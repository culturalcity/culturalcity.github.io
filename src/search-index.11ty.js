// 全站搜尋索引：build 時掃所有 collection + 列舉的 standalone 頁，輸出 /search-index.json
// 跟 src/minutes/search-index.json 平行存在；那個是 minutes 專用、有屆別/AGM 語義；
// 這個是全站、有 type 分類（公告/會議/財務/規約/指南）。

const fs = require('fs');
const path = require('path');

function htmlToPlainText(html) {
  if (!html) return '';
  return String(html)
    // 拋掉 script/style/註解
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // 丟導覽 chrome（不要進搜尋）
    .replace(/<a[^>]*class="[^"]*back-link[^"]*"[\s\S]*?<\/a>/gi, ' ')
    .replace(/<div[^>]*class="header-nav"[\s\S]*?<\/div>/gi, ' ')
    .replace(/<div[^>]*class="back-nav[^"]*"[\s\S]*?<\/div>/gi, ' ')
    .replace(/<nav[^>]*class="[^"]*breadcrumb[^"]*"[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<nav[^>]*class="m-nav[^"]*"[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<div[^>]*class="eyebrow"[^>]*>[\s\S]*?<\/div>/gi, ' ')
    .replace(/<div[^>]*class="header-eyebrow"[^>]*>[\s\S]*?<\/div>/gi, ' ')
    .replace(/<div[^>]*class="header-sub"[^>]*>[\s\S]*?<\/div>/gi, ' ')
    .replace(/<div[^>]*class="tabs"[\s\S]*?<\/div>/gi, ' ')
    .replace(/<button[\s\S]*?<\/button>/gi, ' ')
    // 標籤剝光、entity 還原
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripFrontmatter(raw) {
  if (!raw.startsWith('---')) return raw;
  const end = raw.indexOf('\n---', 3);
  if (end < 0) return raw;
  return raw.slice(end + 4).replace(/^\s*\n/, '');
}

function readPlain(inputPath) {
  try {
    const raw = fs.readFileSync(path.resolve(inputPath), 'utf8');
    return htmlToPlainText(stripFrontmatter(raw));
  } catch (e) {
    return '';
  }
}

function getDate(item) {
  // publishDate 優先（對住戶公開的日期）；fallback 到 date 或 displayDate
  const pd = item.data.publishDate;
  if (pd) return String(pd).replace(/\//g, '-').slice(0, 10);
  if (item.data.displayDate) return String(item.data.displayDate).replace(/\//g, '-').slice(0, 10);
  if (item.date instanceof Date) return item.date.toISOString().slice(0, 10);
  if (item.data.date) return String(item.data.date).slice(0, 10);
  return '';
}

// 排除：草稿、404、search 頁本身、admin 內部頁
function shouldExclude(item) {
  if (item.data.draft) return true;
  const url = String(item.data.permalink || item.url || '');
  if (!url || url === 'false') return true;
  if (url.startsWith('/admin/')) return true;
  if (url === '/404.html') return true;
  if (url === '/search.html') return true;
  return false;
}

module.exports = {
  data: {
    permalink: '/search-index.json',
    eleventyExcludeFromCollections: true,
    layout: null,
  },

  render(data) {
    const items = [];

    // ── 各 tag collection 掃描 ──
    const sources = [
      { tag: 'notice', type: 'notice', label: '公告' },
      { tag: 'minutes', type: 'minutes', label: '會議紀錄' },
      { tag: 'finance', type: 'finance', label: '財務月報' },
      { tag: 'regulation', type: 'regulation', label: '規約辦法' },
    ];

    sources.forEach(src => {
      const coll = (data.collections && data.collections[src.tag]) || [];
      coll.forEach(item => {
        if (shouldExclude(item)) return;
        items.push({
          url: item.url,
          title: item.data.titleZh || item.data.title || '',
          summary: item.data.summary || '',
          date: getDate(item),
          type: src.type,
          typeLabel: src.label,
          content: readPlain(item.inputPath),
        });
      });
    });

    // ── Standalone 頁面（無 collection tag、手動列舉）──
    const standalones = [
      { url: '/welcome/',                  inputPath: './src/welcome/index.html',          title: '新住戶須知',         type: 'guide', label: '新住戶須知' },
      { url: '/welcome/transition.html',   inputPath: './src/welcome/transition.html',     title: '從老社區搬過來？',    type: 'guide', label: '新住戶須知' },
      { url: '/directory/',                inputPath: './src/directory/index.html',        title: '社區廠商聯絡簿',     type: 'directory', label: '廠商聯絡簿' },
      { url: '/evacuation/',               inputPath: './src/evacuation/index.html',       title: '緊急避難圖',         type: 'evacuation', label: '緊急避難圖' },
      { url: '/utility/',                  inputPath: './src/utility/index.html',          title: '公共事業',           type: 'utility', label: '公共事業' },
      { url: '/utility/electricity-target.html', inputPath: './src/utility/electricity-target.html', title: '用電目標速查表', type: 'utility', label: '公共事業' },
      { url: '/net-zero/',                 inputPath: './src/net-zero/index.html',         title: '淨零新生活',         type: 'net-zero', label: '淨零新生活' },
      { url: '/transport/',                inputPath: './src/transport/index.html',        title: '綠色運輸',           type: 'transport', label: '綠色運輸' },
    ];

    standalones.forEach(p => {
      const content = readPlain(p.inputPath);
      if (!content) return;
      items.push({
        url: p.url,
        title: p.title,
        summary: '',
        date: '',
        type: p.type,
        typeLabel: p.label,
        content,
      });
    });

    // 按日期降冪；同日期或無日期者保持原順序（穩定排序）
    items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    return JSON.stringify(items);
  },
};
