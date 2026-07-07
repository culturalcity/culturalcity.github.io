/**
 * 公設使用登記 → 每日備份到私有 Google Sheet（以 id upsert：既有列更新、新列附加）
 * ---------------------------------------------------------------------------
 * ⚠️ 2026-07 起改為 upsert（原本是純累加）：公設登記現在會變動——住戶登記「開始」後，
 *    保全於用畢再補「實際結束時間＋簽名」。純累加會把紀錄凍結在「使用中」狀態，
 *    永遠補不進結束與簽名。故比照訪客備份，用 id 去比對：既有列更新、新 id 才附加。
 *    「最後備份」欄記錄該列最後同步時間。
 *
 * 為什麼要備份：登記資料即時存在 Cloudflare KV（只留最近 500 筆），KV 不在 git、
 * 沒版本、會被裁切。每天抓完整資料進私有 Google Sheet，等於永久、人可讀、有版本的
 * 備份——且 Sheet 私有，不像公開 repo 有個資問題。
 *
 * 部署步驟（用社區共用帳號 culturalcity85 操作）：
 *   1. 建一個私有 Google Sheet（例「閱大安_公設登記備份」），複製網址裡 /d/ 與 /edit
 *      之間那串檔案 ID，填到下方 SHEET_ID。（可與訪客備份共用同一張 Sheet，本腳本會
 *      自動建分頁「公設登記」。）
 *   2. script.google.com 新建專案 → 貼上本檔內容。
 *   3. 專案設定 → 指令碼屬性 → 新增 STAFF_TOKEN = Worker 裡總幹事的 cookie token
 *      （raw/cloudflare-worker/culturalcity-auth.js 的 TOKENS[3] 那串）。放屬性不寫死。
 *   4. 觸發條件 → 新增 → backupFacilityLog → 時間驅動 → 每日（建議凌晨）。
 *   5. ⚠️ 需先把 Worker 草稿貼上 Cloudflare（/facility/api/log 端點才存在），本腳本才抓得到。
 */

var API = 'https://culturalcity.org/facility/api/log';
var SHEET_ID = 'PASTE_YOUR_SHEET_ID_HERE';   // ← 填你建的私有 Sheet 檔案 ID
var SHEET_NAME = '公設登記';
var HEADER = ['id', '公設', '類型', '日期', '整段開放', '起', '迄(預計)', '實際結束', '保全簽名', '戶號', '登記人', '備註', '登記時間(UTC)', '結束登記(UTC)', '最後備份'];

function backupFacilityLog() {
  var token = PropertiesService.getScriptProperties().getProperty('STAFF_TOKEN');
  if (!token) { throw new Error('未設定 STAFF_TOKEN（指令碼屬性）'); }

  var res = UrlFetchApp.fetch(API, {
    headers: { Cookie: 'yda_auth=' + token },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    Logger.log('抓取失敗 HTTP ' + res.getResponseCode() + '（token 失效？Worker 未部署？）');
    return;
  }
  var data;
  try { data = JSON.parse(res.getContentText()); } catch (e) { Logger.log('回應非 JSON'); return; }
  var entries = (data && data.entries) || [];
  if (!entries.length) { Logger.log('無資料'); return; }
  // 安全檢查：總幹事 token 抓回來的應該含戶號；若沒有戶號欄，可能是被當住戶去敏了 → 別亂寫
  if (entries[0].unit === undefined) { Logger.log('回應疑似被去敏（token 等級不足），中止，避免覆寫'); return; }

  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange(1, 1, 1, HEADER.length).setValues([HEADER]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }

  // ⚠️ upsert：既有 id 更新該列、新 id 才附加（公設紀錄會被保全補結束＋簽名而變動）。
  var idRow = {};
  var last = sh.getLastRow();
  if (last >= 2) {
    var ids = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) { if (ids[i][0]) idRow[ids[i][0]] = i + 2; }
  }

  var stamp = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm');
  var appendRows = [], updated = 0;
  entries.forEach(function (e) {
    var row = [
      e.id, e.facility, (e.type === 'exclusive' ? '包場' : '一般'), e.date,
      (e.allDay ? '是' : ''), (e.timeStart || ''), (e.timeEnd || ''),
      (e.endAt || ''), (e.signedBy || ''),
      (e.unit || ''), (e.name || ''), (e.note || ''), (e.createdAt || ''), (e.endStamp || ''), stamp,
    ];
    if (idRow[e.id]) { sh.getRange(idRow[e.id], 1, 1, HEADER.length).setValues([row]); updated++; }
    else { appendRows.push(row); }
  });
  if (appendRows.length) {
    sh.getRange(sh.getLastRow() + 1, 1, appendRows.length, HEADER.length).setValues(appendRows);
  }
  Logger.log('公設備份：新增 ' + appendRows.length + '、更新 ' + updated + ' 筆');
}
