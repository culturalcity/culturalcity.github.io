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
               '(from:service@taipower.com.tw OR from:service-bill@water.gov.taipei ' +
               ' OR from:billing_service@cht.com.tw) newer_than:60d',
};

/** 主要入口：被 trigger 呼叫，或手動執行做測試。 */
function processBills() {
  const log = [];
  const successes = [];
  const errors = [];

  const label = getOrCreateLabel(CONFIG.processedLabel);
  const failLabel = getOrCreateLabel(CONFIG.failedLabel);

  const threads = GmailApp.search(CONFIG.searchQuery, 0, 50);
  log.push(`Found ${threads.length} threads matching search.`);

  for (const thread of threads) {
    let threadHadError = false;
    let threadHadSuccess = false;
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
          if (savedTo === 'duplicate') {
            log.push(`Skip duplicate: ${result.filename}`);
          } else {
            successes.push(`${result.type}: ${result.filename}`);
            threadHadSuccess = true;
          }
        } catch (e) {
          errors.push(`[${att.getName()}] ${e.toString()}`);
          threadHadError = true;
        }
      }
    }
    if (threadHadSuccess && !threadHadError) {
      thread.addLabel(label);
    } else if (threadHadError) {
      thread.addLabel(failLabel);
    }
  }

  if (successes.length > 0 || errors.length > 0) {
    sendSummary(successes, errors);
  }
  log.forEach(l => Logger.log(l));
  return { successes: successes.length, errors: errors.length };
}

/** 呼叫 Cloud Run 解密 + 抽資料。 */
function decryptAndExtract(attachment) {
  const url = CONFIG.decryptUrl;
  if (!url) throw new Error('CLOUD_RUN_URL Script Property 未設定');
  const b64 = Utilities.base64Encode(attachment.getBytes());
  // 用 OIDC identity token 認證 Cloud Run（要求 service 設定 Allow only authenticated）
  const token = ScriptApp.getIdentityToken();
  const response = UrlFetchApp.fetch(url.replace(/\/$/, '') + '/decrypt-bill', {
    method: 'post',
    contentType: 'application/json',
    headers: token ? { Authorization: 'Bearer ' + token } : {},
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

function sendSummary(successes, errors) {
  const subject = `[閱大安] 帳單歸檔 ✓${successes.length}` + (errors.length ? ` ⚠${errors.length}` : '');
  let body = '';
  if (successes.length > 0) {
    body += '已歸檔：\n' + successes.map(s => '  ✓ ' + s).join('\n') + '\n\n';
  }
  if (errors.length > 0) {
    body += '失敗或需檢視：\n' + errors.map(e => '  ⚠ ' + e).join('\n') + '\n\n';
    body += '相關信件已加上 "帳單需檢視" 標籤，請至 Gmail 查看。';
  }
  GmailApp.sendEmail(CONFIG.notifyTo, subject, body);
}

function getOrCreateLabel(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
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
