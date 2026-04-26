// 批次轉換獨特頁面（welcome、utility、index 等）
// 這些頁面結構各異，只用 base.njk 包頭尾，內容和樣式保持不動
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

// 要轉換的頁面清單：[來源路徑, 目標 src 路徑, permalink]
const TARGETS = [
  // 主首頁
  ['index.html', 'src/index.html', '/index.html'],
  // 各分類首頁
  ['notice/index.html', 'src/notice/index.html', '/notice/index.html'],
  ['finance/index.html', 'src/finance/index.html', '/finance/index.html'],
  ['minutes/index.html', 'src/minutes/index.html', '/minutes/index.html'],
  ['regulations/index.html', 'src/regulations/index.html', '/regulations/index.html'],
  // welcome
  ['welcome/index.html', 'src/welcome/index.html', '/welcome/index.html'],
  // utility
  ['utility/index.html', 'src/utility/index.html', '/utility/index.html'],
  ['utility/electricity-target.html', 'src/utility/electricity-target.html', '/utility/electricity-target.html'],
  ['utility/electricity-trend.html', 'src/utility/electricity-trend.html', '/utility/electricity-trend.html'],
];

function escapeYaml(s) {
  if (!s) return s;
  if (/[:#&*!|>'"@`%]/.test(s)) {
    return `'${s.replace(/'/g, "''")}'`;
  }
  return s;
}

let converted = 0;
let skipped = [];

for (const [src, dest, permalink] of TARGETS) {
  const srcPath = path.join(ROOT, src);
  const destPath = path.join(ROOT, dest);

  if (!fs.existsSync(srcPath)) {
    skipped.push({ file: src, reason: '檔案不存在' });
    console.log(`✗ ${src} → 檔案不存在`);
    continue;
  }

  try {
    const html = fs.readFileSync(srcPath, 'utf8');

    const titleMatch = html.match(/<title>(.+?)<\/title>/);
    const title = titleMatch ? titleMatch[1].replace(/^閱大安[・\s]*/, '').trim() : '頁面';

    // 抓 <head> 內的所有 <script> 和 <link>（除了 favicon、global.css）
    // 跟 inline <style>
    const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
    const extraStyles = styleMatch ? styleMatch[1].trim() : '';

    // 抓 <head> 內的非樣式 <script src=...> tag（保留 CDN 引入）
    const scriptTagsInHead = [];
    const headMatch = html.match(/<head>([\s\S]*?)<\/head>/);
    if (headMatch) {
      const scriptRegex = /<script\s+src=["']([^"']+)["'][^>]*><\/script>/g;
      let s;
      while ((s = scriptRegex.exec(headMatch[1])) !== null) {
        scriptTagsInHead.push(s[0]);
      }
    }

    // 抓 body 內容
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/);
    if (!bodyMatch) throw new Error('找不到 body');
    const bodyContent = bodyMatch[1].trim();

    // 組 frontmatter
    let frontmatter = `---
layout: base.njk
permalink: ${permalink}
title: ${escapeYaml(title)}`;

    if (scriptTagsInHead.length > 0) {
      frontmatter += `\nextraHead: |\n  ${scriptTagsInHead.join('\n  ')}`;
    }

    if (extraStyles) {
      // 把多行壓成單行讓 YAML 友善
      const compact = extraStyles
        .split('\n')
        .map(l => l.trimEnd())
        .filter(l => l.trim())
        .join('\n  ');
      frontmatter += `\nextraStyles: |\n  ${compact}`;
    }

    frontmatter += '\n---\n';

    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, frontmatter + bodyContent);
    converted++;
    console.log(`✓ ${src}`);
  } catch (e) {
    skipped.push({ file: src, reason: e.message });
    console.log(`✗ ${src} → ${e.message}`);
  }
}

console.log(`\n完成：成功 ${converted}，跳過 ${skipped.length}`);
if (skipped.length > 0) {
  console.log('\n跳過：');
  skipped.forEach(s => console.log(`  - ${s.file}: ${s.reason}`));
}
