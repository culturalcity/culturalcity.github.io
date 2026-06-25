// ═══════════════════════════════════════════════════════════════
// 閱大安 低溫關懷提醒 Polling（Apps Script）
// ═══════════════════════════════════════════════════════════════
//
// 與 heat-poll.gs 對稱：偵測 CWA「低溫特報」(W28) 臺北燈號，
// 命中就建 Google Calendar 全天事件給總幹事，提示「貼 X 燈低溫圖卡
// 到住戶公告群組 ＋ 關心獨居長輩」。
//
// ── 為什麼低溫＝高溫的鏡像 ──
//   CWA 低溫特報(W28) 自 108/11 起與高溫資訊(W29) 用同一套黃/橙/紅
//   三色燈號、同樣以鄉鎮為單位發布，資料結構一致，故本檔幾乎照搬
//   heat-poll.gs，只把 W29 換成 W28。
//
// ── 官方燈號門檻（臺北站觀測・平地，海拔 200m 以下）──
//   🟡 黃：氣溫 ≤ 10°C
//   🟠 橙：≤ 6°C，或 ≤10°C 且連續 24h ≤12°C
//   🔴 紅：連續 24h ≤ 6°C
//   （來源：CWA W28 低溫特報。馬祖門檻各減 4°C，與本社區無關。）
//
// ── 圖卡內容主軸（與高溫不對稱，刻意如此）──
//   低溫致死的關鍵是「感覺不到的危險」：一氧化碳中毒 ＋ 心血管/夜間猝倒。
//   圖卡別主打「多穿衣服」（那是身體自己會處理的）。三燈遞進詳見社區
//   圖卡素材（Drive：公告圖卡 / 低溫提醒）。
//
// ⚠️ 部署/驗證注意：
//   1. 安裝：用 culturalcity85 登入 script.google.com，貼進新專案，跑 setup() 一次。
//   2. 本檔在「夏季無低溫特報」期間寫成，W28 的 Warning_Taiwan.js / Warning_Content.js
//      實際 JSON 結構是「比照 W29」推定的。**第一次真的發低溫特報時（入冬）請驗一次**
//      detectTaipeiLevel() 是否正確命中，再放心交給它跑。
//
// 設定步驟：
//   1) Apps Script Editor → ⏰ Triggers → Add Trigger:
//        Function: checkColdAlert / Event source: Time-driven / Day timer / 6am–9am
//      （或直接跑 setup() 建每 5 分鐘 trigger）
//   2) 第一次執行會要求授權 Calendar / UrlFetch；同意。

// ── 常數 ──────────────────────────────────────────

var CALENDAR_ID = 'culturalcity85@gmail.com';
var CWA_W28_BASE = 'https://www.cwa.gov.tw/Data/js/warn';
var TAIPEI_CODE = '63';

var W28_LEVELS = {
  '1': { zh: '黃', en: 'Yellow', ja: '黄', num: '1', color: 'YELLOW' },
  '2': { zh: '橙', en: 'Orange', ja: '橙', num: '2', color: 'ORANGE' },
  '3': { zh: '紅', en: 'Red',    ja: '赤', num: '3', color: 'RED'    }
};

// 行事曆事件去重用的標記字串（夾在 title 內、不隨措辭微調而變）
var COLD_EVENT_MARKER = '低溫圖卡';

// ── Helpers ────────────────────────────────────────

function todayTaipei() {
  var taipeiMs = new Date().getTime() + 8 * 60 * 60 * 1000;
  return new Date(taipeiMs).toISOString().substring(0, 10);
}

function taipeiHourMin() {
  var taipeiMs = new Date().getTime() + 8 * 60 * 60 * 1000;
  var t = new Date(taipeiMs);
  return { h: t.getUTCHours(), m: t.getUTCMinutes() };
}

// ── CWA W28 偵測（比照 heat-poll 的 W29 邏輯）──────────

function detectTaipeiLevel() {
  var taiwanJs = UrlFetchApp.fetch(CWA_W28_BASE + '/Warning_Taiwan.js').getContentText();
  var WarnTown = (new Function(taiwanJs + '; return typeof WarnTown !== "undefined" ? WarnTown : null;'))();
  if (!WarnTown) throw new Error('Warning_Taiwan.js parse failed');

  var taipeiEntry = WarnTown[TAIPEI_CODE];
  if (!taipeiEntry) return null;

  var w28Code = null;
  var keys = Object.keys(taipeiEntry);
  for (var i = 0; i < keys.length; i++) {
    var codes = taipeiEntry[keys[i]] || [];
    for (var j = 0; j < codes.length; j++) {
      if (typeof codes[j] === 'string' && codes[j].indexOf('W28-') === 0) {
        w28Code = codes[j]; break;
      }
    }
    if (w28Code) break;
  }
  if (!w28Code) return null;

  var levelNum = w28Code.split('-')[1];
  var level = W28_LEVELS[levelNum];
  if (!level) throw new Error('Unknown W28 level: ' + w28Code);

  var contentJs = UrlFetchApp.fetch(CWA_W28_BASE + '/Warning_Content.js').getContentText();
  var WarnContent = (new Function(contentJs + '; return typeof WarnContent !== "undefined" ? WarnContent : null;'))();
  var w28 = WarnContent && WarnContent.W28 && WarnContent.W28.C;
  if (!w28) throw new Error('W28.C not found');

  var validto = w28.validto || '';
  var validtoDate = validto.substring(0, 10).replace(/\//g, '-');
  var today = todayTaipei();

  // 只認「涵蓋今日」的特報（比照 heat-poll；避免拿到隔日預測就誤建今天的事件）
  if (validtoDate !== today) {
    Logger.log('W28 validto (' + validtoDate + ') != today (' + today + '), skip');
    return null;
  }

  return {
    zh: level.zh, en: level.en, ja: level.ja, num: level.num, color: level.color,
    content: w28.content || '', issued: w28.issued || '', validto: validto
  };
}

// ── Calendar Event ────────────────────────────────

function ensureCalendarEvent(level, today) {
  var cal = CalendarApp.getCalendarById(CALENDAR_ID);
  if (!cal) { Logger.log('Calendar not found: ' + CALENDAR_ID); return; }

  var date = new Date(today + 'T00:00:00+08:00');
  var events = cal.getEventsForDay(date);
  for (var i = 0; i < events.length; i++) {
    if (events[i].getTitle().indexOf(COLD_EVENT_MARKER) >= 0) {
      Logger.log('Calendar event exists: ' + events[i].getTitle());
      return;
    }
  }

  // 待辦字面＝明確動作（總幹事一看就能照做），與高溫對稱
  var title = '❄️ 臺北' + level.zh + '燈・貼' + level.zh + '燈低溫圖卡到公告群組＋關心獨居長輩';
  var desc =
    '中央氣象署今日臺北市發布低溫特報・' + level.zh + '色燈號。\n\n' +
    '【請總幹事處理】\n' +
    '1. 到住戶公告群組張貼「' + level.zh + '燈・低溫提醒」圖卡\n' +
    '   圖卡位置 → Drive：公告圖卡 / 低溫提醒\n' +
    '2. 關心社區獨居長輩，確認狀況\n\n' +
    '【圖卡重點（低溫真正的危險是感覺不到的那兩段）】\n' +
    '・🔥 瓦斯熱水器／暖爐保持通風，嚴防一氧化碳中毒\n' +
    '・🫀 夜間清晨起身放慢、心血管病史者備藥；非「多穿衣服」\n\n' +
    'CWA 發布時間：' + level.issued + '\n有效至：' + level.validto + '\n\n' +
    '--- CWA 原文 ---\n' + level.content + '\n\n' +
    '📌 由 Apps Script cold-poll 自動建立';

  var event = cal.createAllDayEvent(title, date, { description: desc });
  if (CalendarApp.EventColor[level.color]) {
    event.setColor(CalendarApp.EventColor[level.color]);
  }
  Logger.log('Created: ' + title);
}

// ── 主函數（trigger 呼叫） ────────────────────────

function checkColdAlert() {
  // 低溫特報常於前一日傍晚或當日清晨發布；早上 window 抓「今日燈號」最穩。
  var hm = taipeiHourMin();
  var inWindow = (hm.h >= 6 && hm.h <= 8) || (hm.h === 9 && hm.m <= 5);
  if (!inWindow) return;

  var today = todayTaipei();
  Logger.log('checkColdAlert: ' + today + ' ' + hm.h + ':' + hm.m);

  var level;
  try {
    level = detectTaipeiLevel();
  } catch (e) {
    Logger.log('CWA detection error: ' + e.message);
    return;
  }

  if (!level) {
    Logger.log('No W28 advisory for Taipei today');
    return;
  }

  Logger.log('Detected: Taipei 低溫 ' + level.zh + ' level');
  ensureCalendarEvent(level, today);
}

// ── Setup（跑一次即可） ───────────────────────────

function setup() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'checkColdAlert') {
      ScriptApp.deleteTrigger(triggers[i]);
      Logger.log('Deleted existing trigger');
    }
  }
  ScriptApp.newTrigger('checkColdAlert')
    .timeBased()
    .everyMinutes(5)
    .create();
  Logger.log('Created trigger: checkColdAlert every 5 minutes');
}
