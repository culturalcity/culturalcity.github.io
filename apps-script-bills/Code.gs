// 閱大安公用事業帳單自動歸檔（Apps Script）
//
// 此 script 在 culturalcity85@gmail.com 帳號下執行。
// 每小時掃 Gmail，找到公用事業帳單 PDF，呼叫 Cloud Run 解密 + 解析，
// 重新命名後存到 Google Drive 對應子資料夾。
//
// 一次性設定：
//   1. Script Properties（檔案→專案屬性→指令碼屬性）設定下列鍵：
//      CLOUD_RUN_URL                       https://yda-cloud-decrypt-xxx.run.app
//      TAIPOWER_PARENT_FOLDER_ID           （Drive「台電電費電子帳單暨繳費憑證」資料夾 ID）
//      WATER_FOLDER_ID                     （Drive 自來水帳單暨繳費憑證資料夾 ID）
//      TELECOM_FOLDER_ID                   （Drive 中華電信帳單暨繳費憑證資料夾 ID）
//   2. 跑 installTrigger() 一次裝上每小時 trigger
//   3. 跑 processBills() 一次手動測試
//
// 取得資料夾 ID：在 Drive 開啟資料夾，網址 https://drive.google.com/drive/folders/<ID>

const CONFIG = {
  get decryptUrl() { return PropertiesService.getScriptProperties().getProperty('CLOUD_RUN_URL'); },
  get taipowerParent() { return PropertiesService.getScriptProperties().getProperty('TAIPOWER_PARENT_FOLDER_ID'); },
  get waterFolder() { return PropertiesService.getScriptProperties().getProperty('WATER_FOLDER_ID'); },
  get telecomFolder() { return PropertiesService.getScriptProperties().getProperty('TELECOM_FOLDER_ID'); },
  processedLabel: '帳單已歸檔',
  failedLabel: '帳單需檢視',
  // 寄信條件：寄到「自己」(culturalcity85)。可改成主委信箱
  notifyTo: Session.getActiveUser().getEmail(),
  // Gmail 搜尋條件：含 PDF 附件、未標處理、來自台電/水/中華電信
  searchQuery: 'has:attachment filename:pdf -label:帳單已歸檔 -label:帳單需檢視 ' +
               '(from:ebill@ebppsmtp.taipower.com.tw OR from:ebill@water.gov.taipei ' +
               ' OR from:cht_ebpp@cht.com.tw) newer_than:60d',
};

/** 主要入口：被 trigger 呼叫，或手動執行做測試。 */
function processBills() {
  const log = [];
  const successes = [];
  const skipped = [];
  const errors = [];

  const label = getOrCreateLabel(CONFIG.processedLabel);
  const failLabel = getOrCreateLabel(CONFIG.failedLabel);

  const threads = GmailApp.search(CONFIG.searchQuery, 0, 50);
  log.push(`Found ${threads.length} threads matching search.`);

  for (const thread of threads) {
    let threadHadError = false;
    let threadHandled = false; // 有附件被處理（無論新增或 duplicate）
    for (const msg of thread.getMessages()) {
      const atts = msg.getAttachments();
      for (const att of atts) {
        if (!att.getName().toLowerCase().endsWith('.pdf')) continue;
        try {
          const result = decryptAndExtract(att);
          if (result.type === 'unknown') {
            errors.push(`Unknown type [${att.getName()}]: ${result.textPreview || ''}`);
            threadHadError = true;
            continue;
          }
          const savedTo = saveToDrive(result);
          const chartTag = formatChartTag(result.chartUpdate);
          const visionTag = result.geminiUsed ? ' [👁vision]' : '';
          if (savedTo === 'duplicate') {
            skipped.push(result.filename + chartTag + visionTag);
            log.push(`Skip duplicate: ${result.filename}${chartTag}${visionTag}`);
          } else {
            successes.push(`${result.type}: ${result.filename}${chartTag}${visionTag}`);
          }
          threadHandled = true;
        } catch (e) {
          errors.push(`[${att.getName()}] ${e.toString()}`);
          threadHadError = true;
        }
      }
    }
    // 標籤策略：
    //   有 error → 「帳單需檢視」（thread 下次還會被抓回來重試）
    //   無 error 但有任何處理（新增或 duplicate）→ 「帳單已歸檔」（下次不再抓）
    if (threadHadError) {
      thread.addLabel(failLabel);
    } else if (threadHandled) {
      thread.addLabel(label);
    }
  }

  // 摘要信只在「有任何新動作」時寄：新增、跳過、錯誤都算
  if (successes.length > 0 || skipped.length > 0 || errors.length > 0) {
    sendSummary(successes, skipped, errors);
  }
  log.forEach(l => Logger.log(l));
  return { successes: successes.length, skipped: skipped.length, errors: errors.length };
}

/** 呼叫 Cloud Run 解密 + 抽資料。 */
function decryptAndExtract(attachment) {
  const url = CONFIG.decryptUrl;
  if (!url) throw new Error('CLOUD_RUN_URL Script Property 未設定');
  const secret = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
  if (!secret) throw new Error('SHARED_SECRET Script Property 未設定');
  const b64 = Utilities.base64Encode(attachment.getBytes());
  const response = UrlFetchApp.fetch(url.replace(/\/$/, '') + '/decrypt-bill', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Auth-Secret': secret },
    payload: JSON.stringify({ pdf_b64: b64 }),
    muteHttpExceptions: true,
  });
  const code = response.getResponseCode();
  const text = response.getContentText();
  if (code === 422) {
    return JSON.parse(text);
  }
  if (code !== 200) {
    throw new Error(`Decrypt service ${code}: ${text.substring(0, 300)}`);
  }
  return JSON.parse(text);
}

/** 把解密+命名好的 PDF 存到 Drive。回傳 'saved' or 'duplicate'。 */
function saveToDrive(result) {
  let folder;
  if (result.type.indexOf('taipower') === 0) {
    const parentId = CONFIG.taipowerParent;
    if (!parentId) throw new Error('TAIPOWER_PARENT_FOLDER_ID 未設定');
    const parent = DriveApp.getFolderById(parentId);
    const subs = parent.getFoldersByName(result.folder);
    if (!subs.hasNext()) throw new Error('Drive 子資料夾不存在：' + result.folder);
    folder = subs.next();
  } else if (result.type.indexOf('water') === 0) {
    const id = CONFIG.waterFolder;
    if (!id) throw new Error('WATER_FOLDER_ID 未設定');
    folder = DriveApp.getFolderById(id);
  } else if (result.type.indexOf('telecom') === 0) {
    const id = CONFIG.telecomFolder;
    if (!id) throw new Error('TELECOM_FOLDER_ID 未設定');
    folder = DriveApp.getFolderById(id);
  } else {
    throw new Error('Unknown type ' + result.type);
  }

  // 避免重複歸檔
  const dupCheck = folder.getFilesByName(result.filename);
  if (dupCheck.hasNext()) return 'duplicate';

  const bytes = Utilities.base64Decode(result.decryptedPdf_b64);
  const blob = Utilities.newBlob(bytes, 'application/pdf', result.filename);
  folder.createFile(blob);
  return 'saved';
}

function sendSummary(successes, skipped, errors) {
  const subject = `[閱大安] 帳單歸檔 ✓${successes.length}` +
    (skipped.length ? ` ⊙${skipped.length}` : '') +
    (errors.length ? ` ⚠${errors.length}` : '');
  let body = '';
  if (successes.length > 0) {
    body += '本次新增歸檔：\n' + successes.map(s => '  ✓ ' + s).join('\n') + '\n\n';
  }
  if (skipped.length > 0) {
    body += 'Drive 已有同名檔、跳過：\n' + skipped.map(s => '  ⊙ ' + s).join('\n') + '\n\n';
  }
  if (errors.length > 0) {
    body += '失敗或需檢視：\n' + errors.map(e => '  ⚠ ' + e).join('\n') + '\n\n';
    body += '相關信件已加上「帳單需檢視」標籤，請至 Gmail 查看。';
  }
  GmailApp.sendEmail(CONFIG.notifyTo, subject, body);
}

function getOrCreateLabel(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

/** 把 Cloud Run 回傳的 chartUpdate 結果格式化成短註記附在檔名旁。 */
function formatChartTag(cu) {
  if (!cu) return '';
  if (cu.error) return ` [⚠圖表更新失敗: ${cu.error}]`;
  if (cu.skipped) return ` [圖表跳過: ${cu.skipped}]`;
  if (cu.unchanged) return ' [圖表已最新]';
  if (cu.updated) return ' [📈圖表已 commit]';
  return '';
}

/** 一次性：裝上每小時 trigger。 */
function installTrigger() {
  // 先移除既有同名 trigger，避免重複
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'processBills')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('processBills').timeBased().everyHours(1).create();
  Logger.log('Trigger installed: processBills 每小時跑一次');
}

/** Debug：列出最近一次搜尋條件命中的信件。 */
function debugSearch() {
  const threads = GmailApp.search(CONFIG.searchQuery, 0, 20);
  Logger.log('Search query: ' + CONFIG.searchQuery);
  Logger.log('Threads found: ' + threads.length);
  for (const t of threads) {
    Logger.log('  - ' + t.getFirstMessageSubject() + ' (' + t.getMessages().length + ' msgs)');
  }
}

/**
 * 一次性：在 culturalcity85 主 Calendar 建一個提醒事件，
 * 提示 GCP 免費試用即將到期（試用結束前 7 天）、需手動升級成 pay-as-you-go。
 * 試用結束日 = 帳號開通日 + 90 天。請改下方 trialEndDate 為你的實際結束日。
 */
function addExpiryReminder() {
  // ⚠ 改成你的試用實際結束日（GCP 帳號開通日 + 90 天）
  const trialEndDate = new Date('2026-08-16');
  // 提醒設在試用結束前 7 天
  const reminderDate = new Date(trialEndDate.getTime() - 7 * 86400000);

  const calendar = CalendarApp.getDefaultCalendar();
  const title = '⚠️ GCP 免費試用即將到期（7 天後）— 須升級成 pay-as-you-go';
  const description =
    '閱大安公用事業帳單自動歸檔（Cloud Run）所在的 GCP 專案 cultural-city-utility 即將結束 90 天免費試用。\n\n' +
    '若不升級，' + Utilities.formatDate(trialEndDate, 'Asia/Taipei', 'yyyy-MM-dd') + ' 起 Cloud Run 服務會被自動暫停，\n' +
    '帳單自動歸檔會失效（Apps Script 呼叫 Cloud Run 全部 503 失敗）。\n\n' +
    '升級步驟：\n' +
    '1. https://console.cloud.google.com/billing?project=cultural-city-utility\n' +
    '2. 找「升級／Upgrade」按鈕 → 點 → 確認\n' +
    '3. 帳號變成 pay-as-you-go 狀態\n\n' +
    '升級後仍 $0 / 月（Cloud Run 用量在 Always Free 配額內）。';

  const event = calendar.createAllDayEvent(title, reminderDate);
  event.setDescription(description);
  event.addEmailReminder(60 * 9); // 9 小時前寄 email（白天看到）

  Logger.log('Calendar event created on ' + Utilities.formatDate(reminderDate, 'Asia/Taipei', 'yyyy-MM-dd'));
}
