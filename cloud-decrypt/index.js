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
//   PDF_PASSWORD  台電加密 PDF 的解密密碼（社區公務行動門號）。預設沿用既有密碼。

import express from 'express';
import * as mupdf from 'mupdf';

const app = express();
app.use(express.json({ limit: '20mb' }));

const PASSWORD = process.env.PDF_PASSWORD || '0989648285';

const TAIPOWER_METER = {
  '00-81-5173-01-9': '大公電',
  '00-81-5173-02-0': 'B1電信室',
  '00-81-5172-02-9': 'B1充電座',
  '00-81-5173-06-4': 'B3充電座',
};

const WATER_FOLDER = '台北自來水事業處水費電子帳單暨繳費憑證';
const TELECOM_FOLDER = '中華電信台北營運處繳費通知暨繳費憑證';

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
    const ok = doc.authenticatePassword(PASSWORD);
    if (!ok) throw Object.assign(new Error('Password mismatch'), { code: 'BAD_PASSWORD' });
  }
  let text = '';
  for (let i = 0; i < doc.countPages(); i++) {
    text += doc.loadPage(i).toStructuredText('preserve-whitespace').asText() + '\n';
  }
  return { doc, text: text.normalize('NFKC'), encrypted };
}

// ── 類型偵測 ──
function detectType(text) {
  if (/\d{3}\s*年\s*\d{1,2}\s*月\s*電費通知/.test(text)) return 'taipower-bill';
  if (/\d{3}\s*年\s*\d{1,2}\s*月\s*繳費憑證/.test(text) && /電子帳單/.test(text)) return 'taipower-receipt';
  if (/Electricity Bill/.test(text) && !/Payment Receipt/.test(text)) return 'taipower-bill';
  if (/Payment Receipt/.test(text) && /電子帳單/.test(text)) return 'taipower-receipt';
  if (/水費電子繳費憑證|Payment Voucher/.test(text)) return 'water-receipt';
  if (/水費電子通知單|水費電子帳單|Electronic Notice/.test(text)) return 'water-bill';
  if (/繳費結果通知/.test(text) && /中華電信/.test(text)) return 'telecom-receipt';
  if (/繳費通知/.test(text) && /中華電信/.test(text)) return 'telecom-bill';
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
    // 推估：帳單月份的前一個月
    const [rY, rM] = out.rocYearMonth.split('/').map(Number);
    let y = rY + 1911;
    let m2 = rM - 1;
    if (m2 === 0) { m2 = 12; y -= 1; }
    const lastDay = new Date(y, m2, 0).getDate();
    const rocY = y - 1911;
    out.periodStart = `${rocY}/${pad(m2)}/01`;
    out.periodEnd = `${rocY}/${pad(m2)}/${pad(lastDay)}`;
    out.periodEstimated = true;
  }
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
  const yyyy = parseInt(info.rocYearMonth.split('/')[0]) + 1911;
  const mm = info.rocYearMonth.split('/')[1];
  const periodTag = (info.periodStart && info.periodEnd)
    ? `（${rocFullDateToYmd(info.periodStart)}-${rocFullDateToYmd(info.periodEnd)}）`
    : '';
  const docLabel = type === 'telecom-receipt' ? '繳費結果通知' : '繳費通知';
  return `中華電信台北營運處${docLabel} ${yyyy}-${mm}${periodTag}.pdf`;
}

// ── HTTP endpoints ──
app.get('/health', (_req, res) => res.send('ok'));

app.post('/decrypt-bill', (req, res) => {
  try {
    if (!req.body || !req.body.pdf_b64) {
      return res.status(400).json({ error: 'Missing pdf_b64' });
    }
    const pdfBytes = Buffer.from(req.body.pdf_b64, 'base64');
    const { doc, text, encrypted } = extractText(pdfBytes);
    const type = detectType(text);

    if (type === 'unknown') {
      return res.status(422).json({
        error: 'Unknown bill type',
        textPreview: text.substring(0, 500)
      });
    }

    let info, filename, folder;
    if (type === 'taipower-bill' || type === 'taipower-receipt') {
      info = parseTaipower(text);
      if (!info.meter) return res.status(422).json({ error: '台電帳單無法抓到電號' });
      if (!info.rocYearMonth) return res.status(422).json({ error: '台電帳單無法抓到帳單月份' });
      filename = buildTaipowerName(type, info);
      folder = `電號${info.meter} ${TAIPOWER_METER[info.meter]}`;
    } else if (type === 'water-bill' || type === 'water-receipt') {
      info = parseWater(text);
      if (!info.rocYearMonth) return res.status(422).json({ error: '自來水帳單無法抓到收費年月' });
      filename = buildWaterName(type, info);
      folder = WATER_FOLDER;
    } else if (type === 'telecom-bill' || type === 'telecom-receipt') {
      info = parseTelecom(text);
      if (!info.rocYearMonth) return res.status(422).json({ error: '中華電信帳單無法抓到月份' });
      filename = buildTelecomName(type, info);
      folder = TELECOM_FOLDER;
    }

    // 重新存為解密版（如果原本加密）
    let outputBytes;
    if (encrypted) {
      const buf = doc.saveToBuffer('decrypt=yes,encrypt=none');
      outputBytes = Buffer.from(buf.asUint8Array());
    } else {
      outputBytes = pdfBytes;
    }

    res.json({
      type,
      filename,
      folder,
      extracted: info,
      wasEncrypted: encrypted,
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
