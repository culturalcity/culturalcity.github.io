// ═══════════════════════════════════════════════════════════════
// 閱大安 強風／陣風提醒 Polling（Apps Script）
// ═══════════════════════════════════════════════════════════════
//
// 目的：東北季風瞬間陣風會把社區電動大門吹到甩關而受損。
//       這支腳本盯著「大安區風速預報」＋「臺北站即時陣風觀測」，
//       命中門檻就 email 警衛室／總幹事，請其事先把電動門改為手動。
//
// 跟 heat-poll.gs 的差異：
//   - 高溫是抓 CWA 官方「W29 燈號」（政府已判好），轉成住戶公告。
//   - 強風臺北市區幾乎不發官方特報，所以這裡是「自己當判官」：
//     讀原始風速值、用自訂門檻（6 級）判斷，直接通知警衛把門改為手動。
//
// 兩個觸發點（共用一個每 15 分鐘的 trigger）：
//   1. 預防式：每天 18:00 前後跑一次，看今晚＋明日（未來約 36h）的
//      大安區「預報平均風力」。≥ 門檻 → 寄「今晚風強、請先把電動門改為手動」。
//      （預報只給平均風力；平均到 6 級時陣風通常更強，足以當提前警示）
//   2. 即時式：每 15 分鐘看大安森林(CAAH60)＋臺北站(466920)兩站「實測最大陣風」，
//      取兩站最大值。≥ 門檻 → 寄「剛測到陣風 X 級、請把電動門改為手動」。
//      大安森林同區最近但自動站常漏資料，臺北站局屬站當穩定備援；
//      即時式是佐證，與社區門口仍可能有落差。
//
// Script Properties 需設定（在 Apps Script「專案設定 → 指令碼屬性」）：
//   CWA_KEY      — CWA OpenData 授權碼（複製本 repo .env 的 CWA_API_KEY 值）
//   ALERT_EMAIL  — 收警報的信箱，預設 culturalcity85@gmail.com（自寄自收）
//   WIND_LEVEL   — （選填）觸發級數，不填預設 6
//
// 安裝：跑 setup() 一次，會自動建立每 15 分鐘的 time trigger。

// ── 常數 ──────────────────────────────────────────

// 觀測取「兩站最大陣風」：大安森林（同區最近，但自動站常漏資料）
// + 臺北站 466920（局屬有人站，最穩，當 always-on 備援）。
// 任一站達標就警報；大安森林漏資料時自動由臺北站頂上。
var STATION_IDS = ['CAAH60', '466920'];
var FORECAST_DATASET = 'F-D0047-061'; // 臺北市鄉鎮預報・逐 3 小時
var FORECAST_LOCATION = '大安區';
var FORECAST_LOOKAHEAD_H = 36;        // 預報看未來幾小時（今晚＋明日）
var OBS_COOLDOWN_H = 3;               // 即時警報冷卻：同級數 N 小時內不重寄
var DEFAULT_WIND_LEVEL = 6;           // 預設觸發級數（蒲福風級）

// ── Helpers ────────────────────────────────────────

function prop(name) {
  return PropertiesService.getScriptProperties().getProperty(name);
}
function setProp(name, val) {
  PropertiesService.getScriptProperties().setProperty(name, val);
}

function windThreshold() {
  var v = parseInt(prop('WIND_LEVEL'), 10);
  return isNaN(v) ? DEFAULT_WIND_LEVEL : v;
}

function alertEmail() {
  return prop('ALERT_EMAIL') || 'culturalcity85@gmail.com';
}

function cwaKey() {
  var k = prop('CWA_KEY');
  if (!k) throw new Error('CWA_KEY not set in Script Properties');
  return k;
}

function todayTaipei() {
  var t = new Date(new Date().getTime() + 8 * 3600 * 1000);
  return t.toISOString().substring(0, 10);
}

function taipeiHourMin() {
  var t = new Date(new Date().getTime() + 8 * 3600 * 1000);
  return { h: t.getUTCHours(), m: t.getUTCMinutes() };
}

// m/s → 蒲福風級（取該風速所落入的級數）
function msToBeaufort(ms) {
  var ub = [0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
  for (var i = 0; i < ub.length; i++) {
    if (ms < ub[i]) return i;
  }
  return 12;
}

function cwaFetch(dataset, params) {
  var url = 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/' + dataset +
    '?Authorization=' + encodeURIComponent(cwaKey());
  for (var k in params) {
    url += '&' + k + '=' + encodeURIComponent(params[k]);
  }
  var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (resp.getResponseCode() >= 400) {
    throw new Error('CWA ' + dataset + ': ' + resp.getResponseCode() + ' ' +
      resp.getContentText().substring(0, 200));
  }
  return JSON.parse(resp.getContentText());
}

function sendAlert(subject, body) {
  MailApp.sendEmail({ to: alertEmail(), subject: subject, body: body });
  Logger.log('Sent: ' + subject);
}

// ── 即時觀測：臺北站最大陣風 ───────────────────────

function checkWindObservation() {
  var data = cwaFetch('O-A0001-001', {
    StationId: STATION_IDS.join(','),
    WeatherElement: 'GustInfo'
  });
  var stations = data.records && data.records.Station;
  if (!stations || !stations.length) { Logger.log('No station data'); return; }

  // 取各站最大陣風中的最大值：任一站達標就警報，
  // 大安森林漏資料（回 -99）時自動忽略、由臺北站頂上。
  var maxMs = -1, maxName = '', maxId = '', maxObsTime = '';
  for (var i = 0; i < stations.length; i++) {
    var s = stations[i];
    var g = s.WeatherElement && s.WeatherElement.GustInfo &&
      s.WeatherElement.GustInfo.PeakGustSpeed;
    var ms = parseFloat(g);
    Logger.log('  ' + s.StationName + '(' + s.StationId + '): PeakGustSpeed=' + g);
    if (isNaN(ms) || ms < 0) continue; // -99 = 該站該小時無可報陣風
    if (ms > maxMs) {
      maxMs = ms; maxName = s.StationName; maxId = s.StationId;
      maxObsTime = (s.ObsTime && s.ObsTime.DateTime) || '';
    }
  }
  if (maxMs < 0) { Logger.log('No gust this hour at any station'); return; }

  var level = msToBeaufort(maxMs);
  var threshold = windThreshold();
  Logger.log('Max gust ' + maxMs + ' m/s = ' + level + ' 級 @ ' + maxName + ' (threshold ' + threshold + ')');
  if (level < threshold) return;

  // 冷卻：同級數 OBS_COOLDOWN_H 小時內不重寄；級數往上跳才立即再報
  var nowMs = new Date().getTime();
  var last = {};
  try { last = JSON.parse(prop('windObsAlert') || '{}'); } catch (e) {}
  if (last.ts && (nowMs - last.ts) < OBS_COOLDOWN_H * 3600 * 1000 &&
      level <= (last.level || 0)) {
    Logger.log('Within cooldown, same/lower level, skip');
    return;
  }

  var subject = '🌬️ 強風即時警報・陣風 ' + level + ' 級（請將電動門改為手動）';
  var body =
    '中央氣象署測站剛測到強陣風，可能影響社區電動大門。\n\n' +
    '・最大陣風：' + maxMs.toFixed(1) + ' m/s（約 ' + level + ' 級）\n' +
    '・測站：' + maxName + '（' + maxId + '）\n' +
    '・觀測時間：' + maxObsTime + '\n' +
    '・觸發門檻：' + threshold + ' 級\n\n' +
    '【請處理】\n' +
    '請至現場將社區電動大門改為手動模式，\n' +
    '避免瞬間陣風把門甩關造成損壞。\n\n' +
    '※ 取大安森林＋臺北站兩站最大值；與社區門口實際風力仍可能略有落差，請以現場為準。\n' +
    '※ 由 Apps Script wind-poll 自動寄出。';
  sendAlert(subject, body);
  setProp('windObsAlert', JSON.stringify({ ts: nowMs, level: level }));
}

// ── 預報：大安區未來約 36h 平均風力 ─────────────────

function checkWindForecast() {
  var today = todayTaipei();
  if (prop('windFcAlertDate') === today) {
    Logger.log('Forecast already alerted today');
    return;
  }

  var data = cwaFetch(FORECAST_DATASET, {
    LocationName: FORECAST_LOCATION,
    ElementName: '風速'
  });
  var loc = data.records && data.records.Locations &&
    data.records.Locations[0] && data.records.Locations[0].Location[0];
  if (!loc) { Logger.log('No forecast location'); return; }

  var we = null;
  for (var i = 0; i < loc.WeatherElement.length; i++) {
    if (loc.WeatherElement[i].ElementName === '風速') { we = loc.WeatherElement[i]; break; }
  }
  if (!we) { Logger.log('No 風速 element'); return; }

  var nowMs = new Date().getTime();
  var horizonMs = nowMs + FORECAST_LOOKAHEAD_H * 3600 * 1000;
  var maxLevel = 0, maxTime = '';
  for (var j = 0; j < we.Time.length; j++) {
    var t = we.Time[j];
    var startStr = t.StartTime || t.DataTime;
    var startMs = new Date(startStr).getTime();
    if (startMs > horizonMs) continue;
    var ev = t.ElementValue[0];
    var lv = parseInt(ev.BeaufortScale, 10);
    if (isNaN(lv)) continue;
    if (lv > maxLevel) { maxLevel = lv; maxTime = startStr; }
  }

  var threshold = windThreshold();
  Logger.log('Forecast max ' + maxLevel + ' 級 @ ' + maxTime + ' (threshold ' + threshold + ')');
  if (maxLevel < threshold) return;

  var subject = '🌬️ 強風預報提醒・未來 36 小時上看 ' + maxLevel + ' 級（建議先將電動門改為手動）';
  var body =
    '中央氣象署大安區預報：未來約 ' + FORECAST_LOOKAHEAD_H + ' 小時內，\n' +
    '預報平均風力上看 ' + maxLevel + ' 級（出現時段約 ' + maxTime + '）。\n' +
    '平均風到此級數時，瞬間陣風通常會更強。\n\n' +
    '・觸發門檻：' + threshold + ' 級\n\n' +
    '【建議處理】\n' +
    '入夜風增強前，請先把社區電動大門改為手動模式，\n' +
    '避免東北季風瞬間陣風把門甩關造成損壞。\n\n' +
    '※ 此為預報，實際以現場為準。\n' +
    '※ 由 Apps Script wind-poll 自動寄出。';
  sendAlert(subject, body);
  setProp('windFcAlertDate', today);
}

// ── 主函數（trigger 呼叫） ────────────────────────

function checkWind() {
  // 即時觀測：每次都跑
  try {
    checkWindObservation();
  } catch (e) {
    Logger.log('Observation error: ' + e.message);
  }

  // 預報：只在每天 18:00–18:14 這個 window 跑一次
  var hm = taipeiHourMin();
  if (hm.h === 18 && hm.m < 15) {
    try {
      checkWindForecast();
    } catch (e) {
      Logger.log('Forecast error: ' + e.message);
    }
  }
}

// ── 測試用：手動跑一次、忽略 window 與冷卻 ─────────

function testRunNow() {
  Logger.log('--- 即時觀測 ---');
  checkWindObservation();
  Logger.log('--- 預報（忽略每日一次限制）---');
  setProp('windFcAlertDate', '');
  checkWindForecast();
}

// ── Setup（跑一次即可） ───────────────────────────

function setup() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'checkWind') {
      ScriptApp.deleteTrigger(triggers[i]);
      Logger.log('Deleted existing trigger');
    }
  }
  ScriptApp.newTrigger('checkWind').timeBased().everyMinutes(15).create();
  Logger.log('Created trigger: checkWind every 15 minutes');
  Logger.log('Script Properties needed: CWA_KEY, ALERT_EMAIL (預設 culturalcity85@gmail.com), WIND_LEVEL (選填，預設 6)');
}
