// 每日用電 json：以現有 utility/data/daily-elec.json 為歷史基線，把 kv-snapshot.json 的
// 「每一天」upsert 進去——KV 是 2026-04-30 起的「可編輯真相」：新天會新增、**舊天被修正也會
// 覆蓋**（所以在工具裡改 10 天前的錯值，隔天也會傳到這份 json／公開頁）。補氣溫、寫回。
// 自我延續、不依賴 SEED。由 deploy.yml 排程每天跑（fetch-kv.js 先更新 snapshot）。
const fs = require('fs');
const path = require('path');

const TEMP_JSON = path.join(__dirname, '..', 'utility', 'data', 'daily-temp.json');
const SNAP = path.join(__dirname, '..', 'utility', 'data', 'kv-snapshot.json');
const DST = path.join(__dirname, '..', 'utility', 'data', 'daily-elec.json');

// 現有 json = 歷史真相（在 git，有版本）；KV 沒有的舊天（如 2026-04-30 前）保持不動
let out = [];
try { out = JSON.parse(fs.readFileSync(DST, 'utf8')); } catch (e) { out = []; }
const byDate = new Map(out.map(r => [r.d, r]));

// 氣溫 map（給每天補/更新 tmax/tmin）
const tempMap = {};
try { JSON.parse(fs.readFileSync(TEMP_JSON, 'utf8')).forEach(r => { tempMap[r.d] = r; }); }
catch (e) { console.warn('daily-temp.json 讀取失敗：', e.message); }

// 把 KV 每一天 upsert 進去（覆蓋同日、新增新日）
try {
  const e = JSON.parse(fs.readFileSync(SNAP, 'utf8')).electric || {};
  Object.keys(e).forEach(d => {
    const v = Number(e[d]); if (!Number.isFinite(v)) return;
    const row = byDate.get(d) || { d };
    row.k = v;
    if (tempMap[d]) {
      if (tempMap[d].tmax != null) row.tmax = tempMap[d].tmax;
      if (tempMap[d].tmin != null) row.tmin = tempMap[d].tmin;
    }
    byDate.set(d, row);
  });
} catch (err) { console.warn('kv-snapshot.json 未合併（電）：', err.message); }

out = [...byDate.values()].sort((a, b) => a.d.localeCompare(b.d));
fs.writeFileSync(DST, JSON.stringify(out), 'utf8');
console.log(`✓ daily-elec.json：${out.length} 天，到 ${out.length ? out[out.length - 1].d : '-'}`);
