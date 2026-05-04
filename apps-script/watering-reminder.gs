/**
 * 閱大安・自動澆水提醒（Phase 1 核心）
 *
 * 部署位置：culturalcity85@gmail.com 的 Apps Script
 * 觸發：每天 05:00（台北）跑 runDaily()
 * 輸出：在 culturalcity85 主 Calendar 建一個今天 06:30 的事件
 *
 * 設定步驟：
 *   1) Apps Script Editor → ⚙ Project Settings → Script Properties → 加入：
 *        CWA_API_KEY = <你的 CWA OpenData 金鑰>
 *        NOTIFY_EMAIL = wentaihsu@gmail.com   (選填，錯誤通知收件人)
 *   2) Apps Script Editor → ⏰ Triggers → Add Trigger:
 *        Function: runDaily
 *        Event source: Time-driven
 *        Type: Day timer
 *        Time of day: 5am – 6am
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

  // CWA 鄉鎮天氣預報（臺北市未來 1 週 12 小時彙總）
  // 文件：https://opendata.cwa.gov.tw/dataset/forecast/F-D0047-063
  CWA_FORECAST_URL: 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-D0047-063',
  CWA_LOCATION: '大安區',

  // 降雨閾值（mm）
  RAIN_YESTERDAY_SKIP: 5,    // 昨日 ≥ 5 mm 跳過
  RAIN_PAST_3D_SKIP: 8,      // 過去 3 日累積 ≥ 8 mm 跳過（spec 原本 10，調成 8 涵蓋更多潮濕日）
  RAIN_PAST_3D_DRY: 2,       // 過去 3 日累積 < 2 mm 視為乾燥
  RAIN_PAST_5D_LIGHT: 5,     // 過去 5 日累積 < 5 mm 視為連日少雨

  // 預報閾值
  POP_TODAY_SKIP: 70,        // 今日 PoP ≥ 70% 跳過
  POP_TOMORROW_SKIP: 80,     // 明日 PoP ≥ 80% 跳過（明日大雨，今日省）
  HIGH_TEMP: 28,             // 今日預報 max temp ≥ 28°C 視為高溫

  // 事件
  EVENT_HOUR: 6,
  EVENT_MINUTE: 30,
  EVENT_DURATION_MIN: 30,
  REMINDER_BEFORE_MIN: 30,   // 06:00 響鈴
  EVENT_LOCATION: '閱大安社區',
};

// ================== 主入口 ==================

/** 每天 05:00 由 Trigger 自動呼叫 */
function runDaily() {
  try {
    const today = todayTaipei();
    // 1. 先 check 昨天的完成狀態（log 用，不影響今天決策）
    checkYesterdayCompletion_(today);
    // 2. 跑今天的判斷
    const result = decide(today, true);
    log_('runDaily', formatDate_(today), result);
    // 3. 該澆就建事件
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

  // Rule 1: 雨後跳過
  if (r1 >= CONFIG.RAIN_YESTERDAY_SKIP) {
    return { action: 'skip', reason: `昨日降雨 ${r1.toFixed(1)} mm（≥ ${CONFIG.RAIN_YESTERDAY_SKIP}）`, past3, past5 };
  }
  if (past3 >= CONFIG.RAIN_PAST_3D_SKIP) {
    return { action: 'skip', reason: `過去 3 日累積雨量 ${past3.toFixed(1)} mm（≥ ${CONFIG.RAIN_PAST_3D_SKIP}）`, past3, past5 };
  }

  // 取預報（如不需要或失敗，走 fallback）
  let forecast = null;
  if (useForecast) {
    try {
      forecast = fetchForecast_();
    } catch (e) {
      console.warn('預報抓取失敗：', e.message);
      // Fallback：保守原則「植物不會放假」——歷史顯著乾燥就提醒
      if (past3 < CONFIG.RAIN_PAST_3D_DRY) {
        return {
          action: 'water',
          kind: 'fallback-dry',
          title: '💧 今日建議澆水（預報資料缺，依歷史判斷）',
          color: 'yellow',
          past3, past5, forecast: null,
        };
      }
      return { action: 'skip', reason: '預報資料缺，歷史不顯著乾燥', past3, past5 };
    }
  }

  // Rule 2: 雨前跳過
  if (forecast) {
    if (forecast.popToday >= CONFIG.POP_TODAY_SKIP) {
      return { action: 'skip', reason: `今日預報有雨（PoP ${forecast.popToday}%）`, past3, past5, forecast };
    }
    if (forecast.popTomorrow >= CONFIG.POP_TOMORROW_SKIP) {
      return { action: 'skip', reason: `明日預報大雨（PoP ${forecast.popTomorrow}%），今日省`, past3, past5, forecast };
    }
  }

  // Rule 3: 高溫無雨 → 強提醒
  if (forecast && past3 < CONFIG.RAIN_PAST_3D_DRY && forecast.tempToday >= CONFIG.HIGH_TEMP) {
    return {
      action: 'water', kind: 'hot-dry',
      title: '💧 今日建議澆水（高溫無雨）',
      color: 'orange',
      past3, past5, forecast,
    };
  }

  // Rule 4: 連日少雨 → 一般提醒
  if (past5 < CONFIG.RAIN_PAST_5D_LIGHT) {
    return {
      action: 'water', kind: 'dry-spell',
      title: '💧 今日建議澆水（連日少雨）',
      color: 'blue',
      past3, past5, forecast,
    };
  }

  // Rule 5: 中性日
  return {
    action: 'skip',
    reason: `中性日（過去 5 日雨 ${past5.toFixed(1)} mm，無極端）`,
    past3, past5, forecast,
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

// ================== 完成追蹤 / 月統計 ==================

/**
 * 檢查昨天的澆水事件完成狀態。
 * - 找昨天標題開頭「💧」的事件
 * - 顏色 = GRAY → 標記為已澆
 * - 顏色 ≠ GRAY → 提醒：可能漏澆或忘記標
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
  const color = ev.getColor(); // String "1"..."11" 或 "0" (default)；GRAY = "8"
  const isDone = color === CalendarApp.EventColor.GRAY;
  console.log(`[completion] 昨天 ${formatDate_(yesterday)}「${ev.getTitle()}」→ ${isDone ? '✅ 已標完成' : '⚠ 未標完成（可能漏澆或忘記改顏色）'}`);
  return { hadEvent: true, isDone, event: ev };
}

/**
 * 抓某段日期範圍內的 💧 事件統計。
 * @return {{total, done, missed, byKind:{hot-dry,dry-spell,fallback-dry}}}
 */
function collectMonthStats_(start, end) {
  const cal = CalendarApp.getDefaultCalendar();
  const events = cal.getEvents(start, end).filter(ev => ev.getTitle().startsWith('💧'));
  const stats = {
    total: events.length,
    done: 0,
    missed: 0,
    byKind: { 'hot-dry': 0, 'dry-spell': 0, 'fallback-dry': 0, 'other': 0 },
    days: [],
  };
  for (const ev of events) {
    const color = ev.getColor();
    const done = color === CalendarApp.EventColor.GRAY;
    if (done) stats.done++; else stats.missed++;

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
    });
  }
  return stats;
}

function sendMonthlySummary_(monthStart, stats) {
  const to = PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAIL');
  if (!to) {
    console.log('NOTIFY_EMAIL 未設，跳過月統計寄信');
    return;
  }
  const ym = Utilities.formatDate(monthStart, 'Asia/Taipei', 'yyyy 年 M 月');
  const missRate = stats.total === 0 ? 0 : (stats.missed / stats.total * 100);

  const lines = [];
  lines.push(`📅 ${ym} 澆水提醒月報`);
  lines.push('');
  lines.push(`• 推薦澆水：${stats.total} 天`);
  lines.push(`  ├─ 高溫無雨（橘）：${stats.byKind['hot-dry']} 天`);
  lines.push(`  ├─ 連日少雨（藍）：${stats.byKind['dry-spell']} 天`);
  lines.push(`  └─ 預報缺（黃）：${stats.byKind['fallback-dry']} 天`);
  lines.push(`• 已標完成（灰）：${stats.done} 天`);
  lines.push(`• 未標完成：${stats.missed} 天（漏標率 ${missRate.toFixed(0)}%）`);
  lines.push('');
  lines.push('— 詳細日期 —');
  stats.days.forEach(d => {
    lines.push(`${d.done ? '✅' : '⚠'} ${d.date}  ${d.title}`);
  });
  lines.push('');
  lines.push('— 提醒 —');
  if (missRate >= 30) {
    lines.push(`⚠ 漏標率 ${missRate.toFixed(0)}% 偏高。可能：(1) 總幹事忘記改顏色 (2) 真的有漏澆。建議跟總幹事確認。`);
  }
  lines.push('回顧 / 調整閾值請編輯 Apps Script 的 CONFIG 區塊。');

  MailApp.sendEmail({
    to,
    subject: `[閱大安澆水] ${ym} 月報（推薦 ${stats.total} 天 / 完成 ${stats.done} 天）`,
    body: lines.join('\n'),
  });
  console.log('月報寄出 →', to);
}

// ================== Calendar 事件 ==================

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
  lines.push(`• 過去 3 日累積降雨：${result.past3.toFixed(1)} mm`);
  lines.push(`• 過去 5 日累積降雨：${result.past5.toFixed(1)} mm`);
  if (result.forecast) {
    if (result.forecast.tempToday != null)   lines.push(`• 今日預報最高溫：${result.forecast.tempToday}°C`);
    if (result.forecast.popToday != null)    lines.push(`• 今日降雨機率：${result.forecast.popToday}%`);
    if (result.forecast.popTomorrow != null) lines.push(`• 明日降雨機率：${result.forecast.popTomorrow}%`);
  }
  lines.push('');
  lines.push('🚿 建議操作');
  lines.push('• 全區手動開啟澆灌約 10–15 分鐘');
  lines.push('• 完成後請將本事件顏色改為「灰色」表示已澆（隔日腳本會偵測）');
  lines.push('');
  lines.push(`📌 由「閱大安水電監督系統」自動建立 ${formatDate_(today)} 05:00`);
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
  console.log(`    rain: past3=${result.past3?.toFixed?.(1)} mm, past5=${result.past5?.toFixed?.(1)} mm`);
}

function notifyError_(subject, err) {
  try {
    const to = PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAIL');
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
