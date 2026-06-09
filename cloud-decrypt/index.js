// 閱大安公用事業帳單 PDF 解密與類型辨識服務（Cloud Run）
//
// POST /decrypt-bill
//   request body:  { "pdf_b64": "<base64 PDF bytes>" }
//   response 200:  { type, filename, folder, extracted, decryptedPdf_b64 }
//   response 422:  { error: "Unknown bill type", text: "<前 500 chars 供 debug>" }
//
// GET /health → "ok"
//
// 環境變數：
//   PDF_PASSWORDS    加密 PDF 的密碼候選清單（逗號分隔）。會依序嘗試。
//                    預設：0989648285（公用事業，社區公務行動門號）+ 88329471（永豐銀行，閱大安統編）
//   PDF_PASSWORD     舊單一密碼變數，僅作 fallback；建議改用 PDF_PASSWORDS。
//   GEMINI_API_KEY   Google AI Studio API key。若設定，mupdf 抽不到文字（影像型 PDF）時
//                    會 fallback 用 Gemini vision 解析。未設定則只用 mupdf。
//                    永豐銀行交易單證為影像型 PDF，必須有此 key 才能解析。

import express from 'express';
import * as mupdf from 'mupdf';

const app = express();
app.use(express.json({ limit: '20mb' }));

const PASSWORDS = (process.env.PDF_PASSWORDS || process.env.PDF_PASSWORD || '0989648285,88329471')
  .split(',').map(s => s.trim()).filter(Boolean);
const SHARED_SECRET = process.env.SHARED_SECRET || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

// 共享密鑰中介層：除了 /health 之外都要帶 X-Auth-Secret header
app.use((req, res, next) => {
  if (req.path === '/health') return next();
  if (!SHARED_SECRET) {
    console.error('SHARED_SECRET env var not set');
    return res.status(500).json({ error: 'Service misconfigured' });
  }
  if (req.header('x-auth-secret') !== SHARED_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
});

const TAIPOWER_METER = {
  '00-81-5173-01-9': '大公電',
  '00-81-5173-02-0': 'B1電信室',
  '00-81-5172-02-9': 'B1充電座',
  '00-81-5173-06-4': 'B3充電座',
};

const WATER_FOLDER = '台北自來水事業處水費電子帳單暨繳費憑證';
const TELECOM_FOLDER = '中華電信台北營運處繳費通知暨繳費憑證';
// 永豐銀行 folder 名稱純文字，Apps Script 端用 type 來路由不靠這字串
const SINOPAC_STATEMENT_FOLDER = '永豐銀行電子綜合對帳單';
const SINOPAC_TRANSACTION_FOLDER = '永豐銀行交易單證';

// ── 共用工具 ──
function pad(n) { return String(n).padStart(2, '0'); }

function rocFullDateToYmd(rocStr) {
  const m1 = rocStr.match(/^(\d{3})\/(\d{2})\/(\d{2})$/);
  if (m1) return (parseInt(m1[1]) + 1911) + m1[2] + m1[3];
  const m2 = rocStr.match(/^(\d{3})(\d{2})(\d{2})$/);
  if (m2) return (parseInt(m2[1]) + 1911) + m2[2] + m2[3];
  return null;
}

function normalizeFullwidth(s) {
  return s.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
}

function extractText(pdfBytes) {
  const doc = mupdf.Document.openDocument(pdfBytes, 'application/pdf');
  const encrypted = doc.needsPassword();
  if (encrypted) {
    let ok = false;
    for (const pw of PASSWORDS) {
      if (doc.authenticatePassword(pw)) { ok = true; break; }
    }
    if (!ok) throw Object.assign(new Error('Password mismatch'), { code: 'BAD_PASSWORD' });
  }
  let text = '';
  for (let i = 0; i < doc.countPages(); i++) {
    text += doc.loadPage(i).toStructuredText('preserve-whitespace').asText() + '\n';
  }
  return { doc, text: text.normalize('NFKC'), encrypted };
}

// ── 類型偵測 ──
// 中華電信 / 台電的「繳費通知」與「繳費結果通知」字眼可能在內文 footer 重複出現，
// 因此偵測只看 PDF 開頭 800 字（標題與抬頭區）以避免誤判。
function detectType(text) {
  const head = text.substring(0, 800);
  if (/\d{3}\s*年\s*\d{1,2}\s*月\s*電費通知/.test(head)) return 'taipower-bill';
  if (/\d{3}\s*年\s*\d{1,2}\s*月\s*繳費憑證/.test(head) && /電子帳單/.test(head)) return 'taipower-receipt';
  if (/Electricity Bill/.test(head) && !/Payment Receipt/.test(head)) return 'taipower-bill';
  if (/Payment Receipt/.test(head) && /電子帳單/.test(head)) return 'taipower-receipt';
  if (/水費電子繳費憑證|Payment Voucher/.test(head)) return 'water-receipt';
  if (/水費電子通知單|水費電子帳單|Electronic Notice/.test(head)) return 'water-bill';
  if (/中華電信/.test(head)) {
    if (/繳費結果通知/.test(head)) return 'telecom-receipt';
    if (/繳費通知/.test(head)) return 'telecom-bill';
  }
  // 永豐銀行電子綜合對帳單：page 1 header 一定有「綜合對帳單」字眼
  if (/永豐銀行/.test(head) && /綜合對帳單/.test(head)) return 'sinopac-statement';
  // 永豐銀行交易單證為影像型 PDF；mupdf 抽不到文字，會走 Gemini 路徑
  // 因此這裡偵測不到也沒關係，type 會是 'unknown' → 觸發 Gemini fallback
  return 'unknown';
}

// ── parsers ──
function parseTaipower(text) {
  const out = {};
  const meterM = text.match(/(\d{2}-\d{2}-\d{4}-\d{2}-\d)/);
  if (meterM) out.meter = meterM[1];

  const monthM = text.match(/([\d０-９]{3})年([\d０-９]{1,2})月\s*(?:電費通知|繳費憑證)/);
  if (monthM) {
    const y = normalizeFullwidth(monthM[1]);
    const m = normalizeFullwidth(monthM[2]).padStart(2, '0');
    out.rocYearMonth = y + '/' + m;
  }

  const periodM = text.match(/(\d{3}\/\d{2}\/\d{2})\s*至\s*(\d{3}\/\d{2}\/\d{2})/);
  if (periodM) {
    out.periodStart = periodM[1];
    out.periodEnd = periodM[2];
  }
  return out;
}

function parseWater(text) {
  const out = {};
  const monthM = text.match(/(\d{3})年(\d{2})月\s*\n?\s*(?:115\/|繳費日期|\d{3}\/\d{2}\/\d{2})/);
  if (monthM) {
    out.rocYearMonth = monthM[1] + '/' + monthM[2];
  } else {
    const m2 = text.match(/收費年月[^]*?(\d{3})年(\d{1,2})月/);
    if (m2) out.rocYearMonth = m2[1] + '/' + pad(parseInt(m2[2]));
  }

  const periodM = text.match(/(?:用水計費期間|計費期間)[：:]?\s*\n?\s*(\d{7})\/(\d{7})/);
  if (periodM) {
    out.periodStart = periodM[1];
    out.periodEnd = periodM[2];
  }

  // 圖表用金額／度數
  // 度數：「本期用水度數：\n286」或「總用水度數：\n286」
  const tonM = text.match(/(?:本期用水度數|總用水度數)[：:]?\s*\n?\s*(\d+)/);
  if (tonM) out.tonnes = parseInt(tonM[1]);
  // 金額：找第一個 $N,NNN 格式（票面總額），避免抓到「1」「19」這類戶號
  const feeM = text.match(/\$(\d{1,3}(?:,\d{3})*|\d+)/);
  if (feeM) out.fee = parseInt(feeM[1].replace(/,/g, ''));
  return out;
}

function parseTelecom(text) {
  const out = {};
  const m = text.match(/(\d{3})\s*年\s*(\d{1,2})\s*月(?:繳費結果通知|繳費通知)/);
  if (m) out.rocYearMonth = m[1] + '/' + pad(parseInt(m[2]));

  // 中華電信計費期間規律：「YYY 年 MM 月帳單」對應「YYY 年 (MM-1) 月 1 日至最末日」
  // PDF 內如有寫就用 PDF 內的；沒有則由規律推估
  const periodM = text.match(/計費期間[：:]\s*(\d{3}\/\d{2}\/\d{2})\s*至\s*(\d{3}\/\d{2}\/\d{2})/);
  if (periodM) {
    out.periodStart = periodM[1];
    out.periodEnd = periodM[2];
  } else if (out.rocYearMonth) {
    Object.assign(out, estimateTelecomPeriod(out.rocYearMonth));
  }

  // 圖表用金額（市話/行動拆分 + 合計 + 行動上網用量）
  // Bill page 3：「23677065\n513\n」(戶號之後是該戶含稅金額)
  // Receipt page：「23677065\n23677065\n23677065\n$974」(僅總額、無拆分)
  // 用 \b 避免抓到 receipt 的第二個 23677065
  const phoneM = text.match(/23677065\s+(\d{1,4})\b(?!\d)/);
  if (phoneM) out.phone = parseInt(phoneM[1]);
  const mobileM = text.match(/0989648285\s+(\d{1,4})\b(?!\d)/);
  if (mobileM) out.mobile = parseInt(mobileM[1]);

  // 合計：先試 bill 的拆分加總；不行就用 receipt 的 $N,NNN 票面金額
  if (out.phone != null && out.mobile != null) {
    out.total = out.phone + out.mobile;
  } else {
    const totalM = text.match(/\$(\d{1,3}(?:,\d{3})*|\d+)/);
    if (totalM) out.total = parseInt(totalM[1].replace(/,/g, ''));
  }

  // 行動上網使用量：mupdf 可能把標籤跟值分在不同 token、允許之間有 whitespace/\n
  const dataM = text.match(/行動上網使用量約\s*([\d.]+)\s*G\s*B/);
  if (dataM) out.dataGB = parseFloat(dataM[1]);

  return out;
}

function parseSinopacStatement(text) {
  const out = {};
  // 「2025年10月綜合對帳單」（西元年；page 1、page footer 都有）
  const ymM = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*綜合對帳單/);
  if (ymM) {
    const y = ymM[1];
    const m = pad(parseInt(ymM[2]));
    out.yearMonth = y + m; // "202510"
    out.adYear = parseInt(y);
    out.adMonth = parseInt(ymM[2]);
  }
  // 「對帳單期間:2025/10/01~2025/10/31」
  const periodM = text.match(/對帳單期間[：:]\s*(\d{4}\/\d{2}\/\d{2})\s*[~～]\s*(\d{4}\/\d{2}\/\d{2})/);
  if (periodM) {
    out.periodStart = periodM[1];
    out.periodEnd = periodM[2];
  }
  return out;
}

/** 中華電信 period 推估：帳單月份對應前一個自然月 1 日~月底。
 *  mupdf 規律：parseTelecom 內已做；Gemini 路徑也需要這個，因此抽出共用。 */
function estimateTelecomPeriod(rocYearMonth) {
  const [rY, rM] = rocYearMonth.split('/').map(Number);
  let y = rY + 1911;
  let m2 = rM - 1;
  if (m2 === 0) { m2 = 12; y -= 1; }
  const lastDay = new Date(y, m2, 0).getDate();
  const rocY = y - 1911;
  return {
    periodStart: `${rocY}/${pad(m2)}/01`,
    periodEnd: `${rocY}/${pad(m2)}/${pad(lastDay)}`,
    periodEstimated: true,
  };
}

// ── Gemini fallback：mupdf 抽不到文字（影像型 PDF）時用 vision 解析 ──
async function extractWithGemini(pdfBytes) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY 未設定');

  const prompt = `這是一份台灣公用事業帳單或永豐銀行 PDF。請從中萃取結構化資料，回傳純 JSON（不要 markdown、不要說明文字）。

回傳格式：
{
  "type": 字串，須為下列之一：
     "taipower-bill"        台電電費通知
     "taipower-receipt"     台電繳費憑證
     "water-bill"           台北自來水電子帳單／通知單
     "water-receipt"        台北自來水電子繳費憑證
     "telecom-bill"         中華電信繳費通知
     "telecom-receipt"      中華電信繳費結果通知
     "sinopac-statement"    永豐銀行電子綜合對帳單（月對帳單，多帳號彙整）
     "sinopac-transaction"  永豐銀行交易單證（單筆交易確認單）
     "unknown"              其他
  "rocYearMonth":    "民國年/月 譬如 115/05（公用事業用；永豐銀行填 null）",
  "yearMonth":       "西元年月 6 碼譬如 202510（永豐銀行對帳單用；其他填 null）",
  "transactionDate": "交易日 YYYY-MM-DD 西元（永豐銀行交易單證用；其他填 null）",
  "periodStart":     "民國日期譬如 115/04/01 或西元 YYYY/MM/DD（公用事業民國、永豐西元；無則 null）",
  "periodEnd":       "（同上）",
  "meter":   "台電電號 XX-XX-XXXX-XX-X 格式（非台電帳單填 null）",
  "fee":     自來水帳單金額（純整數，無逗號；非自來水填 null）,
  "tonnes":  自來水用水度數（純整數；非自來水填 null）,
  "phone":   中華電信市話 (02)2367-7065 該月含稅費用（純整數；非中華電信或無拆分填 null）,
  "mobile":  中華電信行動 0989-648-285 該月含稅費用（純整數；非中華電信或無拆分填 null）,
  "total":   中華電信合計金額（純整數；非中華電信填 null）,
  "dataGB":  中華電信行動上網用量（小數 GB；無則 null）
}

規則：
- 民國年 = 西元年 - 1911
- 不確定或不存在的欄位填 null，禁止編造數字
- 金額純整數，移除逗號與貨幣符號
- 「繳費通知」與「繳費結果通知」是不同 type，仔細辨識
- 永豐銀行對帳單 header 會有「永豐銀行為您提供專屬電子綜合對帳單」或「YYYY年MM月綜合對帳單」
- 永豐銀行交易單證會有「交易單證」字樣 + 單筆交易明細（日期/金額/帳號/類型）`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: 'application/pdf', data: pdfBytes.toString('base64') } },
          { text: prompt },
        ],
      }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).substring(0, 300)}`);
  const data = await res.json();
  const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!jsonText) throw new Error('Gemini 回傳空 response');
  return JSON.parse(jsonText);
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
  const docLabel = type === 'water-receipt' ? '電子繳費憑證' : '電子帳單';
  return `臺北自來水事業處水費${docLabel} ${yyyy}-${mm}${periodTag}.pdf`;
}

function buildTelecomName(type, info) {
  const yyyy = parseInt(info.rocYearMonth.split('/')[0]) + 1911;
  const mm = info.rocYearMonth.split('/')[1];
  const periodTag = (info.periodStart && info.periodEnd)
    ? `（${rocFullDateToYmd(info.periodStart)}-${rocFullDateToYmd(info.periodEnd)}）`
    : '';
  const docLabel = type === 'telecom-receipt' ? '繳費結果通知' : '繳費通知';
  return `中華電信台北營運處${docLabel} ${yyyy}-${mm}${periodTag}.pdf`;
}

function buildSinopacStatementName(info) {
  // 「永豐銀行電子綜合對帳單 202510.pdf」
  return `永豐銀行電子綜合對帳單 ${info.yearMonth}.pdf`;
}

function buildSinopacTransactionBase(info) {
  // base name 不含 -NN 序號與 .pdf；Apps Script 端掃資料夾後決定序號
  // info.transactionDate 為 YYYY-MM-DD（Gemini 回傳）
  const compact = info.transactionDate.replace(/-/g, '');
  return `永豐銀行交易單證 ${compact}`;
}

// ── GitHub API：把 chart JSON 更新並 commit 上 main branch ──
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_OWNER = process.env.GITHUB_OWNER || 'culturalcity';
const GITHUB_REPO = process.env.GITHUB_REPO || 'culturalcity.github.io';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

async function ghGetFile(filePath) {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}?ref=${GITHUB_BRANCH}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' }
  });
  if (!res.ok) throw new Error(`GitHub GET ${filePath}: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const content = Buffer.from(data.content, 'base64').toString('utf8');
  return { content, sha: data.sha };
}

async function ghPutFile(filePath, content, sha, message) {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
    body: JSON.stringify({
      message, sha, branch: GITHUB_BRANCH,
      content: Buffer.from(content, 'utf8').toString('base64'),
    })
  });
  if (!res.ok) throw new Error(`GitHub PUT ${filePath}: ${res.status} ${await res.text()}`);
  return res.json();
}

/** 自來水 chart 更新（雙月 1/3/5/7/9/11，slot 由 period.indexOf(月份字串) 決定）。 */
async function updateWaterChart(info) {
  if (info.fee == null || info.tonnes == null) return { skipped: '無金額/度數' };
  const adYear = parseInt(info.rocYearMonth.split('/')[0]) + 1911;
  const monthStr = info.rocYearMonth.split('/')[1];
  const { content, sha } = await ghGetFile('utility/data/water-chart.json');
  const chart = JSON.parse(content);
  const slot = chart.periods.indexOf(monthStr);
  if (slot < 0) return { skipped: `月份 ${monthStr} 不在水費雙月排程內` };
  let ds = chart.datasets.find(d => d.label.includes(`（${adYear}）`));
  if (!ds) {
    ds = {
      label: `${adYear - 1911}年（${adYear}）`,
      data: new Array(chart.periods.length).fill(null),
      tonnes: new Array(chart.periods.length).fill(null),
      backgroundColor: 'rgba(105,100,96,0.65)'
    };
    chart.datasets.push(ds);
  }
  if (ds.data[slot] === info.fee && ds.tonnes[slot] === info.tonnes) {
    return { unchanged: true };
  }
  ds.data[slot] = info.fee;
  ds.tonnes[slot] = info.tonnes;
  const msg = `data: 自來水 ${adYear}-${monthStr} 自動更新（${info.tonnes} 度 / ${info.fee.toLocaleString()} 元）`;
  await ghPutFile('utility/data/water-chart.json', JSON.stringify(chart, null, 2) + '\n', sha, msg);
  return { updated: true, slot, fee: info.fee, tonnes: info.tonnes };
}

/** 中華電信 chart 更新（月制 1-12，slot = month - 1）。同時更新 datasets + rows。 */
async function updateTelecomChart(info) {
  if (info.total == null) return { skipped: '無合計金額' };
  const adYear = parseInt(info.rocYearMonth.split('/')[0]) + 1911;
  const month = parseInt(info.rocYearMonth.split('/')[1]);
  const slot = month - 1;
  const { content, sha } = await ghGetFile('utility/data/telecom-chart.json');
  const chart = JSON.parse(content);
  let ds = chart.datasets.find(d => d.label.includes(`（${adYear}）`));
  if (!ds) {
    ds = {
      label: `${adYear - 1911}年（${adYear}）`,
      phone: new Array(12).fill(null),
      mobile: new Array(12).fill(null),
      total: new Array(12).fill(null),
      backgroundColor: 'rgba(105,100,96,0.65)'
    };
    chart.datasets.push(ds);
  }

  let changed = false;
  if (info.phone != null && ds.phone[slot] !== info.phone) { ds.phone[slot] = info.phone; changed = true; }
  if (info.mobile != null && ds.mobile[slot] !== info.mobile) { ds.mobile[slot] = info.mobile; changed = true; }
  if (ds.total[slot] !== info.total) { ds.total[slot] = info.total; changed = true; }

  // rows array：用 rocYearMonth 為 key 找；找到則覆寫、找不到則 insert + sort
  if (!chart.rows) chart.rows = [];
  const rocYM = info.rocYearMonth;
  // rowEntry 只放有實際抓到值的欄位，避免 null 蓋掉既有正確資料
  // 譬如 receipt 抓不到 phone/mobile，但 bill 已寫好；receipt 不該把它清空
  const rowEntry = { rocYearMonth: rocYM };
  if (info.periodStart && info.periodEnd) rowEntry.period = `${info.periodStart}-${info.periodEnd}`;
  if (info.phone != null) rowEntry.phone = info.phone;
  if (info.mobile != null) rowEntry.mobile = info.mobile;
  if (info.total != null) rowEntry.total = info.total;
  if (info.dataGB != null) rowEntry.dataGB = info.dataGB;

  const ri = chart.rows.findIndex(r => r.rocYearMonth === rocYM);
  if (ri >= 0) {
    // 保留既有額外欄位（note、現存的 phone/mobile）：既有 spread 在前、新值只蓋有抓到的欄位
    const merged = { ...chart.rows[ri], ...rowEntry };
    if (JSON.stringify(chart.rows[ri]) !== JSON.stringify(merged)) {
      chart.rows[ri] = merged;
      changed = true;
    }
  } else {
    chart.rows.push(rowEntry);
    chart.rows.sort((a, b) => a.rocYearMonth.localeCompare(b.rocYearMonth));
    changed = true;
  }

  if (!changed) return { unchanged: true };
  const msg = `data: 中華電信 ${adYear}-${String(month).padStart(2,'0')} 自動更新（合計 ${info.total.toLocaleString()} 元）`;
  await ghPutFile('utility/data/telecom-chart.json', JSON.stringify(chart, null, 2) + '\n', sha, msg);
  return { updated: true, slot, total: info.total };
}

// ── HTTP endpoints ──
app.get('/health', (_req, res) => res.send('ok'));

// 純解密端點：給「client 端已自行決定 filename」的用途（如永豐銀行——
// 對帳單從 subject 抓年月、交易單證從 msg.getDate() 抓日期，
// 完全不需要 PDF 內容辨識）。
// request:  { pdf_b64 }
// response: { decryptedPdf_b64, wasEncrypted }
app.post('/decrypt-only', async (req, res) => {
  try {
    if (!req.body || !req.body.pdf_b64) {
      return res.status(400).json({ error: 'Missing pdf_b64' });
    }
    const pdfBytes = Buffer.from(req.body.pdf_b64, 'base64');
    const doc = mupdf.Document.openDocument(pdfBytes, 'application/pdf');
    const encrypted = doc.needsPassword();
    if (encrypted) {
      let ok = false;
      for (const pw of PASSWORDS) {
        if (doc.authenticatePassword(pw)) { ok = true; break; }
      }
      if (!ok) return res.status(401).json({ error: 'PDF 密碼錯誤' });
    }
    let outBytes;
    if (encrypted) {
      const buf = doc.saveToBuffer('decrypt=yes,encrypt=none');
      outBytes = Buffer.from(buf.asUint8Array());
    } else {
      outBytes = pdfBytes;
    }
    res.json({
      decryptedPdf_b64: outBytes.toString('base64'),
      wasEncrypted: encrypted,
    });
  } catch (e) {
    console.error('decrypt-only error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/decrypt-bill', async (req, res) => {
  try {
    if (!req.body || !req.body.pdf_b64) {
      return res.status(400).json({ error: 'Missing pdf_b64' });
    }
    const pdfBytes = Buffer.from(req.body.pdf_b64, 'base64');
    const { doc, text, encrypted } = extractText(pdfBytes);
    let type = detectType(text);
    let info = null;

    // mupdf 路徑：能抓到 type 就先試本地 regex 解析
    if (type === 'taipower-bill' || type === 'taipower-receipt') info = parseTaipower(text);
    else if (type === 'water-bill' || type === 'water-receipt') info = parseWater(text);
    else if (type === 'telecom-bill' || type === 'telecom-receipt') info = parseTelecom(text);
    else if (type === 'sinopac-statement') info = parseSinopacStatement(text);
    // sinopac-transaction 為影像型 PDF，沒有 mupdf 路徑，純走 Gemini

    // 解密過的 PDF bytes（給 Gemini 與最後輸出共用）
    let decryptedBytes;
    if (encrypted) {
      const buf = doc.saveToBuffer('decrypt=yes,encrypt=none');
      decryptedBytes = Buffer.from(buf.asUint8Array());
    } else {
      decryptedBytes = pdfBytes;
    }

    // ── Gemini fallback ──
    // 觸發條件：mupdf 完全失敗、或 mupdf 半死（type 找到但內容欄位缺）。
    // 後者更常見：中華電信 / 自來水的 PDF 格式偶爾微調，某些 regex 就抓不到，
    // 但 type/月份 等大方向還是抓得到 → 沒有 fallback 的話會默默漏資料。
    let geminiUsed = false;
    const utilityType = type === 'taipower-bill' || type === 'taipower-receipt' ||
                        type === 'water-bill' || type === 'water-receipt' ||
                        type === 'telecom-bill' || type === 'telecom-receipt';
    const missingTelecomBillFields = type === 'telecom-bill' &&
      (info?.phone == null || info?.dataGB == null);
    const missingWaterFields = (type === 'water-bill' || type === 'water-receipt') &&
      (info?.fee == null || info?.tonnes == null);
    const missingSinopacStatement = type === 'sinopac-statement' && !info?.yearMonth;
    const needsGemini = !!GEMINI_API_KEY && (
      type === 'unknown' ||
      (utilityType && !info?.rocYearMonth) ||
      ((type === 'taipower-bill' || type === 'taipower-receipt') && !info?.meter) ||
      missingTelecomBillFields ||
      missingWaterFields ||
      missingSinopacStatement
    );
    if (needsGemini) {
      try {
        const g = await extractWithGemini(decryptedBytes);
        geminiUsed = true;
        console.log('Gemini fallback result:', JSON.stringify(g));
        if (g.type && g.type !== 'unknown' && type === 'unknown') type = g.type;
        info = info || {};
        // mupdf 抓到的值優先（信任 text-based）；只補空缺
        for (const k of ['rocYearMonth', 'periodStart', 'periodEnd', 'meter',
                          'fee', 'tonnes', 'phone', 'mobile', 'total', 'dataGB',
                          'yearMonth', 'transactionDate']) {
          if ((info[k] == null || info[k] === '') && g[k] != null && g[k] !== '') {
            info[k] = typeof g[k] === 'string' ? g[k].trim() : g[k];
          }
        }
        // Gemini 給 phone+mobile 但沒給 total：自動加總
        if (info.total == null && info.phone != null && info.mobile != null) {
          info.total = info.phone + info.mobile;
        }
        // 中華電信若補出 rocYearMonth 但 period 仍缺 → 推估
        if ((type === 'telecom-bill' || type === 'telecom-receipt') &&
            info.rocYearMonth && (!info.periodStart || !info.periodEnd)) {
          Object.assign(info, estimateTelecomPeriod(info.rocYearMonth));
        }
      } catch (e) {
        console.error('Gemini fallback failed:', e);
      }
    }

    if (type === 'unknown') {
      // type: 'unknown' 一定要明確帶在 422 response 內，client 端才能用 result.type 統一判斷
      return res.status(422).json({
        type: 'unknown',
        error: 'Unknown bill type',
        geminiUsed,
        textPreview: text.substring(0, 500),
      });
    }

    let filename, folder, filenameStrategy;
    if (type === 'taipower-bill' || type === 'taipower-receipt') {
      if (!info?.meter) return res.status(422).json({ error: '台電帳單無法抓到電號', geminiUsed });
      if (!info.rocYearMonth) return res.status(422).json({ error: '台電帳單無法抓到帳單月份', geminiUsed });
      filename = buildTaipowerName(type, info);
      folder = `電號${info.meter} ${TAIPOWER_METER[info.meter]}`;
    } else if (type === 'water-bill' || type === 'water-receipt') {
      if (!info?.rocYearMonth) return res.status(422).json({ error: '自來水帳單無法抓到收費年月', geminiUsed });
      filename = buildWaterName(type, info);
      folder = WATER_FOLDER;
    } else if (type === 'telecom-bill' || type === 'telecom-receipt') {
      if (!info?.rocYearMonth) return res.status(422).json({ error: '中華電信帳單無法抓到月份', geminiUsed });
      filename = buildTelecomName(type, info);
      folder = TELECOM_FOLDER;
    } else if (type === 'sinopac-statement') {
      if (!info?.yearMonth) return res.status(422).json({ error: '永豐對帳單無法抓到帳單年月', geminiUsed });
      filename = buildSinopacStatementName(info);
      folder = SINOPAC_STATEMENT_FOLDER;
    } else if (type === 'sinopac-transaction') {
      if (!info?.transactionDate) return res.status(422).json({ error: '永豐交易單證無法抓到交易日', geminiUsed });
      // 交易單證：回 base name（含日期不含序號），Apps Script 端掃資料夾後決定 -01/-02 序號
      filename = buildSinopacTransactionBase(info) + '.pdf';
      filenameStrategy = 'sequence-daily';
      folder = SINOPAC_TRANSACTION_FOLDER;
    }

    const outputBytes = decryptedBytes;

    // 嘗試更新 public 圖表 JSON（GitHub commit）
    // 自來水 + 中華電信 才寫；台電不在 public utility 頁範圍
    let chartUpdate = null;
    if (GITHUB_TOKEN) {
      try {
        if (type === 'water-bill' || type === 'water-receipt') {
          chartUpdate = await updateWaterChart(info);
        } else if (type === 'telecom-bill' || type === 'telecom-receipt') {
          chartUpdate = await updateTelecomChart(info);
        }
      } catch (e) {
        chartUpdate = { error: e.message };
        console.error('Chart update failed:', e);
      }
    }

    res.json({
      type,
      filename,
      folder,
      filenameStrategy,
      extracted: info,
      wasEncrypted: encrypted,
      geminiUsed,
      chartUpdate,
      decryptedPdf_b64: outputBytes.toString('base64')
    });
  } catch (e) {
    if (e.code === 'BAD_PASSWORD') {
      return res.status(401).json({ error: 'PDF 密碼錯誤' });
    }
    console.error('Error:', e);
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`yda-cloud-decrypt listening on ${PORT}`));
