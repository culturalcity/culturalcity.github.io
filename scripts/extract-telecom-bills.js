// 從 raw/中華電信台北營運處繳費通知暨繳費憑證/ 抽出各月帳單金額
// 抓「市話/寬頻業務」與「行動」兩類含稅總額（從 page 3 的 用戶號碼 row）
// 輸出 utility/data/telecom-chart.json
//
// 用法：node scripts/extract-telecom-bills.js

const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');

const SRC = path.join(__dirname, '..', 'raw', '中華電信台北營運處繳費通知暨繳費憑證');
const DST = path.join(__dirname, '..', 'utility', 'data', 'telecom-chart.json');

const files = fs.readdirSync(SRC)
  .filter(f => f.includes('繳費通知') && !f.includes('繳費結果'))
  .sort();

async function extractOne(filename) {
  const buf = fs.readFileSync(path.join(SRC, filename));
  const parser = new PDFParse({ data: buf });
  const data = await parser.getText();
  const txt = data.text;

  // 月份從檔名抓：「中華電信台北營運處115年04月繳費通知.pdf」
  const m = filename.match(/(\d+)年(\d+)月/);
  const rocYear = m ? parseInt(m[1]) : null;
  const month = m ? parseInt(m[2]) : null;
  const yearMonth = rocYear && month ? `${rocYear}/${String(month).padStart(2, '0')}` : null;

  // 計費期間從文字抓
  const periodM = txt.match(/計費期間.?[:：]?\s*(\d{3}\/\d{2}\/\d{2})至(\d{3}\/\d{2}\/\d{2})/);
  const period = periodM ? `${periodM[1].split('/').slice(1).join('/')}-${periodM[2].split('/').slice(1).join('/')}` : null;

  // 應繳總金額（封面）
  const totalM = txt.match(/應繳總金額[^0-9]*(\d{1,3}(?:,\d{3})*|\d+)/);
  const total = totalM ? parseInt(totalM[1].replace(/,/g, '')) : null;

  // page 3「23677065」(市話) 與「0989648285」(行動) row 的「應繳金額」
  // page 3 結構：「用戶號碼 應繳金額 合計 小計 細項金額 營業稅 續沖餘額」
  // 抓行首接近「23677065」之後的整數
  let phoneAmt = null, mobileAmt = null;
  const phoneMatch = txt.match(/23677065\s+(\d+)/);
  if (phoneMatch) phoneAmt = parseInt(phoneMatch[1]);
  const mobileMatch = txt.match(/0989648285\s+(\d+)/);
  if (mobileMatch) mobileAmt = parseInt(mobileMatch[1]);

  // 行動 4G 上網使用量（部分月份有）
  const dataUsageM = txt.match(/行動上網使用量[^0-9]*([\d.]+)\s*G\s*B[^0-9]*?(?:約)?\s*([\d.]+)?/);
  const dataGB = dataUsageM ? parseFloat(dataUsageM[1]) : null;

  return {
    file: filename,
    rocYear,
    month,
    yearMonth,
    period,
    phoneAmt,
    mobileAmt,
    total,
    dataGB
  };
}

(async () => {
  console.log(`Found ${files.length} 繳費通知 PDFs`);
  const rows = [];
  for (const f of files) {
    try {
      const r = await extractOne(f);
      rows.push(r);
      console.log(`  ${r.yearMonth}  期間 ${r.period}  市話 ${r.phoneAmt}  行動 ${r.mobileAmt}  合計 ${r.total}${r.dataGB ? `  上網 ${r.dataGB} GB` : ''}`);
    } catch (err) {
      console.error(`  ${f}: ERROR ${err.message}`);
    }
  }

  // 組 chart.json 結構：按年分群
  const byYear = {};
  rows.forEach(r => {
    if (!r.rocYear || !r.month || !r.phoneAmt || !r.mobileAmt) return;
    const ad = 1911 + r.rocYear;
    if (!byYear[ad]) byYear[ad] = { phone: Array(12).fill(null), mobile: Array(12).fill(null), total: Array(12).fill(null) };
    byYear[ad].phone[r.month - 1] = r.phoneAmt;
    byYear[ad].mobile[r.month - 1] = r.mobileAmt;
    byYear[ad].total[r.month - 1] = r.total;
  });

  const colors = {
    2025: 'rgba(60,56,53,0.75)',
    2026: 'rgba(43,74,107,0.85)',
  };

  const datasets = Object.keys(byYear).sort().map(year => ({
    label: `${parseInt(year) - 1911}年（${year}）`,
    phone: byYear[year].phone,
    mobile: byYear[year].mobile,
    total: byYear[year].total,
    backgroundColor: colors[year] || 'rgba(105,100,96,0.65)'
  }));

  const out = {
    periodLabels: ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'],
    datasets,
    rawRows: rows.map(r => ({ yearMonth: r.yearMonth, period: r.period, phone: r.phoneAmt, mobile: r.mobileAmt, total: r.total, dataGB: r.dataGB }))
  };

  fs.mkdirSync(path.dirname(DST), { recursive: true });
  fs.writeFileSync(DST, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`\n✓ wrote ${DST}`);
})();
