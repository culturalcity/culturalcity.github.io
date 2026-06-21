// 每日公水 json：以現有 utility/data/daily-water.json 為歷史基線，把 kv-snapshot.json 的
// 「每一天」upsert 進去——KV 是 2026-04-30 起的「可編輯真相」：新天會新增、**舊天被修正也會
// 覆蓋**（在工具裡改舊天的錯值，隔天會傳到這份 json／公開頁）。寫回。
// 自我延續、不依賴 SEED。由 deploy.yml 排程每天跑（fetch-kv.js 先更新 snapshot）。
const fs = require('fs');
const path = require('path');

const SNAP = path.join(__dirname, '..', 'utility', 'data', 'kv-snapshot.json');
const DST = path.join(__dirname, '..', 'utility', 'data', 'daily-water.json');

let out = [];
try { out = JSON.parse(fs.readFileSync(DST, 'utf8')); } catch (e) { out = []; }
const byDate = new Map(out.map(r => [r.d, r]));

// 把 KV 每一天 upsert 進去（覆蓋同日、新增新日）
try {
  const w = JSON.parse(fs.readFileSync(SNAP, 'utf8')).water || {};
  Object.keys(w).forEach(d => {
    const v = Number(w[d]); if (!Number.isFinite(v)) return;
    byDate.set(d, { d, w: v });
  });
} catch (err) { console.warn('kv-snapshot.json 未合併（水）：', err.message); }

out = [...byDate.values()].sort((a, b) => a.d.localeCompare(b.d));
fs.writeFileSync(DST, JSON.stringify(out), 'utf8');
console.log(`✓ daily-water.json：${out.length} 天，到 ${out.length ? out[out.length - 1].d : '-'}`);
