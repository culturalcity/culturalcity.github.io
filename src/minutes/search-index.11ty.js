// 在 11ty build 時掃描所有會議紀錄，產出單一 JSON 給前端搜尋用。
// 輸出位置：/minutes/search-index.json
//
// 內容欄位：
//   url      — 頁面網址（給連結用）
//   title    — 標題（前端列顯示用）
//   date     — 開會日期 YYYY-MM-DD
//   term     — 屆別（從 permalink 抓）
//   isAgm    — 是否區權人會議
//   content  — 從原始 HTML 抽出的純文字（搜尋用）

const fs = require('fs');
const path = require('path');

function htmlToPlainText(html) {
  if (!html) return '';
  return String(html)
    // 先丟 script/style/註解
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // 丟導覽 chrome（不要進搜尋）：back-link、eyebrow、header-sub、tabs、buttons
    // 這些元素內無巢狀同名 tag，用 lazy match 安全
    .replace(/<a[^>]*class="[^"]*back-link[^"]*"[\s\S]*?<\/a>/gi, ' ')
    .replace(/<div[^>]*class="header-nav"[\s\S]*?<\/div>/gi, ' ')
    .replace(/<div[^>]*class="eyebrow"[^>]*>[\s\S]*?<\/div>/gi, ' ')
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

// 從檔案內容剝掉 YAML frontmatter，回傳 body
function stripFrontmatter(raw) {
  if (!raw.startsWith('---')) return raw;
  const end = raw.indexOf('\n---', 3);
  if (end < 0) return raw;
  return raw.slice(end + 4).replace(/^\s*\n/, '');
}

function parsePermalink(permalink) {
  const url = permalink || '';
  let m = url.match(/\/minutes\/minutes-(\d+)-agm-(\d+)\.html$/);
  if (m) return { term: Number(m[1]), seq: Number(m[2]), isAgm: true };
  m = url.match(/\/minutes\/minutes-(\d+)-agm-temp-(\d+)\.html$/);
  if (m) return { term: Number(m[1]), seq: Number(m[2]), isAgm: true, isTemp: true };
  m = url.match(/\/minutes\/minutes-(\d+)-(\d+)\.html$/);
  if (m) return { term: Number(m[1]), seq: Number(m[2]), isAgm: false };
  return null;
}

module.exports = {
  data: {
    permalink: '/minutes/search-index.json',
    eleventyExcludeFromCollections: true,
    layout: null,
  },

  render(data) {
    const minutes = (data.collections && data.collections.minutes) || [];
    const items = [];

    minutes.forEach(item => {
      const meta = parsePermalink((item.data && item.data.permalink) || item.url);
      if (!meta) return;

      // 直接讀原始檔（item.inputPath 是 input 相對路徑，譬如 ./src/minutes/minutes-4-9.html）
      let plain = '';
      try {
        const raw = fs.readFileSync(path.resolve(item.inputPath), 'utf8');
        const body = stripFrontmatter(raw);
        plain = htmlToPlainText(body);
      } catch (e) {
        plain = '';
      }

      const date = item.date instanceof Date
        ? item.date.toISOString().slice(0, 10)
        : (item.data.date || '');

      items.push({
        url: item.url,
        title: item.data.title || '',
        date,
        term: meta.term,
        isAgm: meta.isAgm,
        content: plain,
      });
    });

    items.sort((a, b) => b.term - a.term || (b.date || '').localeCompare(a.date || ''));

    return JSON.stringify(items);
  },
};
