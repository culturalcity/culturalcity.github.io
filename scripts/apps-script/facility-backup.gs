/**
 * 公設使用登記 → 每日備份到私有 Google Sheet（含完整戶號／姓名，不進公開 repo）
 * ---------------------------------------------------------------------------
 * 為什麼這樣做：登記資料即時存在 Cloudflare KV（只留最近 500 筆），KV 不在 git、
 * 沒版本、會被裁切。把完整資料每天抓出來「累加」進一個私有 Google Sheet，等於
 * 永久、人可讀、有版本紀錄的備份——且因為 Sheet 私有，不像公開 repo 有個資問題。
 *
 * 用「累加（append）」不是「覆蓋」：以每筆的 id 去重，只補新的，所以即使 KV 把
 * 舊資料裁掉，Sheet 仍保有歷史全部。
 *
 * 部署步驟（用社區共用帳號 culturalcity85 操作）：
 *   1. 建一個私有 Google Sheet（隨意命名，例「閱大安_公設登記備份」），複製網址裡的
 *      檔案 ID（/d/ 與 /edit 之間那串），填到下方 SHEET_ID。
 *   2. script.google.com 新建專案 → 貼上本檔內容。
 *   3. 專案設定 → 指令碼屬性 → 新增 STAFF_TOKEN = Worker 裡總幹事的 cookie token
 *      （raw/cloudflare-worker/culturalcity-auth.js 的 TOKENS[2] 那串）。放屬性不寫死在碼裡。
 *   4. 觸發條件 → 新增 → backupFacilityLog → 時間驅動 → 每日（建議凌晨）。
 *   5. ⚠️ 需先把 Worker 草稿貼上 Cloudflare（/facility/api/log 端點才存在），本腳本才抓得到。
 */

var API = 'https://culturalcity.org/facility/api/log';
var SHEET_ID = 'PASTE_YOUR_SHEET_ID_HERE';   // ← 填你建的私有 Sheet 檔案 ID
var SHEET_NAME = '公設登記';
var HEADER = ['id', '公設', '類型', '日期', '整段開放', '起', '迄', '戶號', '登記人', '備註', '登記時間(UTC)', '首次備份'];

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
  // 安全檢查：總幹事 token 抓回來的應該含戶號；若沒有戶號欄，可能是被當住戶去敏了 → 別亂寫
  if (!entries.length) { Logger.log('無資料'); return; }
  if (entries[0].unit === undefined) { Logger.log('回應疑似被去敏（token 等級不足），中止，避免覆寫'); return; }

  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange(1, 1, 1, HEADER.length).setValues([HEADER]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }

  // 既有 id（去重鍵）
  var seen = {};
  var last = sh.getLastRow();
  if (last >= 2) {
    var ids = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) { seen[ids[i][0]] = true; }
  }

  var stamp = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm');
  var rows = [];
  entries.forEach(function (e) {
    if (seen[e.id]) return;  // 已備份過，跳過（累加、不重覆）
    rows.push([
      e.id, e.facility, (e.type === 'exclusive' ? '包場' : '一般'), e.date,
      (e.allDay ? '是' : ''), (e.timeStart || ''), (e.timeEnd || ''),
      (e.unit || ''), (e.name || ''), (e.note || ''), (e.createdAt || ''), stamp,
    ]);
  });

  if (rows.length) {
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, HEADER.length).setValues(rows);
  }
  Logger.log('新增 ' + rows.length + ' 筆（累計備份）');
}
