// 11ty 設定檔
// 文件: https://www.11ty.dev/docs/config/

module.exports = function(eleventyConfig) {
  // ── split filter（Nunjucks 沒有內建）──
  eleventyConfig.addFilter("split", function(s, sep) {
    return String(s || "").split(sep);
  });

  // ── 按發布日排序（用於最新動態時間軸）──
  // 優先取 frontmatter 的 publishDate，否則 fallback 到 item.date。
  // 必須在 template 階段排序：在 addCollection 階段排序時，11ty 在
  // incremental rebuild 後會以 item.date 重新排，覆蓋我們的順序。
  eleventyConfig.addFilter("sortByPublishDate", function(items) {
    const effDate = (i) => {
      const pd = i.data && i.data.publishDate;
      return pd ? new Date(String(pd).replace(/\//g, '-')) : i.date;
    };
    return [...items].sort((a, b) => effDate(b) - effDate(a));
  });

  // ── 日期格式化：YYYY-MM ──
  eleventyConfig.addFilter("dateYM", function(d) {
    if (!d) return "";
    const date = (d instanceof Date) ? d : new Date(d);
    if (isNaN(date)) return "";
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  });

  // ── 民國年月日：2026-04-13 → 115/04/13 ──
  eleventyConfig.addFilter("rocDate", function(d) {
    if (!d) return "";
    const date = (d instanceof Date) ? d : new Date(d);
    if (isNaN(date)) return "";
    const roc = date.getFullYear() - 1911;
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${roc}/${m}/${day}`;
  });

  // ── 西元/民國 → 民國 (僅將 YYYY/MM/DD 字串轉為 民國/MM/DD) ──
  eleventyConfig.addFilter("strToRoc", function(s) {
    if (!s) return s;
    const m = String(s).match(/^(\d{4})\/(\d{2})\/(\d{2})/);
    if (!m) return s;
    return `${parseInt(m[1]) - 1911}/${m[2]}/${m[3]}`;
  });

  // ── 月份兩位數：02 ──
  eleventyConfig.addFilter("monthOnly", function(d) {
    if (!d) return "";
    const date = (d instanceof Date) ? d : new Date(d);
    if (isNaN(date)) return "";
    return String(date.getMonth() + 1).padStart(2, "0");
  });

  // ── 日期格式化：YYYY/MM/DD ──
  eleventyConfig.addFilter("dateYMD", function(d) {
    if (!d) return "";
    const date = (d instanceof Date) ? d : new Date(d);
    if (isNaN(date)) return "";
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${y}/${m}/${day}`;
  });

  // 把 global.css 和 favicon 等靜態檔複製到輸出目錄
  eleventyConfig.addPassthroughCopy("global.css");
  eleventyConfig.addPassthroughCopy("notice.css");
  eleventyConfig.addPassthroughCopy("regulations.css");
  eleventyConfig.addPassthroughCopy("finance.css");
  eleventyConfig.addPassthroughCopy("minutes.css");
  eleventyConfig.addPassthroughCopy("favicon.svg");
  eleventyConfig.addPassthroughCopy("favicon.png");
  eleventyConfig.addPassthroughCopy("CNAME");

  // 把資料 JSON 檔也複製過去
  eleventyConfig.addPassthroughCopy("utility/data");

  // 管理員工具頁（每日水電公告產生器）：原樣複製，不過 11ty 模板
  // 線上路徑為 /admin/utility/，由 Cloudflare Worker 加 Basic Auth 保護
  eleventyConfig.addPassthroughCopy("admin");

  // 圖片：src/images/* → _site/images/*（網址為 /images/檔名）
  eleventyConfig.addPassthroughCopy({ "src/images": "images" });

  // ── 自訂 collection：把公告依年份分組（最新在前） ──
  eleventyConfig.addCollection("noticeByYear", function(collectionApi) {
    const notices = collectionApi.getFilteredByTag("notice").reverse();
    const byYear = {};
    notices.forEach(n => {
      const y = (n.data.displayDate || '').slice(0, 4);
      (byYear[y] = byYear[y] || []).push(n);
    });
    return Object.keys(byYear).sort().reverse().map(y => ({ year: y, items: byYear[y] }));
  });

  // ── 自訂 collection：把財報依年份分組 ──
  eleventyConfig.addCollection("financeByYear", function(collectionApi) {
    const items = collectionApi.getFilteredByTag("finance").reverse();
    const byYear = {};
    items.forEach(n => {
      // 從 permalink 抓 YYYY（例：/finance/2026-03.html → 2026, /finance/2025-annual.html → 2025）
      const m = (n.data.permalink || '').match(/\/finance\/(\d{4})/);
      const y = m ? m[1] : 'other';
      (byYear[y] = byYear[y] || []).push(n);
    });
    return Object.keys(byYear).sort().reverse().map(y => ({ year: y, items: byYear[y] }));
  });

  // ── 自訂 collection：規約按分類（charter/rule/guide）──
  eleventyConfig.addCollection("regulationsByCategory", function(collectionApi) {
    const items = collectionApi.getFilteredByTag("regulation");
    const byCat = { charter: [], rule: [], guide: [] };
    items.forEach(n => {
      const cat = n.data.category || 'rule';
      if (byCat[cat]) byCat[cat].push(n);
    });
    return byCat;
  });

  // ── 自訂 collection：各屆管委會會議（minutes-N-K，排除 agm）──
  const makeTermCollection = (term) => (collectionApi) =>
    collectionApi.getFilteredByTag("minutes")
      .filter(n => new RegExp(`/minutes-${term}-\\d+\\.html$`).test(n.data.permalink || ''))
      .sort((a, b) => b.date - a.date);
  eleventyConfig.addCollection("term1Board", makeTermCollection(1));
  eleventyConfig.addCollection("term2Board", makeTermCollection(2));
  eleventyConfig.addCollection("term3Board", makeTermCollection(3));
  eleventyConfig.addCollection("term4Board", makeTermCollection(4));

  // ── 給單篇管委會議紀錄頁的 prev/next 導航 ──
  // 從 currentUrl 解出屆/次，到對應的 termNBoard collection 找前後一次。
  // eleventyComputed 在 collections 完成前執行所以拿不到 — 必須當 filter 用。
  eleventyConfig.addFilter("getMinutesPager", function(allCollections, currentUrl) {
    const m = (currentUrl || '').match(/\/minutes\/minutes-(\d+)-(\d+)\.html$/);
    if (!m) return null;
    const term = parseInt(m[1]);
    const seq = parseInt(m[2]);
    // 把所有屆合併成一條時間線，跨屆連續
    const all = [];
    for (const t of [1, 2, 3, 4]) {
      const coll = (allCollections && allCollections[`term${t}Board`]) || [];
      coll.forEach(item => {
        const mm = (item.url || '').match(/-(\d+)\.html$/);
        if (mm) all.push({ item, term: t, seq: parseInt(mm[1]) });
      });
    }
    all.sort((a, b) => a.term - b.term || a.seq - b.seq);
    const idx = all.findIndex(x => x.term === term && x.seq === seq);
    if (idx < 0) return null;
    return {
      term, seq,
      prev: idx > 0 ? all[idx - 1].item : null,  // 上一次（較早，可能跨屆）
      next: idx < all.length - 1 ? all[idx + 1].item : null,  // 下一次（較晚，可能跨屆）
    };
  });

  // ── 統一最新動態：合併 notice + finance + minutes，按發布日排序 ──
  // 不複製 item（會觸發 templateContent 早期存取錯誤），類別從 URL 推斷
  // 排序語意是「對住戶公開的時間」：優先用 frontmatter 的 publishDate，
  // 否則 fallback 到 item.date（公告檔名日 / 會議開會日）
  eleventyConfig.addCollection("recentUpdates", function(collectionApi) {
    const tags = ["notice", "finance", "minutes"];
    const all = [];
    tags.forEach(tag => {
      collectionApi.getFilteredByTag(tag).forEach(item => all.push(item));
    });
    return all.sort((a, b) => b.date - a.date);
  });

  return {
    dir: {
      input: "src",          // 原始檔來源
      output: "_site",       // 建置輸出
      includes: "_includes", // 模板放這裡（路徑相對於 input）
      data: "_data"          // 資料檔放這裡（路徑相對於 input）
    },
    // 預設模板引擎：Nunjucks（.njk 檔）
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk"
  };
};
