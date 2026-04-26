// 批次轉換財務月報
const fs = require('fs');
const path = require('path');

const FIN_DIR = path.join(__dirname, 'finance');
const SRC_DIR = path.join(__dirname, 'src', 'finance');
fs.mkdirSync(SRC_DIR, { recursive: true });

const files = fs.readdirSync(FIN_DIR).filter(f =>
  /^(\d{4}-\d{2}|\d{4}-annual)\.html$/.test(f)
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

// finance.css 涵蓋的 selectors（用於過濾 inline style）
const COVERED = new Set([
  ':root', 'body', '.header', '.header::before', '.header-row',
  '.back-nav', '.back-nav a', '.back-nav a::before', '.back-nav a:hover',
  '.header h1', '.header .period', '.header-right', '.header-right strong',
  '.month-nav', '.month-nav a, .month-nav span', '.month-nav .disabled',
  '.month-nav .center', '.month-nav a:hover',
  '.tabs', '.tab', '.tab:hover', '.tab.active',
  '.tab-content', '.tab-content.active', '.main', '.sl', '.sl::after',
  '.kpi-row', '.kpi-card', '.kpi-card::before',
  '.kpi-card.g::before', '.kpi-card.r::before', '.kpi-card.gd::before', '.kpi-card.b::before',
  '.kpi-title', '.kpi-val', '.kpi-val.pos', '.kpi-val.neg',
  '.badge', '.badge.up', '.badge.dn', '.badge.nt',
  '.grid2', '.grid3', '.panel', '.panel.mb',
  '.ph', '.tag', '.tag.b', '.tag.g', '.pb',
  'table', 'th', 'th:not(:first-child)', 'td', 'td:not(:first-child)',
  'tr:last-child td', 'tr.tot td', '.dp', '.dn2', '.dz',
  '.sumbox', '.sumbox::before', '.sumbox h3', '.si', '.si .bul',
  '.alert', '.ok', '.ch', '.btn', '.btn:hover',
  // 重複出現的個別屬性
  '.tab:hover', '.tab.active'
]);

for (const file of files) {
  const fullPath = path.join(FIN_DIR, file);
  const html = fs.readFileSync(fullPath, 'utf8');

  try {
    const titleMatch = html.match(/<title>(.+?)<\/title>/);
    if (!titleMatch) throw new Error('找不到 title');
    const title = titleMatch[1].replace(/^閱大安[・\s]*/, '').trim();

    // 抓 body 內所有內容
    const bodyMatch = html.match(/<body>([\s\S]*?)<\/body>/);
    if (!bodyMatch) throw new Error('找不到 body');
    let bodyContent = bodyMatch[1].trim();

    // 過濾掉 finance.css 已涵蓋的 inline styles，保留特殊樣式
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
layout: finance.njk
permalink: /finance/${slug}.html
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
