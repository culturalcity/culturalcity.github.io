// 從 admin/utility/index.html 內嵌的 SEED_W 抽出 4 年公水每日資料，
// 輸出 utility/data/daily-water.json，格式與 daily-elec.json 對齊。

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', 'admin', 'utility', 'index.html');
const DST = path.join(__dirname, '..', 'utility', 'data', 'daily-water.json');

const html = fs.readFileSync(SRC, 'utf8');

const m = html.match(/var SEED_W=\{start:'(\d{4}-\d{2}-\d{2})',end:'(\d{4}-\d{2}-\d{2})',values:\[([\d.,-]+)\]\};/);
if (!m) {
  console.error('SEED_W not found');
  process.exit(1);
}

const start = m[1];
const end = m[2];
const values = m[3].split(',').map(Number);

const startDate = new Date(start + 'T00:00:00');
const out = values.map((w, i) => {
  const d = new Date(startDate.getTime() + i * 86400000);
  const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  return { d: iso, w };
});

fs.writeFileSync(DST, JSON.stringify(out), 'utf8');
console.log(`✓ wrote ${DST} (${out.length} days, ${start} ~ ${end})`);
