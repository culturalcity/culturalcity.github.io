// ═══════════════════════════════════════════════════════════════
// 閱大安 豪雨特報 → 行事曆防汛準備（Apps Script）
// ═══════════════════════════════════════════════════════════════
//
// 目的：CWA 對臺北市發布「豪雨」以上特報（豪雨／大豪雨／超大豪雨）時，
//       在 culturalcity85 行事曆建一個全天「防汛準備」待辦給總幹事
//       （巡排水孔、確認擋水閘門可下放、確認抽水馬達）。
//
// ── 與 rain-poll.gs 互補（兩種不同的雨）──
//   · rain-poll：午後雷陣雨那種「短時爆量」的急性淹水 → 即時 email（過去10分≥13mm）
//   · 本支：颱風／梅雨鋒面那種「下一整天」的持續性大雨，CWA 提前數小時發特報
//           → 行事曆提前準備（calendar）。兩者尺度與管道都不同、不重疊。
//
// ── 刻意「從豪雨起、跳過大雨」──
//   大安／羅斯福路排水良好，一般「大雨」不致淹（4.4 年僅 0.5 次/年達豪雨日）。
//   用 phenomena 字串含「豪雨」即可命中豪雨／大豪雨／超大豪雨，而「大雨」不含
//   「豪雨」二字、自動排除——不必去查 CWA W26 的數字級碼對照。
//
// ── 資料源 ──
//   W-C0033-001（天氣特報-各別縣市目前警特報情形）；需 CWA_KEY（同 rain-poll／颱風那支）。
//   即颱風 check-typhoon-alert.js 用的同一個 dataset，只是改抓「豪雨」hazard。
//
// Script Properties 需設定（專案設定 → 指令碼屬性）：
//   CWA_KEY — CWA OpenData 授權碼（複製本 repo .env 的 CWA_API_KEY 值）
//
// 安裝：跑 setup() 一次，建每 30 分鐘 trigger（特報可隨時發布；
//       持續期間靠當日去重不重複建事件）。
//
// ⚠️ 驗證：夏天若無豪雨特報，跑 testHeavyRainNow 會回 null（不報錯＝管線通）；
//   真正「豪雨特報發布時正確命中」要等下一次颱風／梅雨豪雨驗。

// ── 常數 ──────────────────────────────────────────

var CALENDAR_ID = 'culturalcity85@gmail.com';
var HEAVYRAIN_DATASET = 'W-C0033-001';
var TARGET_CITY = '臺北市';
var RAIN_KEYWORD = '豪雨';        // 含豪雨/大豪雨/超大豪雨；「大雨」不含此二字、自動排除
var HEAVYRAIN_MARKER = '豪雨特報'; // 行事曆去重標記

// 防汛準備清單（聚焦排水/淹水，不含颱風的強風項；颱風另有專屬清單）
var FLOOD_PREP_CHECKLIST = [
  '清除中庭、頂樓、騎樓、車道排水孔阻塞物（落葉、塑膠袋）',
  '確認停車場擋水閘門可正常下放',
  '確認抽水馬達／集水井運作正常',
  '通知保全加強夜間巡邏（地下室、車道積水）',
  '提醒低樓層／陽台住戶留意排水、收好易淹物品',
];

// ── Helpers ────────────────────────────────────────

function prop(name) {
  return PropertiesService.getScriptProperties().getProperty(name);
}

function cwaKey() {
  var k = prop('CWA_KEY');
  if (!k) throw new Error('CWA_KEY not set in Script Properties');
  return k;
}

function todayTaipei() {
  var taipeiMs = new Date().getTime() + 8 * 60 * 60 * 1000;
  return new Date(taipeiMs).toISOString().substring(0, 10);
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

// ── 偵測：臺北是否有「豪雨」以上特報 ────────────────

function detectTaipeiHeavyRain() {
  var data = cwaFetch(HEAVYRAIN_DATASET, { format: 'JSON' });
  var locations = data.records && data.records.location;
  if (!locations || !locations.length) { Logger.log('No location data'); return null; }

  var city = null;
  for (var i = 0; i < locations.length; i++) {
    if (locations[i].locationName === TARGET_CITY) { city = locations[i]; break; }
  }
  if (!city) { Logger.log('找不到 ' + TARGET_CITY); return null; }

  var hazards = (city.hazardConditions && city.hazardConditions.hazards) || [];
  for (var j = 0; j < hazards.length; j++) {
    var info = hazards[j].info || {};
    var phen = info.phenomena || '';
    if (phen.indexOf(RAIN_KEYWORD) >= 0) {  // 含「豪雨」→ 豪雨/大豪雨/超大豪雨
      var vt = hazards[j].validTime || {};
      return {
        phenomena: phen,
        startTime: vt.startTime || '',
        endTime: vt.endTime || '',
      };
    }
  }
  return null;
}

// ── Calendar Event ────────────────────────────────

function ensureCalendarEvent(info, today) {
  var cal = CalendarApp.getCalendarById(CALENDAR_ID);
  if (!cal) { Logger.log('Calendar not found: ' + CALENDAR_ID); return; }

  var date = new Date(today + 'T00:00:00+08:00');
  var events = cal.getEventsForDay(date);
  for (var i = 0; i < events.length; i++) {
    if (events[i].getTitle().indexOf(HEAVYRAIN_MARKER) >= 0) {
      Logger.log('Calendar event exists: ' + events[i].getTitle());
      return;
    }
  }

  var title = '🌧️ 臺北' + info.phenomena + '・防汛準備（巡排水、確認擋水閘門可下放）';
  var desc =
    '中央氣象署對臺北市發布「' + info.phenomena + '」特報，社區地下室／車道有淹水風險。\n\n' +
    '【請總幹事處理・防汛準備】\n' +
    FLOOD_PREP_CHECKLIST.map(function (x, i) { return (i + 1) + '. ' + x; }).join('\n') + '\n\n' +
    '【特報資訊】\n' +
    '生效時間：' + (info.startTime || '（未標示）') + '\n' +
    '預計結束：' + (info.endTime || '（未標示）') + '\n\n' +
    '※ 這是「持續性大雨」的提前準備；若轉為短時爆雨，rain-poll 會另發即時 email。\n' +
    '📌 由 Apps Script heavyrain-poll 自動建立。資料來源：CWA W-C0033-001';

  var event = cal.createAllDayEvent(title, date, { description: desc });
  event.setColor(CalendarApp.EventColor.CYAN);
  Logger.log('Created: ' + title);
}

// ── 主函數（trigger 呼叫） ────────────────────────

function checkHeavyRain() {
  var info;
  try {
    info = detectTaipeiHeavyRain();
  } catch (e) {
    Logger.log('CWA detection error: ' + e.message);
    return;
  }
  if (!info) {
    Logger.log('臺北目前無豪雨以上特報');
    return;
  }
  Logger.log('Detected: 臺北「' + info.phenomena + '」');
  ensureCalendarEvent(info, todayTaipei());
}

// ── 測試用：手動跑一次（繞過任何時間限制） ──────────

function testHeavyRainNow() {
  var info = detectTaipeiHeavyRain();
  Logger.log(info ? ('命中：' + info.phenomena + '（' + info.startTime + '~' + info.endTime + '）')
                  : '路徑正常：CWA 抓得到、臺北目前無豪雨以上特報（回 null）');
}

// ── Setup（跑一次即可） ───────────────────────────

function setup() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'checkHeavyRain') {
      ScriptApp.deleteTrigger(triggers[i]);
      Logger.log('Deleted existing trigger');
    }
  }
  ScriptApp.newTrigger('checkHeavyRain').timeBased().everyMinutes(30).create();
  Logger.log('Created trigger: checkHeavyRain every 30 minutes');
  Logger.log('Script Property needed: CWA_KEY (= .env 的 CWA_API_KEY)');
}
