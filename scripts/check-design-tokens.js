// 設計表守門（2026-09-19 產品設計稽核後新增；規則見 SHARED-CORE「成品開工先定設計表」與 VI.md「設計表」）
//
// 兩段檢查：
//   warnSource()  建置前：CSS 語境（*.css、<style>、style=""、frontmatter extraStyles）裡寫死的
//                 顏色／行高／字距／間距 → 擋建置（2026-09-19 審閱後由警示改為阻擋）。真有例外，在該宣告後
//                 緊接註解 /* design-ok: 理由 */ 即放行（理由必寫，對應 SHARED-CORE「超過要寫理由」）；
//                 並列出 global.css 色票中 ΔE<3（肉眼分不出）的近似色對。
//   jsColors()    建置前：圖表 JS（<script> 與站內 *.js）裡的色碼字面值 → 擋建置（2026-09-21 新增）。
//                 圖表色一律用 viz.js 的 VIZ.*／VIZ.token() 讀 global.css 色盤：色碼寫在 JS 就等於色盤有兩份，
//                 改色只改一邊就會走鐘——用電目標頁的警戒線圖例是 #A8481F、線卻畫成 #C45A30，正是這樣來的。
//                 2026-09-22 起**一律擋**：值即使與色盤相同也不放行（色盤改了、JS 沒改就分岔）。
//                 要留寫死值就在**同一行**寫 `// design-ok: 理由`（一行有多個色碼時整行放行，例：QR code 的黑白）。
//   dataColors()  建置前：utility/data/*.json 的顏色欄位（backgroundColor／borderColor／color）與色碼 → 擋建置
//                 （2026-09-22 新增）。圖表年度系列色改由 src/utility/index.html 的 seriesColor() 從色盤指派，
//                 資料檔只存數字；帳單 skill 若把色寫回來，這裡會擋。
//   checkOutput() 建置後：逐頁把「頁面本身＋它連結的站內 CSS」合起來看，
//                 用了 var(--x)（無 fallback）卻整頁都沒定義 → 擋建置。
//                 （2026-09 實例：年報的 --amber、公告列表的 --c-staff 從未定義，標記點與 pill 靜默失色。）
// 豁免：AGM 簡報 deck（vw 單位另案）、admin/utility 水電公告產生器（卡片設計凍結值）、images/。
// 單獨執行：node scripts/check-design-tokens.js [建置輸出資料夾，預設 _site]
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const EXEMPT = /agm-5-1-deck\.html$|[\\/]admin[\\/]utility[\\/]|[\\/]images[\\/]/;
// 圖表色檢查的額外豁免：**2026-07 以前**的財務月報與年報是已發布凍結的存檔，圖表色寫在當月頁內，
// 重寫它們只會讓存檔與當初發布的樣子不一致，故永久豁免。
// 2026-08 起的月報已改用 VIZ.cat()／VIZ.*（分類色盤在 global.css），不在豁免內——月報是「複製上個月」
// 產生的，所以新月份會自然沿用 token；skill 的 SKILL.md 也已註明不要複製色碼。
const EXEMPT_JS_COLOR = /[\\/]finance[\\/](2025-\d{2}|2026-0[1-7]|\d{4}-annual|fy\d-annual)\.html$/;

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

// ── 圖表 JS 裡的色碼字面值（2026-09-21）──
const norm = c => c.toLowerCase().replace(/\s+/g, '');
function paletteValues() {
  const g = fs.readFileSync(path.join(ROOT, 'global.css'), 'utf8');
  const vals = new Set(['#fff', '#ffffff', '#000', '#000000', 'transparent', 'currentcolor', 'none']);
  for (const m of g.matchAll(/--[\w-]+\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))/g)) {
    vals.add(norm(m[1]));
    const h = /^#([0-9a-fA-F]{6})$/.exec(m[1]);               // #RRGGBB 的 rgb()／rgba() 等值也算（VIZ.alpha 產出的形狀）
    if (h) { const n = parseInt(h[1], 16); vals.add(`rgb(${n >> 16 & 255},${n >> 8 & 255},${n & 255})`); }
  }
  return vals;
}
function jsColors() {
  const bad = [], pal = paletteValues();
  for (const f of sourceFiles()) {
    if (EXEMPT_JS_COLOR.test(f)) continue;
    const rel = path.relative(ROOT, f), text = fs.readFileSync(f, 'utf8');
    const blocks = f.endsWith('.js') ? [text]
      : [...text.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    for (const b of blocks) {
      // 例外註解寫在同一行、色碼之後即可（中間允許 ; , ) } 等收尾符號）
      for (const m of b.matchAll(/(['"`])(#[0-9a-fA-F]{3,8}|rgba?\([\d.,\s]*\))\1[^\S\n]*[;,)\]}]*[^\S\n]*(\/[/*]\s*design-ok:[^\n*]*)?/g)) {
        if (m[3]) continue;                                    // 寫了理由
        // 一行內有多個色碼時（例：QR code 的黑白兩色），理由寫在行末即整行放行
        const lineEnd = b.indexOf('\n', m.index), line = b.slice(b.lastIndexOf('\n', m.index) + 1, lineEnd < 0 ? undefined : lineEnd);
        if (/design-ok:/.test(line)) continue;
        // 2026-09-22 冰兒審閱：原本「值等於色盤」就放行，但那仍是寫死值——改色時色盤變、JS 不變就分岔。
        // 一律要求走 VIZ.*；真要寫死就寫 design-ok 理由。
        const v = norm(m[2]);
        bad.push(`${rel}  圖表色寫死 ${m[2]}${pal.has(v) || pal.has(v.replace(/,1\)$/, ')')) ? '（值雖與色盤相同，仍會在改色時分岔）' : ''} → 用 VIZ.*／VIZ.token()（色盤在 global.css）`);
      }
    }
  }
  return [...new Set(bad)];
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

// 資料檔不得存色（2026-09-22 冰兒審閱指出）：utility/data/*.json 的年度系列色已改由色盤指派，
// 但帳單 skill 或手動編輯仍可能把 backgroundColor／色碼寫回去，靠文件約束不夠，這裡直接擋。
function dataColors() {
  const bad = [], dirs = [path.join(ROOT, 'utility', 'data'), path.join(ROOT, 'src', 'utility', 'data')];
  for (const d of dirs) for (const f of walk(d, /\.json$/)) {
    const rel = path.relative(ROOT, f), t = fs.readFileSync(f, 'utf8');
    // _comment 是給人看的說明（裡面會提到 backgroundColor 這個字），檢查前先把該欄位的值整段挖掉，
    // 但只挖 _comment 自己——正文若出現同一個色碼仍要擋（2026-09-22 冰兒審閱指出原本用字串比對會誤豁免）。
    const body = t.replace(/"_comment"\s*:\s*"(?:[^"\\]|\\.)*"/g, '"_comment":""');
    for (const m of body.matchAll(/"(backgroundColor|borderColor|color)"\s*:/g)) bad.push(`${rel}  資料檔存了顏色欄位 "${m[1]}" → 年度系列色由 src/utility/index.html 的 seriesColor() 指派`);
    for (const m of body.matchAll(/"(#[0-9a-fA-F]{3,8}|rgba?\([\d.,\s]*\))"/g)) bad.push(`${rel}  資料檔存了色碼 ${m[1]}`);
  }
  return [...new Set(bad)];
}

module.exports = { warnSource, nearColors, checkOutput, jsColors, dataColors };

if (require.main === module) {
  const w = warnSource(), j = jsColors(), dc = dataColors(), n = nearColors(), b = checkOutput(process.argv[2]);
  console.log(`設計表：寫死值 ${w.length} 處${w.length ? '\n  ' + w.slice(0, 40).join('\n  ') : ''}`);
  if (w.length) process.exitCode = 1;
  console.log(`圖表 JS 色碼：${j.length} 處${j.length ? '\n  ' + j.slice(0, 40).join('\n  ') : ''}`);
  if (j.length) process.exitCode = 1;
  console.log(`資料檔顏色：${dc.length} 處${dc.length ? '\n  ' + dc.slice(0, 20).join('\n  ') : ''}`);
  if (dc.length) process.exitCode = 1;
  console.log(`近似色（ΔE<3）：${n.length} 對${n.length ? '\n  ' + n.join('\n  ') : ''}`);
  if (b.length) { console.error(`未定義變數：${b.length} 頁\n  ` + b.join('\n  ')); process.exit(1); }
  console.log('未定義變數：無');
}
