// 一次性：每日水電資料健檢。① 異常值（疑似手填錯）② 各月加總（對帳用）。跑完可刪。
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, '..', 'utility', 'data');
const elec = JSON.parse(fs.readFileSync(path.join(D, 'daily-elec.json'), 'utf8'));   // [{d,k}]
const water = JSON.parse(fs.readFileSync(path.join(D, 'daily-water.json'), 'utf8')); // [{d,w}]

function median(a) { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

// 異常值：與前後 ±10 天中位數比，>3 倍或 <1/4（排除 0），或負數
function outliers(rows, key, label) {
  const vals = rows.map(r => r[key]);
  const flags = [];
  for (let i = 0; i < rows.length; i++) {
    const v = vals[i];
    if (v < 0) { flags.push({ d: rows[i].d, v, why: '負數' }); continue; }
    const win = vals.slice(Math.max(0, i - 10), i + 11).filter(x => x > 0);
    if (win.length < 5) continue;
    const med = median(win);
    if (med <= 0) continue;
    if (v > med * 3 && v - med > (key === 'w' ? 1.5 : 120)) flags.push({ d: rows[i].d, v, med: +med.toFixed(2), why: '偏高 ' + (v / med).toFixed(1) + '×' });
    else if (v > 0.05 && v < med / 4) flags.push({ d: rows[i].d, v, med: +med.toFixed(2), why: '偏低 ' + (v / med).toFixed(2) + '×' });
  }
  console.log('\n=== ' + label + ' 異常值（' + flags.length + ' 天）===');
  flags.slice(-25).forEach(f => console.log('  ' + f.d + '  值=' + f.v + (f.med != null ? ' 鄰中位=' + f.med : '') + '  ' + f.why));
  if (flags.length > 25) console.log('  …(只列最近 25 筆)');
  return flags;
}

// 各月加總
function monthly(rows, key, label) {
  const m = {};
  rows.forEach(r => { const ym = r.d.slice(0, 7); m[ym] = (m[ym] || 0) + r[key]; });
  console.log('\n=== ' + label + ' 各月加總（近 8 個月）===');
  Object.keys(m).sort().slice(-8).forEach(ym => console.log('  ' + ym + '  ' + m[ym].toFixed(1)));
}

console.log('elec 範圍:', elec[0].d, '~', elec[elec.length - 1].d, '(' + elec.length + '天)');
console.log('water 範圍:', water[0].d, '~', water[water.length - 1].d, '(' + water.length + '天)');
outliers(elec, 'k', '電（度/日）');
outliers(water, 'w', '水（度/日）');
monthly(elec, 'k', '電');
monthly(water, 'w', '水');
