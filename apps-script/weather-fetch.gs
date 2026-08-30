// ═══════════════════════════════════════════════════════════════
// 閱大安 每日氣溫／降雨抓取（Apps Script 版）
// ═══════════════════════════════════════════════════════════════
//
// 做的事：抓「昨天」臺北站（466920）的高低溫與累積降雨（CWA CODiS，免金鑰），
// 寫進 repo 的 utility/data/daily-temp.json 與 daily-rain.json（單一 commit，
// GitHub API），commit 觸發 deploy.yml 的 on: push → 1~2 分鐘後網站上線。
//
// 為什麼從 GitHub Actions 搬來這裡（2026-08-30）：
//   GitHub 的 schedule 是公用線路、盡力而為——這個 repo 實測平常晚 51-60 分、
//   08-29 晚 5.5 小時、08-27 夜裡整段停擺 9.5 小時，早上出水電公告時常等不到
//   昨日高溫。Apps Script 的時間觸發器跑在帳號專屬配額，heat-poll 兩個月來每天
//   07:32 準時，故把「準時最重要」的抓取搬過來。GitHub 那三支 cron 保留當備援
//   （兩邊都「無變化就略過 commit」，不會打架）。
//
// 與 scripts/fetch-weather.js 的關係：
//   邏輯鏡像（同 API、同哨兵規則、同 JSON 序列化 = JSON.stringify(arr)+'\n'），
//   產出逐位元相同，兩邊互跑不會製造假 diff。改解析規則時兩支要一起改。
//
// 安裝（一次；與 heat-poll、apps-script-bills 一樣放 culturalcity85 帳號的 Apps Script，
// 所有閱大安自動化集中一個帳號，交接只交一個帳號。帳單管線的 Cloud Run 早已持有
// 同等權限的 GitHub token，這裡再放一把不擴大風險）：
//   1. GitHub → Settings → Developer settings → Personal access tokens →
//      Fine-grained → 只授權 culturalcity.github.io 這一個 repo、
//      Permissions: Contents = Read and write（其餘不用）。
//      Expiration 選 No expiration（2026-08-30 主委定案），就不會有「到期靜默停抓」
//      的問題；若被撤銷，GitHub 回 401/403 時會當天寄信告警。
//   2. Apps Script 專案設定 → 指令碼屬性 → 新增 GITHUB_TOKEN = 上面的 token。
//      （只有在 token 設了到期日時，才另加 GITHUB_TOKEN_EXPIRES = YYYY-MM-DD，
//        剩 30／7／1 天會寄信提醒；沒設到期日就不用填、程式會跳過檢查）
//   3. 先跑 previewNow()（只抓不寫）看 log 正常 → 跑 setup() 建 trigger
//   4. 之後可跑 runNow() 手動補一次（無視時間視窗，會真的 commit）
//
// 觸發：每 30 分鐘一次，只在台北 06:00–13:59 內工作（鏡像 fetch-weather-retry
// 的視窗）。everyMinutes(30) 不保證正好落在 :00／:30，前後會漂 1–2 分——所以說法是
// 「06 點後首班、13:30 後尾班」而不是「06:00 準時」。每次先看 repo 裡昨天是否已有
// → 有就結束（一天最多 16 次輕量 GET）。
// 尾班（13:25 起的那一班）若昨天仍缺或執行出錯，寄一封 email 給本專案擁有者
// （不是急件，純 awareness）；GitHub API 回 401/403（token 到期）當天立刻寄一封。

// ── 常數 ──────────────────────────────────────────

var REPO = 'culturalcity/culturalcity.github.io';
var BRANCH = 'main';
var TEMP_PATH = 'utility/data/daily-temp.json';
var RAIN_PATH = 'utility/data/daily-rain.json';
var STATION_ID = '466920';   // 臺北
var GH_API = 'https://api.github.com';

// ── Helpers ────────────────────────────────────────

function fmt2(n) { return ('0' + n).slice(-2); }

function taipeiNow() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000);   // 以 UTC getter 讀即台北時間
}

function yesterdayTaipeiISO() {
  var t = taipeiNow();
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}

function ghToken() {
  var tok = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!tok) throw new Error('指令碼屬性缺 GITHUB_TOKEN（見檔頭安裝步驟）');
  return tok;
}

function ghFetch(path, method, payload) {
  var opts = {
    method: method || 'get',
    headers: {
      'Authorization': 'Bearer ' + ghToken(),
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    muteHttpExceptions: true
  };
  if (payload) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(payload); }
  var res = UrlFetchApp.fetch(GH_API + path, opts);
  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code === 401 || code === 403) alertTokenDead(code, body);   // PAT 到期／被撤銷：立刻通知，不等日曆提醒
  if (code < 200 || code >= 300) throw new Error('GitHub ' + method + ' ' + path + ' → HTTP ' + code + ': ' + body.slice(0, 200));
  return JSON.parse(body);
}

// 一天只寄一封（每 30 分一班，不設閘會連寄 16 封）
function alertTokenDead(code, body) {
  var props = PropertiesService.getScriptProperties();
  var today = taipeiNow().toISOString().slice(0, 10);
  if (props.getProperty('PAT_ALERT_DATE') === today) return;
  props.setProperty('PAT_ALERT_DATE', today);
  sendAlert('[閱大安] GitHub token 失效，weather-fetch 已停擺',
    'GitHub API 回 HTTP ' + code + '（' + body.slice(0, 120) + '）。\n' +
    '最可能：fine-grained PAT 到期或被撤銷。\n' +
    '處理：GitHub → Settings → Developer settings → Personal access tokens 重新產生一把\n' +
    '（只給 culturalcity.github.io、Contents 讀寫），貼回本 Apps Script 專案的指令碼屬性 GITHUB_TOKEN。\n' +
    '停擺期間 GitHub Actions 備援仍會照舊抓（只是不準時）。');
}

function sendAlert(subject, text) {
  try { MailApp.sendEmail(Session.getEffectiveUser().getEmail(), subject, text); }
  catch (e) { Logger.log('寄信失敗：' + e.message); }
}

// 尾班判定：everyMinutes(30) 的觸發會前後漂移 1–2 分，13:29 跑過就不會再有 13:30 的班，
// 所以從 13:25 起都算尾班（瑩兒 2026-08-30 提醒）
function isLastRun(h, mi) { return h === 13 && mi >= 25; }

// 讀 repo 裡的 JSON 陣列（Contents API 回 base64；檔案 < 1MB 才能用這條路）。
// ref 一律傳「本班一開始固定下來的 HEAD SHA」而不是分支名：讀檔與 commit 之間若有人
// push，我們的 parent 仍是舊 SHA → 更新 ref 會被拒 → 下一班重來，不會蓋掉別人的改動
//（冰兒 2026-08-30 指出的競態）。
function ghReadJson(path, ref) {
  var j = ghFetch('/repos/' + REPO + '/contents/' + path + '?ref=' + ref);
  var text = Utilities.newBlob(Utilities.base64Decode(j.content.replace(/\n/g, ''))).getDataAsString('UTF-8');
  return JSON.parse(text);
}

// ── CODiS ─────────────────────────────────────────

function fetchMonth(year, month) {
  var lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  var params = {
    date: year + '-' + fmt2(month) + '-01',
    type: 'report_month',
    stn_ID: STATION_ID,
    stn_type: 'cwb',
    more: '',
    start: year + '-' + fmt2(month) + '-01T00:00:00',
    end:   year + '-' + fmt2(month) + '-' + fmt2(lastDay) + 'T23:59:59'
  };
  var res = UrlFetchApp.fetch('https://codis.cwa.gov.tw/api/station', {
    method: 'post',
    payload: params,   // Apps Script 會自動編成 x-www-form-urlencoded
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Referer': 'https://codis.cwa.gov.tw/StationData',
      'X-Requested-With': 'XMLHttpRequest'
    },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error('CODiS HTTP ' + res.getResponseCode());
  var json = JSON.parse(res.getContentText());
  if (json.code !== 200) throw new Error('CODiS API error: ' + JSON.stringify(json).slice(0, 300));
  var dts = (json.data && json.data[0] && json.data[0].dts) || [];
  return dts.map(function (d) {
    var tmax = d.AirTemperature ? d.AirTemperature.Maximum : null;
    var tmin = d.AirTemperature ? d.AirTemperature.Minimum : null;
    var rawRain = d.Precipitation ? d.Precipitation.Accumulation : null;
    // CWA 哨兵：-9.8 = 微量降雨 trace（< 0.1 mm，視為 0）；其他負數 = 缺值
    var rain = null;
    if (typeof rawRain === 'number' && isFinite(rawRain)) {
      if (rawRain === -9.8) rain = 0;
      else if (rawRain >= 0) rain = rawRain;
    }
    return {
      d: d.DataDate.slice(0, 10),
      tmax: (typeof tmax === 'number' && isFinite(tmax)) ? tmax : null,
      tmin: (typeof tmin === 'number' && isFinite(tmin)) ? tmin : null,
      rain: rain
    };
  });
}

// ── 合併（鏡像 fetch-weather.js 的規則） ───────────

function mergeRecords(tempArr, rainArr, recs, yestISO) {
  var tempMap = {}, rainMap = {};
  tempArr.forEach(function (r) { tempMap[r.d] = r; });
  rainArr.forEach(function (r) { rainMap[r.d] = r; });
  var tAdd = 0, tUpd = 0, rAdd = 0, rUpd = 0;

  recs.forEach(function (r) {
    if (r.d > yestISO) return;   // 跳過今天／未來
    if (r.tmax !== null && r.tmin !== null) {
      var cur = { d: r.d, tmax: r.tmax, tmin: r.tmin };
      var old = tempMap[r.d];
      if (!old) { tempMap[r.d] = cur; tAdd++; }
      else if (old.tmax !== cur.tmax || old.tmin !== cur.tmin) { tempMap[r.d] = cur; tUpd++; }
    }
    if (r.rain !== null) {
      var curR = { d: r.d, rain: r.rain };
      var oldR = rainMap[r.d];
      if (!oldR) { rainMap[r.d] = curR; rAdd++; }
      else if (oldR.rain !== curR.rain) { rainMap[r.d] = curR; rUpd++; }
    }
  });

  function sorted(m) { return Object.keys(m).sort().map(function (k) { return m[k]; }); }
  return {
    temp: sorted(tempMap), rain: sorted(rainMap),
    tempChanged: tAdd + tUpd > 0, rainChanged: rAdd + rUpd > 0,
    summary: 'temp +' + tAdd + ' ⟳' + tUpd + ', rain +' + rAdd + ' ⟳' + rUpd
  };
}

// 與 node 版 writeJson 逐位元相同
function serialize(arr) { return JSON.stringify(arr) + '\n'; }

// ── GitHub 單一 commit（Git Data API） ─────────────

function ghHeadSha() {
  return ghFetch('/repos/' + REPO + '/git/ref/heads/' + BRANCH).object.sha;
}

function ghCommitFiles(files, message, headSha) {
  // files: [{path, content}]；headSha = 本班開頭讀檔時的 HEAD（同一個 SHA 當 parent）
  var headCommit = ghFetch('/repos/' + REPO + '/git/commits/' + headSha);
  var baseTree = headCommit.tree.sha;

  var tree = files.map(function (f) {
    var blob = ghFetch('/repos/' + REPO + '/git/blobs', 'post', { content: f.content, encoding: 'utf-8' });
    return { path: f.path, mode: '100644', type: 'blob', sha: blob.sha };
  });
  var newTree = ghFetch('/repos/' + REPO + '/git/trees', 'post', { base_tree: baseTree, tree: tree });
  var commit = ghFetch('/repos/' + REPO + '/git/commits', 'post', {
    message: message, tree: newTree.sha, parents: [headSha],
    author: { name: 'weather-bot (Apps Script)', email: '269195393+culturalcity@users.noreply.github.com', date: new Date().toISOString() }
  });
  // 若 HEAD 已被別人推走，這一步會 422（non-fast-forward）：就讓它丟錯，下一班 30 分鐘後
  // 會重新固定 HEAD、重新讀檔、重新合併、重新 commit——天然重試，不必在這裡自己 rebase。
  ghFetch('/repos/' + REPO + '/git/refs/heads/' + BRANCH, 'patch', { sha: commit.sha, force: false });
  return commit.sha;
}

// ── 核心 ──────────────────────────────────────────

function fetchAndCommit(dryRun) {
  var yestISO = yesterdayTaipeiISO();
  var y = Number(yestISO.slice(0, 4)), m = Number(yestISO.slice(5, 7));

  var headSha = ghHeadSha();   // 先固定 HEAD，之後讀檔與 commit 都綁這個 SHA
  var tempArr = ghReadJson(TEMP_PATH, headSha);
  var rainArr = ghReadJson(RAIN_PATH, headSha);
  var hasTemp = tempArr.some(function (r) { return r.d === yestISO; });
  var hasRain = rainArr.some(function (r) { return r.d === yestISO; });
  if (hasTemp && hasRain) {
    Logger.log('repo 已有 ' + yestISO + '（temp ' + tempArr.length + ' 天／rain ' + rainArr.length + ' 天），不用做事');
    return { done: true };
  }

  var recs = fetchMonth(y, m);
  Logger.log('CODiS ' + y + '-' + fmt2(m) + ' 回 ' + recs.length + ' 天，最後：' + (recs.length ? JSON.stringify(recs[recs.length - 1]) : '—'));
  var merged = mergeRecords(tempArr, rainArr, recs, yestISO);
  Logger.log('合併：' + merged.summary);

  if (!merged.tempChanged && !merged.rainChanged) {
    Logger.log('無新資料（CODiS 可能尚未 settle），這班結束');
    return { done: false };
  }

  var files = [];
  if (merged.tempChanged) files.push({ path: TEMP_PATH, content: serialize(merged.temp) });
  if (merged.rainChanged) files.push({ path: RAIN_PATH, content: serialize(merged.rain) });

  if (dryRun) {
    Logger.log('[預覽] 會 commit：' + files.map(function (f) { return f.path + '（' + f.content.length + ' bytes）'; }).join('、'));
    return { done: false, preview: true };
  }

  var names = files.map(function (f) { return f.path.indexOf('temp') >= 0 ? '氣溫' : '降雨'; }).join('/');
  var sha = ghCommitFiles(files, 'data: 每日' + names + '更新（Apps Script weather-fetch）', headSha);
  Logger.log('✅ commit ' + sha.slice(0, 7) + '：' + files.map(function (f) { return f.path; }).join(', '));

  // 兩個維度都有昨天才算完成（只看 temp 會在 rain 缺值時誤報完成——冰兒指出）
  var gotTemp = merged.temp.some(function (r) { return r.d === yestISO; });
  var gotRain = merged.rain.some(function (r) { return r.d === yestISO; });
  return { done: gotTemp && gotRain };
}

// ── PAT 到期預警 ──────────────────────────────────
// 指令碼屬性 GITHUB_TOKEN_EXPIRES（YYYY-MM-DD，建 token 時順手填）；剩 30／7／1 天各寄一封，
// 過期後每天一封。沒填就跳過（仍有 401/403 即時告警兜底）。
function checkTokenExpiry() {
  var props = PropertiesService.getScriptProperties();
  var exp = props.getProperty('GITHUB_TOKEN_EXPIRES');
  if (!exp) return;
  var today = taipeiNow().toISOString().slice(0, 10);
  var daysLeft = Math.round((new Date(exp + 'T00:00:00Z') - new Date(today + 'T00:00:00Z')) / 86400000);
  var thresholds = [30, 7, 1];
  var hit = null;
  for (var i = 0; i < thresholds.length; i++) if (daysLeft <= thresholds[i]) hit = thresholds[i];
  if (daysLeft <= 0) hit = 0;
  if (hit === null) return;
  var key = hit === 0 ? today : String(hit);   // 過期後每天一封；到期前每個門檻一封
  if (props.getProperty('TOKEN_EXPIRY_ALERTED') === key) return;
  props.setProperty('TOKEN_EXPIRY_ALERTED', key);
  sendAlert('[閱大安] GitHub token ' + (daysLeft <= 0 ? '已過期' : '剩 ' + daysLeft + ' 天到期') + '（weather-fetch）',
    'GITHUB_TOKEN 到期日：' + exp + '。\n' +
    '請到 GitHub → Settings → Developer settings → Personal access tokens 重新產生\n' +
    '（只給 culturalcity.github.io、Contents 讀寫），貼回本專案指令碼屬性 GITHUB_TOKEN，\n' +
    '並把 GITHUB_TOKEN_EXPIRES 改成新到期日。');
}

// ── trigger 入口 ──────────────────────────────────

function checkWeather() {
  var t = taipeiNow();
  var h = t.getUTCHours(), mi = t.getUTCMinutes();
  if (h < 6 || h > 13) return;   // 06:00–13:59 台北

  var yest = yesterdayTaipeiISO();
  try { checkTokenExpiry(); } catch (e) { Logger.log('到期檢查失敗：' + e.message); }
  try {
    var r = fetchAndCommit(false);
    if (!r.done && isLastRun(h, mi)) {
      sendAlert('[閱大安] 昨日氣溫資料到尾班仍未取得',
        yest + ' 的 CODiS 資料到今天 13:30 仍缺，weather-fetch 已停止今日重試。\n' +
        '可能：CODiS 故障或回缺值哨兵。明天的班會連同今天一起補（抓整月）。\n' +
        '若連日皆缺，查 https://codis.cwa.gov.tw 是否異常。');
    }
  } catch (e) {
    // 中間班次出錯不寄信（下一班 30 分後自動重試）；但尾班出錯必須寄，
    // 否則整天靜默失敗沒人知道（瑩兒 2026-08-30 指出的漏洞）
    Logger.log('❌ ' + e.message);
    if (isLastRun(h, mi)) {
      sendAlert('[閱大安] weather-fetch 尾班出錯，' + yest + ' 資料未寫入',
        '最後一班（' + fmt2(h) + ':' + fmt2(mi) + '）執行失敗：\n' + e.message + '\n\n' +
        '請看 Apps Script 執行紀錄。GitHub Actions 備援仍會照舊抓（只是不準時）。');
    }
  }
}

// ── 手動工具 ──────────────────────────────────────

// 只抓、只算、不寫 repo（第一次安裝用它驗證 token 與解析都正常）
function previewNow() { fetchAndCommit(true); }

// 無視時間視窗立刻跑一次（會真的 commit）
function runNow() { fetchAndCommit(false); }

// 建 trigger（跑一次即可；重跑會先清掉舊的）
function setup() {
  ScriptApp.getProjectTriggers().forEach(function (tr) {
    if (tr.getHandlerFunction() === 'checkWeather') { ScriptApp.deleteTrigger(tr); Logger.log('刪除舊 trigger'); }
  });
  ScriptApp.newTrigger('checkWeather').timeBased().everyMinutes(30).create();
  Logger.log('已建立 trigger：checkWeather 每 30 分鐘（06:00–13:59 台北內工作）');
}
