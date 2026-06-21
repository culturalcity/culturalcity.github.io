// 每日公水 json：以現有 utility/data/daily-water.json 為歷史基線（自我延續——2026-06 退休
// admin 內嵌 SEED 後改此法），把 kv-snapshot.json 中「最後一天之後」的新天接上、寫回。
// 由 deploy.yml 排程每天跑（fetch-kv.js 先更新 snapshot）。
const fs = require('fs');
const path = require('path');

const SNAP = path.join(__dirname, '..', 'utility', 'data', 'kv-snapshot.json');
const DST = path.join(__dirname, '..', 'utility', 'data', 'daily-water.json');

// 現有 json = 歷史真相（在 git，有版本）
let out = [];
try { out = JSON.parse(fs.readFileSync(DST, 'utf8')); } catch (e) { out = []; }
const lastD = out.length ? out[out.length - 1].d : '0000-00-00';

// 接 KV 中 lastD 之後的天（date-keyed，容許缺日）
try {
  const w = JSON.parse(fs.readFileSync(SNAP, 'utf8')).water || {};
  Object.keys(w).filter(d => d > lastD).sort().forEach(d => { out.push({ d, w: w[d] }); });
} catch (err) { console.warn('kv-snapshot.json 未合併（水）：', err.message); }

fs.writeFileSync(DST, JSON.stringify(out), 'utf8');
console.log(`✓ daily-water.json：${out.length} 天，到 ${out.length ? out[out.length - 1].d : '-'}`);
