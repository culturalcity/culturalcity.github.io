// 批次轉換會議紀錄
const fs = require('fs');
const path = require('path');

const MIN_DIR = path.join(__dirname, 'minutes');
const SRC_DIR = path.join(__dirname, 'src', 'minutes');
fs.mkdirSync(SRC_DIR, { recursive: true });

const files = fs.readdirSync(MIN_DIR).filter(f =>
  f.startsWith('minutes-') && f.endsWith('.html')
);

let converted = 0;
let skipped = [];

function escapeYaml(s) {
  if (!s) return s;
  if (/[:#&*!|>'"@`%]/.test(s)) {
    return `'${s.replace(/'/g, "''")}'`;
  }
  return s;
}

const COVERED = new Set([
  ':root', 'body', '.header', '.header::before', '.header-inner',
  '.header-nav', '.back-link', '.back-link:hover', '.back-link::before',
  '.finance-link', '.finance-link:hover',
  '.eyebrow', '.header h1', '.header-sub', '.header-rule',
  '.meta-grid', '.meta-cell', '.meta-cell:nth-child(4n)',
  '.meta-cell:nth-last-child(-n+4)', '.meta-label', '.meta-val',
  '.tabs', '.tab-btn', '.tab-btn:hover', '.tab-btn.active',
  '.main', '.tab-content', '.tab-content.active'
]);

for (const file of files) {
  const fullPath = path.join(MIN_DIR, file);
  const html = fs.readFileSync(fullPath, 'utf8');

  try {
    const titleMatch = html.match(/<title>閱大安・(.+?)<\/title>/);
    if (!titleMatch) throw new Error('找不到 title');
    const title = titleMatch[1];

    const bodyMatch = html.match(/<body>([\s\S]*?)<\/body>/);
    if (!bodyMatch) throw new Error('找不到 body');
    const bodyContent = bodyMatch[1].trim();

    const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
    let extraStyles = '';
    if (styleMatch) {
      const allStyles = styleMatch[1];
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
        if (COVERED.has(selector)) continue;
        uniqueRules.push(rule);
      }
      if (uniqueRules.length > 0) {
        extraStyles = uniqueRules.map(r => r.replace(/\s+/g, ' ').trim()).join('\n  ');
      }
    }

    const slug = file.replace(/\.html$/, '');
    let frontmatter = `---
layout: minutes.njk
permalink: /minutes/${slug}.html
title: ${escapeYaml(title)}`;
    if (extraStyles) frontmatter += `\nextraStyles: |\n  ${extraStyles}`;
    frontmatter += '\n---\n';

    const outPath = path.join(SRC_DIR, file);
    fs.writeFileSync(outPath, frontmatter + bodyContent);
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
