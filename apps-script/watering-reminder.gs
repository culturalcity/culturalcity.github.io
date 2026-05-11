/**
 * 閱大安・自動澆水提醒（Phase 1 核心）
 *
 * 部署位置：culturalcity85@gmail.com 的 Apps Script
 * 觸發：每天 08:00–09:00（台北）跑 runDaily()
 *   為什麼不更早：daily-rain.json 由 GitHub Actions cron 每天台北 ~07:00
 *   更新（cron 排 06:00 名目、實際 06:51–07:00 觸發）。08:00 之後跑才能
 *   讀到昨日雨量；若 trigger 設更早（譬如 05:00），past3 / past5 永遠
 *   少 1 天，會在閾值附近誤判。
 * 輸出：在 culturalcity85 主 Calendar 建一個今天 09:30 的事件
 *   （09:30 對齊總幹事 09:00 上班 + 半小時 buffer 看 summary email）
 *
 * 設定步驟：
 *   1) Apps Script Editor → ⚙ Project Settings → Script Properties → 加入：
 *        CWA_API_KEY = <你的 CWA OpenData 金鑰>
 *      （NOTIFY_EMAIL 已寫死進 CONFIG，不需設 Script Property；
 *        若舊版 Property 還在可刪除）
 *   2) Apps Script Editor → ⏰ Triggers → Add Trigger:
 *        Function: runDaily
 *        Event source: Time-driven
 *        Type: Day timer
 *        Time of day: 8am – 9am
 *   3) 第一次執行任何 function 時 Google 會要求授權 Calendar / UrlFetch / Gmail；同意。
 *
 * 測試：
 *   - 執行 testHistoricalCases() 跑 spec 內 5 個歷史日期，看 console 結果
 *   - 執行 simulate('2024-05-12') 模擬該日清晨判斷
 *   - 執行 dryRunToday() 跑今天但只印 log 不建事件
 *
 * 規則 / 閾值請見 CONFIG，spec 凍結中——跑滿 1-2 個月再考慮調。
 */

// ================== 設定 ==================
const CONFIG = {
  // 降雨歷史 JSON（GitHub raw，公開，不需 auth）
  RAIN_HISTORY_URL: 'https://raw.githubusercontent.com/culturalcity/culturalcity.github.io/main/utility/data/daily-rain.json',
  // 氣溫歷史（用於預報 vs 實際的 backfill）
  TEMP_HISTORY_URL: 'https://raw.githubusercontent.com/culturalcity/culturalcity.github.io/main/utility/data/daily-temp.json',

  // CWA 鄉鎮天氣預報（臺北市未來 1 週 12 小時彙總）
  // 文件：https://opendata.cwa.gov.tw/dataset/forecast/F-D0047-063
  CWA_FORECAST_URL: 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-D0047-063',
  CWA_LOCATION: '大安區',

  // CWA 自動雨量站即時資料（每 10 分鐘更新），用 CAAH60「大安森林」站
  // 文件：https://opendata.cwa.gov.tw/dataset/observation/O-A0002-001
  // 為什麼 CAAH60 不是 466920：
  //   · 466920 在中正區（中央氣象署本部），距大安區 5–6 km
  //   · CAAH60 在大安森林公園，是大安區地理中心，能 catch 局部對流雨
  //   · 2026-05-11 case：CAAH60 Past24hr=0.5 mm（catch 到頂樓濕的那場雨），
  //     466920 Past24hr=0 mm（局部雨沒下到中正區）
  // 為什麼 O-A0002-001 不是 O-A0001-001：
  //   · O-A0001-001（自動氣象站）對 466920 只有 Now.Precipitation（10 min），
  //     沒有 Past12hr 等累積值
  //   · O-A0002-001（自動雨量站）才有 Past10Min/1hr/3hr/6Hr/12hr/24hr 完整累積
  // 為什麼用 Past6Hr 不用 Past12hr：
  //   · 我們要看「今天 00:00 到現在累積」對齊日邊界，08:00 跑時最理想是 Past8hr
  //   · 但 CWA schema 沒給 Past8hr，只有 6/12 兩擋可選
  //   · Past6Hr (02:00–08:00) 漏 00:00–02:00 那 2 小時，但語意乾淨（純「今天」）
  //   · Past12hr (昨 20:00–今 08:00) 多 cover 昨晚，會跟 Rule 1（昨日累積）語意重疊
  //   · 設計取捨：寧可漏 2 小時、讓總幹事上樓親眼確認，也不要混雜「今 vs 昨」
  //   · 哲學一致：系統 keep it simple，人眼當最後防線（同「let go」原則）
  // Schema 注意：Past6Hr 大寫 H、Past1hr/3hr/12hr/24hr 小寫 h（CWA 自己的 schema 不統一）
  CWA_REALTIME_URL: 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0002-001',
  CWA_REALTIME_STATION: 'CAAH60',

  // 降雨閾值（mm）
  TODAY_RAIN_SKIP: 0.5,      // 過去 6 小時累積雨量 ≥ 0.5 mm 跳過（Rule 0）
                             // 0.5 是 CWA 雨量計最小觀測單位（傾斗式 0.5 mm/tip），
                             // 校準依據：2026-05-11 case 主委實測 CAAH60=0.5 mm 時頂樓已濕、不需澆
  RAIN_YESTERDAY_SKIP: 5,    // 昨日 ≥ 5 mm 跳過
  RAIN_PAST_3D_SKIP: 8,      // 過去 3 日累積 ≥ 8 mm 跳過（spec 原本 10，調成 8 涵蓋更多潮濕日）
  RAIN_PAST_3D_DRY: 2,       // 過去 3 日累積 < 2 mm 視為乾燥
  RAIN_PAST_5D_LIGHT: 5,     // 過去 5 日累積 < 5 mm 視為連日少雨

  // 預報閾值
  POP_TODAY_SKIP: 70,        // 今日降雨機率 ≥ 70% 跳過
  POP_TOMORROW_SKIP: 80,     // 明日降雨機率 ≥ 80% 跳過（明日大雨，今日省）
  HIGH_TEMP: 28,             // 今日預報 max temp ≥ 28°C 視為高溫

  // 事件
  EVENT_HOUR: 9,
  EVENT_MINUTE: 30,
  EVENT_DURATION_MIN: 30,
  REMINDER_BEFORE_MIN: 30,   // 09:00 響鈴（總幹事剛上班）
  EVENT_LOCATION: '閱大安社區',

  // 通知收件人（每日 summary / 錯誤通知 / 月報三類信件都寄這裡）
  // 寫死進 CONFIG，免得每次重貼 code 還要記得到 Script Properties 對齊
  NOTIFY_EMAIL: 'culturalcity85@gmail.com',
};

// ================== 主入口 ==================

/** 每天 08:00–09:00 由 Trigger 自動呼叫 */
function runDaily() {
  try {
    const today = todayTaipei();
    // 1. 先 check 昨天的完成狀態（log 用，不影響今天決策）
    checkYesterdayCompletion_(today);
    // 2. 跑今天的判斷
    const result = decide(today, true);
    // 2b. 若該澆水，計算建議澆灌分鐘（注入 result.wateringMin / wateringBreakdown / 改 title）
    attachWateringAmount_(result);
    log_('runDaily', formatDate_(today), result);
    // 3. 把今日 forecast snapshot 寫到 Google Sheet（預報精度日誌）
    if (result.forecast) {
      try { logForecastSnapshot_(today, result.forecast); }
      catch (e) { console.warn('forecast log 失敗：', e.message); /* 不阻斷主流程 */ }
    }
    // 4. 寄每日 summary email（不論 SKIP 或 WATER 都寄；含規則表、數據、下次預估）
    try { sendDailySummary_(today, result); }
    catch (e) { console.warn('daily summary email 失敗：', e.message); /* 不阻斷主流程 */ }
    // 5. 該澆就建 Calendar 事件
    if (result.action === 'water') {
      createWateringEvent_(today, result);
    }
  } catch (e) {
    notifyError_('runDaily 異常', e);
    throw e;
  }
}

/**
 * 月初 07:00 由獨立 Trigger 呼叫，寄上月澆水統計給 NOTIFY_EMAIL。
 * Trigger 設定：Function=monthlySummary, Type=Month timer, Day of month=1, Time=7am-8am
 */
function monthlySummary() {
  try {
    const today = todayTaipei();
    // 上個月的範圍
    const monthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth(), 1);
    const stats = collectMonthStats_(monthStart, monthEnd);
    sendMonthlySummary_(monthStart, stats);
  } catch (e) {
    notifyError_('monthlySummary 異常', e);
    throw e;
  }
}

/** 模擬：跑某個歷史日期，只印 log，不建事件、不抓預報（純歷史降雨判斷） */
function simulate(dateStr) {
  const d = parseDate_(dateStr);
  const result = decide(d, false);
  log_('simulate', dateStr, result);
  return result;
}

/** Dry run：跑今天但只 log，不建事件 */
function dryRunToday() {
  const today = todayTaipei();
  const result = decide(today, true);
  log_('dryRunToday', formatDate_(today), result);
  return result;
}

/** 手動測試月報：跑「上個月」並寄信 */
function testMonthlySummary() {
  monthlySummary();
}

/** 手動測試 forecast 日誌：抓今日預報、寫進 Sheet、backfill 之前列 */
function testForecastLog() {
  const today = todayTaipei();
  const forecast = fetchForecast_();
  logForecastSnapshot_(today, forecast);
  const ss = getOrCreateForecastSheet_();
  console.log('日誌試算表 URL：', ss.getUrl());
}

/** 手動測試完成追蹤：log 昨天的澆水事件狀態 */
function testCheckYesterday() {
  return checkYesterdayCompletion_(todayTaipei());
}

/**
 * Spec 歷史測試案例（已用 CODiS 實測校正）
 * spec 原案 2024-05-12 經查 CODiS：前 5 天 0 mm 雨、tmax 33.6°C，是乾熱日不是梅雨期，
 * 已換成 2024-05-13（昨日 16 mm 大雨）作為 Rule 1 真正命中的測試。
 */
function testHistoricalCases() {
  const cases = [
    { date: '2024-05-13', expect: 'skip',  reason: '昨日 16 mm 大雨（Rule 1）' },
    { date: '2024-05-22', expect: 'skip',  reason: '昨日 23.5 mm 豪雨（Rule 1）' },
    { date: '2024-08-13', expect: 'skip',  reason: '颱風前後，昨日 13.5 mm（Rule 1）' },
    { date: '2024-07-20', expect: 'water', reason: '7 月連日無雨高溫（Rule 3 hot-dry）' },
    { date: '2024-02-15', expect: 'water', reason: '2 月連日少雨（Rule 4 dry-spell）' },
    { date: '2024-04-10', expect: 'skip',  reason: '4 月中性日（Rule 5）' },
  ];
  console.log('========== 歷史測試案例 ==========');
  cases.forEach(c => {
    const result = simulate(c.date);
    const match = result.action === c.expect ? '✅' : '❌';
    console.log(`${match} ${c.date} 預期=${c.expect} 實際=${result.action} | ${c.reason}`);
    console.log(`   → ${result.reason || result.title}`);
  });
}

// ================== 核心判斷 ==================

/**
 * @param {Date} today  Date 物件（任何時區皆可，內部統一用台北日期 key）
 * @param {boolean} useForecast  是否抓 CWA 預報（測試模式 false 純看歷史）
 * @return {{action:'water'|'skip', kind?:string, title?:string, color?:string, reason?:string, ...}}
 */
function decide(today, useForecast) {
  const histMap = fetchRainHistory_();
  const r1 = getRainNDaysAgo_(histMap, today, 1);
  const past3 = sumPastRain_(histMap, today, 3);
  const past5 = sumPastRain_(histMap, today, 5);

  // 即時雨量先抓（讓 todayRainSoFar 在所有 return path 都可用，方便 logging）
  let todayRainSoFar = null;
  if (useForecast) {
    todayRainSoFar = fetchTodayRainSoFar_();
  }

  // 預報先抓（讓 forecast 在所有 return path 都可用，方便 logging）
  let forecast = null;
  if (useForecast) {
    try {
      forecast = fetchForecast_();
    } catch (e) {
      console.warn('預報抓取失敗：', e.message);
      // forecast 留 null，後面規則會自動走 fallback
    }
  }

  // 評估順序：Rule 0 → Rule 1 → Rule 4 → fallback → Rule 2 → Rule 3 → Rule 5
  // Rule 0 排最前：實況雨量（天然已澆過）的訊號最強，優先於所有歷史/預報。
  // Rule 4 排在 Rule 2 之前是刻意的：past5 < 5 mm 表示已經連續 5 天明顯缺雨，
  // 這時即使預報明天大雨（Rule 2b）也不能再賭一天，否則植物可能因預報失準而過旱。

  // Rule 0: 今晨已雨（CWA 即時觀測過去 6 小時累積）
  if (todayRainSoFar !== null && todayRainSoFar >= CONFIG.TODAY_RAIN_SKIP) {
    return {
      action: 'skip',
      reason: `今晨過去 6 小時已下雨 ${todayRainSoFar.toFixed(1)} mm（≥ ${CONFIG.TODAY_RAIN_SKIP}）`,
      past3, past5, forecast, todayRainSoFar,
    };
  }

  // Rule 1: 雨後跳過
  if (r1 >= CONFIG.RAIN_YESTERDAY_SKIP) {
    return { action: 'skip', reason: `昨日降雨 ${r1.toFixed(1)} mm（≥ ${CONFIG.RAIN_YESTERDAY_SKIP}）`, past3, past5, forecast, todayRainSoFar };
  }
  if (past3 >= CONFIG.RAIN_PAST_3D_SKIP) {
    return { action: 'skip', reason: `過去 3 日累積雨量 ${past3.toFixed(1)} mm（≥ ${CONFIG.RAIN_PAST_3D_SKIP}）`, past3, past5, forecast, todayRainSoFar };
  }

  // Rule 4: 連日少雨 → 必澆（不論預報，因為已經乾太久）
  if (past5 < CONFIG.RAIN_PAST_5D_LIGHT) {
    return {
      action: 'water', kind: 'dry-spell',
      title: '💧 今日建議澆水（連日少雨）',
      color: 'blue',
      past3, past5, forecast, todayRainSoFar,
    };
  }

  // 預報失敗 fallback：past5 ≥ 5 但 past3 < 2 的灰色地帶（短期乾、長期 OK，沒預報無法判斷）
  if (useForecast && !forecast) {
    if (past3 < CONFIG.RAIN_PAST_3D_DRY) {
      return {
        action: 'water', kind: 'fallback-dry',
        title: '💧 今日建議澆水（預報資料缺，依歷史判斷）',
        color: 'yellow',
        past3, past5, forecast: null, todayRainSoFar,
      };
    }
    return { action: 'skip', reason: '預報資料缺，歷史不顯著乾燥', past3, past5, forecast: null, todayRainSoFar };
  }

  // Rule 2: 雨前跳過
  if (forecast) {
    if (forecast.popToday >= CONFIG.POP_TODAY_SKIP) {
      return { action: 'skip', reason: `今日預報有雨（降雨機率 ${forecast.popToday}%）`, past3, past5, forecast, todayRainSoFar };
    }
    if (forecast.popTomorrow >= CONFIG.POP_TOMORROW_SKIP) {
      return { action: 'skip', reason: `明日預報大雨（降雨機率 ${forecast.popTomorrow}%），今日省`, past3, past5, forecast, todayRainSoFar };
    }
  }

  // Rule 3: 高溫無雨 → 強提醒
  if (forecast && past3 < CONFIG.RAIN_PAST_3D_DRY && forecast.tempToday >= CONFIG.HIGH_TEMP) {
    return {
      action: 'water', kind: 'hot-dry',
      title: '💧 今日建議澆水（高溫無雨）',
      color: 'orange',
      past3, past5, forecast, todayRainSoFar,
    };
  }

  // Rule 5: 中性日
  return {
    action: 'skip',
    reason: `中性日（過去 5 日雨 ${past5.toFixed(1)} mm，無極端）`,
    past3, past5, forecast, todayRainSoFar,
  };
}

// ================== 取資料 ==================

/** 取降雨歷史，回傳 Map<dateKey, mm> */
function fetchRainHistory_() {
  const res = UrlFetchApp.fetch(CONFIG.RAIN_HISTORY_URL, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    throw new Error(`降雨歷史 HTTP ${res.getResponseCode()}`);
  }
  const arr = JSON.parse(res.getContentText());
  const map = {};
  for (const r of arr) map[r.d] = r.rain;
  return map;
}

/** 取氣溫歷史，回傳 Map<dateKey, {tmax, tmin}> */
function fetchTempHistory_() {
  const res = UrlFetchApp.fetch(CONFIG.TEMP_HISTORY_URL, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    throw new Error(`氣溫歷史 HTTP ${res.getResponseCode()}`);
  }
  const arr = JSON.parse(res.getContentText());
  const map = {};
  for (const r of arr) map[r.d] = { tmax: r.tmax, tmin: r.tmin };
  return map;
}

/** 取 N 天前的降雨（缺值保守當 0） */
function getRainNDaysAgo_(map, today, n) {
  const d = new Date(today);
  d.setDate(d.getDate() - n);
  const key = formatDate_(d);
  const v = map[key];
  return (typeof v === 'number') ? v : 0;
}

function sumPastRain_(map, today, n) {
  let sum = 0;
  for (let i = 1; i <= n; i++) sum += getRainNDaysAgo_(map, today, i);
  return sum;
}

/** 取 CWA 預報，回傳今天 / 明天的 {tempToday, popToday, popTomorrow} */
function fetchForecast_() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('CWA_API_KEY');
  if (!apiKey) throw new Error('Script Property CWA_API_KEY 未設');

  const url = `${CONFIG.CWA_FORECAST_URL}?Authorization=${encodeURIComponent(apiKey)}`
    + `&LocationName=${encodeURIComponent(CONFIG.CWA_LOCATION)}&format=JSON`;
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    throw new Error(`CWA HTTP ${res.getResponseCode()}`);
  }
  const json = JSON.parse(res.getContentText());
  const loc = json && json.records && json.records.Locations && json.records.Locations[0]
    && json.records.Locations[0].Location && json.records.Locations[0].Location[0];
  if (!loc) throw new Error('CWA response 結構異常');

  const elements = loc.WeatherElement;
  const tempEl = elements.find(e => e.ElementName === '最高溫度');
  const popEl  = elements.find(e => e.ElementName === '12小時降雨機率');
  if (!tempEl || !popEl) throw new Error('CWA 缺最高溫度或降雨機率欄位');

  const todayKey = formatDate_(todayTaipei());
  const tomorrowKey = formatDate_(addDays_(todayTaipei(), 1));

  // 取每天「白天」slot：StartTime 在該日 06:00–12:00 之間（偏好 06:00 開頭的 12 小時 slot）
  const tempTodaySlot = pickDaySlot_(tempEl.Time, todayKey);
  const popTodaySlot  = pickDaySlot_(popEl.Time, todayKey);
  const popTomSlot    = pickDaySlot_(popEl.Time, tomorrowKey);

  return {
    tempToday: tempTodaySlot ? Number(tempTodaySlot.ElementValue[0].MaxTemperature) : null,
    popToday:  popTodaySlot  ? Number(popTodaySlot.ElementValue[0].ProbabilityOfPrecipitation) : null,
    popTomorrow: popTomSlot  ? Number(popTomSlot.ElementValue[0].ProbabilityOfPrecipitation) : null,
  };
}

/**
 * 抓 CWA CAAH60「大安森林」站「過去 6 小時累積雨量」（mm）。
 * 08:00 runDaily 跑時 ≈ 02:00–08:00 累積，覆蓋凌晨/清晨已下的雨。
 *
 * 為什麼不是 Past12hr：見 CONFIG.CWA_REALTIME_URL 上方註解。
 * 取捨：寧可漏 00:00–02:00 那 2 小時，讓總幹事上樓親眼確認。
 *
 * Schema：station.RainfallElement.Past6Hr.Precipitation（注意大寫 H）。
 *
 * Fail-soft 設計：API 失敗、欄位變化、key 沒設都回傳 null（不拋例外），
 * 主流程會跳過 Rule 0 走原來的 Rule 1-5。避免 API 暫掛就漏澆。
 *
 * @return {number|null}  mm，null 表示無法取得（包含 schema 不認識的情況）
 */
function fetchTodayRainSoFar_() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('CWA_API_KEY');
  if (!apiKey) {
    console.warn('CWA_API_KEY 未設，跳過今晨雨量 check（Rule 0 不會觸發）');
    return null;
  }
  const url = `${CONFIG.CWA_REALTIME_URL}?Authorization=${encodeURIComponent(apiKey)}`
    + `&StationId=${encodeURIComponent(CONFIG.CWA_REALTIME_STATION)}&format=JSON`;
  let json;
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      console.warn(`今晨雨量 API HTTP ${res.getResponseCode()}（Rule 0 不會觸發）`);
      return null;
    }
    json = JSON.parse(res.getContentText());
  } catch (e) {
    console.warn('今晨雨量 API 例外：', e.message, '（Rule 0 不會觸發）');
    return null;
  }

  const station = json && json.records && json.records.Station && json.records.Station[0];
  if (!station) {
    console.warn('今晨雨量 API 回應找不到 Station[0]');
    return null;
  }

  const re = station.RainfallElement;
  if (!re) {
    console.warn('今晨雨量：station 沒有 RainfallElement（dataset 換錯了？）');
    return null;
  }

  // 主要 path：Past6Hr 大寫 H（CWA 目前的 schema）
  let val = null;
  if (re.Past6Hr && re.Past6Hr.Precipitation != null) {
    val = parseFloat(re.Past6Hr.Precipitation);
  }
  // Schema 變動 fallback：未來 CWA 統一成小寫 h 也能 catch
  else if (re.Past6hr && re.Past6hr.Precipitation != null) {
    val = parseFloat(re.Past6hr.Precipitation);
    console.warn('今晨雨量：CWA schema 統一成小寫 h 了，請更新 code');
  }

  if (val == null || isNaN(val)) {
    console.warn('今晨雨量：無法解析 Past6Hr.Precipitation（schema 變了？）');
    return null;
  }
  // CWA 對 missing data 用 -99 / -99.0 / -990 等負值
  if (val < 0) return 0;
  return val;
}

/** 從一連串 12 小時 slot 中挑出「某天的白天 slot」(StartTime 落在該日 06:00-12:00) */
function pickDaySlot_(timeArr, dateKey) {
  for (const t of timeArr) {
    const start = new Date(t.StartTime);
    const startKey = formatDate_(start);
    if (startKey !== dateKey) continue;
    const h = Number(Utilities.formatDate(start, 'Asia/Taipei', 'H'));
    if (h >= 6 && h < 12) return t;
  }
  // fallback：任何 StartTime 在該日的第一個 slot
  return timeArr.find(t => formatDate_(new Date(t.StartTime)) === dateKey) || null;
}

// ================== 預報精度日誌 ==================
//
// 每天清晨 5 點寫入今日 forecast snapshot 到 Google Sheet，並 backfill
// 之前所有列的「實際值」（從 daily-rain.json / daily-temp.json）。
// 跑滿 1-2 個月後可以分析 CWA 預報的校準曲線（降雨機率 70% 實際下雨多少 % 等）。
//
// Sheet 結構：
//   date | popToday | popTomorrow | tempToday | actualRainToday | actualTmaxToday | recordedAt
//
// Sheet ID 第一次跑時自動建立，存進 Script Property `FORECAST_SHEET_ID`，
// Sheet 本身放在 culturalcity85 的 My Drive 根目錄。

/** 取（或第一次建）forecast 日誌試算表 */
function getOrCreateForecastSheet_() {
  const props = PropertiesService.getScriptProperties();
  const existingId = props.getProperty('FORECAST_SHEET_ID');
  if (existingId) {
    try { return SpreadsheetApp.openById(existingId); }
    catch (e) { console.warn('FORECAST_SHEET_ID 失效，重新建立'); }
  }
  const ss = SpreadsheetApp.create('閱大安澆水提醒・預報精度日誌');
  const sheet = ss.getActiveSheet();
  sheet.setName('Forecast Log');
  const headers = ['date', 'popToday', 'popTomorrow', 'tempToday',
                   'actualRainToday', 'actualTmaxToday', 'recordedAt'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  props.setProperty('FORECAST_SHEET_ID', ss.getId());
  console.log('建立預報精度日誌 Sheet：', ss.getUrl());
  return ss;
}

/** 寫今日 snapshot + backfill 之前所有列的實際值 */
function logForecastSnapshot_(today, forecast) {
  const ss = getOrCreateForecastSheet_();
  const sheet = ss.getSheets()[0];
  const todayKey = formatDate_(today);

  // 1. backfill 既有列的 actual 欄位
  backfillActuals_(sheet);

  // 2. 看今天是否已寫過（runDaily 不該重複，但 dryRunToday 可能多次）
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === todayKey) {
      console.log('forecast log: 今日已記錄，skip 新增');
      return;
    }
  }

  // 3. append 新列
  sheet.appendRow([
    todayKey,
    forecast.popToday,
    forecast.popTomorrow,
    forecast.tempToday,
    '', '',          // actualRainToday / actualTmaxToday 留空，之後 backfill
    new Date(),
  ]);
  console.log(`forecast log: ${todayKey} 寫入完成`);
}

/** 對 sheet 裡每一列檢查 actual 欄位，若可從 history 取得就回填 */
function backfillActuals_(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return;

  // 先抓 history（一次抓一份就好）
  let rainMap, tempMap;
  try { rainMap = fetchRainHistory_(); }
  catch (e) { console.warn('backfill: 抓 rain 失敗', e.message); return; }
  try { tempMap = fetchTempHistory_(); }
  catch (e) { console.warn('backfill: 抓 temp 失敗', e.message); return; }

  let updated = 0;
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const dateKey = row[0];
    // actualRainToday（注意：0 是有效值，不是 falsy）
    if (row[4] === '' && rainMap[dateKey] != null) {
      sheet.getRange(i + 1, 5).setValue(rainMap[dateKey]);
      updated++;
    }
    // actualTmaxToday
    if (row[5] === '' && tempMap[dateKey] && tempMap[dateKey].tmax != null) {
      sheet.getRange(i + 1, 6).setValue(tempMap[dateKey].tmax);
      updated++;
    }
  }
  if (updated > 0) console.log(`forecast log: backfilled ${updated} cells`);
}

// ================== 完成追蹤 / 月統計 ==================

/**
 * 檢查昨天的澆水事件完成狀態。
 * 三態：
 * - 顏色 = GRAY（石墨黑） → ✅ 已澆水
 * - 顏色 = GREEN（羅勒綠/Basil）→ 🌧 看完未澆（因雨或現場判斷不需）
 * - 其他顏色（橘/藍/黃 等原始建立色） → ⚠ 漏標（可能漏澆或忘記改色）
 * - 沒事件 → 昨天本來就不需澆水，沒事
 */
function checkYesterdayCompletion_(today) {
  const cal = CalendarApp.getDefaultCalendar();
  const yesterday = addDays_(today, -1);
  const ystart = new Date(yesterday); ystart.setHours(0, 0, 0, 0);
  const yend = new Date(yesterday); yend.setHours(23, 59, 59, 999);

  const events = cal.getEvents(ystart, yend).filter(ev => ev.getTitle().startsWith('💧'));
  if (events.length === 0) {
    console.log(`[completion] 昨天 ${formatDate_(yesterday)} 無澆水事件（不需澆水日）`);
    return { hadEvent: false };
  }
  const ev = events[0];
  const color = ev.getColor(); // String "1"..."11" 或 "0" (default)；GRAY="8"、GREEN="10"
  const isDone = color === CalendarApp.EventColor.GRAY;
  const isCancelled = color === CalendarApp.EventColor.GREEN;
  let label = '⚠ 未標完成（可能漏澆或忘記改顏色）';
  if (isDone) label = '✅ 已標完成（已澆水）';
  else if (isCancelled) label = '🌧 看完未澆（因雨或現場判斷不需）';
  console.log(`[completion] 昨天 ${formatDate_(yesterday)}「${ev.getTitle()}」→ ${label}`);
  return { hadEvent: true, isDone, isCancelled, event: ev };
}

/**
 * 抓某段日期範圍內的 💧 事件統計。
 * 三種事件結束狀態：
 *   · done       — 顏色 = GRAY（石墨黑）：總幹事標已澆
 *   · cancelled  — 顏色 = GREEN（羅勒綠/Basil）：總幹事看完判斷不需澆（因雨等）
 *   · missed     — 其他顏色（保留原始建立色）：漏標或漏澆
 * @return {{total, done, cancelled, missed, byKind, days}}
 */
function collectMonthStats_(start, end) {
  const cal = CalendarApp.getDefaultCalendar();
  const events = cal.getEvents(start, end).filter(ev => ev.getTitle().startsWith('💧'));
  const stats = {
    total: events.length,
    done: 0,
    cancelled: 0,
    missed: 0,
    byKind: { 'hot-dry': 0, 'dry-spell': 0, 'fallback-dry': 0, 'other': 0 },
    days: [],
  };
  for (const ev of events) {
    const color = ev.getColor();
    const done = color === CalendarApp.EventColor.GRAY;
    const cancelled = color === CalendarApp.EventColor.GREEN;
    if (done) stats.done++;
    else if (cancelled) stats.cancelled++;
    else stats.missed++;

    const title = ev.getTitle();
    let kind = 'other';
    if (title.includes('高溫無雨')) kind = 'hot-dry';
    else if (title.includes('連日少雨')) kind = 'dry-spell';
    else if (title.includes('預報資料缺')) kind = 'fallback-dry';
    stats.byKind[kind] = (stats.byKind[kind] || 0) + 1;

    stats.days.push({
      date: formatDate_(ev.getStartTime()),
      title,
      done,
      cancelled,
    });
  }
  return stats;
}

function sendMonthlySummary_(monthStart, stats) {
  const to = CONFIG.NOTIFY_EMAIL;
  if (!to) {
    console.log('NOTIFY_EMAIL 未設，跳過月統計寄信');
    return;
  }
  const ym = Utilities.formatDate(monthStart, 'Asia/Taipei', 'yyyy 年 M 月');
  // 漏標率 = 漏標 / 推薦總數（cancelled 屬於合理結束、不算漏）
  const missRate = stats.total === 0 ? 0 : (stats.missed / stats.total * 100);
  // 因雨取消率 = cancelled / 推薦總數，太高代表系統建議澆水太頻繁
  const cancelRate = stats.total === 0 ? 0 : (stats.cancelled / stats.total * 100);

  const lines = [];
  lines.push(`📅 ${ym} 澆水提醒月報`);
  lines.push('');
  lines.push(`• 推薦澆水：${stats.total} 天`);
  lines.push(`  ├─ 高溫無雨（橙橘色）：${stats.byKind['hot-dry']} 天`);
  lines.push(`  ├─ 連日少雨（藍）：${stats.byKind['dry-spell']} 天`);
  lines.push(`  └─ 備援（黃）：${stats.byKind['fallback-dry']} 天`);
  lines.push(`• 已澆完成（石墨黑）：${stats.done} 天`);
  lines.push(`• 看完未澆（羅勒綠）：${stats.cancelled} 天（因雨或現場判斷不需，因雨取消率 ${cancelRate.toFixed(0)}%）`);
  lines.push(`• 漏標：${stats.missed} 天（漏標率 ${missRate.toFixed(0)}%）`);
  lines.push('');
  lines.push('— 詳細日期 —');
  stats.days.forEach(d => {
    const icon = d.done ? '✅' : (d.cancelled ? '🌧' : '⚠');
    lines.push(`${icon} ${d.date}  ${d.title}`);
  });
  lines.push('');
  lines.push('— 提醒 —');
  if (missRate >= 30) {
    lines.push(`⚠ 漏標率 ${missRate.toFixed(0)}% 偏高。可能：(1) 總幹事忘記改顏色 (2) 真的有漏澆。建議跟總幹事確認。`);
  }
  if (cancelRate >= 30) {
    lines.push(`💡 因雨取消率 ${cancelRate.toFixed(0)}% 偏高，代表系統建議澆水比實際需要頻繁。可考慮調 Rule 3 / Rule 4 閾值。`);
  }
  lines.push('回顧 / 調整閾值請編輯 Apps Script 的 CONFIG 區塊。');

  MailApp.sendEmail({
    to,
    subject: `[閱大安澆水] ${ym} 月報（推薦 ${stats.total} / 澆 ${stats.done} / 雨取消 ${stats.cancelled}）`,
    body: lines.join('\n'),
  });
  console.log('月報寄出 →', to);
}

// ================== Calendar 事件 ==================

/**
 * 計算建議澆水分鐘（保守原則：寧多勿少，cap 15 分）。
 * 公式：基礎（依規則） + 修正項（依乾旱程度與高溫加成）
 *   - Rule 4 連日少雨：基礎 5 分
 *   - Rule 3 高溫無雨：基礎 8 分
 *   - fallback-dry（預報缺值）：基礎 6 分（保守 +1）
 *   - past3 < 0.5 mm：+2 分（土壤幾乎完全乾燥）
 *   - past5 === 0 mm：+1 分（連續 5 日無雨）
 *   - forecast.tempToday >= 32：+2 分（極端高溫蒸散更猛）
 * @return {{minutes:number, breakdown:string[]}}
 */
function calcWateringMin_(result) {
  let base = 5;
  let baseLabel = 'Rule 4 連日少雨';
  if (result.kind === 'hot-dry') {
    base = 8;
    baseLabel = 'Rule 3 高溫無雨';
  } else if (result.kind === 'fallback-dry') {
    base = 6;
    baseLabel = '備援（預報缺值）保守';
  }
  const parts = [`基礎 ${base} 分（${baseLabel}）`];
  let total = base;

  if (result.past3 < 0.5) {
    total += 2;
    parts.push(`+2 分（過去 3 日 ${result.past3.toFixed(1)} mm < 0.5 mm，土壤完全乾燥）`);
  }
  if (result.past5 === 0) {
    total += 1;
    parts.push('+1 分（過去 5 日 0 mm，連續無雨）');
  }
  if (result.forecast && result.forecast.tempToday != null && result.forecast.tempToday >= 32) {
    total += 2;
    parts.push(`+2 分（預報最高溫 ${result.forecast.tempToday}°C ≥ 32，蒸散更猛）`);
  }

  if (total > 15) {
    total = 15;
    parts.push('（cap at 15 分）');
  }
  return { minutes: total, breakdown: parts };
}

/** 把計算結果注入 result，改寫 title 加上分鐘數。SKIP 結果不動。 */
function attachWateringAmount_(result) {
  if (!result || result.action !== 'water') return;
  const calc = calcWateringMin_(result);
  result.wateringMin = calc.minutes;
  result.wateringBreakdown = calc.breakdown;
  // 改寫 title：原本「💧 今日建議澆水（高溫無雨）」→「💧 澆水 8 分鐘（高溫無雨）」
  result.title = result.title.replace(/^💧\s*今日建議澆水/, `💧 澆水 ${result.wateringMin} 分鐘`);
}

const WEEKDAY_TC_ = ['日', '一', '二', '三', '四', '五', '六'];

/**
 * 寄出每日澆水判斷 summary email 給 NOTIFY_EMAIL（社區共用帳號 culturalcity85）。
 * 不論 SKIP 或 WATER 都寄。Calendar 事件邏輯維持原樣（只在 WATER 日建）。
 *
 * 用 GmailApp.sendEmail（不是 MailApp，差異：MailApp 有 quota 限制、寄件人是
 * 不可控的 noreply；GmailApp 寄件人就是腳本所有者帳號 culturalcity85）。
 * 因為 Apps Script 部署在 culturalcity85、收件人也是 culturalcity85，本質上
 * 是「自己寄給自己」，會直接進 Inbox。
 */
function sendDailySummary_(today, result) {
  const to = CONFIG.NOTIFY_EMAIL;
  if (!to) {
    console.warn('NOTIFY_EMAIL 未設，跳過 daily summary email');
    return;
  }

  const dateStr = formatDate_(today);
  const dateLabel = `${dateStr}（週${WEEKDAY_TC_[today.getDay()]}）`;
  const isWater = result.action === 'water';

  const subject = isWater
    ? `閱大安澆水預告：${dateStr} 澆水（建議 ${result.wateringMin} 分鐘）`
    : `閱大安澆水預告：${dateStr} 不澆水`;

  const lines = [];
  lines.push('=========================================');
  lines.push('  閱大安・每日澆水預告');
  lines.push('=========================================');
  lines.push('');
  lines.push(`【今日判斷】${dateLabel}`);
  lines.push(isWater ? '  ✓ 澆水' : '  ✗ 不澆水');
  lines.push('');

  // 觸發規則
  lines.push('【觸發規則】');
  if (isWater) {
    if (result.kind === 'hot-dry') {
      lines.push('  Rule 3 — 高溫無雨');
      lines.push(`  · 過去 3 日累計 ${result.past3.toFixed(1)} mm < 2 mm 閾值`);
      if (result.forecast && result.forecast.tempToday != null) {
        lines.push(`  · 預報最高溫 ${result.forecast.tempToday}°C ≥ 28°C 閾值`);
      }
    } else if (result.kind === 'dry-spell') {
      lines.push('  Rule 4 — 連日少雨');
      lines.push(`  · 過去 5 日累計 ${result.past5.toFixed(1)} mm < 5 mm 閾值`);
    } else if (result.kind === 'fallback-dry') {
      lines.push('  備援 — 預報資料缺，依歷史判斷');
      lines.push(`  · 過去 3 日累計 ${result.past3.toFixed(1)} mm < 2 mm 閾值`);
    }
  } else {
    lines.push(`  ${result.reason || '中性日（無極端）'}`);
  }
  lines.push('');

  // 建議澆水量（只在 WATER 日）
  if (isWater && result.wateringMin) {
    lines.push('【建議澆水量】');
    lines.push(`  ${result.wateringMin} 分鐘（約 ${(result.wateringMin * 0.2).toFixed(1)} 度公水）`);
    if (result.wateringBreakdown && result.wateringBreakdown.length) {
      result.wateringBreakdown.forEach(p => lines.push(`  · ${p}`));
    }
    lines.push('  ⚠ 保守設計，寧多勿少。實際土壤狀況請目測判斷。');
    lines.push('');
  }

  // 降雨數據
  lines.push('【降雨數據】');
  if (result.todayRainSoFar != null) {
    lines.push(`  今晨已雨 ...... ${result.todayRainSoFar.toFixed(1)} mm（過去 6 小時，CAAH60 大安森林站即時）`);
  }
  lines.push(`  過去 3 日累計 ... ${result.past3.toFixed(1)} mm`);
  lines.push(`  過去 5 日累計 ... ${result.past5.toFixed(1)} mm`);
  lines.push('');

  // 預報資訊
  if (result.forecast) {
    lines.push('【今日預報】');
    if (result.forecast.tempToday != null)   lines.push(`  最高溫 ........ ${result.forecast.tempToday}°C`);
    if (result.forecast.popToday != null)    lines.push(`  今日降雨機率 .. ${result.forecast.popToday}%`);
    if (result.forecast.popTomorrow != null) lines.push(`  明日降雨機率 .. ${result.forecast.popTomorrow}%`);
    lines.push('');
  }

  // 下次澆水預估（只在 SKIP 日）
  if (!isWater) {
    let next = null;
    try { next = simulateNextWaterDay_(today); }
    catch (e) { console.warn('simulateNextWaterDay_ 失敗：', e.message); }
    if (next && (next.conditional || next.guaranteed)) {
      lines.push('【接下來可能 / 必澆水日】');
      // 情境一：conditional 比 guaranteed 早 → 兩個都列（最早可能 + 最遲必澆）
      // 情境二：兩個同一天 → 列一個（已是 Rule 4 必澆）
      // 情境三：只有 conditional → 14 天內 past5 沒掉到 5 以下，只列條件
      // 情境四：只有 guaranteed → 罕見（past5 直接掉但 past3 還沒掉），列 guaranteed
      if (next.conditional && next.guaranteed && next.conditional.date !== next.guaranteed.date) {
        lines.push(`  · ${next.conditional.date}（最早）：Rule 3 候選 — 若當日預報最高溫 ≥ 28°C 則澆`);
        lines.push(`  · ${next.guaranteed.date}（最遲）：Rule 4 連日少雨必澆 — 不論氣溫`);
      } else if (next.guaranteed) {
        lines.push(`  · ${next.guaranteed.date}：Rule 4 連日少雨必澆 — 不論氣溫`);
      } else if (next.conditional) {
        lines.push(`  · ${next.conditional.date}：Rule 3 候選 — 若當日預報最高溫 ≥ 28°C 則澆（14 日內無 Rule 4 必澆日）`);
      }
      lines.push('  ※ 以上假設明天起都不下雨。實際視天氣而定。');
      lines.push('');
    }
  }

  lines.push('=========================================');
  lines.push('  完整規則參考（社區自訂啟發式，非援引文獻）');
  lines.push('=========================================');
  lines.push('');
  lines.push('評估順序：Rule 0 → Rule 1 → Rule 4 → 備援 → Rule 2 → Rule 3 → Rule 5');
  lines.push('（Rule 0 排最前：實況雨量訊號最強，優先於歷史/預報。）');
  lines.push('（Rule 4 刻意排在 Rule 2 前，避免「連日少雨必澆」被「預報明日有雨」遮蔽）');
  lines.push('');
  lines.push('Rule 0（今晨已雨）：');
  lines.push('  · CWA 自動雨量站 CAAH60 大安森林站「過去 6 小時累積雨量」≥ 0.5 mm → 跳過');
  lines.push('  · 08:00 runDaily 時 ≈ 02:00–08:00 累積，覆蓋凌晨/清晨已下的雨');
  lines.push('Rule 1（雨後跳過）：');
  lines.push('  · 昨日降雨 ≥ 5 mm → 跳過');
  lines.push('  · 過去 3 日累計 ≥ 8 mm → 跳過');
  lines.push('Rule 4（連日少雨）：');
  lines.push('  · 過去 5 日 < 5 mm → 澆水（不論氣溫、不論預報）');
  lines.push('備援（預報資料缺時的保守觸發）：');
  lines.push('  · CWA 預報抓取失敗，且過去 3 日 < 2 mm → 短澆 6 分鐘');
  lines.push('  · （當 past5 < 5 已先觸發 Rule 4 時不會走到這裡）');
  lines.push('Rule 2（雨前跳過）：');
  lines.push('  · 今日降雨機率 ≥ 70% → 跳過');
  lines.push('  · 明日降雨機率 ≥ 80% → 跳過');
  lines.push('Rule 3（高溫無雨）：');
  lines.push('  · 過去 3 日 < 2 mm 且預報最高溫 ≥ 28°C → 澆水');
  lines.push('Rule 5（中性日）：上述都不滿足 → 跳過');
  lines.push('');
  lines.push('⚠ 上述閾值（0.5 mm / 5 mm / 8 mm / 28°C / 2 mm / 5 mm）為社區內部估值，');
  lines.push('  尚未對照 FAO-56 或 extension service 的 ET 模型校準。');
  lines.push('  累積運作資料後可再調整。');
  lines.push('');

  lines.push('=========================================');
  lines.push('  澆水量公式參考');
  lines.push('=========================================');
  lines.push('');
  lines.push('基礎：Rule 4 為 5 分、Rule 3 為 8 分、備援為 6 分');
  lines.push('+ 2 分 if past3 < 0.5 mm（土壤完全乾燥）');
  lines.push('+ 1 分 if past5 = 0 mm（連 5 日滴雨未下）');
  lines.push('+ 2 分 if 預報最高溫 ≥ 32°C（極端高溫）');
  lines.push('Cap 15 分。');
  lines.push('');

  lines.push('【資料來源】');
  lines.push('· 中央氣象署 CODiS 466920 臺北站每日累計雨量（歷史，隔日 settle）');
  lines.push('· CWA 自動雨量站 O-A0002-001 CAAH60 大安森林站（今晨雨量，10 分鐘更新）');
  lines.push('· CWA 鄉鎮天氣預報（大安區）');
  lines.push('');

  lines.push('【備註】');
  if (isWater) {
    const eventTimeLabel = `${String(CONFIG.EVENT_HOUR).padStart(2,'0')}:${String(CONFIG.EVENT_MINUTE).padStart(2,'0')}`;
    lines.push(`· 本次澆水提醒已建立 culturalcity85 行事曆 ${eventTimeLabel} 事件。`);
    lines.push('· 處理完請依實況改行事曆事件顏色（便於月底統計）：');
    lines.push('  ‐ 有澆水 → 改「石墨黑」（Graphite，灰色那個）');
    lines.push('  ‐ 上樓看完判斷不需澆（因雨等）→ 改「羅勒綠」（Basil）');
  } else {
    lines.push('· 今日不澆水，未建立行事曆事件。');
  }
  lines.push('');
  lines.push('——');
  lines.push('本信由 watering-reminder.gs 自動產生');
  lines.push('每日台北 08:00–09:00 觸發、以 culturalcity85 帳號發信');

  GmailApp.sendEmail(to, subject, lines.join('\n'));
  console.log('每日 summary email 已寄出 →', to);
}

/**
 * 預測接下來最早可能澆水的日期（往後推 14 天，假設都不下雨）。
 * 同時回兩個候選：
 *   conditional — 最早可能 Rule 3 候選日（要看當日 28°C 才澆）
 *   guaranteed — 最早 Rule 4 必澆日（不論氣溫）
 * 一般兩個都有：conditional 是「最早可能」、guaranteed 是「最遲必澆」。
 * @param {Date} today 台北時區「今天」的 Date
 * @return {{conditional: ?{date:string,past3:number,past5:number}, guaranteed: ?{date:string,past3:number,past5:number}}}
 */
function simulateNextWaterDay_(today) {
  const histMap = fetchRainHistory_();
  let conditional = null;
  let guaranteed = null;

  for (let offset = 1; offset <= 14; offset++) {
    const futureDay = addDays_(today, offset);

    const r1Date = addDays_(futureDay, -1);
    const r1 = r1Date.getTime() <= today.getTime() ? (histMap[formatDate_(r1Date)] || 0) : 0;
    let past3 = 0, past5 = 0;
    for (let k = 1; k <= 5; k++) {
      const d = addDays_(futureDay, -k);
      if (d.getTime() > today.getTime()) continue;
      const v = histMap[formatDate_(d)] || 0;
      if (k <= 3) past3 += v;
      past5 += v;
    }

    if (r1 >= CONFIG.RAIN_YESTERDAY_SKIP) continue;
    if (past3 >= CONFIG.RAIN_PAST_3D_SKIP) continue;

    // Rule 1 通過
    if (!guaranteed && past5 < CONFIG.RAIN_PAST_5D_LIGHT) {
      guaranteed = { date: formatDate_(futureDay), past3, past5 };
    }
    if (!conditional && past3 < CONFIG.RAIN_PAST_3D_DRY) {
      conditional = { date: formatDate_(futureDay), past3, past5 };
    }
    if (conditional && guaranteed) break;
  }
  return { conditional, guaranteed };
}

function createWateringEvent_(today, result) {
  const cal = CalendarApp.getDefaultCalendar();
  const dayStart = new Date(today); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(today); dayEnd.setHours(23, 59, 59, 999);

  // 去重：今天已有「💧」開頭的事件就 skip
  const existing = cal.getEvents(dayStart, dayEnd).filter(ev => ev.getTitle().startsWith('💧'));
  if (existing.length > 0) {
    console.log('已有澆水事件，skip 建立');
    return existing[0];
  }

  const start = new Date(today);
  start.setHours(CONFIG.EVENT_HOUR, CONFIG.EVENT_MINUTE, 0, 0);
  const end = new Date(start.getTime() + CONFIG.EVENT_DURATION_MIN * 60 * 1000);

  const event = cal.createEvent(result.title, start, end, {
    description: buildDescription_(result, today),
    location: CONFIG.EVENT_LOCATION,
  });
  event.setColor(eventColor_(result.color));
  event.addPopupReminder(CONFIG.REMINDER_BEFORE_MIN);
  console.log('建立事件 OK：', event.getTitle(), '@', start);
  return event;
}

function buildDescription_(result, today) {
  const lines = [];
  lines.push('📊 判斷依據');
  if (result.todayRainSoFar != null) {
    lines.push(`• 今晨已雨（過去 6 小時）：${result.todayRainSoFar.toFixed(1)} mm`);
  }
  lines.push(`• 過去 3 日累積降雨：${result.past3.toFixed(1)} mm`);
  lines.push(`• 過去 5 日累積降雨：${result.past5.toFixed(1)} mm`);
  if (result.forecast) {
    if (result.forecast.tempToday != null)   lines.push(`• 今日預報最高溫：${result.forecast.tempToday}°C`);
    if (result.forecast.popToday != null)    lines.push(`• 今日降雨機率：${result.forecast.popToday}%`);
    if (result.forecast.popTomorrow != null) lines.push(`• 明日降雨機率：${result.forecast.popTomorrow}%`);
  }
  lines.push('');
  lines.push('🚿 建議操作');
  if (result.wateringMin) {
    lines.push(`• 全區手動開啟澆灌 ${result.wateringMin} 分鐘（保守原則：寧多勿少）`);
    if (result.wateringBreakdown && result.wateringBreakdown.length) {
      lines.push('   分解：');
      result.wateringBreakdown.forEach(p => lines.push(`     · ${p}`));
    }
  } else {
    lines.push('• 全區手動開啟澆灌約 10–15 分鐘');
  }
  lines.push('• 處理完請依實況改顏色（隔日腳本會依顏色分類統計）：');
  lines.push('   · 有澆水 → 「石墨黑」（Graphite，灰色那個）');
  lines.push('   · 上樓看完判斷不需澆（因雨等）→ 「羅勒綠」（Basil）');
  lines.push('   · 都不改 → 月報會列為「漏標」');
  lines.push('');
  lines.push(`📌 由「閱大安水電監督系統」自動建立 ${formatDate_(today)} 08:00`);
  return lines.join('\n');
}

function eventColor_(name) {
  switch (name) {
    case 'orange': return CalendarApp.EventColor.ORANGE;
    case 'blue':   return CalendarApp.EventColor.BLUE;
    case 'yellow': return CalendarApp.EventColor.YELLOW;
    case 'gray':   return CalendarApp.EventColor.GRAY;
    default:       return CalendarApp.EventColor.DEFAULT;
  }
}

// ================== 工具 ==================

/** 台北時區的「今天 00:00」 */
function todayTaipei() {
  const ymd = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd').split('-').map(Number);
  return new Date(ymd[0], ymd[1] - 1, ymd[2]);
}

function addDays_(d, n) {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}

function formatDate_(d) {
  return Utilities.formatDate(d, 'Asia/Taipei', 'yyyy-MM-dd');
}

function parseDate_(s) {
  const [y, m, day] = s.split('-').map(Number);
  return new Date(y, m - 1, day);
}

function log_(tag, dateStr, result) {
  console.log(`[${tag}] ${dateStr} → ${result.action.toUpperCase()}${result.kind ? ` (${result.kind})` : ''}`);
  if (result.reason) console.log(`    reason: ${result.reason}`);
  if (result.title)  console.log(`    title : ${result.title}`);
  if (result.forecast) console.log(`    forecast: tempToday=${result.forecast.tempToday}, popToday=${result.forecast.popToday}, popTomorrow=${result.forecast.popTomorrow}`);
  console.log(`    rain: past3=${result.past3?.toFixed?.(1)} mm, past5=${result.past5?.toFixed?.(1)} mm`
    + (result.todayRainSoFar != null ? `, todayRainSoFar=${result.todayRainSoFar.toFixed(1)} mm` : ''));
}

function notifyError_(subject, err) {
  try {
    const to = CONFIG.NOTIFY_EMAIL;
    if (!to) return;
    MailApp.sendEmail({
      to,
      subject: `[閱大安澆水提醒] ${subject}`,
      body: `${err && err.message}\n\n${err && err.stack || '(no stack)'}\n\n時間：${new Date()}`,
    });
  } catch (e) {
    console.error('notifyError_ 自身失敗：', e.message);
  }
}
