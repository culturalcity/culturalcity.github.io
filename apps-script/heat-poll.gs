// ═══════════════════════════════════════════════════════════════
// 閱大安 Heat Alert Polling（Apps Script）
// ═══════════════════════════════════════════════════════════════
//
// 每 5 分鐘 trigger：07:30-09:00 台北 window 內偵測 CWA W29 高溫資訊，
// 若臺北今日有 advisory，建立：
//   1. Google Calendar 全天事件（給總幹事一上班看的 todo）
//   2. GitHub PR（公告草稿給主委 review + merge → deploy）
//
// 取代 GitHub Actions heat-alert.yml + heat-notice-draft.yml，
// 因為 GH Actions cron 不可靠（51-60min 延遲 + silently skip）。
//
// Script Properties 需設定：
//   GH_PAT  — GitHub Personal Access Token（repo + workflow scope）
//
// 安裝：跑 setup() 一次，會自動建立 time trigger。

// ── 常數 ──────────────────────────────────────────

var CALENDAR_ID = 'culturalcity85@gmail.com';
var GH_OWNER = 'culturalcity';
var GH_REPO = 'culturalcity.github.io';
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

function addDays(yyyyMmDd, delta) {
  var d = new Date(yyyyMmDd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().substring(0, 10);
}

function taipeiHourMin() {
  var now = new Date();
  var taipeiMs = now.getTime() + 8 * 60 * 60 * 1000;
  var t = new Date(taipeiMs);
  return { h: t.getUTCHours(), m: t.getUTCMinutes() };
}

function githubApi(method, path, payload) {
  var token = PropertiesService.getScriptProperties().getProperty('GH_PAT');
  if (!token) throw new Error('GH_PAT not set in Script Properties');
  var options = {
    method: method.toLowerCase(),
    headers: {
      'Authorization': 'Bearer ' + token,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'culturalcity-heat-poll'
    },
    muteHttpExceptions: true
  };
  if (payload) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(payload);
  }
  var url = 'https://api.github.com' + path;
  var resp = UrlFetchApp.fetch(url, options);
  var code = resp.getResponseCode();
  var body = resp.getContentText();
  try { body = JSON.parse(body); } catch (e) { /* keep as string */ }
  if (code >= 400) {
    throw new Error('GitHub API ' + method + ' ' + path + ': ' + code + ' ' + JSON.stringify(body).substring(0, 300));
  }
  return body;
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

function ensureCalendarEvent(level, today) {
  var cal = CalendarApp.getCalendarById(CALENDAR_ID);
  if (!cal) { Logger.log('Calendar not found: ' + CALENDAR_ID); return; }

  var date = new Date(today + 'T00:00:00+08:00');
  var events = cal.getEventsForDay(date);
  for (var i = 0; i < events.length; i++) {
    var t = events[i].getTitle();
    if (t.indexOf('臺北') >= 0 && t.indexOf('燈') >= 0 && t.indexOf('關懷') >= 0) {
      Logger.log('Calendar event exists: ' + t);
      return;
    }
  }

  var title = '⚠️ 臺北' + level.zh + '燈・必須關懷獨居長者';
  var desc = '中央氣象署今日臺北市為' + level.zh + '色燈號。\n\n' +
    'CWA 發布時間：' + level.issued + '\n有效至：' + level.validto + '\n\n' +
    '--- CWA 原文 ---\n' + level.content + '\n\n' +
    '📌 由 Apps Script heat-poll 自動建立';

  var event = cal.createAllDayEvent(title, date, { description: desc });
  if (level.num === '3') {
    event.setColor(CalendarApp.EventColor.RED);
  } else {
    event.setColor(CalendarApp.EventColor.ORANGE);
  }
  Logger.log('Created: ' + title);
}

// ── GitHub PR ─────────────────────────────────────

function countConsecutiveDays(today) {
  var files;
  try {
    files = githubApi('GET', '/repos/' + GH_OWNER + '/' + GH_REPO + '/contents/src/notice');
  } catch (e) { return 1; }
  var heatDates = {};
  for (var i = 0; i < files.length; i++) {
    var m = files[i].name.match(/^(\d{4}-\d{2}-\d{2})-高溫[黃橙紅]燈提醒\.html$/);
    if (m) heatDates[m[1]] = true;
  }
  var consecutive = 0;
  for (var d = 1; d <= 14; d++) {
    if (!heatDates[addDays(today, -d)]) break;
    consecutive++;
  }
  return consecutive + 1;
}

function ensureNoticePR(level, day, today) {
  var filename = today + '-高溫' + level.zh + '燈提醒.html';
  var filepath = 'src/notice/' + filename;
  var branch = 'heat-draft-' + today;

  // file exists on main?
  try {
    githubApi('GET', '/repos/' + GH_OWNER + '/' + GH_REPO + '/contents/' + encodeURIComponent(filepath));
    Logger.log('Notice file exists on main, skip');
    return;
  } catch (e) {
    if (e.message.indexOf('404') < 0) throw e;
  }

  // branch exists?
  try {
    githubApi('GET', '/repos/' + GH_OWNER + '/' + GH_REPO + '/git/ref/heads/' + branch);
    Logger.log('Branch ' + branch + ' exists, skip');
    return;
  } catch (e) {
    if (e.message.indexOf('404') < 0) throw e;
  }

  var mainRef = githubApi('GET', '/repos/' + GH_OWNER + '/' + GH_REPO + '/git/ref/heads/main');
  var mainSha = mainRef.object.sha;

  githubApi('POST', '/repos/' + GH_OWNER + '/' + GH_REPO + '/git/refs', {
    ref: 'refs/heads/' + branch, sha: mainSha
  });

  var content = generateNoticeContent(level, day, today);
  githubApi('PUT', '/repos/' + GH_OWNER + '/' + GH_REPO + '/contents/' + encodeURIComponent(filepath), {
    message: 'feat(notice): [auto-draft] ' + today + ' 臺北市高溫' + level.zh + '燈・社區提醒（連續第 ' + day + ' 日）',
    content: Utilities.base64Encode(content, Utilities.Charset.UTF_8),
    branch: branch
  });

  var pr = githubApi('POST', '/repos/' + GH_OWNER + '/' + GH_REPO + '/pulls', {
    title: '[草稿] ' + today + ' 臺北市高溫' + level.zh + '燈・社區提醒（連續第 ' + day + ' 日）',
    head: branch, base: 'main',
    body: '自動產生的高溫公告草稿。\n\n' +
      '- **日期**：' + today + '\n- **等級**：' + level.zh + '燈\n- **連續第幾日**：' + day + '\n' +
      '- **資料來源**：CWA W29\n\n' +
      '## 怎麼處理\n\n- **內容 OK** → 直接 merge\n- **要改文字** → 在此 PR 上直接 commit 修改，再 merge\n\n' +
      '---\n🤖 由 Apps Script heat-poll 自動產生'
  });
  Logger.log('Created PR: ' + pr.html_url);
}

// ── 公告模板（三語） ──────────────────────────────

function generateNoticeContent(level, day, today) {
  var displayDate = today.replace(/-/g, '/');
  var isOrangeOrAbove = level.num === '2' || level.num === '3';
  var mm = parseInt(today.substring(5, 7), 10);
  var dd = parseInt(today.substring(8, 10), 10);

  var dayPhraseZh = day >= 2 ? '・連續第 ' + day + ' 日' : '';
  var dayPhraseEn = day >= 2 ? ' — Day ' + day : '';
  var dayPhraseJa = day >= 2 ? '・' + day + '日連続' : '';
  var dayContextZh = day >= 3 ? '連 ' + day + ' 日高溫累積，提醒大家加倍注意。'
    : (day === 2 ? '連兩日高溫累積疲勞，提醒大家彼此關照。' : '');
  var dayContextEn = day >= 3 ? 'After ' + day + ' consecutive days of heat, please take extra care.'
    : (day === 2 ? 'Sustained heat over two days accumulates fatigue; please look out for one another.' : '');
  var dayContextJa = day >= 3 ? day + '日連続の高温で疲労が累積していますので、より一層のご注意をお願いいたします。'
    : (day === 2 ? '連日の高温で疲労が累積しやすい時期ですので、お互いに気遣いをお願いいたします。' : '');

  var levelDescZh = { '1':'黃燈是高溫資訊中最輕的等級，代表有 36°C 高溫機率', '2':'橙燈代表「連續 36°C 高溫」的持續性風險，較黃燈一個等級為高', '3':'紅燈代表有「連續 38°C 極端高溫」的機率，是高溫資訊最高等級' }[level.num];
  var levelDescEn = { '1':'Yellow is the mildest tier, indicating a likelihood of temperatures reaching 36°C', '2':'Orange indicates sustained risk of consecutive 36°C days, one tier higher than Yellow', '3':'Red is the highest tier, indicating consecutive 38°C extreme heat' }[level.num];
  var levelDescJa = { '1':'黄信号は高温情報の中で最も軽い注意レベルで、36℃の高温になる可能性を示します', '2':'橙信号は「連続36℃の高温」が続くリスクを示し、黄信号より一段階高いレベルです', '3':'赤信号は「連続38℃の極端な高温」のリスクを示し、最高レベルの高温情報です' }[level.num];

  // ZH actions
  var a1TitleZh = isOrangeOrAbove ? '多補水・避免長時間日曬' : '補水・防曬・避開正午外出';
  var a1BodyZh = isOrangeOrAbove
    ? '連續高溫下身體流失水分加快，比平常多喝水、少喝含糖或含咖啡因飲料（會加速脫水）。白天 11:00–15:00 最熱時段盡量留在室內或陰涼處；必要外出時撐傘、戴帽、隨身帶水。'
    : '白天 11:00–15:00 是最熱時段，盡量在室內或陰涼處活動；外出時撐傘、戴帽、隨身帶水。';
  var a2TitleZh = isOrangeOrAbove ? '室內全日降溫、夜間不要過早關冷氣' : '室內降溫小撇步';
  var a2BodyZh = isOrangeOrAbove
    ? '連續高溫日夜溫差變小，夜間室內仍可能悶熱。拉上窗簾／百葉減少陽光直射；冷氣搭配電風扇加速循環、設定 26–28°C 兼顧舒適與節電；睡前不要過早關冷氣，避免熱壓力延續到夜間影響睡眠與恢復。'
    : '拉上窗簾／百葉減少陽光直射；冷氣搭配電風扇加速循環、設定 26–28°C 兼顧舒適與節電；回家先開窗排出悶熱空氣再開冷氣。';
  var a3TitleZh = isOrangeOrAbove ? '主動問候敏感族群' : '彼此關心';
  var a3BodyZh = isOrangeOrAbove
    ? (day >= 3 ? '連續第 ' + day + ' 日，' : '') + '家中或鄰居有長輩、小孩、慢性病親友的話，今天主動致電或敲門問一聲。若有人出現頭暈、噁心、皮膚乾熱無汗、意識不清的徵兆，請立刻協助移至涼處、補水降溫，並聯繫管理中心；若狀況嚴重請直接撥 119。'
    : '家中或鄰居有長輩、小孩、慢性病親友的話，今天多看一眼、多問一聲。若有人出現頭暈、噁心、皮膚乾熱無汗的徵兆，請立刻協助移至涼處並聯繫管理中心。';
  var noteZh = isOrangeOrAbove ? '若您或家人有身體不適或需任何協助，請隨時聯繫管理中心；緊急狀況請撥 119。' : '若您或家人有身體不適或需任何協助，請隨時聯繫管理中心。';

  // 說明
  var streakStart = addDays(today, -(day - 1));
  var streakMd = parseInt(streakStart.substring(5, 7), 10) + '/' + parseInt(streakStart.substring(8, 10), 10);
  var explainZh = day >= 3
    ? streakMd + ' 起臺北已連續第 ' + day + ' 日高溫警示，今日為' + level.zh + '燈，代表 36°C 高溫已不是「一天的事」、而是持續模式。連續高溫對身體散熱機制是累積壓力，對長者、小孩、慢性病友、孕婦特別嚴峻。本則整理今天我們可以一起留意的三件事，邀請大家彼此關照。'
    : (day === 2
      ? level.zh + '燈' + (isOrangeOrAbove ? '' : '雖非嚴重等級，但') + '連續高溫對長者、小孩、慢性病友、孕婦的負擔會逐日累積。本則整理今天我們可以一起留意的三件事，邀請大家彼此關照。'
      : level.zh + '燈' + (isOrangeOrAbove ? '代表 36°C 連續高溫的持續性風險' : '雖非嚴重等級，但持續高溫對長者、小孩、慢性病友、孕婦仍是負擔') + '。本則整理今天我們可以一起留意的三件事，邀請大家彼此關照。');

  // EN actions
  var a1TitleEn = isOrangeOrAbove ? 'Hydrate More, Avoid Prolonged Sun' : 'Hydrate, Stay Shaded, Avoid Midday Outings';
  var a1BodyEn = isOrangeOrAbove
    ? 'Sustained heat accelerates water loss; drink more water than usual, and avoid sugary or caffeinated drinks. Stay indoors or in the shade during 11:00–15:00.'
    : '11:00–15:00 is the hottest stretch; stay indoors or in the shade when possible. If going out, carry an umbrella, wear a hat, and bring water.';
  var a2TitleEn = isOrangeOrAbove ? "Cool Your Home All Day; Don't Turn Off AC Too Early at Night" : 'Cool Your Home Smartly';
  var a2BodyEn = isOrangeOrAbove
    ? "Day-night temperature gaps shrink during sustained heat. Draw curtains to block sun; pair AC with a fan, set to 26–28°C; don't turn off AC too early before bed."
    : 'Draw curtains or blinds to block direct sun; pair the AC with a fan for circulation and set it to 26–28°C.';
  var a3TitleEn = isOrangeOrAbove ? 'Reach Out to Vulnerable Neighbors and Family' : 'Check on Each Other';
  var a3BodyEn = isOrangeOrAbove
    ? (day >= 3 ? 'On day ' + day + ' of this heat stretch, ' : '') + 'if you have older family members, young children, or neighbors with chronic conditions, call or knock today. If anyone shows dizziness, nausea, hot dry skin, or altered consciousness, move them to a cool place and contact the Management Center. For serious cases, call 119.'
    : 'If you have older family members, young children, or neighbors with chronic conditions, take a moment to check in today. If anyone shows dizziness, nausea, or hot dry skin, move them to a cool place and contact the Management Center.';
  var noteEn = isOrangeOrAbove ? 'If you or a family member feels unwell, contact the Management Center. For emergencies, call 119.' : 'If you or a family member feels unwell, please contact the Management Center at any time.';
  var explainEn = day >= 3
    ? 'This is day ' + day + ' of consecutive heat advisory in Taipei (' + level.en + '). Continuous heat compounds strain on the body, especially for older residents, young children, those with chronic conditions, and expectant mothers.'
    : (day === 2
      ? 'Consecutive days of heat compound the strain on older residents, young children, those with chronic conditions, and expectant mothers.'
      : (isOrangeOrAbove ? level.en + ' indicates sustained risk of consecutive 36°C days. ' : 'While ' + level.en + ' is the lowest tier, sustained heat still strains vulnerable residents. ') + 'Here are three things we can all keep in mind today.');

  // JA actions
  var a1TitleJa = isOrangeOrAbove ? '水分をいつもより多めに・長時間の直射日光を避ける' : '水分補給・日焼け対策・正午の外出回避';
  var a1BodyJa = isOrangeOrAbove
    ? '連続する高温で身体の水分損失が早まります。普段より多めに水分を取り、糖分・カフェインを含む飲料は控えめに。日中の11:00〜15:00はできるだけ室内や日陰でお過ごしください。'
    : '日中の11:00〜15:00が最も暑い時間帯です。できるだけ室内や日陰でお過ごしください。外出の際は日傘・帽子・お水をお持ちください。';
  var a2TitleJa = isOrangeOrAbove ? '室内は一日中涼しく・夜間も早めにエアコンを切らない' : '室内を上手に涼しく';
  var a2BodyJa = isOrangeOrAbove
    ? '連続高温では昼夜の温度差が小さくなり、夜間も室内が蒸し暑くなる可能性があります。カーテンを閉めて直射日光を遮り、エアコンと扇風機を併用、26〜28℃に設定。就寝前にエアコンを早く切りすぎないでください。'
    : 'カーテンやブラインドを閉めて直射日光を遮りましょう。エアコンと扇風機を併用すると空気が循環しやすくなります（26〜28℃の設定が快適さと省エネを両立）。';
  var a3TitleJa = isOrangeOrAbove ? '気遣いの一声を、特に敏感な方へ' : 'お互いを気遣う';
  var a3BodyJa = isOrangeOrAbove
    ? (day >= 3 ? day + '日連続の高温日となります。' : '') + 'ご家族やご近所にご高齢の方・小さなお子様・慢性疾患をお持ちの方がいらっしゃる場合、本日は積極的にお電話やお声がけをお願いします。めまい・吐き気・汗をかかず肌が乾いて熱い・意識がもうろうとするといった症状が見られた場合は、すぐに涼しい場所へ移動させ、管理センターまでご連絡ください。重症の場合は119へお電話ください。'
    : 'ご家族やご近所にご高齢の方・小さなお子様・慢性疾患をお持ちの方がいらっしゃる場合、今日はひと声かけてみてください。めまい・吐き気・汗をかかず肌が乾いて熱いといった症状が見られた場合は、すぐに涼しい場所へ移動させ、管理センターまでご連絡ください。';
  var noteJa = isOrangeOrAbove ? 'ご自身またはご家族のお身体の不調や、何かお手伝いが必要な際は、いつでも管理センターまでご連絡ください。緊急の場合は119へお電話ください。' : 'ご自身またはご家族のお身体の不調や、何かお手伝いが必要な際は、いつでも管理センターまでご連絡ください。';
  var explainJa = day >= 3
    ? '台北市では本日で' + day + '日連続の高温注意報となり、本日は' + level.ja + '信号です。連続する高温は身体の体温調節機能に負担を累積させ、特に高齢者・お子様・慢性疾患をお持ちの方・妊婦の皆様にとって厳しい状況です。'
    : (day === 2
      ? level.ja + '信号は' + (isOrangeOrAbove ? '持続的な高温に対する注意レベル' : '重大なレベルではありません') + 'が、連日の高温は高齢者・お子様・慢性疾患をお持ちの方・妊婦の皆様にとって負担が累積しやすくなります。'
      : (isOrangeOrAbove ? level.ja + '信号は連続36℃高温の持続的リスクを示します。' : level.ja + '信号は重大なレベルではありませんが、長時間の高温は高齢者・お子様・慢性疾患をお持ちの方・妊婦の皆様にとっては負担となります。') + '本日皆で気をつけたい3つのポイントをまとめましたので、お互いに気遣う一日にいたしましょう。');

  var summary = day >= 2
    ? '連續第 ' + day + ' 日臺北市高溫' + level.zh + '燈・建議補水防曬、室內降溫、彼此關照'
    : '今日臺北市為高溫' + level.zh + '燈・建議補水防曬、室內降溫、彼此關照';

  var css = '  .body-text{font-size:17px;color:var(--wg41);line-height:1.9;}\n' +
    '  .body-text p{margin-bottom:1em;}\n' +
    '  .body-text p:last-child{margin-bottom:0;}\n' +
    '  .heat-alert{background:rgba(140,90,0,0.06);border:1px solid rgba(140,90,0,0.22);border-left:4px solid #8C5A00;border-radius:var(--radius);padding:14px 18px;margin-bottom:24px;font-size:15px;color:var(--wg41);line-height:1.75;}\n' +
    '  .heat-alert strong{color:#8C5A00;}\n' +
    '  .care-list{list-style:none;padding:0;margin:4px 0;}\n' +
    '  .care-list li{display:flex;gap:14px;padding:12px 0;border-bottom:1px solid var(--line);font-size:15px;color:var(--wg11);line-height:1.75;align-items:flex-start;}\n' +
    '  .care-list li:last-child{border-bottom:none;}\n' +
    '  .care-num{flex-shrink:0;width:22px;height:22px;background:var(--wg41);color:var(--wg1);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;margin-top:2px;}\n' +
    '  .care-content strong{color:var(--wg41);}';

  return '---\n' +
    'layout: notice.njk\n' +
    'permalink: /notice/' + today + '-高溫' + level.zh + '燈提醒.html\n' +
    'title: 臺北市高溫' + level.zh + '燈・社區提醒\n' +
    'titleZh: 臺北市高溫' + level.zh + '燈・社區提醒\n' +
    "titleEn: 'Heat Advisory (" + level.en + "): Community Reminder'\n" +
    'titleJa: 台北市高温注意報（' + level.ja + '信号）・コミュニティのご案内\n' +
    'displayDate: ' + displayDate + '\n' +
    'typeZh: 安全警示\ntypeEn: Safety Alert\ntypeJa: 安全のお知らせ\n' +
    'pillType: safety\n' +
    'summary: ' + summary + '\n' +
    'extraStyles: |\n' + css + '\n' +
    '---\n' +
    '<div class="lang-block active" data-lang="zh">\n' +
    '  <div class="heat-alert">\n' +
    '    🌡️ <strong>高溫' + level.zh + '燈' + dayPhraseZh + '：</strong>中央氣象署今（' + mm + '/' + dd + '）日發布高溫資訊，<strong>臺北市為' + level.zh + '色燈號</strong>（' + levelDescZh + '）。' + dayContextZh + '\n' +
    '  </div>\n' +
    '  <div class="sec">\n    <div class="sec-label">說明</div>\n    <div class="body-text">\n      <p>' + explainZh + '</p>\n    </div>\n  </div>\n' +
    '  <div class="sec">\n    <div class="sec-label">建議行動</div>\n    <ol class="care-list">\n' +
    '      <li>\n        <span class="care-num">1</span>\n        <span class="care-content"><strong>' + a1TitleZh + '：</strong>' + a1BodyZh + '</span>\n      </li>\n' +
    '      <li>\n        <span class="care-num">2</span>\n        <span class="care-content"><strong>' + a2TitleZh + '：</strong>' + a2BodyZh + '</span>\n      </li>\n' +
    '      <li>\n        <span class="care-num">3</span>\n        <span class="care-content"><strong>' + a3TitleZh + '：</strong>' + a3BodyZh + '</span>\n      </li>\n' +
    '    </ol>\n  </div>\n  <div class="note">' + noteZh + '</div>\n</div>\n\n' +
    '<div class="lang-block" data-lang="en">\n' +
    '  <div class="heat-alert">\n' +
    '    🌡️ <strong>Heat Advisory (' + level.en + ')' + dayPhraseEn + ':</strong> The Central Weather Administration issued a heat advisory today. <strong>Taipei City is under ' + level.en + ' alert</strong> — ' + levelDescEn + '. ' + dayContextEn + '\n' +
    '  </div>\n' +
    '  <div class="sec">\n    <div class="sec-label">Notice</div>\n    <div class="body-text">\n      <p>' + explainEn + '</p>\n    </div>\n  </div>\n' +
    '  <div class="sec">\n    <div class="sec-label">Suggested Actions</div>\n    <ol class="care-list">\n' +
    '      <li>\n        <span class="care-num">1</span>\n        <span class="care-content"><strong>' + a1TitleEn + ':</strong> ' + a1BodyEn + '</span>\n      </li>\n' +
    '      <li>\n        <span class="care-num">2</span>\n        <span class="care-content"><strong>' + a2TitleEn + ':</strong> ' + a2BodyEn + '</span>\n      </li>\n' +
    '      <li>\n        <span class="care-num">3</span>\n        <span class="care-content"><strong>' + a3TitleEn + ':</strong> ' + a3BodyEn + '</span>\n      </li>\n' +
    '    </ol>\n  </div>\n  <div class="note">' + noteEn + '</div>\n</div>\n\n' +
    '<div class="lang-block" data-lang="ja">\n' +
    '  <div class="heat-alert">\n' +
    '    🌡️ <strong>高温注意報（' + level.ja + '信号）' + dayPhraseJa + '：</strong>中央気象署は本日高温情報を発表しました。<strong>台北市は' + level.ja + '信号</strong>（' + levelDescJa + '）。' + dayContextJa + '\n' +
    '  </div>\n' +
    '  <div class="sec">\n    <div class="sec-label">お知らせ</div>\n    <div class="body-text">\n      <p>' + explainJa + '</p>\n    </div>\n  </div>\n' +
    '  <div class="sec">\n    <div class="sec-label">推奨される行動</div>\n    <ol class="care-list">\n' +
    '      <li>\n        <span class="care-num">1</span>\n        <span class="care-content"><strong>' + a1TitleJa + '：</strong>' + a1BodyJa + '</span>\n      </li>\n' +
    '      <li>\n        <span class="care-num">2</span>\n        <span class="care-content"><strong>' + a2TitleJa + '：</strong>' + a2BodyJa + '</span>\n      </li>\n' +
    '      <li>\n        <span class="care-num">3</span>\n        <span class="care-content"><strong>' + a3TitleJa + '：</strong>' + a3BodyJa + '</span>\n      </li>\n' +
    '    </ol>\n  </div>\n  <div class="note">' + noteJa + '</div>\n</div>\n';
}

// ── 主函數（trigger 呼叫） ────────────────────────

function checkHeatAlert() {
  var hm = taipeiHourMin();
  var inWindow = (hm.h === 7 && hm.m >= 30) || hm.h === 8 || (hm.h === 9 && hm.m <= 5);
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

  var day;
  try {
    day = countConsecutiveDays(today);
  } catch (e) {
    Logger.log('Consecutive day count error: ' + e.message);
    day = 1;
  }

  try {
    ensureNoticePR(level, day, today);
  } catch (e) {
    Logger.log('PR creation error: ' + e.message);
  }
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
  Logger.log('Script Properties needed: GH_PAT (GitHub Personal Access Token with repo+workflow scope)');
}
