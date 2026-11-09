// ═══════════════════════════════════════════════════════════════
// 閱大安 下月日曆設定檢查（Apps Script）
// ═══════════════════════════════════════════════════════════════
//
// 為什麼有這支：每月的「維修保養公告」與「清潔排程公告」要在月底（約 29–31 日）
// 發給住戶，資料來源是總幹事在 Google 日曆排好的下個月行程。總幹事晚排，
// 主委就要臨時追（2026-11 的清潔排程 10/31 才排好）。2026-11-09 主委要求自動檢查。
//
// 做法：每天 09:00 跑，只在「月底前兩天」起動作（31 天的月 29 日起、30 天的月 28 日起、2 月 26 日起）：
//   - 檢查「閱大安-清潔」日曆：下個月每一天都要有事件（打掃區域或「清潔排休」）
//   - 檢查「閱大安-維養」日曆：下個月要有每月固定的三項（機電、電梯、園藝保養）
//   - 還沒排好 → 每天寄信（最多 3 封），寫給總幹事、列出缺哪些
//   - 兩本都排好 → 當月寄一次「可以準備公告了」
//
// 收件人：culturalcity85（總幹事收信、主委也看得到；不寫個人信箱，換屆不必改）。信是寫給總幹事的，語氣要柔和。
// 安裝：跑 previewNow() 看下個月目前的檢查結果（只看不寄）→ 跑 setup() 建每日 trigger。

// ── 常數 ──────────────────────────────────────────

var CLEAN_CAL = '92d9e32e58a759f9f2116192198b4f431b91e2fe0ebe934ce399d100a79c10d7@group.calendar.google.com';
var MAINT_CAL = 'cultralcity85@gmail.com';   // 維養日曆的 id 少一個 u，是建立時的原樣，不是筆誤
var NOTIFY_EMAIL = 'culturalcity85@gmail.com';  // 只寄社區帳號：總幹事收得到、主委也看得到，換屆不必改程式（2026-11-09 主委定）
var DAYS_BEFORE_END = 2;                     // 月底前幾天開始檢查（2026-11-09 主委定：月底前兩天，2 月也涵蓋）
var MONTHLY_ITEMS = ['機電保養', '電梯保養', '園藝保養'];  // 每月固定項目（事件標題開頭）
var DONE_KEY = 'done_notified_';             // + YYYY-MM：當月已寄「完成」

// ── 日期工具 ──────────────────────────────────────

function tz() { return 'Asia/Taipei'; }
function fmt(d, p) { return Utilities.formatDate(d, tz(), p); }
function todayParts() {
  var s = fmt(new Date(), 'yyyy-MM-dd').split('-');
  return { y: +s[0], m: +s[1], d: +s[2] };
}
function nextMonth(t) {
  var y = t.m === 12 ? t.y + 1 : t.y, m = t.m === 12 ? 1 : t.m + 1;
  var days = new Date(y, m, 0).getDate();
  return { y: y, m: m, days: days, key: y + '-' + ('0' + m).slice(-2) };
}
function monthRange(nm) {
  // 台北時間的月初 00:00 到下月初 00:00
  var start = new Date(Utilities.formatString('%04d-%02d-01T00:00:00+08:00', nm.y, nm.m));
  var ny = nm.m === 12 ? nm.y + 1 : nm.y, nmm = nm.m === 12 ? 1 : nm.m + 1;
  var end = new Date(Utilities.formatString('%04d-%02d-01T00:00:00+08:00', ny, nmm));
  return { start: start, end: end };
}
var WD = '日一二三四五六';
function md(nm, day) {
  var d = new Date(Utilities.formatString('%04d-%02d-%02dT12:00:00+08:00', nm.y, nm.m, day));
  return nm.m + '/' + ('0' + day).slice(-2) + '（' + WD.charAt(d.getDay()) + '）';
}

// ── 檢查 ──────────────────────────────────────────

function checkClean(nm) {
  var r = monthRange(nm);
  var events = CalendarApp.getCalendarById(CLEAN_CAL).getEvents(r.start, r.end);
  var covered = {};
  events.forEach(function (e) {
    // 全天事件可能跨多天：逐日標記
    var s = e.isAllDayEvent() ? e.getAllDayStartDate() : e.getStartTime();
    var t = e.isAllDayEvent() ? e.getAllDayEndDate() : new Date(e.getEndTime().getTime() + 1);
    for (var d = new Date(s); d < t; d = new Date(d.getTime() + 86400000)) {
      if (fmt(d, 'yyyy-MM') === nm.key) covered[+fmt(d, 'd')] = true;
      if (!e.isAllDayEvent()) break;
    }
  });
  var missing = [];
  for (var day = 1; day <= nm.days; day++) if (!covered[day]) missing.push(day);
  return { count: events.length, missing: missing };
}

function checkMaint(nm) {
  var r = monthRange(nm);
  var titles = CalendarApp.getCalendarById(MAINT_CAL).getEvents(r.start, r.end)
    .map(function (e) { return e.getTitle().trim(); });
  var missing = MONTHLY_ITEMS.filter(function (item) {
    return !titles.some(function (t) { return t.indexOf(item) === 0; });
  });
  return { titles: titles, missing: missing };
}

function summarize(nm, c, m) {
  var lines = [];
  if (c.missing.length === 0) lines.push('✓ 清潔排程：' + nm.m + ' 月每天都排好了');
  else if (c.missing.length === nm.days) lines.push('✗ 清潔排程：' + nm.m + ' 月還完全沒排');
  else lines.push('✗ 清潔排程：還缺 ' + c.missing.length + ' 天（' +
    c.missing.map(function (d) { return md(nm, d); }).join('、') + '）');
  if (m.missing.length === 0) lines.push('✓ 維修保養：機電、電梯、園藝三項都排好了');
  else lines.push('✗ 維修保養：還沒排 ' + m.missing.join('、'));
  return lines;
}

// ── 主程式 ────────────────────────────────────────

function runDaily() {
  var t = todayParts();
  var lastDay = new Date(t.y, t.m, 0).getDate();
  if (t.d < lastDay - DAYS_BEFORE_END) return;
  var nm = nextMonth(t);
  var c = checkClean(nm), m = checkMaint(nm);
  var ok = c.missing.length === 0 && m.missing.length === 0;
  var props = PropertiesService.getScriptProperties();
  var lines = summarize(nm, c, m);

  if (ok) {
    if (props.getProperty(DONE_KEY + nm.key)) return;
    MailApp.sendEmail(NOTIFY_EMAIL,
      '【閱大安】' + nm.m + ' 月清潔排程與維修保養都排好了，可以準備公告',
      lines.join('\n') + '\n\n可以開始準備 ' + nm.m + ' 月的維修保養公告與清潔排程公告。' + footer());
    props.setProperty(DONE_KEY + nm.key, fmt(new Date(), 'yyyy-MM-dd'));
    return;
  }
  var asks = [];
  if (c.missing.length) asks.push(nm.m + ' 月的清潔排程');
  if (m.missing.length) asks.push(nm.m + ' 月的' + m.missing.join('、') + '日期');
  MailApp.sendEmail(NOTIFY_EMAIL,
    '【閱大安】提醒：' + asks.join('、') + '還沒排進 Google 日曆',
    '主任您好：\n\n月底要發給住戶的維修保養公告與清潔排程公告，會用到 Google 日曆裡下個月的行程。' +
    '今天（' + t.m + '/' + t.d + '）檢查的結果如下：\n\n' + lines.join('\n') +
    '\n\n想麻煩您這兩天幫忙把' + asks.join('，以及') + '排進日曆，謝謝！' +
    '\n\n（已經排好的話，明天檢查通過就不會再收到這封信。）' + footer());
}

function footer() {
  return '\n\n—— Apps Script calendar-setup-check 自動寄出（每月月底前 ' + DAYS_BEFORE_END + ' 天起每天 09:00 檢查）';
}

// 手動：看下個月目前的檢查結果（不寄信、不看日期）
function previewNow() {
  var nm = nextMonth(todayParts());
  var c = checkClean(nm), m = checkMaint(nm);
  Logger.log(nm.key + '\n' + summarize(nm, c, m).join('\n'));
  Logger.log('維養事件：' + m.titles.join('｜'));
}

// 手動：跳過日期限制，立刻寄一封檢查結果到 culturalcity85（測試用）
function testMailNow() {
  var t = todayParts(), nm = nextMonth(t);
  var c = checkClean(nm), m = checkMaint(nm);
  MailApp.sendEmail(NOTIFY_EMAIL, '【閱大安】下月日曆檢查（測試信）',
    summarize(nm, c, m).join('\n') + footer());
}

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (tr) {
    if (tr.getHandlerFunction() === 'runDaily') ScriptApp.deleteTrigger(tr);
  });
  ScriptApp.newTrigger('runDaily').timeBased().everyDays(1).atHour(9).inTimezone('Asia/Taipei').create();
  Logger.log('已建每日 09:00 trigger');
}
