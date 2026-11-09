// ═══════════════════════════════════════════════════════════════
// 閱大安 下月日曆設定檢查＋清潔排程公告自動草稿（Apps Script）
// ═══════════════════════════════════════════════════════════════
//
// 為什麼有這支：每月的「維修保養公告」與「清潔排程公告」要在月底（約 29–31 日）
// 發給住戶，資料來源是總幹事在 Google 日曆排好的下個月行程。總幹事晚排，
// 主委就要臨時追（2026-11 的清潔排程 10/31 才排好）。2026-11-09 主委要求：
//   - 自動檢查總幹事排好了沒，沒排好就提醒
//   - 清潔排程排好了 → 自動做成網站「內審版」公告，請主委確認後轉正式（B 方案）
//   - 維修保養排好了 → 提醒主委找晰兒做公告（A 方案；施作範圍要翻英日文，不自動）
//
// 做法：每天 09:00 跑，只在「月底前兩天」起動作（31 天的月 29 日起、30 天的月 28 日起、2 月 26 日起）：
//   - 「閱大安-清潔」日曆：下個月每一天都要有事件（打掃區域或「清潔排休」）
//       排好 → 產公告 HTML、commit 到 repo（內審版：不進列表與首頁）→ 寄信＋主日曆 📢 待辦
//       之後總幹事又改了日曆 → 公告還沒轉正式就自動更新並再寄信
//   - 「閱大安-維養」日曆：下個月要有每月必有的機電保養、電梯保養（園藝不是每月都有，不檢查）
//       排好 → 寄信＋主日曆 📢 待辦「確認發布保養公告」
//   - 還沒排好 → 每天寄一封提醒（最多 3 封），寫給總幹事、列出缺哪些
//
// 收件人：culturalcity85（總幹事收信、主委也看得到；不寫個人信箱，換屆不必改）。
// 轉正式由主委跟晰兒說「發 X 月清潔公告」：刪 eleventyExcludeFromCollections、檔名改發布日、push、LINE 帶路圖。
//
// 安裝：
//   1. 專案設定 → 指令碼屬性 → 新增 GITHUB_TOKEN（與 weather-fetch 同一把：只給本 repo、Contents 讀寫）
//   2. 跑 previewNow() 看下個月目前的檢查結果與公告草稿（只看不寫）
//   3. 跑 setup() 建每日 09:00 trigger

// ── 常數 ──────────────────────────────────────────

var CLEAN_CAL = '92d9e32e58a759f9f2116192198b4f431b91e2fe0ebe934ce399d100a79c10d7@group.calendar.google.com';
var MAINT_CAL = 'cultralcity85@gmail.com';   // 維養日曆的 id 少一個 u，是建立時的原樣，不是筆誤
var MAIN_CAL = 'culturalcity85@gmail.com';   // 主日曆：📢 待辦放這裡
var NOTIFY_EMAIL = 'culturalcity85@gmail.com';
var DAYS_BEFORE_END = 2;                     // 月底前幾天開始檢查（2026-11-09 主委定：月底前兩天，2 月也涵蓋）
var MONTHLY_ITEMS = ['機電保養', '電梯保養'];  // 維養每月必有的項目（事件標題開頭）。園藝合約 1、2、11 月沒有，不列入
var REPO = 'culturalcity/culturalcity.github.io';
var BRANCH = 'main';
var SITE = 'https://culturalcity.org';

// ── 日期工具 ──────────────────────────────────────

function fmt(d, p) { return Utilities.formatDate(d, 'Asia/Taipei', p); }
function todayParts() {
  var s = fmt(new Date(), 'yyyy-MM-dd').split('-');
  return { y: +s[0], m: +s[1], d: +s[2], iso: s.join('-') };
}
function nextMonth(t) {
  var y = t.m === 12 ? t.y + 1 : t.y, m = t.m === 12 ? 1 : t.m + 1;
  return { y: y, m: m, days: new Date(y, m, 0).getDate(), key: y + '-' + pad2(m) };
}
function pad2(n) { return ('0' + n).slice(-2); }
function monthRange(nm) {
  var ny = nm.m === 12 ? nm.y + 1 : nm.y, nmm = nm.m === 12 ? 1 : nm.m + 1;
  return {
    start: new Date(nm.y + '-' + pad2(nm.m) + '-01T00:00:00+08:00'),
    end: new Date(ny + '-' + pad2(nmm) + '-01T00:00:00+08:00')
  };
}
function weekday(y, m, d) { return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }  // 0=日

// ═══ 清潔排程：日曆標題 → 區域代碼（純函式，可在 Node 測） ═══════════
//
// 總幹事的標題寫法（2026-08～11 實測）：「NNF走道含當層A.B逃生梯」「02F健身房…」「01F閱覽室及C逃生梯」
// 「R1F閱覽室及空中花園…」「R2F-R3F A梯逃生梯」「BnF地下室及擦拭充電樁」「清潔排休」。
// 對不上的（臨時加做，如「B4F消防機房內拖地保持乾燥」）回 null，公告寫「其他公共區域加強清潔」，信裡列出來。
function areaCode(title) {
  var s = String(title).trim();
  if (s === '清潔排休') return 'OFF';
  var m;
  if ((m = s.match(/^(\d{2})F走道/))) return String(+m[1]);
  if (/^02F健身房/.test(s)) return '2';
  if (/^01F閱覽室/.test(s)) return '1';
  if (/^R1F閱覽室/.test(s) || /^R2F-R3F/.test(s)) return 'R';
  if ((m = s.match(/^B([1-4])F地下室及擦拭充電樁/))) return 'B' + m[1];
  return null;
}

// 空間名稱依 i18n-glossary.md（2026-11-08 主委定案）
function areaName(code, li) {
  var A = {
    'R': ['RF 頂樓室內空間、空中花園與 A 梯（含 R2F–R3F）', 'RF Lounge, Sky Garden &amp; Staircase A (incl. R2F–R3F)', 'RF ラウンジ・屋上庭園・A階段（R2〜R3階を含む）'],
    '1': ['1F 交誼廳與 C 梯', '1F Lounge &amp; Staircase C', '1F ラウンジ・C階段'],
    '2': ['2F 健身房與 A、B 梯', '2F Gym, Staircases A &amp; B', '2F ジム・A・B階段'],
    'X': ['其他公共區域加強清潔', 'Additional cleaning of other common areas', 'その他共用部分の重点清掃']
  };
  if (A[code]) return A[code][li];
  if (code[0] === 'B') return [code + 'F 地下室與充電樁', code + 'F Basement Parking Lot &amp; EV Chargers', code + 'F 地下駐車場・EV充電器'][li];
  return [code + 'F 走道與 A、B 梯', code + 'F Corridor, Staircases A &amp; B', code + 'F 共用廊下・A・B階段'][li];
}

var ORDER = ['R', '15', '14', '13', '12', '11', '10', '9', '8', '7', '6', '5', '4', '3', '2', '1', 'B1', 'B2', 'B3', 'B4'];
var LANGS = ['zh', 'en', 'ja'];
var WD = { zh: '日一二三四五六', en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], ja: '日月火水木金土' };
function wdName(lang, y, m, d) { var w = weekday(y, m, d); return lang === 'en' ? WD.en[w] : WD[lang].charAt(w); }

// events: [{ day, title }] → S[day] = 'OFF' | [代碼…]；extras = 對不上的標題
function buildSchedule(days, events) {
  var S = {}, extras = [];
  events.forEach(function (e) {
    var c = areaCode(e.title);
    if (c === 'OFF') { if (!S[e.day]) S[e.day] = 'OFF'; return; }
    if (S[e.day] === 'OFF' || !S[e.day]) S[e.day] = [];
    if (c === null) { extras.push(e.day + '日：' + String(e.title).trim()); c = 'X'; }
    if (S[e.day].indexOf(c) < 0) S[e.day].push(c);
  });
  var missing = [];
  for (var d = 1; d <= days; d++) {
    if (!S[d]) { missing.push(d); continue; }
    if (S[d] !== 'OFF') {
      // 有正式區域就不顯示「其他加強清潔」；同一天多區時由低樓層到高樓層
      var real = S[d].filter(function (c) { return c !== 'X'; });
      S[d] = (real.length ? real : ['X']).sort(function (a, b) { return ORDER.indexOf(b) - ORDER.indexOf(a); });
    }
  }
  return { S: S, extras: extras, missing: missing };
}

function floorRows(y, m, S, lang) {
  var days = {}, out = [];
  Object.keys(S).map(Number).sort(function (a, b) { return a - b; }).forEach(function (d) {
    if (S[d] === 'OFF') return;
    S[d].forEach(function (k) { if (k !== 'X') (days[k] = days[k] || []).push(d); });
  });
  var groups = [];
  ORDER.forEach(function (k) {
    if (!days[k]) return;
    var last = groups.length ? groups[groups.length - 1] : null;
    var prev = last ? last[last.length - 1] : null;
    if (last && days[prev].join() === days[k].join() && S[days[k][0]].indexOf(prev) >= 0) last.push(k);
    else groups.push([k]);
  });
  var gsep = { zh: '、', en: ' &amp; ', ja: '・' }[lang], dsep = { zh: '、', en: ', ', ja: '、' }[lang];
  groups.forEach(function (g) {
    var label = g.slice().sort(function (a, b) { return ORDER.indexOf(b) - ORDER.indexOf(a); }).map(function (k) {
      if (k === 'R') return { zh: 'RF（含 R2F–R3F）', en: 'RF (incl. R2F–R3F)', ja: 'RF（R2〜R3階を含む）' }[lang];
      return k + 'F';
    }).join(gsep);
    var ds = days[g[0]].map(function (d) {
      var w = wdName(lang, y, m, d);
      return '<span class="d">' + m + '/' + pad2(d) + (lang === 'en' ? ' (' + w + ')' : '（' + w + '）') + '</span>';
    }).join(dsep);
    out.push('          <tr><td>' + label + '</td><td>' + ds + '</td></tr>');
  });
  return out.join('\n');
}

function dateRows(y, m, S, lang) {
  var li = LANGS.indexOf(lang), out = [];
  var off = { zh: '清潔人員排休', en: 'Cleaning staff day off', ja: '清掃スタッフ休み' }[lang];
  Object.keys(S).map(Number).sort(function (a, b) { return a - b; }).forEach(function (d) {
    var w = weekday(y, m, d), wk = (w === 0 || w === 6) ? ' class="wkend"' : '';
    var head = '<td>' + m + '/' + pad2(d) + '</td><td' + wk + '>' + wdName(lang, y, m, d) + '</td>';
    if (S[d] === 'OFF') out.push('          <tr class="off">' + head + '<td>' + off + '</td></tr>');
    else out.push('          <tr>' + head + '<td>' + S[d].map(function (k) { return areaName(k, li); }).join('<br>') + '</td></tr>');
  });
  return out.join('\n');
}

var TXT = {
  zh: { floor: '依樓層查', fh: ['樓層', '本月清掃日'], date: '依日期查', dh: ['日期', '星期', '清掃區域'],
        intro: '清潔人員依下表輪流清掃各樓層公共區域。',
        note: '實際日期可能因天候或臨時狀況調整。發現公共區域髒污，請隨時告知管理中心。' },
  en: { floor: 'Find Your Floor', fh: ['Floor', 'Cleaning Days'], date: 'By Date', dh: ['Date', 'Day', 'Area'],
        intro: 'Our cleaning staff clean the common areas floor by floor according to the schedule below.',
        note: 'Dates may change due to weather or unforeseen circumstances. If you notice any dirty common areas, please let the Management Center know at any time.' },
  ja: { floor: '階別の清掃日', fh: ['階', '清掃日'], date: '日付別', dh: ['日付', '曜日', '清掃エリア'],
        intro: '清掃スタッフが下表のとおり各階の共用部分を順番に清掃します。',
        note: '天候や臨時の事情により日程が変更になる場合があります。共用部分の汚れにお気づきの際は、いつでも管理センターまでお知らせください。' }
};

function langBlock(y, m, S, lang) {
  var t = TXT[lang];
  return '<div class="lang-block' + (lang === 'zh' ? ' active' : '') + '" data-lang="' + lang + '">\n' +
    '<div class="sec">\n' +
    '      <div class="sec-label">' + t.floor + '</div>\n' +
    '      <p>' + t.intro + '</p>\n' +
    '      <table class="clean-table floor-table">\n' +
    '        <thead><tr><th>' + t.fh[0] + '</th><th>' + t.fh[1] + '</th></tr></thead>\n' +
    '        <tbody>\n' + floorRows(y, m, S, lang) + '\n        </tbody>\n      </table>\n    </div>\n' +
    '<div class="sec">\n' +
    '      <div class="sec-label">' + t.date + '</div>\n' +
    '      <table class="clean-table">\n' +
    '        <thead><tr><th>' + t.dh[0] + '</th><th>' + t.dh[1] + '</th><th>' + t.dh[2] + '</th></tr></thead>\n' +
    '        <tbody>\n' + dateRows(y, m, S, lang) + '\n        </tbody>\n      </table>\n    </div>\n' +
    '    <div class="note">' + t.note + '</div>\n</div>\n';
}

var MONTH_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function noticeSlug(pub, m) { return pub + '-' + m + '月清潔排程'; }

// pub = 'YYYY-MM-DD'（產生日；轉正式時晰兒改成發布日）
function buildNoticeHtml(y, m, pub, S) {
  var offs = Object.keys(S).map(Number).filter(function (d) { return S[d] === 'OFF'; }).sort(function (a, b) { return a - b; })
    .map(function (d, i) { return i ? pad2(d) : m + '/' + pad2(d); }).join('、');
  var fm = [
    '---',
    'layout: notice.njk',
    'permalink: /notice/' + noticeSlug(pub, m) + '.html',
    'title: ' + y + '年' + m + '月公共區域清潔排程',
    'titleZh: ' + y + '年' + m + '月公共區域清潔排程',
    "titleEn: 'Common Area Cleaning Schedule – " + MONTH_EN[m - 1] + ' ' + y + "'",
    'titleJa: ' + y + '年' + m + '月　共用部分清掃スケジュール',
    'displayDate: ' + pub.replace(/-/g, '/'),
    'typeZh: 環境清潔',
    'typeEn: Cleaning',
    'typeJa: 清掃',
    'pillType: clean',
    'eleventyExcludeFromCollections: true   # 內審版：主委確認後刪這行轉正式',
    'extraStyles: |',
    '  .clean-table{width:100%;border-collapse:collapse;font-size:var(--fs-text);}',
    '  .clean-table th{background:var(--wg41);color:var(--wg1);padding:var(--sp-8) var(--sp-12);text-align:left;font-weight:500;font-size:var(--fs-text);letter-spacing:var(--ls-text);}',
    '  .clean-table td{padding:var(--sp-8) var(--sp-12);border-bottom:1px solid var(--line);vertical-align:top;background:var(--white);line-height:var(--lh-text);}',
    '  .clean-table td:first-child{font-weight:700;color:var(--wg41);width:64px;}',
    '  .clean-table td:nth-child(2){color:var(--wg11);width:56px;}',
    '  .main .sec .clean-table th,.main .sec .clean-table td:first-child,.main .sec .clean-table td:nth-child(2){white-space:nowrap;}',
    '  .clean-table td.wkend{color:var(--dn);}',
    '  .clean-table tr.off td{background:var(--tint);color:var(--wg9);}',
    '  .clean-table tr.off td:first-child{color:var(--wg9);font-weight:400;}',
    '  .clean-table.floor-table td:first-child{width:auto;}',
    '  .main .sec .clean-table.floor-table td:nth-child(2){white-space:normal;width:auto;color:var(--wg41);}',
    '  .clean-table .d{white-space:nowrap;}',
    'summary: 依樓層查本月清掃日；排休 ' + offs,
    '---'
  ].join('\n');
  return fm + '\n' + LANGS.map(function (l) { return langBlock(y, m, S, l); }).join('\n');
}

// ═══ Google 日曆讀取 ══════════════════════════════

function readCleanEvents(nm) {
  var r = monthRange(nm), out = [];
  CalendarApp.getCalendarById(CLEAN_CAL).getEvents(r.start, r.end).forEach(function (e) {
    var title = e.getTitle();
    if (!e.isAllDayEvent()) { out.push({ day: +fmt(e.getStartTime(), 'd'), title: title }); return; }
    for (var d = e.getAllDayStartDate(); d < e.getAllDayEndDate(); d = new Date(d.getTime() + 86400000)) {
      if (fmt(d, 'yyyy-MM') === nm.key) out.push({ day: +fmt(d, 'd'), title: title });
    }
  });
  return out;
}

function checkMaint(nm) {
  var r = monthRange(nm);
  var events = CalendarApp.getCalendarById(MAINT_CAL).getEvents(r.start, r.end);
  var titles = events.map(function (e) { return e.getTitle().trim(); });
  var missing = MONTHLY_ITEMS.filter(function (item) {
    return !titles.some(function (t) { return t.indexOf(item) === 0; });
  });
  // 給主委確認「本月是不是就只有這幾項」：日期時間＋標題，說明欄空白的標「內部事項，不進公告」
  var list = events.map(function (e) {
    var when = e.isAllDayEvent() ? fmt(e.getAllDayStartDate(), 'M/dd') + '（全天）'
      : fmt(e.getStartTime(), 'M/dd HH:mm') + '–' + fmt(e.getEndTime(), 'HH:mm');
    return '・' + when + '　' + e.getTitle().trim() + (String(e.getDescription() || '').trim() ? '' : '　← 說明欄空白：內部事項，不進公告');
  });
  return { titles: titles, missing: missing, list: list };
}

function mdw(nm, d) { return nm.m + '/' + pad2(d) + '（' + WD.zh.charAt(weekday(nm.y, nm.m, d)) + '）'; }

function statusLines(nm, cl, mt) {
  var lines = [];
  if (!cl.missing.length) lines.push('✓ 清潔排程：' + nm.m + ' 月每天都排好了');
  else if (cl.missing.length === nm.days) lines.push('✗ 清潔排程：' + nm.m + ' 月還完全沒排');
  else lines.push('✗ 清潔排程：還缺 ' + cl.missing.length + ' 天（' + cl.missing.map(function (d) { return mdw(nm, d); }).join('、') + '）');
  if (!mt.missing.length) lines.push('✓ 維修保養：機電、電梯保養都排好了');
  else lines.push('✗ 維修保養：還沒排 ' + mt.missing.join('、'));
  return lines;
}

// ═══ GitHub ═══════════════════════════════════════

function ghFetch(path, method, payload, allow404) {
  var tok = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!tok) throw new Error('指令碼屬性缺 GITHUB_TOKEN（見檔頭安裝步驟）');
  var opts = { method: method || 'get', muteHttpExceptions: true,
    headers: { 'Authorization': 'Bearer ' + tok, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } };
  if (payload) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(payload); }
  var res = UrlFetchApp.fetch('https://api.github.com' + path, opts), code = res.getResponseCode();
  if (code === 404 && allow404) return null;
  if (code < 200 || code >= 300) throw new Error('GitHub ' + (method || 'get') + ' ' + path + ' → HTTP ' + code + ': ' + res.getContentText().slice(0, 200));
  return JSON.parse(res.getContentText());
}
function ghPath(p) { return '/repos/' + REPO + '/contents/' + encodeURIComponent(p).replace(/%2F/g, '/'); }
function ghGetFile(p) {
  var j = ghFetch(ghPath(p) + '?ref=' + BRANCH, 'get', null, true);
  if (!j) return null;
  return { sha: j.sha, text: Utilities.newBlob(Utilities.base64Decode(j.content.replace(/\n/g, ''))).getDataAsString('UTF-8') };
}
function ghPutFile(p, text, message, sha) {
  var body = { message: message, branch: BRANCH, content: Utilities.base64Encode(text, Utilities.Charset.UTF_8) };
  if (sha) body.sha = sha;
  return ghFetch(ghPath(p), 'put', body);
}

// ═══ 主程式 ═══════════════════════════════════════

function runDaily() {
  var t = todayParts();
  var lastDay = new Date(t.y, t.m, 0).getDate();
  if (t.d < lastDay - DAYS_BEFORE_END) return;
  var nm = nextMonth(t);
  var props = PropertiesService.getScriptProperties();
  var cl = buildSchedule(nm.days, readCleanEvents(nm));
  var mt = checkMaint(nm);
  var lines = statusLines(nm, cl, mt);

  // 清潔排程（B）：排好就產內審版；之後日曆變了、仍是內審版就更新
  if (!cl.missing.length) {
    try { handleCleanDraft(nm, t, cl, props); }
    catch (e) { mail('【閱大安】' + nm.m + ' 月清潔排程公告自動產生失敗', '錯誤：' + e.message + '\n\n請主委找晰兒手動產生。'); }
  }

  // 維修保養（A）：排好就提醒主委找晰兒做公告（每月一次）
  if (!mt.missing.length && !props.getProperty('maint_done_' + nm.key)) {
    var ev = todo('📢 確認發布 ' + nm.m + ' 月維修保養公告',
      '總幹事已在「閱大安-維養」日曆排好 ' + nm.m + ' 月的機電、電梯保養。\n主委跟晰兒說「做 ' + nm.m + ' 月保養公告」即可。');
    mail('【閱大安】' + nm.m + ' 月維修保養已排好，可以準備保養公告',
      '總幹事已在「閱大安-維養」日曆排好 ' + nm.m + ' 月的機電、電梯保養。\n\n' +
      '日曆上 ' + nm.m + ' 月目前排了這些，請確認是不是就只有這幾項：\n' + mt.list.join('\n') + '\n\n' +
      '下一步：主委跟晰兒說「做 ' + nm.m + ' 月保養公告」，晰兒會掃日曆、做三語公告給主委確認。\n' +
      '（主日曆今天已建待辦「' + ev + '」）');
    props.setProperty('maint_done_' + nm.key, t.iso);
  }

  // 還沒排好的部分：寫給總幹事（月底前每天一封，最多 3 封）
  if (cl.missing.length || mt.missing.length) {
    var asks = [];
    if (cl.missing.length) asks.push(nm.m + ' 月的清潔排程');
    if (mt.missing.length) asks.push(nm.m + ' 月的' + mt.missing.join('、') + '日期');
    mail('【閱大安】提醒：' + asks.join('、') + '還沒排進 Google 日曆',
      '主任您好：\n\n月底要發給住戶的維修保養公告與清潔排程公告，會用到 Google 日曆裡下個月的行程。' +
      '今天（' + t.m + '/' + t.d + '）檢查的結果如下：\n\n' + lines.join('\n') +
      '\n\n想麻煩您這兩天幫忙把' + asks.join('，以及') + '排進日曆，謝謝！' +
      '\n\n（已經排好的話，明天檢查通過就不會再收到這封信。）');
  }
}

function handleCleanDraft(nm, t, cl, props) {
  var html0 = buildNoticeHtml(nm.y, nm.m, '0000-00-00', cl.S);           // 不含日期的內容指紋
  var hash = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, html0, Utilities.Charset.UTF_8));
  var rec = JSON.parse(props.getProperty('clean_draft_' + nm.key) || 'null');   // { path, pub, hash, url }
  if (rec && rec.hash === hash) return;                                  // 沒變

  var pub = rec ? rec.pub : t.iso;
  var path = 'src/notice/' + noticeSlug(pub, nm.m) + '.html';
  var existing = ghGetFile(path);
  if (rec && (!existing || existing.text.indexOf('eleventyExcludeFromCollections: true') < 0)) {
    // 已轉正式（或晰兒改了檔名）：不自動改正式公告，只通知一次
    if (rec.notifiedChange !== hash) {
      mail('【閱大安】' + nm.m + ' 月清潔排程在公告轉正式後又改了',
        '總幹事在「閱大安-清潔」日曆改了 ' + nm.m + ' 月的排程，但公告已經轉為正式，程式不會自動改正式公告。\n' +
        '請主委找晰兒說「更新 ' + nm.m + ' 月清潔公告」。');
      rec.notifiedChange = hash; props.setProperty('clean_draft_' + nm.key, JSON.stringify(rec));
    }
    return;
  }
  var html = buildNoticeHtml(nm.y, nm.m, pub, cl.S);
  ghPutFile(path, html, (rec ? 'data(notice): 更新 ' : 'feat(notice): ') + nm.y + '年' + nm.m + '月清潔排程（內審版・Apps Script 依清潔日曆自動產生）',
    existing ? existing.sha : null);
  var url = SITE + '/notice/' + encodeURIComponent(noticeSlug(pub, nm.m)) + '.html';
  var extraTxt = cl.extras.length ? '\n\n以下臨時加做的項目，公告寫成「其他公共區域加強清潔」（有正式區域的日子就不列）：\n' + cl.extras.join('\n') : '';
  if (!rec) {
    var ev = todo('📢 確認發布 ' + nm.m + ' 月清潔排程公告', '內審版已上線：' + url + '\n主委看過沒問題，跟晰兒說「發 ' + nm.m + ' 月清潔公告」。');
    mail('【閱大安】' + nm.m + ' 月清潔排程公告（內審版）已上線，請主委確認',
      '總幹事已排好 ' + nm.m + ' 月清潔排程，網站公告已自動做好（內審版：還不會出現在公告列表與首頁）。\n\n' +
      '預覽（約 2 分鐘後上線）：' + url + '\n\n' +
      '主委看過沒問題，跟晰兒說「發 ' + nm.m + ' 月清潔公告」，晰兒會轉正式、推上網站、做 LINE 帶路圖。' + extraTxt +
      '\n\n（主日曆今天已建待辦「' + ev + '」）');
  } else {
    mail('【閱大安】' + nm.m + ' 月清潔排程有異動，內審版公告已自動更新',
      '總幹事改了「閱大安-清潔」日曆，內審版公告已照新排程更新：\n' + url + extraTxt);
  }
  props.setProperty('clean_draft_' + nm.key, JSON.stringify({ path: path, pub: pub, hash: hash, url: url }));
}

function todo(title, desc) {
  var t = todayParts();
  CalendarApp.getCalendarById(MAIN_CAL).createAllDayEvent(title, new Date(t.iso + 'T00:00:00+08:00'), { description: desc });
  return title;
}

function mail(subject, body) {
  MailApp.sendEmail(NOTIFY_EMAIL, subject, body +
    '\n\n—— Apps Script calendar-setup-check 自動寄出（每月月底前 ' + DAYS_BEFORE_END + ' 天起每天 09:00 檢查）');
}

// ── 手動工具 ──────────────────────────────────────

// 看下個月目前的檢查結果與公告草稿開頭（不寫 repo、不寄信、不看日期）
function previewNow() {
  var nm = nextMonth(todayParts());
  var cl = buildSchedule(nm.days, readCleanEvents(nm)), mt = checkMaint(nm);
  Logger.log(nm.key + '\n' + statusLines(nm, cl, mt).join('\n'));
  if (cl.extras.length) Logger.log('對不上的清潔標題：\n' + cl.extras.join('\n'));
  if (!cl.missing.length) Logger.log(buildNoticeHtml(nm.y, nm.m, todayParts().iso, cl.S).slice(0, 3000));
}

// 指定月份（YYYY-MM）的清潔公告草稿，只印不寫；拿已排好的月份驗證用
function previewCleanMonth(key) {
  key = key || '2026-11';
  var p = key.split('-'), y = +p[0], m = +p[1];
  var nm = { y: y, m: m, days: new Date(y, m, 0).getDate(), key: key };
  var cl = buildSchedule(nm.days, readCleanEvents(nm));
  Logger.log('缺：' + cl.missing.join(',') + '\n對不上：' + cl.extras.join('；'));
  Logger.log(buildNoticeHtml(y, m, '2026-01-01', cl.S));
}

// 確認 GITHUB_TOKEN 能讀 repo（只讀不寫）
function testGitHub() {
  var f = ghGetFile('i18n-glossary.md');
  Logger.log(f ? 'GitHub token 正常：讀得到 repo（i18n-glossary.md ' + f.text.length + ' 字）' : '讀不到檔案');
}

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (tr) {
    if (tr.getHandlerFunction() === 'runDaily') ScriptApp.deleteTrigger(tr);
  });
  ScriptApp.newTrigger('runDaily').timeBased().everyDays(1).atHour(9).inTimezone('Asia/Taipei').create();
  Logger.log('已建每日 09:00 trigger');
}

if (typeof module !== 'undefined') module.exports = { areaCode: areaCode, buildSchedule: buildSchedule, buildNoticeHtml: buildNoticeHtml };
