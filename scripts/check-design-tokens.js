// 設計表守門（2026-09-19 產品設計稽核後新增；規則見 SHARED-CORE「成品開工先定設計表」與 VI.md「設計表」）
//
// 兩段檢查：
//   warnSource()  建置前：CSS 語境（*.css、<style>、style=""、frontmatter extraStyles）裡寫死的
//                 顏色／行高／字距／間距 → 擋建置（2026-09-19 審閱後由警示改為阻擋）。真有例外，在該宣告後
//                 緊接註解 /* design-ok: 理由 */ 即放行（理由必寫，對應 SHARED-CORE「超過要寫理由」）；
//                 並列出 global.css 色票中 ΔE<3（肉眼分不出）的近似色對。
//   checkOutput() 建置後：逐頁把「頁面本身＋它連結的站內 CSS」合起來看，
//                 用了 var(--x)（無 fallback）卻整頁都沒定義 → 擋建置。
//                 （2026-09 實例：年報的 --amber、公告列表的 --c-staff 從未定義，標記點與 pill 靜默失色。）
// 豁免：AGM 簡報 deck（vw 單位另案）、admin/utility 水電公告產生器（卡片設計凍結值）、images/。
// 單獨執行：node scripts/check-design-tokens.js [建置輸出資料夾，預設 _site]
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const EXEMPT = /agm-5-1-deck\.html$|[\\/]admin[\\/]utility[\\/]|[\\/]images[\\/]/;

function walk(dir, re, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, re, acc);
    else if (re.test(f)) acc.push(p);
  }
  return acc;
}

function sourceFiles() {
  const acc = fs.readdirSync(ROOT).filter(f => /\.(css|js)$/.test(f) && !/^(_migrate|\.eleventy)/.test(f)).map(f => path.join(ROOT, f));
  walk(path.join(ROOT, 'src'), /\.(html|njk|md|css|js)$/, acc);
  walk(path.join(ROOT, 'admin'), /\.html$/, acc);
  return acc.filter(p => !EXEMPT.test(p));
}

// CSS 語境：CSS 檔整份；HTML 的 <style>、style=""／style=''、frontmatter extraStyles；
// JS（.js 檔與頁內 <script>）的 el.style.xxx = '值' 與 cssText 字串（2026-09-19 審閱補：單引號與 JS 都能繞過）
const kebab = s => s.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
function jsChunks(text) {
  const out = [];
  for (const m of text.matchAll(/\.style\.([a-zA-Z]+)\s*=\s*(['"`])([^'"`]*)\2\s*;?(\s*\/\*\s*design-ok:[^*]+\*\/)?/g)) out.push(`${kebab(m[1])}: ${m[3]};${m[4] || ''}`);
  // 例外註解可寫在字串內（每條宣告後）或整句後；整句後的 design-ok 視為整段放行
  for (const m of text.matchAll(/(?:cssText|setAttribute\(\s*['"]style['"]\s*,)\s*=?\s*(['"`])([^'"`]*)\1\s*\)?\s*;?(\s*\/\*\s*design-ok:[^*]+\*\/)?/g)) if (!m[3]) out.push(m[2]);
  return out;
}
function cssChunks(file, text) {
  if (file.endsWith('.css')) return [text];
  if (file.endsWith('.js')) return jsChunks(text);
  const out = [];
  for (const m of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) out.push(m[1]);
  for (const m of text.matchAll(/\bstyle="([^"]*)"/g)) out.push(m[1]);
  for (const m of text.matchAll(/\bstyle='([^']*)'/g)) out.push(m[1]);
  for (const m of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) out.push(...jsChunks(m[1]));
  const fm = text.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---/);   // 少數檔開頭有 BOM
  // 區塊最後一行緊貼 frontmatter 結尾的 ---，沒有換行，要一併收
  if (fm) { const x = (fm[1] + '\n').match(/^extraStyles:[ \t]*[|>][-+]?[ \t]*\r?\n((?:[ \t]+.*\r?\n|[ \t]*\r?\n)*)/m); if (x) out.push(x[1]); }
  return out;
}

const LIT_COLOR = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/;
function warnSource() {
  const warns = [];
  for (const f of sourceFiles()) {
    const rel = path.relative(ROOT, f);
    for (const chunk of cssChunks(f, fs.readFileSync(f, 'utf8'))) {
      for (const m of chunk.matchAll(/(?<![\w-])([a-z-]+)\s*:\s*([^;{}"]+);?(\s*\/\*\s*design-ok:[^*]+\*\/)?/g)) {
        const [, prop, raw, ok] = m, v = raw.replace(/\/\*[\s\S]*?\*\//g, '').trim();
        if (ok || /\/\*\s*design-ok:[^*]+\*\//.test(raw)) continue;  // 已寫明理由的例外（註解緊接在值後）
        if (prop.startsWith('--')) continue;                       // token 定義本身不算
        if (prop === 'line-height' && /^\d*\.?\d+$/.test(v) && v !== '0') warns.push(`${rel}  line-height: ${v} → var(--lh-*)`);
        else if (prop === 'letter-spacing' && /^-?\d*\.?\d+(em|px)/.test(v) && !/^0(em|px)?$/.test(v)) warns.push(`${rel}  letter-spacing: ${v} → var(--ls-*)`);
        else if (/^(margin|padding)(-(top|right|bottom|left))?$|^(row-|column-)?gap$/.test(prop)) {
          for (const x of v.matchAll(/(?<![\w.-])(-?\d*\.?\d+)px\b/g)) if (Math.abs(parseFloat(x[1])) > 2) warns.push(`${rel}  ${prop}: ${v} → var(--sp-*)`);
        } else if (/^(color|background|background-color|border.*|outline.*|box-shadow)$/.test(prop) && LIT_COLOR.test(v)) warns.push(`${rel}  ${prop}: ${v} → 色票 token`);
      }
    }
  }
  return [...new Set(warns)];
}

// ── 近似色（CIELAB ΔE76，只比 global.css 不透明色票）──
function lab(hex) {
  const h = hex.replace('#', ''); const c = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
    .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const x = (c[0] * .4124 + c[1] * .3576 + c[2] * .1805) / .95047, y = c[0] * .2126 + c[1] * .7152 + c[2] * .0722, z = (c[0] * .0193 + c[1] * .1192 + c[2] * .9505) / 1.08883;
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
function nearColors() {
  const g = fs.readFileSync(path.join(ROOT, 'global.css'), 'utf8');
  const toks = [...g.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/g)].map(m => [m[1], m[2]]);
  const out = [];
  for (let i = 0; i < toks.length; i++) for (let j = i + 1; j < toks.length; j++) {
    if (toks[i][1].toLowerCase() === toks[j][1].toLowerCase()) continue;  // 同值別名（語意分開）不算
    const d = Math.hypot(...lab(toks[i][1]).map((v, k) => v - lab(toks[j][1])[k]));
    if (d < 3) out.push(`${toks[i][0]} ${toks[i][1]} ≈ ${toks[j][0]} ${toks[j][1]}（ΔE ${d.toFixed(1)}）`);
  }
  return out;
}

// ── 建置後：未定義變數 ──
function checkOutput(outDir = path.join(ROOT, '_site')) {
  const bad = [], cssCache = {};
  const readCss = href => {
    const p = path.join(outDir, href.split(/[?#]/)[0]);
    if (!(p in cssCache)) cssCache[p] = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
    return cssCache[p];
  };
  for (const f of walk(outDir, /\.html$/)) {
    const rel = path.relative(outDir, f).replace(/\\/g, '/');
    if (EXEMPT.test(path.sep + rel.replace(/\//g, path.sep))) continue;
    const html = fs.readFileSync(f, 'utf8');
    let text = html;
    // 站內 CSS 與 JS：屬性順序不拘、相對路徑以頁面位置解析；外部網址略過
    const pageDir = '/' + path.posix.dirname(rel) + '/';
    const local = href => /^(https?:)?\/\//.test(href) ? null : path.posix.normalize(href.startsWith('/') ? href : pageDir + href);
    for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
      const tag = m[0]; if (!/rel=["']?stylesheet/i.test(tag)) continue;
      const h = (tag.match(/href=["']([^"']+)["']/i) || [])[1]; const p = h && local(h); if (p) text += '\n' + readCss(p);
    }
    for (const m of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) { const p = local(m[1]); if (p) text += '\n' + readCss(p); }
    text = text.replace(/\/\*[\s\S]*?\*\//g, '');                   // 註解裡的「--x:」不算定義
    const defined = new Set([...text.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));
    for (const m of text.matchAll(/setProperty\(\s*['"](--[\w-]+)/g)) defined.add(m[1]);
    const missing = new Set();
    for (const m of text.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) {
      const n = m[1];
      if (n.endsWith('-') || defined.has(n)) continue;            // --c-${k} 這類動態組名略過
      missing.add(n);
    }
    if (missing.size) bad.push(`${rel}  未定義：${[...missing].join(' ')}`);
  }
  return bad;
}

module.exports = { warnSource, nearColors, checkOutput };

if (require.main === module) {
  const w = warnSource(), n = nearColors(), b = checkOutput(process.argv[2]);
  console.log(`設計表：寫死值 ${w.length} 處${w.length ? '\n  ' + w.slice(0, 40).join('\n  ') : ''}`);
  if (w.length) process.exitCode = 1;
  console.log(`近似色（ΔE<3）：${n.length} 對${n.length ? '\n  ' + n.join('\n  ') : ''}`);
  if (b.length) { console.error(`未定義變數：${b.length} 頁\n  ` + b.join('\n  ')); process.exit(1); }
  console.log('未定義變數：無');
}
