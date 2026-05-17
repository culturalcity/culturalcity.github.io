// 統一處理 6 種公用事業 PDF（帳單通知 + 繳費憑證）：
//   - 台電帳單通知（加密，C 後綴）
//   - 台電繳費憑證（加密，RD 後綴）
//   - 自來水帳單通知（未加密）
//   - 自來水繳費憑證（未加密）
//   - 中華電信帳單通知（未加密）
//   - 中華電信繳費結果通知（未加密）
//
// 用法：node scripts/decrypt-rename-bills.js
// 讀 raw/*.pdf 與 raw/中華電信台北營運處繳費通知暨繳費憑證/*.pdf，產出至 _demo/

import * as mupdf from 'mupdf';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DST = path.join(ROOT, '_demo');
const PASSWORD = '0989648285';

const TAIPOWER_METER = {
  '00-81-5173-01-9': '大公電',
  '00-81-5173-02-0': 'B1電信室',
  '00-81-5172-02-9': 'B1充電座',
  '00-81-5173-06-4': 'B3充電座',
};

// ── 共用工具 ──
function rocFullDateToYmd(rocStr) {
  // "115/01/12" → "20260112"，"1141225" → "20251225"
  const m1 = rocStr.match(/^(\d{3})\/(\d{2})\/(\d{2})$/);
  if (m1) return (parseInt(m1[1]) + 1911) + m1[2] + m1[3];
  const m2 = rocStr.match(/^(\d{3})(\d{2})(\d{2})$/);
  if (m2) return (parseInt(m2[1]) + 1911) + m2[2] + m2[3];
  return null;
}

function normalizeFullwidth(s) {
  // 全形數字 → 半形
  return s.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
}

function extractText(pdfBytes) {
  const doc = mupdf.Document.openDocument(pdfBytes, 'application/pdf');
  const encrypted = doc.needsPassword();
  if (encrypted) {
    const ok = doc.authenticatePassword(PASSWORD);
    if (!ok) throw new Error('密碼錯誤');
  }
  let text = '';
  for (let i = 0; i < doc.countPages(); i++) {
    text += doc.loadPage(i).toStructuredText('preserve-whitespace').asText() + '\n';
  }
  // 台灣政府 PDF 常用 CJK Compatibility Ideographs（F900-FAFF），NFKC 轉成標準 CJK
  text = text.normalize('NFKC');
  return { doc, text, encrypted };
}

function saveDecrypted(doc, outPath) {
  const buf = doc.saveToBuffer('decrypt=yes,encrypt=none');
  fs.writeFileSync(outPath, buf.asUint8Array());
}

// ── 類型偵測（NFKC 之後，看標題關鍵字） ──
function detectType(text) {
  // 台電：用標題月份字串判斷
  if (/\d{3}\s*年\s*\d{1,2}\s*月\s*電費通知/.test(text)) return 'taipower-bill';
  if (/\d{3}\s*年\s*\d{1,2}\s*月\s*繳費憑證/.test(text) && /電子帳單/.test(text)) return 'taipower-receipt';
  if (/Electricity Bill/.test(text) && !/Payment Receipt/.test(text)) return 'taipower-bill';
  if (/Payment Receipt/.test(text) && /電子帳單/.test(text)) return 'taipower-receipt';
  // 自來水
  if (/水費電子繳費憑證|Payment Voucher/.test(text)) return 'water-receipt';
  if (/水費電子通知單|水費電子帳單|Electronic Notice/.test(text)) return 'water-bill';
  // 中華電信
  if (/繳費結果通知/.test(text) && /中華電信/.test(text)) return 'telecom-receipt';
  if (/繳費通知/.test(text) && /中華電信/.test(text)) return 'telecom-bill';
  return 'unknown';
}

// ── 各類型 parser ──
function parseTaipower(text) {
  const out = {};
  const meterM = text.match(/(\d{2}-\d{2}-\d{4}-\d{2}-\d)/);
  if (meterM) out.meter = meterM[1];

  // 帳單民國年月：「１１５年０３月 電費通知」/「１１５年０４月 繳費憑證」
  const monthM = text.match(/([\d０-９]{3})年([\d０-９]{1,2})月\s*(?:電費通知|繳費憑證)/);
  if (monthM) {
    const y = normalizeFullwidth(monthM[1]);
    const m = normalizeFullwidth(monthM[2]).padStart(2, '0');
    out.rocYearMonth = y + '/' + m;
  }

  // 計費期間
  const periodM = text.match(/(\d{3}\/\d{2}\/\d{2})\s*至\s*(\d{3}\/\d{2}\/\d{2})/);
  if (periodM) {
    out.periodStart = periodM[1];
    out.periodEnd = periodM[2];
  }
  return out;
}

function parseWater(text) {
  const out = {};
  // 收費年月「115年03月」
  const monthM = text.match(/(\d{3})年(\d{2})月\s*\n?\s*(?:115\/|繳費日期|\d{3}\/\d{2}\/\d{2})/);
  if (monthM) {
    out.rocYearMonth = monthM[1] + '/' + monthM[2];
  } else {
    // fallback: 「收費年月」附近
    const m2 = text.match(/收費年月[^]*?(\d{3})年(\d{1,2})月/);
    if (m2) out.rocYearMonth = m2[1] + '/' + String(m2[2]).padStart(2, '0');
  }

  // 用水計費期間：「1141225/1150304」 或 「1150305/1150504」
  const periodM = text.match(/(?:用水計費期間|計費期間)[：:]?\s*\n?\s*(\d{7})\/(\d{7})/);
  if (periodM) {
    out.periodStart = periodM[1];
    out.periodEnd = periodM[2];
  }
  return out;
}

function parseTelecom(text) {
  const out = {};
  // 「115 年04 月繳費結果通知」「115年05月繳費通知」
  const m = text.match(/(\d{3})\s*年\s*(\d{1,2})\s*月(?:繳費結果通知|繳費通知)/);
  if (m) out.rocYearMonth = m[1] + '/' + String(m[2]).padStart(2, '0');
  return out;
}

// ── 命名 ──
function buildTaipowerName(type, info) {
  const label = TAIPOWER_METER[info.meter];
  if (!label) throw new Error('未知電號：' + info.meter);
  const yyyy = parseInt(info.rocYearMonth.split('/')[0]) + 1911;
  const mm = info.rocYearMonth.split('/')[1];
  const periodTag = (info.periodStart && info.periodEnd)
    ? `（${rocFullDateToYmd(info.periodStart)}-${rocFullDateToYmd(info.periodEnd)}）`
    : '';
  const docLabel = type === 'taipower-receipt' ? '繳費憑證' : '電子帳單';
  return `台灣電力公司電費${docLabel} 電號${info.meter} ${label} ${yyyy}-${mm}${periodTag}.pdf`;
}

function buildWaterName(type, info) {
  const yyyy = parseInt(info.rocYearMonth.split('/')[0]) + 1911;
  const mm = info.rocYearMonth.split('/')[1];
  const periodTag = (info.periodStart && info.periodEnd)
    ? `（${rocFullDateToYmd(info.periodStart)}-${rocFullDateToYmd(info.periodEnd)}）`
    : '';
  const docLabel = type === 'water-receipt' ? '繳費憑證' : '電子帳單';
  return `臺北自來水事業處水費${docLabel} ${yyyy}-${mm}${periodTag}.pdf`;
}

function buildTelecomName(type, info) {
  const docLabel = type === 'telecom-receipt' ? '繳費結果通知' : '繳費通知';
  return `中華電信台北營運處${info.rocYearMonth.split('/')[0]}年${info.rocYearMonth.split('/')[1]}月${docLabel}.pdf`;
}

// ── 主流程 ──
function listAllPdfs(dir) {
  const out = [];
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, f.name);
    if (f.isDirectory()) out.push(...listAllPdfs(full));
    else if (f.name.toLowerCase().endsWith('.pdf')) out.push(full);
  }
  return out;
}

fs.mkdirSync(DST, { recursive: true });
const files = listAllPdfs(path.join(ROOT, 'raw'));
console.log(`Found ${files.length} PDF files\n`);

for (const f of files) {
  const rel = path.relative(ROOT, f);
  try {
    const pdfBytes = fs.readFileSync(f);
    const { doc, text } = extractText(pdfBytes);
    const type = detectType(text);
    let newName;
    if (type === 'taipower-bill' || type === 'taipower-receipt') {
      newName = buildTaipowerName(type, parseTaipower(text));
    } else if (type === 'water-bill' || type === 'water-receipt') {
      newName = buildWaterName(type, parseWater(text));
    } else if (type === 'telecom-bill' || type === 'telecom-receipt') {
      newName = buildTelecomName(type, parseTelecom(text));
    } else {
      console.log(`⊘ ${rel}: 無法辨識類型，跳過`);
      continue;
    }
    saveDecrypted(doc, path.join(DST, newName));
    console.log(`✓ ${rel}`);
    console.log(`  → ${newName}\n`);
  } catch (e) {
    console.error(`✗ ${rel}: ${e.message}\n`);
  }
}
