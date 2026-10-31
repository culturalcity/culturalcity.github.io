// ═══════════════════════════════════════════════════════════════
// 閱大安 路權申請預警（Apps Script）
// ═══════════════════════════════════════════════════════════════
//
// 為什麼有這支：鄰居申請「臨時使用道路」（吊車等）不必通知鄰近住戶，
// 2026-10-31 後巷 81 巷吊車封路，保全看到吊車才知道，住戶 09:40 才收到通知。
// 但申請必須在使用日前 7–30 天送件，核准案件在市府「臺北市申請使用道路網」
// 首頁的「查詢申請」可公開查到（地址＋起訖時間＋狀態，不含申請人與用途）。
//
// 做法：每天早上查未來 31 天的全部案件，地址落在監看範圍的，
// 第一次看到就寄信給 culturalcity85，並在主日曆施工時段建 🚧 事件給總幹事；
// 之後狀態變成核准／撤回／駁回，就地改事件標題並再寄一封。
//
// ⚠️ 資料來源是該網站首頁自己用的內部介面（非正式開放資料），市府改版就可能失效。
//    查詢失敗時當天會寄信，不會安靜停擺。天災緊急申請不受 7 天限制，來不及預警。
//
// 安裝：跑 previewNow() 看今天會抓到什麼（只看不寫）→ 跑 setup() 建每日 trigger。

// ── 常數 ──────────────────────────────────────────

var CALENDAR_ID = 'culturalcity85@gmail.com';
var NOTIFY_EMAIL = 'culturalcity85@gmail.com';
var SITE = 'https://assembly.gov.taipei/PolicePeople/';
var LOOKAHEAD_DAYS = 31;            // 申請最早 30 天前送件，多看一天保險

// 監看的巷弄：地址正規化後（半形數字、去空白、臺→台、2段→二段）含這些字就算
// （81 巷含 81 巷 16 弄；77 巷不影響社區動線，主委 2026-10-31 明示排除）
var WATCH_LANES = [
  '羅斯福路二段81巷',
  '羅斯福路二段101巷',
  '和平東路一段104巷'
];

// 大門前後：羅斯福路二段「大馬路門牌」（不含巷弄）距 85 號 50 公尺內
var ANCHOR_ADDRESS = '台北市大安區羅斯福路二段85號';
var ANCHOR_ROAD = '羅斯福路二段';
var ANCHOR_RADIUS_M = 50;

var ACTIVE = ['收件', '審核中', '緊急申請審核中', '已核准'];
var STORE_KEY = 'roaduse_seen';     // 已通知案件：{ key: { status, eventId, end } }

// ── Helpers ────────────────────────────────────────

function taipeiDate(offsetDays) {
  var t = new Date(Date.now() + 8 * 3600 * 1000 + (offsetDays || 0) * 86400 * 1000);
  return t.toISOString().substring(0, 10);
}

// 全形數字／英文轉半形、去空白、臺→台、阿拉伯數字段別→國字（申請人自己打的地址常混用）
function normAddr(s) {
  s = String(s || '').replace(/[０-９Ａ-Ｚａ-ｚ]/g, function (c) {
    return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
  });
  s = s.replace(/自門牌號至門牌號/g, '').replace(/\s+/g, '').replace(/臺/g, '台');
  var CN = { '1': '一', '2': '二', '3': '三', '4': '四', '5': '五', '6': '六' };
  return s.replace(/路([1-6])段/g, function (m, d) { return '路' + CN[d] + '段'; });
}

function caseAddress(c) {
  var a = String(c.ral_address1 || '').replace(/\s*自門牌號至門牌號/g, '').trim();
  var b = c.ral_address2 && c.ral_address2 !== 'null'
    ? String(c.ral_address2).replace(/\s*自門牌號至門牌號/g, '').trim() : '';
  return b && b !== a ? a + '／' + b : a;
}

function caseKey(c) {
  return c.ral_start_date + '|' + c.ral_end_date + '|' + normAddr(caseAddress(c));
}

function fmtTime(iso) {          // "2026-10-31T08:30:00" → "10/31 08:30"
  var m = String(iso).match(/^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return m ? Number(m[1]) + '/' + Number(m[2]) + ' ' + m[3] + ':' + m[4] : iso;
}

function fmtRange(c) {
  var s = fmtTime(c.ral_start_date), e = fmtTime(c.ral_end_date);
  return s.split(' ')[0] === e.split(' ')[0] ? s + '–' + e.split(' ')[1] : s + ' – ' + e;
}

// ── 抓資料（模仿網站首頁「查詢申請」的請求順序） ──

function cookieHeader(resp, jar) {
  var h = resp.getAllHeaders()['Set-Cookie'];
  if (!h) return;
  (Array.isArray(h) ? h : [h]).forEach(function (line) {
    var kv = String(line).split(';')[0];
    var i = kv.indexOf('=');
    if (i > 0) jar[kv.substring(0, i).trim()] = kv.substring(i + 1);
  });
}

function jarString(jar) {
  return Object.keys(jar).map(function (k) { return k + '=' + jar[k]; }).join('; ');
}

function fetchCases(fromDate, toDate) {
  var jar = {};
  var r = UrlFetchApp.fetch(SITE, { muteHttpExceptions: true, followRedirects: true });
  cookieHeader(r, jar);

  r = UrlFetchApp.fetch(SITE + 'api/JwtToken/GetToken', {
    method: 'post', contentType: 'application/json; charset=utf-8', payload: '',
    headers: { Cookie: jarString(jar) }, muteHttpExceptions: true
  });
  cookieHeader(r, jar);
  var token = JSON.parse(r.getContentText()).ACCESSTOKEN;

  r = UrlFetchApp.fetch(SITE + 'api/antiforgery/tk', {
    headers: { Cookie: jarString(jar) }, muteHttpExceptions: true
  });
  cookieHeader(r, jar);
  var xsrf = JSON.parse(r.getContentText()).tk;

  r = UrlFetchApp.fetch(SITE + 'api/Home/GetRallyTable', {
    method: 'post',
    payload: {
      payno: '',
      rallydays: fromDate.replace(/-/g, '/'),
      rallydaye: toDate.replace(/-/g, '/'),
      rallyplace: ''
    },
    headers: { 'Anti-CSRF': token, 'X-XSRF-TOKEN': xsrf, Cookie: jarString(jar) },
    muteHttpExceptions: true
  });
  if (r.getResponseCode() !== 200) {
    throw new Error('GetRallyTable HTTP ' + r.getResponseCode() + '：' + r.getContentText().substring(0, 300));
  }
  var list = JSON.parse(r.getContentText());
  if (!Array.isArray(list)) throw new Error('GetRallyTable 回傳格式不是陣列');
  // 一個月全市約 1,800 筆；回傳 0 筆幾乎可確定是介面壞了，不是真的沒人申請
  if (list.length === 0) throw new Error('GetRallyTable 回傳 0 筆（查詢介面可能已改版）');
  return list;
}

// ── 比對監看範圍 ──────────────────────────────────

function geocodeLatLng(addr) {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('geo:' + addr);
  if (hit) return hit === 'null' ? null : JSON.parse(hit);
  var res = Maps.newGeocoder().setRegion('tw').setLanguage('zh-TW').geocode(addr);
  var loc = res.status === 'OK' && res.results.length ? res.results[0].geometry.location : null;
  cache.put('geo:' + addr, loc ? JSON.stringify(loc) : 'null', 21600);
  return loc;
}

function distanceM(a, b) {
  var R = 6371000, rad = Math.PI / 180;
  var dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.sqrt(x));
}

// 回傳命中原因字串；沒命中回 null
function matchReason(c, anchor) {
  var addr = normAddr(caseAddress(c));
  for (var i = 0; i < WATCH_LANES.length; i++) {
    if (addr.indexOf(WATCH_LANES[i]) >= 0) return WATCH_LANES[i].replace(/(\d+)巷$/, ' $1 巷');
  }
  if (!anchor || addr.indexOf(ANCHOR_ROAD) < 0) return null;
  // 只看大馬路門牌：切成單一地址，含「巷」的跳過（巷內施工不擋大門前）
  var parts = addr.split(/[／、，,;；]/);
  for (var j = 0; j < parts.length; j++) {
    var m = parts[j].match(/羅斯福路二段(\d+)(之\d+)?號/);
    if (!m || /巷/.test(parts[j].substring(0, parts[j].indexOf(m[0]) + m[0].length))) continue;
    var loc = geocodeLatLng('台北市大安區羅斯福路二段' + m[1] + (m[2] || '') + '號');
    if (!loc) continue;
    var d = distanceM(anchor, loc);
    if (d <= ANCHOR_RADIUS_M) return '85 號前後約 ' + Math.round(d) + ' 公尺';
  }
  return null;
}

function findMatches() {
  var list = fetchCases(taipeiDate(0), taipeiDate(LOOKAHEAD_DAYS));
  var anchor = null;
  try { anchor = geocodeLatLng(ANCHOR_ADDRESS); } catch (e) { Logger.log('anchor geocode 失敗：' + e.message); }
  var out = [];
  list.forEach(function (c) {
    var reason = matchReason(c, anchor);
    if (reason) out.push({ c: c, reason: reason });
  });
  return { total: list.length, anchorOk: !!anchor, matches: out };
}

// ── 通知 ──────────────────────────────────────────

function describe(c, reason) {
  return '地點：' + caseAddress(c) + '\n' +
    '時段：' + fmtRange(c) + '\n' +
    '狀態：' + c.ral_status + '\n' +
    '監看範圍：' + reason + '\n' +
    '類型：' + (c.apply_type === 'assembly' ? '使用道路申請（新工處）' : '臨時使用道路（警察局）') + '\n' +
    '申請送件：' + fmtTime(c.ral_rcv_date);
}

var TODO =
  '【請總幹事處理】\n' +
  '1. 判斷是否影響車道出口或住戶進出；會影響的話，施工前 3 天在住戶群組公告\n' +
  '2. 公告時段以本事件為準（市府核准的起訖時間），不要用口頭轉述的時間\n' +
  '3. 施工當日提醒值班保全\n\n' +
  '資料來源：臺北市申請使用道路網 https://assembly.gov.taipei/PolicePeople/ 首頁「查詢申請」\n' +
  '（網站只公開地址、時段與狀態，申請人與用途要問現場或轄區分局交通組）';

function eventTitle(c) {
  var tag = c.ral_status === '已核准' ? '' : '（' + c.ral_status + '）';
  return '🚧 路權施工' + tag + '・' + caseAddress(c).replace(/^(臺北市|台北市)?大安區/, '') +
    ' ' + fmtRange(c).replace(/^\d+\/\d+ /, '');
}

function createEvent(c, reason) {
  var cal = CalendarApp.getCalendarById(CALENDAR_ID);
  var start = new Date(c.ral_start_date + '+08:00');
  var end = new Date(c.ral_end_date + '+08:00');
  var ev = cal.createEvent(eventTitle(c), start, end, {
    description: describe(c, reason) + '\n\n' + TODO + '\n\n📌 由 Apps Script roaduse-poll 自動建立'
  });
  ev.setColor(CalendarApp.EventColor.ORANGE);
  return ev.getId();
}

function sendMail(subject, body) {
  MailApp.sendEmail(NOTIFY_EMAIL, subject, body + '\n\n—— Apps Script roaduse-poll 自動寄出');
}

// ── 主函數（trigger 呼叫） ────────────────────────

function runDaily() {
  var props = PropertiesService.getScriptProperties();
  var seen = JSON.parse(props.getProperty(STORE_KEY) || '{}');
  var result;
  try {
    result = findMatches();
  } catch (e) {
    Logger.log('查詢失敗：' + e.message);
    sendMail('⚠️ 路權預警今天查詢失敗',
      '今天沒能從臺北市申請使用道路網取得資料，這段期間的施工不會自動預警。\n\n' +
      '錯誤：' + e.message + '\n\n若連續幾天都失敗，多半是市府網站改版，需要修 roaduse-poll.gs。');
    return;
  }
  Logger.log('全市 ' + result.total + ' 筆，命中 ' + result.matches.length + ' 筆');

  result.matches.forEach(function (m) {
    var c = m.c, key = caseKey(c), old = seen[key];
    var active = ACTIVE.indexOf(c.ral_status) >= 0;

    if (!old) {
      if (!active) return;           // 第一次看到就已撤回／駁回，不必通知
      var id = createEvent(c, m.reason);
      seen[key] = { status: c.ral_status, eventId: id, end: c.ral_end_date };
      sendMail('🚧 路權預警：' + fmtRange(c) + ' ' + caseAddress(c),
        '監看範圍內有新的路權申請：\n\n' + describe(c, m.reason) + '\n\n已在主日曆建立事件。\n\n' + TODO);
      return;
    }
    if (old.status === c.ral_status) return;

    // 狀態變了：改事件標題、寄一封
    try {
      var ev = CalendarApp.getCalendarById(CALENDAR_ID).getEventById(old.eventId);
      if (ev) ev.setTitle(active ? eventTitle(c) : '❎ 已' + c.ral_status.replace(/^申請人自行/, '') + '・' + eventTitle(c).replace(/^🚧 /, ''));
    } catch (e) { Logger.log('改事件失敗：' + e.message); }
    sendMail((active ? '🚧' : '❎') + ' 路權狀態變更：' + old.status + ' → ' + c.ral_status,
      describe(c, m.reason) + (active ? '' : '\n\n這筆已不會施工，主日曆事件已標註，不必公告。'));
    old.status = c.ral_status;
  });

  // 清掉已結束的案件
  var nowIso = taipeiDate(0) + 'T00:00:00';
  Object.keys(seen).forEach(function (k) { if (seen[k].end < nowIso) delete seen[k]; });
  props.setProperty(STORE_KEY, JSON.stringify(seen));
}

// ── 手動工具 ──────────────────────────────────────

// 只查不寫：印出今天抓到的命中案件（驗證介面還活著、比對規則對不對）
function previewNow() {
  var r = findMatches();
  Logger.log('全市 ' + r.total + ' 筆；85 號定位' + (r.anchorOk ? '成功' : '失敗（大門前後 50 公尺這條暫時無效）'));
  r.matches.forEach(function (m) { Logger.log(m.c.ral_status + '｜' + fmtRange(m.c) + '｜' + caseAddress(m.c) + '｜' + m.reason); });
  if (!r.matches.length) Logger.log('未來 ' + LOOKAHEAD_DAYS + ' 天監看範圍內沒有案件');
}

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runDaily') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runDaily').timeBased().everyDays(1).atHour(7).inTimezone('Asia/Taipei').create();
  Logger.log('Created trigger: runDaily 每天 07:00–08:00');
}
