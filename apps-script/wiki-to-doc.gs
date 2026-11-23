/**
 * 閱大安・總幹事與保全 Wiki → NotebookLM 來源文件（wiki-to-doc）
 *
 * 用途：每天把 repo 裡的總幹事 Wiki、保全 Wiki、保全 SOP 合併寫進一份固定的 Google 文件，
 *       給 culturalcity85 的 NotebookLM「閱大安總幹事小幫手」當來源。
 *       正本永遠是 repo 的 .md；這份 Google 文件是自動產生的副本，不要手改（隔天會被蓋掉）。
 *
 * NotebookLM 不會自己更新來源：Wiki 改了之後，到 NotebookLM 點該來源→「與 Google 雲端硬碟同步」。
 *
 * 部署：culturalcity85 的 Apps Script 專案
 *       「閱大安・總幹事與保全 Wiki → NotebookLM 來源文件（wiki-to-doc）」
 *       repo 根目錄跑 node scripts/deploy-apps-script.js wiki-to-doc --push
 * 初次：先跑 runNow()（授權＋建文件），再跑 setup() 建每日觸發器。
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
  let doc = null;
  if (docId) {
    try { doc = DocumentApp.openById(docId); } catch (e) { doc = null; }
  }
  if (!doc) {
    doc = DocumentApp.create(DOC_NAME);
    docId = doc.getId();
    props.setProperty('DOC_ID', docId);
    props.deleteProperty('HASH');
    Logger.log('已建立新文件：' + doc.getUrl());
  }

  if (props.getProperty('HASH') === hash) {
    Logger.log('Wiki 無變化，略過。文件：' + doc.getUrl());
    return;
  }
  doc.getBody().setText(text);
  doc.saveAndClose();
  props.setProperty('HASH', hash);
  props.setProperty('UPDATED', new Date().toISOString());
  Logger.log('已更新（' + text.length + ' 字元）：' + doc.getUrl());
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
      fm.body.trim());
  });
  return parts.join('\n');
}

// 從 SOP 目錄頁（sop.md）的連結找出各支 SOP。不用 GitHub API：
// 匿名呼叫從 Google 共用 IP 出去，常被限流回 403（2026-11-23 實測）。
// 目錄頁上有、但正本是 .html 的（火警、颱風）讀不到 .md，略過。
function listSops_() {
  const index = fetchText_(RAW + encodePath_('src/security/sop.md'));
  const slugs = {};
  (index.match(/\/security\/sop\/[a-z0-9-]+\//g) || [])
    .forEach(m => { slugs[m.split('/')[3]] = true; });
  return Object.keys(slugs).sort()
    .map(s => SOP_DIR + '/' + s + '.md')
    .filter(p => fetchText_(RAW + encodePath_(p), true) !== null);
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
