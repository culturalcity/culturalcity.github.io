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
//      SINOPAC_STATEMENT_FOLDER_ID         （Drive 永豐銀行電子綜合對帳單資料夾 ID）
//      SINOPAC_TRANSACTION_FOLDER_ID       （Drive 永豐銀行交易單證資料夾 ID）
//   2. 跑 installTrigger() 一次裝上每小時 trigger
//   3. 跑 processBills() 一次手動測試
//
// 取得資料夾 ID：在 Drive 開啟資料夾，網址 https://drive.google.com/drive/folders/<ID>

const CONFIG = {
  get decryptUrl() { return PropertiesService.getScriptProperties().getProperty('CLOUD_RUN_URL'); },
  get taipowerParent() { return PropertiesService.getScriptProperties().getProperty('TAIPOWER_PARENT_FOLDER_ID'); },
  get waterFolder() { return PropertiesService.getScriptProperties().getProperty('WATER_FOLDER_ID'); },
  get telecomFolder() { return PropertiesService.getScriptProperties().getProperty('TELECOM_FOLDER_ID'); },
  get sinopacStatementFolder() { return PropertiesService.getScriptProperties().getProperty('SINOPAC_STATEMENT_FOLDER_ID'); },
  get sinopacTransactionFolder() { return PropertiesService.getScriptProperties().getProperty('SINOPAC_TRANSACTION_FOLDER_ID'); },
  processedLabel: '帳單已歸檔',
  failedLabel: '帳單需檢視',
  // 寄信條件：寄到「自己」(culturalcity85)。可改成主委信箱
  notifyTo: Session.getActiveUser().getEmail(),
  // Gmail 搜尋條件：含 PDF 附件、未標處理、來自台電/水/中華電信/永豐
  searchQuery: 'has:attachment filename:pdf -label:帳單已歸檔 -label:帳單需檢視 ' +
               '(from:ebill@ebppsmtp.taipower.com.tw OR from:ebill@water.gov.taipei ' +
               ' OR from:cht_ebpp@cht.com.tw' +
               ' OR from:ebillservice@newebill.banksinopac.com.tw) newer_than:60d',
};

/** 判斷 message 是否來自永豐銀行。 */
function isSinopacMessage(msg) {
  const from = (msg.getFrom() || '').toLowerCase();
  return from.indexOf('ebillservice@newebill.banksinopac.com.tw') >= 0;
}

/** 對永豐 attachment：從 subject/msg.getDate() 抓 metadata、呼叫 Cloud Run 純解密、命名存檔。 */
function processSinopacAttachment(msg, att) {
  const subject = msg.getSubject() || '';
  const dateObj = msg.getDate();
  let type, filename, folderId, useSequenceDaily = false;

  if (subject.indexOf('電子綜合對帳單') >= 0) {
    const ymRe = new RegExp('(\\d{4})\\s*年\\s*(\\d{1,2})\\s*月');
    const ymM = subject.match(ymRe);
    if (!ymM) throw new Error('永豐對帳單 subject 抓不到年月：' + subject);
    const ym = ymM[1] + ('0' + parseInt(ymM[2])).slice(-2);
    type = 'sinopac-statement';
    filename = '永豐銀行電子綜合對帳單 ' + ym + '.pdf';
    folderId = CONFIG.sinopacStatementFolder;
    if (!folderId) throw new Error('SINOPAC_STATEMENT_FOLDER_ID 未設定');
  } else if (subject.indexOf('交易單證') >= 0) {
    const ymd = Utilities.formatDate(dateObj, 'Asia/Taipei', 'yyyyMMdd');
    type = 'sinopac-transaction';
    filename = '永豐銀行交易單證 ' + ymd + '.pdf';
    folderId = CONFIG.sinopacTransactionFolder;
    if (!folderId) throw new Error('SINOPAC_TRANSACTION_FOLDER_ID 未設定');
    useSequenceDaily = true;
  } else {
    throw new Error('永豐信件 subject 不認得：' + subject);
  }

  const url = CONFIG.decryptUrl;
  if (!url) throw new Error('CLOUD_RUN_URL Script Property 未設定');
  const secret = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
  if (!secret) throw new Error('SHARED_SECRET Script Property 未設定');
  const b64 = Utilities.base64Encode(att.getBytes());
  const response = UrlFetchApp.fetch(url.replace(new RegExp('/$'), '') + '/decrypt-only', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Auth-Secret': secret },
    payload: JSON.stringify({ pdf_b64: b64 }),
    muteHttpExceptions: true,
  });
  const code = response.getResponseCode();
  const body = response.getContentText();
  if (code !== 200) throw new Error('decrypt-only ' + code + ': ' + body.substring(0, 300));
  const result = JSON.parse(body);

  const folder = DriveApp.getFolderById(folderId);
  const bytes = Utilities.base64Decode(result.decryptedPdf_b64);

  if (useSequenceDaily) {
    const baseName = filename.substring(0, filename.length - 4);
    const escaped = baseName.replace(new RegExp('[.*+?^${}()|[\\]\\\\]', 'g'), '\\$&');
    const pat = new RegExp('^' + escaped + '-(\\d+)\\.pdf$');
    let maxN = 0;
    const iter = folder.getFiles();
    while (iter.hasNext()) {
      const fm = iter.next().getName().match(pat);
      if (fm) {
        const n = parseInt(fm[1], 10);
        if (n > maxN) maxN = n;
      }
    }
    const newName = baseName + '-' + ('0' + (maxN + 1)).slice(-2) + '.pdf';
    folder.createFile(Utilities.newBlob(bytes, 'application/pdf', newName));
    return { type: type, filename: newName, savedTo: 'saved' };
  }

  if (folder.getFilesByName(filename).hasNext()) {
    return { type: type, filename: filename, savedTo: 'duplicate' };
  }
  folder.createFile(Utilities.newBlob(bytes, 'application/pdf', filename));
  return { type: type, filename: filename, savedTo: 'saved' };
}

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
      const isSinopac = isSinopacMessage(msg);
      for (const att of atts) {
        if (!att.getName().toLowerCase().endsWith('.pdf')) continue;
        try {
          if (isSinopac) {
            const sr = processSinopacAttachment(msg, att);
            if (sr.savedTo === 'duplicate') skipped.push(sr.filename);
            else successes.push(sr.type + ': ' + sr.filename);
            threadHandled = true;
            continue;
          }
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
    if (threadHadError) {
      thread.addLabel(failLabel);
    } else if (threadHandled) {
      thread.addLabel(label);
    }
  }

  if (successes.length > 0 || skipped.length > 0 || errors.length > 0) {
    sendSummary(successes, skipped, errors);
  }
  log.forEach(l => Logger.log(l));
  return { successes: successes.length, skipped: skipped.length, errors: errors.length };
}

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
  if (code === 422) return JSON.parse(text);
  if (code !== 200) throw new Error(`Decrypt service ${code}: ${text.substring(0, 300)}`);
  return JSON.parse(text);
}

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
  } else if (result.type === 'sinopac-statement') {
    const id = CONFIG.sinopacStatementFolder;
    if (!id) throw new Error('SINOPAC_STATEMENT_FOLDER_ID 未設定');
    folder = DriveApp.getFolderById(id);
  } else if (result.type === 'sinopac-transaction') {
    const id = CONFIG.sinopacTransactionFolder;
    if (!id) throw new Error('SINOPAC_TRANSACTION_FOLDER_ID 未設定');
    folder = DriveApp.getFolderById(id);
  } else {
    throw new Error('Unknown type ' + result.type);
  }

  const bytes = Utilities.base64Decode(result.decryptedPdf_b64);

  if (result.filenameStrategy === 'sequence-daily') {
    const m = result.filename.match(/^(.+)\.pdf$/);
    if (!m) throw new Error('sequence-daily 檔名格式錯誤：' + result.filename);
    const baseName = m[1];
    const escaped = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pat = new RegExp('^' + escaped + '-(\\d+)\\.pdf$');
    let maxN = 0;
    const iter = folder.getFiles();
    while (iter.hasNext()) {
      const fm = iter.next().getName().match(pat);
      if (fm) {
        const n = parseInt(fm[1], 10);
        if (n > maxN) maxN = n;
      }
    }
    const newName = baseName + '-' + ('0' + (maxN + 1)).slice(-2) + '.pdf';
    folder.createFile(Utilities.newBlob(bytes, 'application/pdf', newName));
    result.filename = newName;
    return 'saved';
  }

  const dupCheck = folder.getFilesByName(result.filename);
  if (dupCheck.hasNext()) return 'duplicate';

  const blob = Utilities.newBlob(bytes, 'application/pdf', result.filename);
  const saved = folder.createFile(blob);
  try {
    const sc = addFinanceShortcut(result.type, result.filename, saved.getId());
    if (sc) result.filename += '（財務夾捷徑：' + sc + '）';
  } catch (e) {
    // 捷徑失敗不影響正本歸檔；摘要信會帶出錯誤讓主委知道
    result.filename += '（⚠ 財務夾捷徑建立失敗：' + e + '）';
  }
  return 'saved';
}

// ── 財務夾捷徑（2026-11-19 加）──
// 總幹事核銷要貼「已付款」的證明，所以只為三種收據建捷徑：
// 台電電費繳費憑證、自來水電子繳費憑證、中華電信繳費結果通知。帳單（繳費通知）不建。
// 捷徑名＝06 正本檔名，只把「YYYY-MM」挪到最前面寫成「YYYYMM 」（總幹事的費用憑證夾以年月排序）。
// 位置：02. 財務管理/05. 費用憑證/廠商發票收據/<西元年>/；台電另放在該年的「台電繳款憑證」子夾。
const FINANCE_RECEIPT_TYPES = ['taipower-receipt', 'water-receipt', 'telecom-receipt'];
const FINANCE_VOUCHER_PATH = ['02. 財務管理', '05. 費用憑證', '廠商發票收據'];

function financeShortcutName(filename) {
  const base = filename.replace(/\.pdf$/i, '');
  const m = base.match(/^(.*?)\s*(\d{4})-(\d{2})((?:（[^）]*）)?)$/);
  if (!m) return null;
  return { year: m[2], name: m[2] + m[3] + ' ' + m[1] + m[4] + '.pdf' };  // 留 .pdf：電腦版雲端硬碟才認得副檔名、雙擊能開
}

function getChildFolder(parent, name, create) {
  const it = parent.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  if (!create) throw new Error('找不到資料夾：' + name);
  return parent.createFolder(name);
}

function financeVoucherRoot() {
  const id = PropertiesService.getScriptProperties().getProperty('FINANCE_VOUCHER_FOLDER_ID');
  if (id) return DriveApp.getFolderById(id);
  let f = DriveApp.getRootFolder();
  for (const n of FINANCE_VOUCHER_PATH) f = getChildFolder(f, n, false);
  return f;
}

/** 回傳建好的捷徑名稱；不屬於收據、或已有同名捷徑時回傳 null。 */
function addFinanceShortcut(type, filename, targetId) {
  if (FINANCE_RECEIPT_TYPES.indexOf(type) < 0) return null;
  const nm = financeShortcutName(filename);
  if (!nm) throw new Error('檔名抓不到年月：' + filename);
  let folder = getChildFolder(financeVoucherRoot(), nm.year, true);
  if (type === 'taipower-receipt') folder = getChildFolder(folder, '台電繳款憑證', true);
  if (folder.getFilesByName(nm.name).hasNext()) return null;
  const sc = folder.createShortcut(targetId);
  sc.setName(nm.name);
  return nm.name;
}

/** 手動測試：對 06 既有的一份收據建捷徑（不碰 Gmail）。在編輯器選這個函式執行，看執行記錄。 */
function testFinanceShortcut() {
  const name = '中華電信台北營運處繳費結果通知 2026-10（20260901-20260930）.pdf';
  const f = DriveApp.getFolderById(CONFIG.telecomFolder).getFilesByName(name);
  if (!f.hasNext()) throw new Error('找不到測試檔：' + name);
  Logger.log(addFinanceShortcut('telecom-receipt', name, f.next().getId()) || '已存在，未重建');
}

function sendSummary(successes, skipped, errors) {
  const subject = `[閱大安] 帳單歸檔 ✓${successes.length}` +
    (skipped.length ? ` ⊙${skipped.length}` : '') +
    (errors.length ? ` ⚠${errors.length}` : '');
  let body = '';
  if (successes.length > 0) body += '本次新增歸檔：\n' + successes.map(s => '  ✓ ' + s).join('\n') + '\n\n';
  if (skipped.length > 0) body += 'Drive 已有同名檔、跳過：\n' + skipped.map(s => '  ⊙ ' + s).join('\n') + '\n\n';
  if (errors.length > 0) {
    body += '失敗或需檢視：\n' + errors.map(e => '  ⚠ ' + e).join('\n') + '\n\n';
    body += '相關信件已加上「帳單需檢視」標籤，請至 Gmail 查看。';
  }
  GmailApp.sendEmail(CONFIG.notifyTo, subject, body);
}

function getOrCreateLabel(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

function formatChartTag(cu) {
  if (!cu) return '';
  if (cu.error) return ` [⚠圖表更新失敗: ${cu.error}]`;
  if (cu.skipped) return ` [圖表跳過: ${cu.skipped}]`;
  if (cu.unchanged) return ' [圖表已最新]';
  if (cu.updated) return ' [📈圖表已 commit]';
  return '';
}

function installTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'processBills')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('processBills').timeBased().everyHours(1).create();
  Logger.log('Trigger installed: processBills 每小時跑一次');
}

function backfillSinopac() {
  const query = 'has:attachment filename:pdf -label:帳單已歸檔 ' +
                'from:ebillservice@newebill.banksinopac.com.tw';
  const label = getOrCreateLabel(CONFIG.processedLabel);
  const failLabel = getOrCreateLabel(CONFIG.failedLabel);
  const successes = [], skipped = [], errors = [];

  const threads = GmailApp.search(query, 0, 50);
  Logger.log('backfillSinopac: ' + threads.length + ' threads found');

  for (const thread of threads) {
    let threadHadError = false;
    let threadHandled = false;
    for (const msg of thread.getMessages()) {
      for (const att of msg.getAttachments()) {
        if (!att.getName().toLowerCase().endsWith('.pdf')) continue;
        try {
          const r = processSinopacAttachment(msg, att);
          if (r.savedTo === 'duplicate') skipped.push(r.filename);
          else successes.push(r.type + ': ' + r.filename);
          threadHandled = true;
        } catch (e) {
          errors.push('[' + att.getName() + '] ' + e.toString());
          threadHadError = true;
        }
      }
    }
    if (threadHadError) {
      thread.addLabel(failLabel);
    } else {
      thread.removeLabel(failLabel);
      if (threadHandled) thread.addLabel(label);
    }
  }

  if (successes.length > 0 || skipped.length > 0 || errors.length > 0) {
    sendSummary(successes, skipped, errors);
  }
  Logger.log('backfillSinopac done: found=' + threads.length + ' saved=' + successes.length + ' dup=' + skipped.length + ' err=' + errors.length);
  return { found: threads.length, successes: successes.length, skipped: skipped.length, errors: errors.length };
}

/**
 * 一次性回填：以上版本（不打 Gemini）。
 */
function debugSearch() {
  const threads = GmailApp.search(CONFIG.searchQuery, 0, 20);
  Logger.log('Search query: ' + CONFIG.searchQuery);
  Logger.log('Threads found: ' + threads.length);
  for (const t of threads) Logger.log('  - ' + t.getFirstMessageSubject() + ' (' + t.getMessages().length + ' msgs)');
}

function addExpiryReminder() {
  const trialEndDate = new Date('2026-08-16');
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
  event.addEmailReminder(60 * 9);
  Logger.log('Calendar event created on ' + Utilities.formatDate(reminderDate, 'Asia/Taipei', 'yyyy-MM-dd'));
}
