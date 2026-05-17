// 從 admin/utility/index.html 內嵌的 SEED_E 抽出每日用電資料，
// 合併 utility/data/daily-temp.json 的氣溫，輸出 utility/data/daily-elec.json。

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'admin', 'utility', 'index.html');
const TEMP_JSON = path.join(__dirname, '..', 'utility', 'data', 'daily-temp.json');
const DST = path.join(__dirname, '..', 'utility', 'data', 'daily-elec.json');

const html = fs.readFileSync(SRC, 'utf8');

const m = html.match(/var SEED_E=\{start:'(\d{4}-\d{2}-\d{2})',end:'(\d{4}-\d{2}-\d{2})',values:\[([\d.,-]+)\]\};/);
if (!m) { console.error('SEED_E not found'); process.exit(1); }

const start = m[1];
const end = m[2];
const values = m[3].split(',').map(Number);

// 氣溫 map
const tempMap = {};
try {
  const tempArr = JSON.parse(fs.readFileSync(TEMP_JSON, 'utf8'));
  // daily-temp.json 結構為 [{d, tmax, tmin}, ...]
  tempArr.forEach(r => { tempMap[r.d] = r; });
} catch (e) {
  console.warn('daily-temp.json 讀取失敗，沒有氣溫欄位：', e.message);
}

const startDate = new Date(start + 'T00:00:00');
const out = values.map((k, i) => {
  const d = new Date(startDate.getTime() + i * 86400000);
  const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const row = { d: iso, k };
  if (tempMap[iso]) {
    if (tempMap[iso].tmax != null) row.tmax = tempMap[iso].tmax;
    if (tempMap[iso].tmin != null) row.tmin = tempMap[iso].tmin;
  }
  return row;
});

fs.writeFileSync(DST, JSON.stringify(out), 'utf8');
console.log(`✓ wrote ${DST} (${out.length} days, ${start} ~ ${end})`);
