// 字級字重守門：建置前掃 src/ 與根目錄 *.css，違規就讓建置失敗。
// 規則（字級表在 global.css 的 :root，--fs-*）：
//   1. font-size 只能寫 var(--fs-*)，圖示放大可寫 calc(var(--fs-*) * N)；任何數字（px/em/rem）一律擋
//   2. font-weight 只能是 400 / 500 / 700（或 normal / bold / inherit）
// 例外：簡報 deck（vw 單位另案）、水電公告產生器（卡片設計凍結值）、images/ 下的 SVG 圖檔。
// 單獨執行：node scripts/check-type-scale.js
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const EXEMPT = /agm-5-1-deck\.html$|[\\/]admin[\\/]utility[\\/]|[\\/]images[\\/]/;

function files() {
  const acc = fs.readdirSync(ROOT).filter(f => f.endsWith('.css')).map(f => path.join(ROOT, f));
  (function walk(d) {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (/\.(html|njk|md|css)$/.test(f)) acc.push(p);
    }
  })(path.join(ROOT, 'src'));
  return acc.filter(p => !EXEMPT.test(p));
}

function check() {
  const bad = [];
  for (const p of files()) {
    fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/font-size\s*:\s*([^;"'}]+)/g)) {
        const v = m[1].trim();
        // 允許 calc(var(--fs-x) * N)：只給圖示類（如大打勾）放大用，仍以字級表為錨
        if (!/^(var\(--fs-[a-z]+\)|calc\(var\(--fs-[a-z]+\) \* [0-9.]+\))(\s*!important)?$/.test(v) && !/^(inherit|unset|initial)$/.test(v))
          bad.push(`${path.relative(ROOT, p)}:${i + 1}  font-size: ${v}`);
      }
      for (const m of line.matchAll(/font-weight\s*:\s*([^;"'}]+)/g)) {
        const v = m[1].trim().replace(/\s*!important$/, '');
        if (!/^(400|500|700|normal|bold|inherit)$/.test(v))
          bad.push(`${path.relative(ROOT, p)}:${i + 1}  font-weight: ${v}`);
      }
    });
  }
  return bad;
}

module.exports = check;

if (require.main === module) {
  const bad = check();
  if (bad.length) { console.error(`字級守門：${bad.length} 處違規\n` + bad.join('\n')); process.exit(1); }
  console.log('字級守門：通過');
}
