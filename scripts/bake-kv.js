// 定期把 KV 的水電每日值「落地」到 admin 工具的 SEED_W/SEED_E（floating → 進 git）。
//
// 季度流程：
//   1. 主委在已登入瀏覽器開 https://culturalcity.org/admin/utility/api/data，整段 JSON
//      覆蓋存到  utility/data/kv-snapshot.json （這支同時是「KV 完整備份」）
//   2. node scripts/bake-kv.js          → dry-run，看會接幾天
//   3. node scripts/bake-kv.js --write   → 接到 SEED_W/SEED_E（只接 SEED 結束日之後的天，可重跑）
//   4. node scripts/extract-daily-elec.js && node scripts/extract-daily-water.js  → 重生公開 json
//   5. node scripts/reconcile-check.js   → 異常值＋對帳健檢
//   6. git commit（src/admin/utility/index.html + utility/data/daily-*.json + kv-snapshot.json）
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const WRITE = process.argv.includes('--write');
const SNAP = path.join(ROOT, 'utility', 'data', 'kv-snapshot.json');
const HTML = path.join(ROOT, 'src', 'admin', 'utility', 'index.html');
const kv = JSON.parse(fs.readFileSync(SNAP, 'utf8'));

function isoAdd(iso, n) { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

// 只取 SEED 結束日之後、連續無缺的天（可重跑：已落地的天會自動略過）
function buildAppend(obj, afterDate, label) {
  const dates = Object.keys(obj).filter(d => d > afterDate).sort();
  if (dates.length === 0) return { vals: [], end: afterDate };
  if (dates[0] !== isoAdd(afterDate, 1)) throw new Error(label + ' 第一筆新資料 ' + dates[0] + ' 不接在 ' + afterDate + ' 之後（中間有缺）');
  const vals = [];
  let prev = afterDate;
  for (const d of dates) {
    if (d !== isoAdd(prev, 1)) throw new Error(label + ' 缺日期 ' + isoAdd(prev, 1));
    vals.push(obj[d]); prev = d;
  }
  return { vals, end: prev };
}

let html = fs.readFileSync(HTML, 'utf8');
function bakeSeed(name, kvObj, label) {
  const re = new RegExp("var " + name + "=\\{start:'(\\d{4}-\\d{2}-\\d{2})',end:'(\\d{4}-\\d{2}-\\d{2})',values:\\[([\\d.,-]+)\\]\\};");
  const m = html.match(re);
  if (!m) throw new Error(name + ' 找不到');
  const oldEnd = m[2];
  const oldVals = m[3].split(',');
  const app = buildAppend(kvObj, oldEnd, label);
  if (app.vals.length === 0) { console.log(`${label}: 已是最新（到 ${oldEnd}），無新天可接`); return oldEnd; }
  const newVals = oldVals.concat(app.vals.map(String));
  console.log(`${label}: SEED 原 ${oldVals.length} 天(到 ${oldEnd}) + ${app.vals.length} 天 → ${newVals.length} 天(到 ${app.end})`);
  html = html.replace(re, "var " + name + "={start:'" + m[1] + "',end:'" + app.end + "',values:[" + newVals.join(',') + "]};");
  return app.end;
}

bakeSeed('SEED_W', kv.water, '水');
bakeSeed('SEED_E', kv.electric, '電');

if (WRITE) { fs.writeFileSync(HTML, html); console.log('\n✅ 已寫入 ' + path.relative(ROOT, HTML)); }
else console.log('\n(DRY-RUN：未寫檔。加 --write 才實際寫入)');
