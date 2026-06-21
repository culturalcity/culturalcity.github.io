// 從 admin/utility/index.html 內嵌的 SEED_E 抽出每日用電資料，
// 合併 utility/data/daily-temp.json 的氣溫，輸出 utility/data/daily-elec.json。

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', 'admin', 'utility', 'index.html');
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

// 合併 KV 快照（utility/data/kv-snapshot.json）中 SEED 結束日「之後」的天。
// 每日自動落地：fetch-kv.js 先更新 snapshot，這裡把新天接進 json（date-keyed，容許缺日）。
const SNAP = path.join(__dirname, '..', 'utility', 'data', 'kv-snapshot.json');
try {
  const kv = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
  const e = kv.electric || {};
  Object.keys(e).filter(d => d > end).sort().forEach(d => {
    const row = { d, k: e[d] };
    if (tempMap[d]) {
      if (tempMap[d].tmax != null) row.tmax = tempMap[d].tmax;
      if (tempMap[d].tmin != null) row.tmin = tempMap[d].tmin;
    }
    out.push(row);
  });
} catch (err) { console.warn('kv-snapshot.json 未合併（電）：', err.message); }

const lastD = out.length ? out[out.length - 1].d : end;
fs.writeFileSync(DST, JSON.stringify(out), 'utf8');
console.log(`✓ wrote ${DST} (${out.length} days, ${start} ~ ${lastD})`);
