// ═══════════════════════════════════════════════════════════════
// 閱大安 Heat Alert Polling（Apps Script）
// ═══════════════════════════════════════════════════════════════
//
// 每 5 分鐘 trigger：07:30-15:00 台北 window 內偵測 CWA W29 高溫資訊，
// 若臺北今日有 advisory，建立 Google Calendar 全天事件給總幹事。
// （2026-07-20 視窗從 07:30-09:00 拉長到 15:00：當日 CWA 11:35 才把臺北
//   納入橘燈，落在舊視窗外而漏建。15:00 後才發的燈號離 17:00 失效太近，
//   不再提醒。一天只建一筆由「高溫圖卡」去重標記保證；若盤中燈色升級
//   （黃→橙/紅、橙→紅），就地更新既有事件的標題/說明/顏色，不另建。）
//
// 取代 GitHub Actions heat-alert.yml（GH Actions cron 不可靠：51-60min
// 延遲 + silently skip）。
//
// 安裝：跑 setup() 一次，會自動建立 time trigger。

// ── 常數 ──────────────────────────────────────────

var CALENDAR_ID = 'culturalcity85@gmail.com';
var CWA_W29_BASE = 'https://www.cwa.gov.tw/Data/js/warn';
var TAIPEI_CODE = '63';

var W29_LEVELS = {
  '1': { zh: '黃', en: 'Yellow', ja: '黄', num: '1' },
  '2': { zh: '橙', en: 'Orange', ja: '橙', num: '2' },
  '3': { zh: '紅', en: 'Red',    ja: '赤', num: '3' }
};

// ── Helpers ────────────────────────────────────────

function todayTaipei() {
  var now = new Date();
  var taipeiMs = now.getTime() + 8 * 60 * 60 * 1000;
  var t = new Date(taipeiMs);
  return t.toISOString().substring(0, 10);
}

function taipeiHourMin() {
  var now = new Date();
  var taipeiMs = now.getTime() + 8 * 60 * 60 * 1000;
  var t = new Date(taipeiMs);
  return { h: t.getUTCHours(), m: t.getUTCMinutes() };
}

// ── CWA W29 偵測 ──────────────────────────────────

function detectTaipeiLevel() {
  var taiwanJs = UrlFetchApp.fetch(CWA_W29_BASE + '/Warning_Taiwan.js').getContentText();
  var WarnTown = (new Function(taiwanJs + '; return typeof WarnTown !== "undefined" ? WarnTown : null;'))();
  if (!WarnTown) throw new Error('Warning_Taiwan.js parse failed');

  var taipeiEntry = WarnTown[TAIPEI_CODE];
  if (!taipeiEntry) return null;

  var w29Code = null;
  var keys = Object.keys(taipeiEntry);
  for (var i = 0; i < keys.length; i++) {
    var codes = taipeiEntry[keys[i]] || [];
    for (var j = 0; j < codes.length; j++) {
      if (typeof codes[j] === 'string' && codes[j].indexOf('W29-') === 0) {
        w29Code = codes[j]; break;
      }
    }
    if (w29Code) break;
  }
  if (!w29Code) return null;

  var levelNum = w29Code.split('-')[1];
  var level = W29_LEVELS[levelNum];
  if (!level) throw new Error('Unknown W29 level: ' + w29Code);

  var contentJs = UrlFetchApp.fetch(CWA_W29_BASE + '/Warning_Content.js').getContentText();
  var WarnContent = (new Function(contentJs + '; return typeof WarnContent !== "undefined" ? WarnContent : null;'))();
  var w29 = WarnContent && WarnContent.W29 && WarnContent.W29.C;
  if (!w29) throw new Error('W29.C not found');

  var validto = w29.validto || '';
  var validtoDate = validto.substring(0, 10).replace(/\//g, '-');
  var today = todayTaipei();

  if (validtoDate !== today) {
    Logger.log('W29 validto (' + validtoDate + ') != today (' + today + '), skip');
    return null;
  }

  return {
    zh: level.zh, en: level.en, ja: level.ja, num: level.num,
    content: w29.content || '', issued: w29.issued || '', validto: validto
  };
}

// ── Calendar Event ────────────────────────────────

// 從既有事件標題讀出燈色等級（0=讀不到）
function titleLevelNum(title) {
  if (title.indexOf('紅燈') >= 0) return 3;
  if (title.indexOf('橙燈') >= 0) return 2;
  if (title.indexOf('黃燈') >= 0) return 1;
  return 0;
}

function ensureCalendarEvent(level, today) {
  var cal = CalendarApp.getCalendarById(CALENDAR_ID);
  if (!cal) { Logger.log('Calendar not found: ' + CALENDAR_ID); return; }

  var date = new Date(today + 'T00:00:00+08:00');
  var events = cal.getEventsForDay(date);
  var existing = null;
  for (var i = 0; i < events.length; i++) {
    // 用「高溫圖卡」當去重標記（不隨待辦措辭微調而失效；與 cold-poll 對稱）
    if (events[i].getTitle().indexOf('高溫圖卡') >= 0) {
      existing = events[i];
      break;
    }
  }

  // 盤中升級：既有事件燈色 >= 新燈色 → 不動；比較低（黃→橙/紅、橙→紅）→ 就地升級。
  // 黃→橙盤中升級結構上罕見（預報須從36跳升跨38），但納入處理求完整。
  var oldNum = existing ? titleLevelNum(existing.getTitle()) : 0;
  if (existing && oldNum >= Number(level.num)) {
    Logger.log('Calendar event exists: ' + existing.getTitle());
    return;
  }

  // 待辦字面＝明確動作（總幹事一看就能照做），與 cold-poll.gs 對稱
  var title = '⚠️ 臺北' + level.zh + '燈・貼' + level.zh + '燈高溫圖卡到公告群組＋關心獨居長輩';
  var desc =
    '中央氣象署今日臺北市發布高溫資訊・' + level.zh + '色燈號。\n\n' +
    '【請總幹事處理】\n' +
    '1. 到住戶公告群組張貼「' + level.zh + '燈・高溫提醒」圖卡\n' +
    '   圖卡位置 → Drive：01. 行政管理 / 09. 公告 / 公告圖卡 / 高溫提醒\n' +
    '2. 關心社區獨居長輩，確認狀況\n\n' +
    '【圖卡重點（高溫的危險常被低估、身體不會主動示警）】\n' +
    '・💧 主動補水、別等口渴；長者口渴感退化更要提醒\n' +
    '・☀️ 避開正午曝曬，戶外活動移到清晨或傍晚\n\n' +
    'CWA 發布時間：' + level.issued + '\n有效至：' + level.validto + '\n\n' +
    '--- CWA 原文 ---\n' + level.content + '\n\n' +
    '📌 由 Apps Script heat-poll 自動建立';

  var LEVEL_ZH = { 1: '黃', 2: '橙', 3: '紅' };
  var event;
  if (existing) {
    desc += '\n📌 盤中升級自動更新（' + (LEVEL_ZH[oldNum] || '?') + '燈→' + level.zh + '燈）';
    existing.setTitle(title);
    existing.setDescription(desc);
    event = existing;
    Logger.log('Upgraded: ' + title);
  } else {
    event = cal.createAllDayEvent(title, date, { description: desc });
    Logger.log('Created: ' + title);
  }
  if (level.num === '3') {
    event.setColor(CalendarApp.EventColor.RED);
  } else {
    event.setColor(CalendarApp.EventColor.ORANGE);
  }
}

// ── 主函數（trigger 呼叫） ────────────────────────

function checkHeatAlert() {
  var hm = taipeiHourMin();
  var inWindow = (hm.h === 7 && hm.m >= 30) || (hm.h >= 8 && hm.h < 15) || (hm.h === 15 && hm.m <= 5);
  if (!inWindow) return;

  var today = todayTaipei();
  Logger.log('checkHeatAlert: ' + today + ' ' + hm.h + ':' + hm.m);

  var level;
  try {
    level = detectTaipeiLevel();
  } catch (e) {
    Logger.log('CWA detection error: ' + e.message);
    return;
  }

  if (!level) {
    Logger.log('No W29 advisory for Taipei today');
    return;
  }

  Logger.log('Detected: Taipei ' + level.zh + ' level');
  ensureCalendarEvent(level, today);
}

// ── Setup（跑一次即可） ───────────────────────────

function setup() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'checkHeatAlert') {
      ScriptApp.deleteTrigger(triggers[i]);
      Logger.log('Deleted existing trigger');
    }
  }
  ScriptApp.newTrigger('checkHeatAlert')
    .timeBased()
    .everyMinutes(5)
    .create();
  Logger.log('Created trigger: checkHeatAlert every 5 minutes');
}
