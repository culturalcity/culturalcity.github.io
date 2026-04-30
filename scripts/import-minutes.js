#!/usr/bin/env node
// 把 raw/.../*.docx 匯入成 src/minutes/minutes-{屆}-{次}.html
// 用法：node scripts/import-minutes.js <docx-path> [--out src/minutes/minutes-X-Y.html] [--dry]
//
// 自動偵測格式：
//   • structured（第二屆以後）：壹/貳/參 章節 + 議案N + 說明 + 決議
//   • freeform（第一屆）：話題：標題 + 自由段落 + 決議：

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

// ─── 參數 ─────────────────────────────────────────────
const argv = process.argv.slice(2);
const docxPath = argv.find(a => !a.startsWith('--'));
const outFlag = argv.indexOf('--out');
const outOverride = outFlag >= 0 ? argv[outFlag + 1] : null;
const dryRun = argv.includes('--dry');

if (!docxPath) {
  console.error('用法：node scripts/import-minutes.js <docx路徑> [--out 輸出路徑] [--dry]');
  process.exit(1);
}
if (!fs.existsSync(docxPath)) {
  console.error('找不到 docx：', docxPath);
  process.exit(1);
}

// ─── 抽段落（支援 .docx / .doc / .pdf）─────────────────
function extractParagraphsFromDocx(filePath) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minutes-'));
  try { execSync(`unzip -q -o "${filePath}" -d "${tmp}"`, { stdio: 'pipe' }); }
  catch (e) { console.error('解壓 docx 失敗：', e.message); return []; }
  const xml = fs.readFileSync(path.join(tmp, 'word/document.xml'), 'utf8');
  fs.rmSync(tmp, { recursive: true, force: true });
  const paras = [];
  const re = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const inner = m[1];
    const texts = [];
    const tre = /<w:t[^>]*>([^<]*)<\/w:t>/g;
    let tm;
    while ((tm = tre.exec(inner)) !== null) texts.push(tm[1]);
    const joined = texts.join('').replace(/ /g, ' ').trim();
    if (joined) paras.push(joined);
  }
  return paras;
}

function splitTextIntoParas(txt) {
  return txt.replace(/\r\n/g, '\n').split(/\n[\s]*\n/)
    .map(s => s.split('\n').map(l => l.trim()).join(' ').replace(/\s+/g, ' ').trim())
    .filter(s => s.length > 0 && !/^第\s*\d+\s*頁/.test(s));
}

function extractParagraphsFromDoc(filePath) {
  let txt;
  try { txt = execSync(`antiword -m UTF-8.txt "${filePath}"`, { encoding: 'utf8' }); }
  catch (e) { console.error('antiword 失敗：', e.message); return []; }
  // antiword 表格用 | 分隔；按行切，每行可能含多個 cell（用 | 分），各成一段
  const out = [];
  txt.replace(/\r\n/g, '\n').split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (trimmed.includes('|')) {
      // 表格行：切 cells、過濾空 cell
      trimmed.split('|').map(c => c.trim()).filter(c => c.length > 0).forEach(c => out.push(c));
    } else {
      out.push(trimmed);
    }
  });
  return out;
}

function extractParagraphsFromPdf(filePath) {
  let txt;
  try { txt = execSync(`pdftotext -layout -enc UTF-8 -nopgbrk "${filePath}" -`, { encoding: 'utf8' }); }
  catch (e) { console.error('pdftotext 失敗：', e.message); return []; }
  return splitTextIntoParas(txt);
}

function extractParagraphsFromAny(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.docx') return extractParagraphsFromDocx(filePath);
  if (ext === '.doc')  return extractParagraphsFromDoc(filePath);
  if (ext === '.pdf')  return extractParagraphsFromPdf(filePath);
  return [];
}

let paras = extractParagraphsFromDocx(docxPath);
if (paras.length === 0) { console.error('段落抽取為空'); process.exit(1); }

// ─── 標籤辨識 ─────────────────────────────────────────
const SECTION_PREFIXES = ['壹', '貳', '參', '肆', '伍', '陸', '柒', '捌', '玖', '拾'];
const isStrictSectionHeading = (s) => SECTION_PREFIXES.some(p => s.startsWith(p + '、') || s.startsWith(p + '.'));
// 議案：議案/議題 + 中文數字 + 可選 ：/、；標籤行
const motionRe = /^(議案|議題)\s*([一二三四五六七八九十百零\d]*)\s*[、：:]?\s*$/;
const isMotionHeading = (s) => motionRe.test(s);
// 議題N、content 或 議案N：content（inline 形式）
const motionInlineRe = /^(議案|議題)\s*([一二三四五六七八九十百零\d]+)\s*[、：:]\s*(.+)$/;
// 全形空白也算白空格：用 \s 已包含部分但中文全形空白 　 要明寫
const wsClass = '[\\s\\u3000]*';
const isResolutionLabel = (s) => new RegExp(`^決${wsClass}議${wsClass}[：:]?${wsClass}$`).test(s);
const isExplanationLabel = (s) => new RegExp(`^說${wsClass}明${wsClass}[：:]?${wsClass}$`).test(s);
const isAnyMotionLabel = (s) => isMotionHeading(s) || isResolutionLabel(s) || isExplanationLabel(s);

const META_LABELS = ['開會日期', '開會時間', '開會地點', '召集人', '主席', '主　　席', '記錄', '紀錄', '會議記錄', '出席委員', '列席人員', '列席單位'];
const normalizeLabel = (s) => {
  const t = s.replace(/\s+/g, '').replace(/[：:]$/, '');
  if (t === '主　　席' || t === '主席') return '主席';
  if (t === '紀錄' || t === '會議記錄' || t === '記錄') return '記錄';
  return t;
};
const isMetaLabel = (s) => META_LABELS.includes(s.trim()) || META_LABELS.includes(s.replace(/\s+/g, ''));

const SUBHEADINGS = ['社區概況報告', '社區財務報告', '工作報告'];
const isSubHeading = (s) => SUBHEADINGS.includes(s.trim());

// 日期支援多格式：113/10/1、113/10/01、113/10/04-113/10/15、113/10/1~4、
// 1131023（純數字 7-8 位）、3/05（短月/日，3-7 屆後期工作報告）
const dateRe = /^(?:\d{1,3}\/\d{1,2}(?:\/\d{1,2})?(?:\s*[-－～~至]\s*(?:\d{1,3}\/\d{1,2}\/)?\d{1,2})?|\d{7,8})$/;
const isDateLine = (s) => dateRe.test(s.trim());
// 日期帶 dash 結尾，下一段才是區間結束（Word 拆段）
const isPartialDateLine = (s) => /^\d{2,3}\/\d{1,2}\/\d{1,2}\s*[-－]\s*$/.test(s.trim());
// 數量 pattern：純數字 + 戶/位
const countValueRe = /^\d+\s*(戶|位)$/;
const isCountValue = (s) => countValueRe.test(s.trim());

// ─── 標題 + 屆/次 ─────────────────────────────────────
function findTitleIndex(paras) {
  for (let i = 0; i < Math.min(5, paras.length); i++) {
    if (/第[一二三四五六七八九十]+屆.*?第[一二三四五六七八九十]+次/.test(paras[i])) return i;
  }
  return -1;  // 沒找到 title 段落（如 1120610 直接從 metadata 開始）
}
const titleIdx = findTitleIndex(paras);
const docTitle = titleIdx >= 0 ? paras[titleIdx] : '';

function parseTermAndSeq(title, fileBaseName) {
  const cnNum = (s) => {
    const map = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10, '十一': 11, '十二': 12, '十三': 13, '十四': 14, '十五': 15, '十六': 16, '十七': 17, '十八': 18, '十九': 19, '二十': 20 };
    return map[s] !== undefined ? map[s] : null;
  };
  const m2 = fileBaseName.match(/第([一二三四五六七八九十]+)屆.*?第([一二三四五六七八九十]+)次/);
  if (m2) { const term = cnNum(m2[1]), seq = cnNum(m2[2]); if (term && seq) return { term, seq }; }
  const m = title.match(/第([一二三四五六七八九十]+)屆.*?第([一二三四五六七八九十]+)次/);
  if (m) { const term = cnNum(m[1]), seq = cnNum(m[2]); if (term && seq) return { term, seq }; }
  return null;
}
const fileBaseName = path.basename(docxPath);
const ts = parseTermAndSeq(docTitle, fileBaseName);
if (!ts) { console.error('無法解析屆/次：', docTitle); process.exit(1); }
const { term, seq } = ts;

// ─── 拆 inline 「label：value」段落 ────────────────────
// 把 "開會時間：111/06/27..." 拆成 ["開會時間", "111/06/27..."]
// 也處理一段含多 label：value 的情況（如 "主　　席：X　　紀錄：Y"）
function splitInlineLabels(p) {
  // 嘗試按 META_LABELS 切分
  const result = [];
  let rest = p;
  let safety = 0;
  while (rest && safety++ < 10) {
    let matched = false;
    for (const lbl of META_LABELS) {
      const re = new RegExp(`^\\s*${lbl.replace(/[.*+?^${}()|[\\]]/g, '\\$&')}\\s*[：:]\\s*(.*)`);
      const m = rest.match(re);
      if (m) {
        // 找到 label，剩下文字繼續找下一個 label
        let val = m[1];
        // 看 val 內有沒有下一個 label
        let nextLabelIdx = -1;
        let nextLabel = null;
        for (const lbl2 of META_LABELS) {
          const idx = val.indexOf(lbl2 + '：');
          const idx2 = val.indexOf(lbl2 + ':');
          const candidate = idx >= 0 ? idx : (idx2 >= 0 ? idx2 : -1);
          if (candidate > 0 && (nextLabelIdx < 0 || candidate < nextLabelIdx)) {
            nextLabelIdx = candidate; nextLabel = lbl2;
          }
        }
        if (nextLabelIdx > 0) {
          result.push(normalizeLabel(lbl));
          result.push(val.substring(0, nextLabelIdx).trim());
          rest = val.substring(nextLabelIdx);
        } else {
          result.push(normalizeLabel(lbl));
          result.push(val.trim());
          rest = '';
        }
        matched = true;
        break;
      }
    }
    if (!matched) break;
  }
  return result.length > 0 ? result : null;
}

// 預處理 1：在 title 之後，把 inline metadata 段落拆開
const preProcessed = [];
for (let i = 0; i < paras.length; i++) {
  if (titleIdx >= 0 && i <= titleIdx) { preProcessed.push(paras[i]); continue; }
  const split = splitInlineLabels(paras[i]);
  if (split) preProcessed.push(...split);
  else preProcessed.push(paras[i]);
}
paras = preProcessed;

// 預處理 2：把「短中文標題：內容」格式拆成兩段
const inlineHeadingRe = /^([一-龥]{2,6})\s*[：:]\s*(\S.*)$/;
// 「說　明：xxx」「決　議：xxx」帶全形空白 → 拆
const wsLabelRe = /^([一-龥][　\s]*[一-龥])[　\s]*[：:][　\s]*(\S.*)$/;
// 「議題一、內容」「議案一：內容」inline
// motionInlineRe 已宣告於上方
const preProcessed2 = [];
for (let i = 0; i < paras.length; i++) {
  if (titleIdx >= 0 && i <= titleIdx) { preProcessed2.push(paras[i]); continue; }
  const p = paras[i];
  if (isMetaLabel(p) || isResolutionLabel(p) || isExplanationLabel(p) || isMotionHeading(p)) {
    preProcessed2.push(p); continue;
  }
  // 議題N、xxx / 議案N：xxx
  const mm = p.match(motionInlineRe);
  if (mm) {
    preProcessed2.push(`${mm[1]}${mm[2]}`);
    preProcessed2.push(mm[3]);
    continue;
  }
  // 帶全形空白的「說　明：xxx」「決　議：xxx」
  const mw = p.match(wsLabelRe);
  if (mw) {
    const labelNoWs = mw[1].replace(/[　\s]+/g, '');
    if (labelNoWs === '說明' || labelNoWs === '決議') {
      preProcessed2.push(labelNoWs + '：');
      preProcessed2.push(mw[2]);
      continue;
    }
  }
  // 一般 "Heading：content"
  const m = p.match(inlineHeadingRe);
  if (m && !isMetaLabel(m[1])) {
    preProcessed2.push(m[1] + '：');
    preProcessed2.push(m[2]);
  } else {
    preProcessed2.push(p);
  }
}
paras = preProcessed2;

// ─── 抓 metadata ──────────────────────────────────────
const meta = {};
let bodyStart = titleIdx >= 0 ? titleIdx + 1 : 0;
let i = bodyStart;
while (i < paras.length && !isStrictSectionHeading(paras[i])) {
  const cur = paras[i];
  if (isMetaLabel(cur) && i + 1 < paras.length) {
    const label = normalizeLabel(cur);
    const vals = [];
    let j = i + 1;
    while (j < paras.length && !isMetaLabel(paras[j]) && !isStrictSectionHeading(paras[j]) && !isFreeformHeading(paras[j])) {
      // 收 metadata value：碰到下個 label 或 section 才停
      vals.push(paras[j]);
      j++;
    }
    if (vals.length > 0) meta[label] = vals.join('、').replace(/、+/g, '、');
    i = j;
  } else {
    if (!isMetaLabel(cur) && !cur.includes('：')) break;
    i++;
  }
  bodyStart = i;
}

// 自由格式的「話題：」heading：以「：」結尾且非 metadata、非太長
function isFreeformHeading(s) {
  if (!s) return false;
  if (isMetaLabel(s)) return false;
  if (isResolutionLabel(s) || isExplanationLabel(s) || isMotionHeading(s)) return false;
  // 全行以「：」結尾 + 內文短（<= 25 字）
  const trimmed = s.trim();
  return /[：:]\s*$/.test(trimmed) && trimmed.length <= 25 && trimmed.length >= 3;
}

function rocToDate(s) {
  const m = s.match(/(\d{2,3})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (!m) return null;
  const y = parseInt(m[1]) + 1911;
  const mo = String(parseInt(m[2])).padStart(2, '0');
  const d = String(parseInt(m[3])).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}
// 從檔名前綴解析日期（NNNNNNN-...，民國 YYY MM DD）— 更可靠
function dateFromFilename(name) {
  const m = name.match(/^(\d{3})(\d{2})(\d{2})-/);
  if (!m) return null;
  const y = parseInt(m[1]) + 1911;
  return `${y}-${m[2]}-${m[3]}`;
}
const isoDate = dateFromFilename(fileBaseName) ||
  (meta['開會日期'] || meta['開會時間'] ? rocToDate(meta['開會日期'] || meta['開會時間']) : null);

// ─── 偵測格式（structured vs freeform）─────────────────
const bodyParas = paras.slice(bodyStart);
const hasStrictSections = bodyParas.some(isStrictSectionHeading);
const formatMode = hasStrictSections ? 'structured' : 'freeform';

// ─── 切 sections ──────────────────────────────────────
const sections = [];
if (formatMode === 'structured') {
  let curSec = null;
  for (const p of bodyParas) {
    if (isStrictSectionHeading(p)) {
      if (curSec) sections.push(curSec);
      curSec = { heading: p, paras: [] };
    } else if (curSec) {
      curSec.paras.push(p);
    }
  }
  if (curSec) sections.push(curSec);
} else {
  // freeform：每個「Heading：」為一個 topic
  let curSec = null;
  for (const p of bodyParas) {
    if (isFreeformHeading(p)) {
      if (curSec) sections.push(curSec);
      curSec = { heading: p.replace(/[：:]\s*$/, ''), paras: [], freeform: true };
    } else if (curSec) {
      curSec.paras.push(p);
    } else {
      // section 之前的內容（如「宣佈開會」之前）放成「會議開始」
      curSec = { heading: '會議概況', paras: [p], freeform: true };
    }
  }
  if (curSec) sections.push(curSec);
}

// ─── 渲染 ─────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function renderTextBlock(paras) {
  if (paras.length === 0) return '';
  const out = ['    <div class="m-text">'];
  paras.forEach(p => out.push(`      <p>${escHtml(p)}</p>`));
  out.push('    </div>');
  return out.join('\n');
}
// 把 stats 依「總X」拆成獨立分組（戶數 / 汽車位 / 機車位 等）
function groupStats(items) {
  const groups = [];
  let cur = null;
  for (const it of items) {
    if (/^總/.test(it.label) && cur) {
      groups.push(cur);
      cur = { items: [it] };
    } else if (!cur) {
      cur = { items: [it] };
    } else {
      cur.items.push(it);
    }
  }
  if (cur) groups.push(cur);
  return groups;
}
function renderStatsGroup(items) {
  const groups = groupStats(items);
  const out = [];
  for (const g of groups) {
    out.push('    <div class="m-stats">');
    g.items.forEach(({ label, val }) => out.push(`      <div class="m-stat"><div class="m-stat-label">${escHtml(label)}</div><div class="m-stat-val">${escHtml(val)}</div></div>`));
    out.push('    </div>');
  }
  return out.join('\n');
}
// 把純數字日期 1130123 轉成 113/01/23
function normalizeDate(d) {
  const m = d.match(/^(\d{3})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}/${m[2]}/${m[3]}`;
  // 區間 1130123-1130204 之類
  const m2 = d.match(/^(\d{3})(\d{2})(\d{2})\s*[-－～~]\s*(\d{3})(\d{2})(\d{2})$/);
  if (m2) return `${m2[1]}/${m2[2]}/${m2[3]}-${m2[4]}/${m2[5]}/${m2[6]}`;
  return d;
}
function renderWorklog(items) {
  const out = ['    <table class="m-worklog">', '      <thead><tr><th>日期</th><th>事項</th></tr></thead>', '      <tbody>'];
  items.forEach(({ date, item }) => out.push(`        <tr><td>${escHtml(normalizeDate(date))}</td><td>${escHtml(item)}</td></tr>`));
  out.push('      </tbody>', '    </table>');
  return out.join('\n');
}
function tryParseStats(buf, start) {
  const items = [];
  let j = start;
  while (j + 1 < buf.length && !isSubHeading(buf[j]) && !isAnyMotionLabel(buf[j])) {
    const label = buf[j], val = buf[j + 1];
    if (isCountValue(val) && !isCountValue(label) && !isSubHeading(label) && !isDateLine(label)) {
      items.push({ label, val });
      j += 2;
    } else break;
  }
  return items.length >= 2 ? { items, end: j } : null;
}
// 工作報告：日期 + 事項（事項可能跨多段）。日期區間「113/06/04-」+「113/06/15」也合併。
function tryParseWorklog(buf, start) {
  const items = [];
  let j = start;
  // 跳過開頭非日期的雜訊段落（如「上次=討論」），最多跳 3 段
  let skipped = 0;
  while (j < buf.length && skipped < 3 && !isDateLine(buf[j]) && !isPartialDateLine(buf[j]) && !isSubHeading(buf[j]) && !isAnyMotionLabel(buf[j])) {
    j++; skipped++;
  }
  while (j < buf.length && !isSubHeading(buf[j]) && !isAnyMotionLabel(buf[j])) {
    let date;
    if (isPartialDateLine(buf[j]) && j + 1 < buf.length && isDateLine(buf[j + 1])) {
      // 「113/06/04-」+「113/06/15」→ 合併
      date = buf[j].trim() + buf[j + 1].trim();
      j += 2;
    } else if (isPartialDateLine(buf[j])) {
      // 「112/08/28-」+ 事項（祕書漏填區間結束日）→ 拿掉尾巴 dash 當單一日期用
      date = buf[j].trim().replace(/[-－]\s*$/, '');
      j += 1;
    } else if (isDateLine(buf[j])) {
      date = buf[j].trim();
      j += 1;
    } else {
      break; // 不是日期就停（或已經沒對應的事項）
    }
    // 收事項：直到下個日期、子標題、議案
    const itemParts = [];
    while (j < buf.length && !isDateLine(buf[j]) && !isPartialDateLine(buf[j]) &&
           !isSubHeading(buf[j]) && !isAnyMotionLabel(buf[j])) {
      itemParts.push(buf[j]);
      j++;
    }
    if (itemParts.length === 0) break; // 日期之後沒事項，可能誤判
    items.push({ date, item: itemParts.join('') });
  }
  return items.length >= 2 ? { items, end: j } : null;
}

let motionAutoNum = 0;
function renderMotion(num, titleParas, explainParas, decisionParas) {
  const out = ['    <article class="m-motion">'];
  out.push('      <div class="m-motion-head">');
  out.push(`        <div class="m-motion-num">${escHtml(num)}</div>`);
  if (titleParas.length > 0) out.push(`        <div class="m-motion-title">${escHtml(titleParas[0])}</div>`);
  out.push('      </div>');
  const extraTopic = titleParas.slice(1);
  if (extraTopic.length > 0) {
    out.push('      <div class="m-motion-body">');
    extraTopic.forEach(t => out.push(`        <p>${escHtml(t)}</p>`));
    out.push('      </div>');
  }
  if (explainParas.length > 0) {
    out.push('      <div class="m-explanation">');
    out.push('        <div class="m-block-label">說明</div>');
    explainParas.forEach(t => out.push(`        <p>${escHtml(t)}</p>`));
    out.push('      </div>');
  }
  if (decisionParas.length > 0) {
    out.push('      <div class="m-resolution">');
    out.push('        <div class="m-block-label resolution">決議</div>');
    decisionParas.forEach(t => out.push(`        <p>${escHtml(t)}</p>`));
    out.push('      </div>');
  }
  out.push('    </article>');
  return out.join('\n');
}

function renderStructuredSection(sec) {
  motionAutoNum = 0;
  const out = ['  <section class="m-section">'];
  out.push(`    <h2 class="m-section-title">${escHtml(sec.heading)}</h2>`);
  const buf = sec.paras;
  let i = 0;
  let plainBuf = [];
  const flushPlain = () => { if (plainBuf.length) { out.push(renderTextBlock(plainBuf)); plainBuf = []; } };
  while (i < buf.length) {
    const p = buf[i];
    if (isSubHeading(p)) {
      flushPlain();
      out.push(`    <h3 class="m-subsection">${escHtml(p)}</h3>`);
      i++;
      if (p === '社區概況報告') {
        const stats = tryParseStats(buf, i);
        if (stats) { out.push(renderStatsGroup(stats.items)); i = stats.end; continue; }
      }
      if (p === '工作報告') {
        const wl = tryParseWorklog(buf, i);
        if (wl) { out.push(renderWorklog(wl.items)); i = wl.end; continue; }
      }
      continue;
    }
    if (isMotionHeading(p)) {
      flushPlain();
      const motionMatch = p.match(motionRe);
      const numStr = (motionMatch && motionMatch[1]) ? motionMatch[1] : '';
      motionAutoNum++;
      const cnSeq = ['一','二','三','四','五','六','七','八','九','十','十一','十二','十三','十四','十五','十六','十七','十八','十九','二十'];
      const display = numStr ? `議案${numStr}` : `議案${cnSeq[motionAutoNum-1] || motionAutoNum}`;
      const titleParas = [], explainParas = [], decisionParas = [];
      let phase = 'title';
      let j = i + 1;
      while (j < buf.length) {
        const q = buf[j];
        if (isMotionHeading(q)) break;
        if (isExplanationLabel(q)) { phase = 'explain'; j++; continue; }
        if (isResolutionLabel(q)) { phase = 'decision'; j++; continue; }
        if (phase === 'title') titleParas.push(q);
        else if (phase === 'explain') explainParas.push(q);
        else decisionParas.push(q);
        j++;
      }
      out.push(renderMotion(display, titleParas, explainParas, decisionParas));
      i = j;
      continue;
    }
    plainBuf.push(p);
    i++;
  }
  flushPlain();
  out.push('  </section>');
  return out.join('\n');
}

// freeform: 每個 section 是一個「topic」卡片
function renderFreeformSection(sec) {
  const out = ['  <article class="m-motion m-topic">'];
  out.push('    <div class="m-motion-head">');
  out.push(`      <div class="m-motion-title">${escHtml(sec.heading)}</div>`);
  out.push('    </div>');

  // 拆出 inline 「決議：」段落
  const discussionParas = [];
  const decisionParas = [];
  for (const p of sec.paras) {
    const m = p.match(/^決議\s*[：:]\s*(.+)$/);
    if (m) { decisionParas.push(m[1]); continue; }
    if (isResolutionLabel(p)) continue;  // 純標籤行，下一段才是內容
    decisionParas.length > 0 ? decisionParas.push(p) : discussionParas.push(p);
  }

  if (discussionParas.length > 0) {
    out.push('    <div class="m-motion-body">');
    discussionParas.forEach(t => out.push(`      <p>${escHtml(t)}</p>`));
    out.push('    </div>');
  }
  if (decisionParas.length > 0) {
    out.push('    <div class="m-resolution">');
    out.push('      <div class="m-block-label resolution">決議</div>');
    decisionParas.forEach(t => out.push(`      <p>${escHtml(t)}</p>`));
    out.push('    </div>');
  }
  out.push('  </article>');
  return out.join('\n');
}

function totalMotions() {
  if (formatMode === 'structured') {
    let n = 0;
    for (const sec of sections) for (const p of sec.paras) if (isMotionHeading(p)) n++;
    return n;
  } else {
    return sections.length; // freeform：每個 topic 算一項
  }
}
const motionCount = totalMotions();

// ─── frontmatter / 輸出 ───────────────────────────────
const cnSeqMap = ['一','二','三','四','五','六','七','八','九','十','十一','十二','十三','十四','十五','十六','十七','十八','十九','二十'];
const titleStr = `第${cnSeqMap[term-1]}屆第${cnSeqMap[seq-1] || seq}次管委會議紀錄`;

const fm = ['---'];
fm.push('layout: minutes.njk');
fm.push(`permalink: /minutes/minutes-${term}-${seq}.html`);
fm.push(`title: ${titleStr}`);
if (isoDate) fm.push(`date: ${isoDate}`);
if (motionCount > 0) {
  const label = formatMode === 'structured' ? '項議案' : '個討論主題';
  fm.push(`agendaCount: ${motionCount} ${label}`);
}
// 結尾 --- 等 noticeData 算完再加（要插 noticeDate）

const header = [];
header.push('<div class="header">');
header.push('  <div class="header-inner">');
header.push('    <div class="header-nav"><a href="./" class="back-link">會議紀錄列表</a></div>');
header.push('    <div class="eyebrow">MINUTES OF MEETING</div>');
// h1 跟第四屆一致：不帶「紀錄」二字，僅顯示到「管委會議」
header.push(`    <h1>${escHtml(titleStr.replace('管委會議紀錄', '管委會議'))}</h1>`);
header.push('    <div class="header-rule"></div>');
const metaItems = [
  ['日期', meta['開會日期'] || meta['開會時間']],
  ['時間', meta['開會時間']],
  ['地點', meta['開會地點']],
  ['主席', meta['主席']],
  ['記錄', meta['記錄']],
  ['出席委員', meta['出席委員']],
  ['列席人員', meta['列席人員'] || meta['列席單位']]
].filter(([_, v]) => v && v.trim());
// 去重：日期跟時間若同樣值（freeform 下兩者皆從「開會時間」抓）
const seen = new Set();
const dedup = [];
for (const [l, v] of metaItems) {
  const key = l + '|' + v;
  if (seen.has(v)) continue;
  seen.add(v);
  dedup.push([l, v]);
}
header.push('    <div class="meta-grid">');
dedup.forEach(([label, val]) => header.push(`      <div class="meta-cell"><div class="meta-label">${escHtml(label)}</div><div class="meta-val">${escHtml(val)}</div></div>`));
header.push('    </div>');
// tabs（如有 notice）放在 header-inner 最後，視覺上跟第四屆一致
const HEADER_TABS_PLACEHOLDER = '    <!--__TABS__-->';
header.push(HEADER_TABS_PLACEHOLDER);
header.push('  </div>');
header.push('</div>');

// ─── 找對應的開會通知檔（同日期前綴）─────────────────
function findNoticeFile(meetingPath) {
  const baseName = path.basename(meetingPath);
  const m = baseName.match(/^(\d{7})/);
  if (!m) return null;
  const noticeDir = path.join(path.dirname(meetingPath), '..', '第一屆至第三屆管理委員會開會通知');
  if (!fs.existsSync(noticeDir)) return null;
  const files = fs.readdirSync(noticeDir);
  const found = files.find(f => f.startsWith(m[1] + '-'));
  return found ? path.join(noticeDir, found) : null;
}

// ─── 解析通知：metadata + agenda（題目清單，無決議）─────
function parseNotice(noticeParas) {
  if (!noticeParas || noticeParas.length === 0) return null;
  // 預處理：拆 inline label，跟主流程同邏輯
  const split2 = [];
  for (const p of noticeParas) {
    const sp = splitInlineLabels(p);
    if (sp) split2.push(...sp); else split2.push(p);
  }
  // 也拆「短標題：內容」
  const split3 = [];
  for (const p of split2) {
    if (isMetaLabel(p) || isResolutionLabel(p) || isExplanationLabel(p) || isMotionHeading(p)) { split3.push(p); continue; }
    const mm = p.match(motionInlineRe);
    if (mm) { split3.push(`${mm[1]}${mm[2]}`); split3.push(mm[3]); continue; }
    const m = p.match(/^([一-龥]{2,6})\s*[：:]\s*(\S.*)$/);
    if (m && !isMetaLabel(m[1])) {
      split3.push(m[1] + '：');
      split3.push(m[2]);
    } else {
      split3.push(p);
    }
  }
  // metadata 收集（更寬：受文者 / 會議名稱 / 預計時間 / 聯絡人 / 聯絡電話 / 會議主席 / 出席人員）
  const NOTICE_LABELS = ['受文者','會議名稱','會議時間','會議地點','會議主席','預計時間','聯絡人','聯絡電話','出席人員',
                         '開會日期','開會時間','開會地點','召集人','主席','記錄','紀錄','會議記錄','出席委員','列席人員','列席單位'];
  const isNoticeLabel = (s) => NOTICE_LABELS.includes(s.trim().replace(/[：:]$/, ''));
  const meta = {};
  let i = 0;
  // 跳掉 title 段
  while (i < split3.length && !isNoticeLabel(split3[i]) && !isStrictSectionHeading(split3[i])) i++;
  while (i < split3.length && !isStrictSectionHeading(split3[i])) {
    const cur = split3[i];
    if (isNoticeLabel(cur) && i + 1 < split3.length) {
      const label = cur.trim().replace(/[：:]$/, '');
      const vals = [];
      let j = i + 1;
      let totalLen = 0;
      // antiword 對舊 .doc 的直書標題（會/議/程/序）會把單字塞進內容，
      // 加 body 起始字偵測 + 段數上限避免爆量
      const bodyStartWords = /^(?:會議程序|相關依據|會\s*議\s*程|議\s*程\s*序|主席宣布開會)$/;
      while (j < split3.length && !isNoticeLabel(split3[j]) && !isStrictSectionHeading(split3[j])) {
        const t = split3[j].trim();
        if (bodyStartWords.test(t)) break;
        if (vals.length >= 6) break;            // 一般 metadata 不會超過 6 段
        if (totalLen > 150) break;
        // 過濾單字殘留（會/議/程/序、相、關 等直書拆字）
        if (t.length === 1 && /[一-龥]/.test(t)) { j++; continue; }
        vals.push(t);
        totalLen += t.length;
        j++;
      }
      if (vals.length > 0) meta[label] = vals.join('、').replace(/、+/g, '、');
      i = j;
    } else { i++; }
  }
  // sections
  const noticeSections = [];
  let cur = null;
  for (; i < split3.length; i++) {
    const p = split3[i];
    if (isStrictSectionHeading(p)) {
      if (cur) noticeSections.push(cur);
      cur = { heading: p, items: [] };
    } else if (cur) {
      cur.items.push(p);
    }
  }
  if (cur) noticeSections.push(cur);

  // 後處理每個 section 的 items：合併 Word 拆段（議案 / 一 / ：標題 → "議案一：標題"）
  // 並濾掉「中華民國YYY年MM月DD日」這類發出日期殘留
  const cnDigit = /^[一二三四五六七八九十百十一十二十三十四十五十六十七十八十九二十]+$/;
  // 完整 YYY 年 M 月 D 日 才算發出日期戳（避免誤殺「112年度中元普渡」之類）
  const dateStampRe = /^(?:中華民國\s*)?\d{2,3}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日\s*$/;
  const startsSep = (s) => /^[、：:．\-]/.test(s);
  noticeSections.forEach(sec => {
    const merged = [];
    let buf = '';
    const flush = () => { if (buf.trim()) merged.push(buf.trim()); buf = ''; };
    for (let k = 0; k < sec.items.length; k++) {
      const p = sec.items[k];
      if (dateStampRe.test(p)) continue; // 發出日期
      if (!buf) { buf = p; continue; }
      // buf 結尾是「議案/議題」、單一數字、或以 :/、/- 等收尾 → 當前段是延續 → 合併
      const bufEndsContinuing =
        /^議案$|^議題$/.test(buf) ||
        /(議案|議題)\s*[一二三四五六七八九十百零\d]+\s*$/.test(buf) ||
        /[、：:\-－—──]\s*$/.test(buf);
      if (cnDigit.test(p) || startsSep(p) || bufEndsContinuing || /^──/.test(p)) {
        buf += p;
      } else {
        flush();
        buf = p;
      }
    }
    flush();
    sec.items = merged;
  });
  // 從通知段落最後幾段找「中華民國YYY年MM月DD日」當作通知發出日
  let issuedDate = null;
  for (let k = split3.length - 1; k >= Math.max(0, split3.length - 8); k--) {
    const mm = split3[k].match(/(?:中華民國\s*)?(\d{2,3})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
    if (mm) {
      const y = parseInt(mm[1]) + 1911;
      const mo = String(parseInt(mm[2])).padStart(2, '0');
      const d = String(parseInt(mm[3])).padStart(2, '0');
      issuedDate = `${y}/${mo}/${d}`;
      break;
    }
  }
  return { meta, sections: noticeSections, issuedDate };
}

function renderNoticeTab(notice) {
  const out = [];
  out.push('<div id="tab-notice" class="tab-content active">');
  // Metadata table
  const rows = [
    ['受文者', notice.meta['受文者']],
    ['會議名稱', notice.meta['會議名稱']],
    ['會議時間', notice.meta['會議時間'] || notice.meta['開會時間']],
    ['會議地點', notice.meta['會議地點'] || notice.meta['開會地點']],
    ['預計時間', notice.meta['預計時間']],
    ['會議主席', notice.meta['會議主席'] || notice.meta['主席']],
    ['記錄', notice.meta['記錄']],
    ['出席人員', notice.meta['出席人員'] || notice.meta['出席委員']],
    ['列席人員', notice.meta['列席人員'] || notice.meta['列席單位']],
    ['聯絡人', notice.meta['聯絡人']],
    ['聯絡電話', notice.meta['聯絡電話']],
  ].filter(([_, v]) => v && v.trim());
  if (rows.length > 0) {
    out.push('  <table class="notice-table">');
    rows.forEach(([k, v]) => out.push(`    <tr><th>${escHtml(k)}</th><td>${escHtml(v)}</td></tr>`));
    out.push('  </table>');
  }
  // Agenda sections
  notice.sections.forEach(sec => {
    if (sec.items.length === 0) {
      out.push(`  <div class="notice-section"><div class="notice-section-title">${escHtml(sec.heading)}</div></div>`);
      return;
    }
    out.push(`  <div class="notice-section"><div class="notice-section-title">${escHtml(sec.heading)}</div>`);
    out.push('    <ul class="notice-agenda">');
    sec.items.forEach(it => {
      // 取項目本身的「議案N」「議題N」「一、」當前綴標記，分到 .na-num；其餘是 .na-text
      // 用顯式中文數字模式（1-39）避免 greedy 抓進標題（如「議題十三三菱電梯」）
      const cnNum = '(?:[一二三四五六七八九]|十[一二三四五六七八九]?|二十[一二三四五六七八九]?|三十[一二三四五六七八九]?)';
      const labelRe = new RegExp('^((?:議案|議題)\\s*(?:' + cnNum + '|\\d+)|' + cnNum + '\\s*[、])\\s*[：:]?\\s*');
      const m = it.match(labelRe);
      if (m) {
        const labelPart = m[1].trim();
        const rest = it.slice(m[0].length).trim();
        out.push(`      <li><span class="na-num">${escHtml(labelPart)}</span><span class="na-text">${escHtml(rest)}</span></li>`);
      } else {
        out.push(`      <li><span class="na-text" style="margin-left:0">${escHtml(it)}</span></li>`);
      }
    });
    out.push('    </ul>');
    out.push('  </div>');
  });
  out.push('</div>');
  return out.join('\n');
}

// ─── 組裝 main / 包 tabs ──────────────────────────────
const noticePath = findNoticeFile(docxPath);
let noticeData = null;
if (noticePath) {
  const noticeParas = extractParagraphsFromAny(noticePath);
  noticeData = parseNotice(noticeParas);
}
const hasNotice = noticeData && (Object.keys(noticeData.meta).length > 0 || noticeData.sections.length > 0);

// 通知發出日 → frontmatter
if (noticeData && noticeData.issuedDate) fm.push(`noticeDate: ${noticeData.issuedDate}`);
fm.push('---');

const main = ['<div class="main">'];
if (hasNotice) {
  main.push(renderNoticeTab(noticeData));
  main.push('<div id="tab-minutes" class="tab-content">');
  sections.forEach(sec => main.push(formatMode === 'structured' ? renderStructuredSection(sec) : renderFreeformSection(sec)));
  main.push('</div>');
} else {
  sections.forEach(sec => main.push(formatMode === 'structured' ? renderStructuredSection(sec) : renderFreeformSection(sec)));
}
main.push('</div>');

// 把 tabs 放進 header（如有 notice），跟第四屆結構一致
let headerStr = header.join('\n');
if (hasNotice) {
  const tabsHtml = [
    '    <div class="tabs">',
    '      <button class="tab-btn active" data-tab="notice" onclick="switchTab(\'notice\')">📋 開會通知單</button>',
    '      <button class="tab-btn" data-tab="minutes" onclick="switchTab(\'minutes\')">📝 會議紀錄</button>',
    '    </div>'
  ].join('\n');
  headerStr = headerStr.replace('    <!--__TABS__-->', tabsHtml);
} else {
  headerStr = headerStr.replace('\n    <!--__TABS__-->', '');
}

const html = [fm.join('\n'), headerStr, main.join('\n'), ''].join('\n');

const outPath = outOverride || `src/minutes/minutes-${term}-${seq}.html`;
if (dryRun) {
  console.log(`[dry-run] 會輸出到：${outPath}`);
  console.log(`[format] ${formatMode}`);
  console.log(`[meta]`, meta);
  console.log(`[sections]`, sections.map(s => s.heading));
} else {
  fs.writeFileSync(outPath, html, 'utf8');
  console.log(`✓ ${outPath}　[${formatMode}]　日期：${isoDate || '?'}　${motionCount} ${formatMode === 'structured' ? '議案' : '主題'}`);
}
