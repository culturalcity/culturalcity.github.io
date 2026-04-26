// 批次轉換規約：舊 HTML → 新 11ty 格式
const fs = require('fs');
const path = require('path');

const REG_DIR = path.join(__dirname, 'regulations');
const SRC_DIR = path.join(__dirname, 'src', 'regulations');
fs.mkdirSync(SRC_DIR, { recursive: true });

const files = fs.readdirSync(REG_DIR).filter(f => f.startsWith('regulations-') && f.endsWith('.html'));

let converted = 0;
let skipped = [];

function escapeYaml(s) {
  if (!s) return s;
  if (/[:#&*!|>'"@`%]/.test(s)) {
    return `'${s.replace(/'/g, "''")}'`;
  }
  return s;
}

for (const file of files) {
  const fullPath = path.join(REG_DIR, file);
  const html = fs.readFileSync(fullPath, 'utf8');

  try {
    // 1. title
    const titleMatch = html.match(/<title>閱大安・(.+?)<\/title>/);
    if (!titleMatch) throw new Error('找不到 title');
    const title = titleMatch[1];

    // 2. eyebrow（COMMUNITY REGULATIONS 等）
    const eyebrowMatch = html.match(/<div class="eyebrow">([^<]+)<\/div>/);
    const eyebrow = eyebrowMatch ? eyebrowMatch[1].trim() : '';

    // 3. version & last updated
    const pillMatches = [...html.matchAll(/<span class="meta-pill">([^<]+)<\/span>/g)];
    let version = '', lastUpdated = '';
    for (const m of pillMatches) {
      const txt = m[1].trim();
      if (txt.startsWith('v') || /^v?\d/i.test(txt)) version = txt;
      else if (txt.includes('更新')) lastUpdated = txt.replace(/^最後更新\s*/, '');
    }

    // 4. main 內容（從 <div class="main"> 到對應的 </div>，但要小心巢狀）
    // 簡化做法：抓 <div class="main"> 之後到 </body> 前的整段，但去掉 footer 後的 </div>
    const mainMatch = html.match(/<div class="main">([\s\S]*?)<\/div>\s*<\/body>/);
    if (!mainMatch) throw new Error('找不到 main 區塊');
    let mainContent = mainMatch[1].trim();
    // 移除 footer（如果有單獨的 .footer，保留也可以）
    // 我們直接保留所有內容

    // 5. 抓 regulations-specific styles（過濾已被 regulations.css 涵蓋的）
    const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
    let extraStyles = '';
    if (styleMatch) {
      const allStyles = styleMatch[1];
      const coveredSelectors = new Set([
        ':root', 'body', '.header', '.header::before', '.header-inner',
        '.back', '.back::before', '.back:hover', '.eyebrow', '.header h1', '.header-meta',
        '.meta-pill', '.main',
        '.rev-summary', '.rev-summary:hover', '.rev-table',
        '.rev-table th', '.rev-table td', '.rev-table tr:last-child td',
        '.doc-body', '.chapter', '.chapter:first-child', '.annex',
        '.art-block', '.art-block:first-child', '.art-title', '.art-num',
        '.art-name', '.art-body', '.art-body p', '.art-body p:last-child',
        '.art-body p.indent-1', '.art-body p.indent-2', '.art-body p.indent-3',
        '.art-body p.indent-1-cont', '.art-body p.indent-2-cont', '.art-body p.indent-3-cont',
        '.footer'
      ]);
      const uniqueRules = [];
      const ruleRegex = /(@media[^{]*\{[^}]*(?:\{[^}]*\}[^}]*)*\}|[^{}]+\{[^}]*\})/g;
      let r;
      while ((r = ruleRegex.exec(allStyles)) !== null) {
        const rule = r[0].trim();
        if (!rule) continue;
        const selMatch = rule.match(/^([^{]+)\{/);
        if (!selMatch) continue;
        const selector = selMatch[1].trim();
        if (selector.startsWith('@media')) continue;
        if (coveredSelectors.has(selector)) continue;
        uniqueRules.push(rule);
      }
      if (uniqueRules.length > 0) {
        extraStyles = uniqueRules.map(r => r.replace(/\s+/g, ' ').trim()).join('\n  ');
      }
    }

    // 6. 組 frontmatter
    const slug = file.replace(/\.html$/, '');
    let frontmatter = `---
layout: regulations.njk
permalink: /regulations/${slug}.html
title: ${escapeYaml(title)}`;
    if (eyebrow) frontmatter += `\neyebrow: ${escapeYaml(eyebrow)}`;
    if (version) frontmatter += `\nversion: ${escapeYaml(version)}`;
    if (lastUpdated) frontmatter += `\nlastUpdated: ${escapeYaml(lastUpdated)}`;
    if (extraStyles) frontmatter += `\nextraStyles: |\n  ${extraStyles}`;
    frontmatter += '\n---\n';

    // 7. 寫入
    const outPath = path.join(SRC_DIR, file);
    fs.writeFileSync(outPath, frontmatter + mainContent);
    converted++;
    console.log(`✓ ${file}`);
  } catch (e) {
    skipped.push({ file, reason: e.message });
    console.log(`✗ ${file} → ${e.message}`);
  }
}

console.log(`\n完成：成功 ${converted}，跳過 ${skipped.length}`);
if (skipped.length > 0) {
  console.log('\n跳過：');
  skipped.forEach(s => console.log(`  - ${s.file}: ${s.reason}`));
}
