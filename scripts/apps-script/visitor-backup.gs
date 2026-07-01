/**
 * 訪客出入登記 → 每日備份到私有 Google Sheet（累加、以 id 去重）
 * ---------------------------------------------------------------------------
 * 與 facility-backup.gs 同一套做法。可以：
 *   (A) 跟公設備份用「同一張 Sheet」——填一樣的 SHEET_ID，本腳本會自動建另一個分頁「訪客登記」；或
 *   (B) 另開一張 Sheet。
 * 也可以把本檔的程式碼貼進「同一個 Apps Script 專案」當第二個函式，沿用同一組 STAFF_TOKEN，
 * 只要另外幫 backupVisitorLog 設一個每日觸發器即可。
 *
 * 部署（culturalcity85）：填 SHEET_ID → 指令碼屬性設 STAFF_TOKEN（總幹事 cookie token，
 * TOKENS[3]）→ 觸發條件設 backupVisitorLog 每日。⚠️ 需 Worker 已含 /visitor/api/log 端點。
 */

var V_API = 'https://culturalcity.org/visitor/api/log';
var V_SHEET_ID = 'PASTE_YOUR_SHEET_ID_HERE';   // ← 可填與公設備份同一張 Sheet 的 ID
var V_SHEET_NAME = '訪客登記';
var V_HEADER = ['id', '拜訪事由', '訪客姓名', '造訪戶別', '受訪住戶', '人數', '聯絡電話', '車號', '車型/顏色', '單位', '給保全交代', '預計來訪', '進入時間(UTC)', '離開時間(UTC)', '借出物品', '物品狀態', '首次備份'];

function backupVisitorLog() {
  var token = PropertiesService.getScriptProperties().getProperty('STAFF_TOKEN');
  if (!token) { throw new Error('未設定 STAFF_TOKEN（指令碼屬性）'); }

  var res = UrlFetchApp.fetch(V_API, { headers: { Cookie: 'yda_auth=' + token }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    Logger.log('抓取失敗 HTTP ' + res.getResponseCode() + '（token 失效？Worker 未部署？非保全/總幹事？）');
    return;
  }
  var data;
  try { data = JSON.parse(res.getContentText()); } catch (e) { Logger.log('回應非 JSON'); return; }
  var entries = (data && data.entries) || [];
  if (!entries.length) { Logger.log('無資料'); return; }

  var ss = SpreadsheetApp.openById(V_SHEET_ID);
  var sh = ss.getSheetByName(V_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(V_SHEET_NAME);
    sh.getRange(1, 1, 1, V_HEADER.length).setValues([V_HEADER]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }

  var seen = {};
  var last = sh.getLastRow();
  if (last >= 2) {
    var ids = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) { seen[ids[i][0]] = true; }
  }

  var stamp = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm');
  var rows = [];
  entries.forEach(function (e) {
    if (seen[e.id]) return;
    rows.push([
      e.id, e.reason, e.name, e.unit, (e.host || ''), (e.count || 1),
      (e.phone || ''), (e.plate || ''), (e.carModel || ''), (e.org || ''), (e.note || ''), (e.expectAt || ''),
      (e.enterAt || ''), (e.leaveAt || ''), (e.lentItem || ''), (e.itemStatus || ''), stamp,
    ]);
  });

  if (rows.length) {
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, V_HEADER.length).setValues(rows);
  }
  Logger.log('訪客新增 ' + rows.length + ' 筆（累計備份）');
}
