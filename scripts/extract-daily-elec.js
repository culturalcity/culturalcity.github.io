// 每日用電 json：以現有 utility/data/daily-elec.json 為歷史基線（自我延續——2026-06 退休
// admin 內嵌 SEED 後改此法），把 kv-snapshot.json 中「最後一天之後」的新天接上、補氣溫、寫回。
// 由 deploy.yml 排程每天跑（fetch-kv.js 先更新 snapshot）。
const fs = require('fs');
const path = require('path');

const TEMP_JSON = path.join(__dirname, '..', 'utility', 'data', 'daily-temp.json');
const SNAP = path.join(__dirname, '..', 'utility', 'data', 'kv-snapshot.json');
const DST = path.join(__dirname, '..', 'utility', 'data', 'daily-elec.json');

// 現有 json = 歷史真相（在 git，有版本）
let out = [];
try { out = JSON.parse(fs.readFileSync(DST, 'utf8')); } catch (e) { out = []; }
const lastD = out.length ? out[out.length - 1].d : '0000-00-00';

// 氣溫 map（給新天補 tmax/tmin）
const tempMap = {};
try { JSON.parse(fs.readFileSync(TEMP_JSON, 'utf8')).forEach(r => { tempMap[r.d] = r; }); }
catch (e) { console.warn('daily-temp.json 讀取失敗，新天無氣溫欄位：', e.message); }

// 接 KV 中 lastD 之後的天（date-keyed，容許缺日）
try {
  const e = JSON.parse(fs.readFileSync(SNAP, 'utf8')).electric || {};
  Object.keys(e).filter(d => d > lastD).sort().forEach(d => {
    const row = { d, k: e[d] };
    if (tempMap[d]) {
      if (tempMap[d].tmax != null) row.tmax = tempMap[d].tmax;
      if (tempMap[d].tmin != null) row.tmin = tempMap[d].tmin;
    }
    out.push(row);
  });
} catch (err) { console.warn('kv-snapshot.json 未合併（電）：', err.message); }

fs.writeFileSync(DST, JSON.stringify(out), 'utf8');
console.log(`✓ daily-elec.json：${out.length} 天，到 ${out.length ? out[out.length - 1].d : '-'}`);
