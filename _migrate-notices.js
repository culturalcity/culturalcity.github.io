// 批次轉換公告：舊 HTML → 新 11ty 格式
// 一次性遷移腳本，跑完即可刪除

const fs = require('fs');
const path = require('path');

const NOTICE_DIR = path.join(__dirname, 'notice');
const SRC_DIR = path.join(__dirname, 'src', 'notice');

// 確保 src/notice/ 存在
fs.mkdirSync(SRC_DIR, { recursive: true });

// 取得所有 .html 檔案（排除 index.html）
const files = fs.readdirSync(NOTICE_DIR).filter(f => f.endsWith('.html') && f !== 'index.html');

let converted = 0;
let skipped = [];

for (const file of files) {
  const fullPath = path.join(NOTICE_DIR, file);
  const html = fs.readFileSync(fullPath, 'utf8');

  try {
    // 1. 抓 title (zh)
    const titleMatch = html.match(/<title>閱大安・(.+?)<\/title>/);
    if (!titleMatch) throw new Error('找不到 title');
    const titleZh = titleMatch[1];

    // 2. 抓三語標題（從 h1 內 data-lang-text）
    const titleZhAlt = html.match(/<span data-lang-text="zh">([^<]+)<\/span>/);
    const titleEnAlt = html.match(/<span data-lang-text="en"[^>]*>([^<]+)<\/span>/);
    const titleJaAlt = html.match(/<span data-lang-text="ja"[^>]*>([^<]+)<\/span>/);
    const titleZhFinal = (titleZhAlt && titleZhAlt[1]) || titleZh;
    const titleEnFinal = (titleEnAlt && titleEnAlt[1]) || titleZh;
    const titleJaFinal = (titleJaAlt && titleJaAlt[1]) || titleZh;

    // 3. 抓日期（YYYY/MM/DD 格式）
    const dateMatch = html.match(/<span>(\d{4}\/\d{2}\/\d{2})<\/span>/);
    if (!dateMatch) throw new Error('找不到日期');
    const displayDate = dateMatch[1];

    // 4. 抓類型 pill（pill-work / pill-rule / pill-event / pill-meeting / pill-safety）
    const pillMatch = html.match(/class="type-pill (pill-\w+)"/);
    const pillType = pillMatch ? pillMatch[1].replace('pill-', '') : 'work';

    // 5. 抓類型文字（zh from id="type-label" textContent，或從 typeMap 解析）
    const typeMapMatch = html.match(/typeMap\s*=\s*\{[^}]*zh:'([^']+)'[^}]*en:'([^']+)'[^}]*ja:'([^']+)'/);
    let typeZh = '通知', typeEn = 'Notice', typeJa = 'お知らせ';
    if (typeMapMatch) {
      typeZh = typeMapMatch[1];
      typeEn = typeMapMatch[2];
      typeJa = typeMapMatch[3];
    } else {
      // 退而求其次：抓 id="type-label" 的內容
      const labelMatch = html.match(/id="type-label"[^>]*>([^<]+)</);
      if (labelMatch) typeZh = labelMatch[1].trim();
    }

    // 6. 抓 .lang-block 三段內容（用深度追蹤找配對的 </div>）
    const blocks = extractLangBlocks(html);
    if (blocks.length < 3) throw new Error(`找到 ${blocks.length} 個 lang-block，預期 3 個`);

    // 7. 不額外加 footer：每個 lang-block 內已經有對應語言的 footer
    const footerHtml = '';

    // 8. 抓 notice-specific styles（只保留 notice.css 沒有涵蓋的）
    const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
    let extraStyles = '';
    if (styleMatch) {
      const allStyles = styleMatch[1];
      // notice.css 已涵蓋的 selector（用整段比對前綴）
      const coveredSelectors = new Set([
        ':root', 'body', '.header', '.header::before', '.header-inner',
        '.back', '.back::before', '.back:hover', '.header h1', '.header-meta',
        '.type-pill', '.pill-work', '.pill-rule', '.pill-event', '.pill-meeting', '.pill-safety',
        '.lang-bar', '.lang-bar-inner', '.lang-btn', '.lang-btn:hover', '.lang-btn.active',
        '.main', '.lang-block', '.lang-block.active',
        '.sec', '.sec-label', '.sec-label::after',
        '.note', '.footer'
      ]);
      const uniqueRules = [];
      // 拆每個規則（@media 與一般規則）
      const ruleRegex = /(@media[^{]*\{[^}]*(?:\{[^}]*\}[^}]*)*\}|[^{}]+\{[^}]*\})/g;
      let r;
      while ((r = ruleRegex.exec(allStyles)) !== null) {
        const rule = r[0].trim();
        if (!rule) continue;
        // 抓出 selector（{ 之前的部分）
        const selMatch = rule.match(/^([^{]+)\{/);
        if (!selMatch) continue;
        const selector = selMatch[1].trim();
        // 若是 @media，跳過（只有 600px 那條，已在 notice.css）
        if (selector.startsWith('@media')) continue;
        // 若 selector 完全等於 covered selector 之一，跳過
        if (coveredSelectors.has(selector)) continue;
        uniqueRules.push(rule);
      }
      if (uniqueRules.length > 0) {
        // 把多行 CSS 規則壓成單行（去掉換行和多餘空白），讓 YAML 縮排不會出錯
        extraStyles = uniqueRules
          .map(r => r.replace(/\s+/g, ' ').trim())
          .join('\n  ');
      }
    }

    // 9. 組合 frontmatter
    const slug = file.replace(/\.html$/, '');
    let frontmatter = `---
layout: notice.njk
permalink: /notice/${slug}.html
title: ${titleZh}
titleZh: ${titleZhFinal}
titleEn: ${escapeYaml(titleEnFinal)}
titleJa: ${escapeYaml(titleJaFinal)}
displayDate: ${displayDate}
typeZh: ${typeZh}
typeEn: ${escapeYaml(typeEn)}
typeJa: ${escapeYaml(typeJa)}
pillType: ${pillType}`;

    if (extraStyles) {
      frontmatter += `\nextraStyles: |\n  ${extraStyles}`;
    }
    frontmatter += '\n---\n';

    // 10. 組合內容（三個 lang-block + footer）
    const content = blocks.map(b =>
      `<div class="lang-block${b.lang === 'zh' ? ' active' : ''}" data-lang="${b.lang}">\n${b.content}\n</div>`
    ).join('\n\n') + footerHtml;

    // 11. 寫入 src/notice/
    const outPath = path.join(SRC_DIR, file);
    fs.writeFileSync(outPath, frontmatter + content);
    converted++;
    console.log(`✓ ${file}`);
  } catch (e) {
    skipped.push({ file, reason: e.message });
    console.log(`✗ ${file} → ${e.message}`);
  }
}

function escapeYaml(s) {
  // 若包含 : # & * ! | > ' " % @ ` 等 YAML 特殊字元，用單引號包起來
  if (/[:#&*!|>'"@`%]/.test(s)) {
    return `'${s.replace(/'/g, "''")}'`;
  }
  return s;
}

// 用深度追蹤找出 .lang-block 的配對 </div>
function extractLangBlocks(html) {
  const blocks = [];
  const openRegex = /<div class="lang-block[^"]*" data-lang="(zh|en|ja)">/g;
  let m;
  while ((m = openRegex.exec(html)) !== null) {
    const lang = m[1];
    const startIdx = m.index + m[0].length;
    // 從 startIdx 開始，計算 <div...> 與 </div> 的深度，初始為 1
    let depth = 1;
    let i = startIdx;
    const tagRegex = /<\/?div[\s>]/g;
    tagRegex.lastIndex = startIdx;
    let t;
    while ((t = tagRegex.exec(html)) !== null) {
      if (t[0].startsWith('</')) {
        depth--;
        if (depth === 0) {
          const content = html.slice(startIdx, t.index).trim();
          blocks.push({ lang, content });
          break;
        }
      } else {
        depth++;
      }
    }
  }
  return blocks;
}

console.log(`\n完成：成功 ${converted}，跳過 ${skipped.length}`);
if (skipped.length > 0) {
  console.log('\n跳過的檔案：');
  skipped.forEach(s => console.log(`  - ${s.file}: ${s.reason}`));
}
