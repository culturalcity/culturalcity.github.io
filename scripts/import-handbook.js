// 一次性匯入腳本：把 raw/閱大安總幹事手冊-增補版-v2.md 轉成
// src/admin/handbook.md（11ty 可吃，套 handbook.njk）
//
// 用法： node scripts/import-handbook.js
//
// 做的事：
// 1. 剝掉 raw 檔的 frontmatter 與文件級 H1
// 2. 把 Notion 殘留 <aside>💡 ...回到頁面頂端... </aside> 塊清掉
//    若 aside 內含實際內容（譬如 > 引用塊），改寫成標準 markdown blockquote
// 3. ![[image N.png]] Obsidian 連結 → 圖片缺漏註記（HTML inline）
// 4. 加上 handbook.njk frontmatter

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'raw', '閱大安總幹事手冊-增補版-v2.md');
const DST = path.join(__dirname, '..', 'src', 'admin', 'handbook.md');

let md = fs.readFileSync(SRC, 'utf8');

// 剝 UTF-8 BOM（raw 檔從 Notion 匯出帶 BOM，會卡到 frontmatter 正規表達式）
if (md.charCodeAt(0) === 0xFEFF) md = md.slice(1);

// ── 1. 剝 frontmatter（第一個 --- 到第二個 ---）
md = md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n+/, '');

// ── 2. 剝文件級 H1「# 閱大安總幹事手冊」
md = md.replace(/^#\s+閱大安總幹事手冊\s*\n+/m, '');

// ── 3. 處理 <aside>💡 ... </aside> 區塊
//    分兩類：純「回到頁面頂端」（直接刪）vs 有實質內容（轉 blockquote 並 dedent）
md = md.replace(/<aside>\s*\n?\s*💡\s*\n([\s\S]*?)<\/aside>/g, function (m, inner) {
  // 拆行、剝 > 前綴、計算共同縮排再 dedent
  let lines = inner.split('\n').map(function (l) {
    return l.replace(/^\s*>\s?/, '');  // 剝 markdown blockquote prefix
  });
  // 去掉首尾空行
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();

  // 如果只剩「回到頁面頂端」相關殘留 → 整塊刪掉
  const joined = lines.join('\n');
  if (/回到頁面頂端/.test(joined) && !/[^\s]/.test(joined.replace(/\[[^\]]*回到頁面頂端[^\]]*\]\([^)]*\)|\[\*\*⬆️\*\*\]\([^)]*\)/g, ''))) {
    return '';
  }

  // 計算非空行的共同 leading whitespace 長度
  const nonempty = lines.filter(function (l) { return l.trim(); });
  let minIndent = Infinity;
  nonempty.forEach(function (l) {
    const m2 = l.match(/^(\s*)/);
    if (m2 && m2[1].length < minIndent) minIndent = m2[1].length;
  });
  if (!isFinite(minIndent)) minIndent = 0;

  // dedent + 包 blockquote
  const dedented = lines.map(function (l) {
    return l.trim() ? '> ' + l.slice(minIndent) : '>';
  }).join('\n');

  return '\n' + dedented + '\n';
});

// ── 4. ![[image N.png]] Obsidian 連結直接移除整行（圖檔不匯入）
md = md.replace(/^[ \t]*!\[\[[^\]]+\]\][ \t]*\n/gm, '');

// ── 5. 收斂多餘空行（連續 3 個以上 → 2 個）
md = md.replace(/\n{3,}/g, '\n\n');

// ── 6. 加 frontmatter
const today = new Date();
const ymd = today.getFullYear() + '-' +
  String(today.getMonth() + 1).padStart(2, '0') + '-' +
  String(today.getDate()).padStart(2, '0');

const frontmatter = [
  '---',
  'layout: handbook.njk',
  'permalink: /admin/handbook/index.html',
  'title: 閱大安總幹事手冊',
  'lastUpdate: ' + ymd,
  'eleventyExcludeFromCollections: true',
  '---',
  '',
].join('\n');

fs.mkdirSync(path.dirname(DST), { recursive: true });
fs.writeFileSync(DST, frontmatter + md.trim() + '\n', 'utf8');

console.log('✓ wrote ' + DST + ' (' + (md.length / 1024).toFixed(1) + ' KB)');
