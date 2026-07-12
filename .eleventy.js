// 11ty 設定檔
// 文件: https://www.11ty.dev/docs/config/

module.exports = function(eleventyConfig) {
  // ── 開發伺服器：關閉 DOM 差異比對、改用整頁重載 ──
  // 預設的就地 DOM 修補會擾動「JS 動態產生的內容」（如 /about/ 的 Leaflet 互動地圖、
  // utility 的 Chart.js 圖表），導致改檔熱更新後地圖/圖表「掉了」。整頁重載最穩。
  // 只影響開發期熱重載行為，不影響 build 產物與正式站。
  eleventyConfig.setServerOptions({ domDiff: false });

  // ── markdown-it 改成 CJK 友善：解決 **中文「夾全形標點」** 不渲染粗體的問題
  // 預設 CommonMark flanking rule 在 CJK 字 + 全形標點交界時會判定 ** 開閉失敗
  const md = require("markdown-it")({ html: true, linkify: true, breaks: false })
    .use(require("markdown-it-cjk-friendly").default);
  eleventyConfig.setLibrary("md", md);

  // ── split filter（Nunjucks 沒有內建）──
  eleventyConfig.addFilter("split", function(s, sep) {
    return String(s || "").split(sep);
  });

  // ── cssBust：CSS 連結加「內容指紋」破快取 ──
  // 用法：href="{{ '/global.css' | cssBust }}" → 輸出 /global.css?v=a1b2c3d4
  // 讀該 CSS 檔內容算 8 碼雜湊當版本；CSS 內容一變、雜湊就變、網址就變，
  // 瀏覽器自動抓新版。配合 Worker 對 HTML 的 no-cache（HTML 永遠最新、引用到
  // 最新雜湊），住戶改版後不必清快取就看到新樣式。只有真的被改到的 CSS 會破
  // 快取，沒被改的維持長快取。找不到檔就原樣返回，不擋 build。
  const crypto = require("crypto");
  const fs = require("fs");
  const path = require("path");
  eleventyConfig.addFilter("cssBust", function(urlPath) {
    try {
      const rel = String(urlPath).replace(/^\//, "").split("?")[0];
      const buf = fs.readFileSync(path.join(__dirname, rel));
      const hash = crypto.createHash("sha1").update(buf).digest("hex").slice(0, 8);
      return `${urlPath}?v=${hash}`;
    } catch (e) {
      return urlPath;
    }
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

  // ── 全站警示橫條：找出當前 active 的緊急公告 ──
  // 使用：{% set b = collections.notice | activeBanner %} → 回傳最新一則
  // banner:true 且（bannerFrom <= 今天，選填）且（bannerUntil >= 今天，選填）的公告物件；無則 null。
  // 用於 base.njk <body> 開頭渲染黃條。每日 06:00 build 重跑，到期自動消失、到 bannerFrom 自動出現。
  // bannerFrom：選填「排程起始日」（YYYY-MM-DD）。設了它就能「現在填、之後才自動上架」，
  //   不必到時手動打開；沒填 = 立即生效（與舊行為相同）。
  // bannerWhileTyphoon：選填（颱風公告專用，2026-07-12）。設 true 後「額外」要求
  //   utility/data/typhoon-state.json 的 active === true 才顯示。typhoon-alert 排程偵測到
  //   警報進入/解除會自動觸發重建（見 typhoon-alert.yml 最後一步），橫條隨警報上/下架，
  //   不必猜 bannerUntil。建議仍設寬鬆 bannerUntil（如 +14 天）當保險，state 卡住時不至於永遠掛著。
  eleventyConfig.addFilter("activeBanner", function(notices) {
    if (!Array.isArray(notices) || !notices.length) return null;
    // 一律用「台北日期字串（YYYY-MM-DD）」比對，避開 UTC/本地時區的 off-by-one。
    // build 在 GitHub Actions（UTC）跑，但住戶在台北，故以台北日期為準。
    const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
    const norm = (v) => (v instanceof Date) ? v.toISOString().slice(0, 10)
                                            : String(v).slice(0, 10).replace(/\//g, '-');
    const active = notices
      .filter(n => n.data && n.data.banner === true)
      .filter(n => !n.data.bannerFrom  || norm(n.data.bannerFrom)  <= todayStr) // 選填起始日；無 = 立即生效
      .filter(n => !n.data.bannerUntil || norm(n.data.bannerUntil) >= todayStr) // 選填到期日；無 = 一直顯示
      .filter(n => {
        if (!n.data.bannerWhileTyphoon) return true;
        try {   // 每次呼叫重讀，dev server 增量重建也拿得到最新 state
          const st = JSON.parse(require("fs").readFileSync("utility/data/typhoon-state.json", "utf8"));
          return st.active === true;
        } catch (e) { return false; }   // state 檔缺失/壞掉 → 寧可不顯示
      })
      .sort((a, b) => b.date - a.date);
    return active[0] || null;
  });

  // 把根目錄所有共用 CSS 複製到輸出目錄（用 glob，新增 .css 不會漏）
  eleventyConfig.addPassthroughCopy("*.css");
  // 三語切換共用機制（trilingual:true 頁面由 base.njk 載入）
  eleventyConfig.addPassthroughCopy("lang.js");
  eleventyConfig.addPassthroughCopy("favicon.svg");
  eleventyConfig.addPassthroughCopy("favicon.png");
  eleventyConfig.addPassthroughCopy("CNAME");
  eleventyConfig.addPassthroughCopy("robots.txt");

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
  eleventyConfig.addCollection("term5Board", makeTermCollection(5));

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
    for (const t of [1, 2, 3, 4, 5]) {
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

  // ── 給單篇財報月報頁的 prev/next 導航（取代各檔寫死的 month-nav）──
  // 只認 /finance/YYYY-MM.html 月報（排除年報、長期模型、草稿）；草稿因
  // eleventyExcludeFromCollections 不在 collection 內，自然不會被連結。
  // 升冪排序：prev=較舊月、next=較新月。
  eleventyConfig.addFilter("getFinancePager", function(collections, currentUrl) {
    const items = (collections.finance || [])
      .filter(i => /\/finance\/\d{4}-\d{2}\.html$/.test(i.url || ''))
      .sort((a, b) => (a.url > b.url ? 1 : -1));
    const idx = items.findIndex(i => i.url === currentUrl);
    if (idx < 0) return null;
    return {
      prev: idx > 0 ? items[idx - 1] : null,
      next: idx < items.length - 1 ? items[idx + 1] : null,
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
