/**
 * 閱大安・總幹事與保全 Wiki → NotebookLM 來源文件（wiki-to-doc）
 *
 * 用途：每天把 repo 裡的總幹事 Wiki、保全 Wiki、保全 SOP 合併寫進一份固定的 Google 文件，
 *       給 culturalcity85 的 NotebookLM「閱大安總幹事小幫手」當來源。
 *       正本永遠是 repo 的 .md；這份 Google 文件是自動產生的副本，不要手改（隔天會被蓋掉）。
 *
 * 筆記本：culturalcity85 的 Gemini Notebook（原 NotebookLM）「閱大安總幹事小幫手」，以本文件為來源。
 * Gemini Notebook 匯入雲端硬碟檔案後會自動同步（2026-11-23 介面說明），不必手動按同步。
 * 時效：Wiki push 後，最晚隔天 06:00–07:00 本程式重寫文件，筆記本再自動跟上；急的話在後台手動跑 runNow()。
 *
 * 部署：culturalcity85 的 Apps Script 專案
 *       「閱大安・總幹事與保全 Wiki → NotebookLM 來源文件（wiki-to-doc）」
 *       repo 根目錄跑 node scripts/deploy-apps-script.js wiki-to-doc --push
 * 初次：先跑 runNow()（授權＋建文件），再跑 setup() 建每日觸發器。
 * 權限：本專案線上 appsscript.json 明列 oauthScopes（documents、drive、script.external_request、
 *       script.scriptapp）。自動偵測只會給 drive 唯讀，Drive API 覆寫文件會 403（2026-11-23 實測）。
 *       deploy-apps-script.js 沿用線上 manifest，不會蓋掉；重建專案時要補回。
 */

const REPO = 'culturalcity/culturalcity.github.io';
const RAW = 'https://raw.githubusercontent.com/' + REPO + '/main/';
const SITE = 'https://culturalcity.org';
const DOC_NAME = '閱大安總幹事小幫手・來源（自動產生，勿手改）';

// 固定收錄的檔案；保全 SOP 資料夾另外自動列舉（新增 SOP 不必改這裡）
const FIXED_SOURCES = [
  'src/admin/staff/pm-wiki.md',
  'src/security/wiki.md',
  'src/security/sop.md',
];
const SOP_DIR = 'src/security/sop';

function runNow() {
  const text = buildText_();
  const props = PropertiesService.getScriptProperties();
  const hash = Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8));

  let docId = props.getProperty('DOC_ID');
  let file = null;
  if (docId) {
    try { file = DriveApp.getFileById(docId); } catch (e) { file = null; }
  }
  if (!file) {
    docId = DocumentApp.create(DOC_NAME).getId();
    file = DriveApp.getFileById(docId);
    props.setProperty('DOC_ID', docId);
    props.deleteProperty('HASH');
    Logger.log('已建立新文件：' + file.getUrl());
  }

  if (props.getProperty('HASH') === hash) {
    Logger.log('Wiki 無變化，略過。文件：' + file.getUrl());
    return;
  }
  overwriteDoc_(docId, text);
  props.setProperty('HASH', hash);
  props.setProperty('UPDATED', new Date().toISOString());
  Logger.log('已更新（' + text.length + ' 字元）：' + file.getUrl());
}

// 用 Drive API 把整份 Markdown 上傳覆蓋同一個 Google 文件（ID 不變，筆記本來源不斷）。
// 不用 DocumentApp 的 setText：清掉 7 萬多字再重寫會逾時「文件服務無法正常運作」（2026-11-23 實測）。
// Markdown 匯入會轉成真正的標題與表格；萬一 Drive 不收 markdown，退回純文字。
function overwriteDoc_(docId, text) {
  const url = 'https://www.googleapis.com/upload/drive/v3/files/' + docId + '?uploadType=media';
  const headers = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
  for (const type of ['text/markdown', 'text/plain']) {
    const res = UrlFetchApp.fetch(url, {
      method: 'patch', contentType: type, headers: headers,
      payload: Utilities.newBlob(text, type).getBytes(), muteHttpExceptions: true,
    });
    if (res.getResponseCode() === 200) { Logger.log('以 ' + type + ' 匯入'); return; }
    Logger.log(type + ' 匯入失敗 HTTP ' + res.getResponseCode() + '：' + res.getContentText().slice(0, 300));
  }
  throw new Error('覆寫文件失敗，見上方紀錄');
}

function previewNow() {
  const text = buildText_();
  Logger.log('合計 ' + text.length + ' 字元；開頭：\n' + text.slice(0, 800));
}

function setup() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'runNow')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('runNow').timeBased().everyDays(1).atHour(6).create();
  Logger.log('已建立每日 06:00–07:00 觸發器');
}

function buildText_() {
  const paths = FIXED_SOURCES.concat(listSops_());
  const today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
  const parts = [
    '閱大安總幹事小幫手的來源文件（' + today + ' 自動產生）',
    '內容合併自：總幹事 Wiki、保全 Wiki、保全 SOP。正本在社區網站，本文件不要手改。',
    '每一段開頭的【來源】是該段在網站上的網址，回答時請附上。',
  ];
  paths.forEach(p => {
    const md = fetchText_(RAW + encodePath_(p));
    const fm = parseFrontmatter_(md);
    const title = fm.title || p;
    const url = fm.permalink ? SITE + fm.permalink.replace(/index\.html$/, '') : '';
    parts.push(
      '\n\n==================================================\n' +
      '【文件】' + title + '\n' +
      (url ? '【來源】' + url + '\n' : '') +
      (fm.lastUpdate ? '【最後更新】' + fm.lastUpdate + '\n' : '') +
      '==================================================\n\n' +
      (/\.html$/.test(p) ? htmlToText_(fm.body) : fm.body).trim());
  });
  return parts.join('\n');
}

// 從 SOP 目錄頁（sop.md）的連結找出各支 SOP。不用 GitHub API：
// 匿名呼叫從 Google 共用 IP 出去，常被限流回 403（2026-11-23 實測）。
// 正本是 .md 的直接收；是 .html 的（火警、颱風）先試 .md、讀不到再收 .html，由 buildText_ 轉純文字。
function listSops_() {
  const index = fetchText_(RAW + encodePath_('src/security/sop.md'));
  const slugs = {};
  (index.match(/\/security\/sop\/[a-z0-9-]+\//g) || [])
    .forEach(m => { slugs[m.split('/')[3]] = true; });
  const out = [];
  Object.keys(slugs).sort().forEach(s => {
    for (const ext of ['.md', '.html']) {
      const p = SOP_DIR + '/' + s + ext;
      if (fetchText_(RAW + encodePath_(p), true) !== null) { out.push(p); return; }
    }
    Logger.log('找不到 SOP 原始檔：' + s);
  });
  return out;
}

// HTML 頁轉成 Markdown 風格純文字：去掉樣式與程式、標題轉 #、表格欄位用 ｜ 分隔
function htmlToText_(html) {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<h([1-6])[^>]*>/gi, (m, n) => '\n\n' + '#'.repeat(Number(n)) + ' ')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/t[dh]>\s*<t[dh][^>]*>/gi, ' ｜ ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|table|ul|ol|section|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n')
    .replace(/\n-\s*(?=\n)/g, '')
    .replace(/\n{3,}/g, '\n\n');
}

function fetchText_(url, allowMissing) {
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() === 404 && allowMissing) return null;
  if (res.getResponseCode() !== 200) throw new Error('讀取失敗 ' + url + '：HTTP ' + res.getResponseCode());
  return res.getContentText('UTF-8');
}

function parseFrontmatter_(md) {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { body: md };
  const out = { body: md.slice(m[0].length) };
  m[1].split(/\r?\n/).forEach(line => {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].replace(/^['"]|['"]$/g, '');
  });
  return out;
}

function encodePath_(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}
