/* 閱大安・三語切換的「共通預設機制」 ── 全站唯一標準實作
 *
 * 由 base.njk 在頁面 frontmatter 設 `trilingual: true` 時自動載入。
 * 配套 HTML 慣例（見 CLAUDE.md「三語標準實現」）：
 *   - 語言鈕：<button class="lang-btn" data-lang="zh|en|ja" onclick="setLang('zh')">…</button>
 *   - 內容塊：<div class="lang-block" data-lang="zh|en|ja">…</div>（預設 zh 那塊加 active）
 *   - 行內小字：<span data-lang-text="zh|en|ja">…</span>
 * 樣式在 global.css 的「三語切換」段；預設靠 CSS .active 顯示中文，JS 壞了也能看中文。
 *
 * 切完語言後會呼叫 window.onLangChange(lang)（若有定義）── 給「切語言要多做事」的頁面
 * 插自己的動作。已用掛鉤併入標準的：evacuation（重貼樓層副標＝地圖標籤）、welcome
 * （改 header 標題）、notice.njk（公告類別標籤 #type-label 隨語言改字）。
 *
 * ✅ 全站三語頁皆走此共用機制，已無例外。各頁的 lang bar 樣式可不同（深色 header 版 vs
 *    淺色 pill 版，靠 pageCss/extraStyles 覆蓋 global），那是正當的版型差異、非機制例外。
 */
function setLang(lang) {
  document.querySelectorAll('.lang-btn').forEach(function (b) {
    b.classList.toggle('active', b.dataset.lang === lang);
  });
  document.querySelectorAll('.lang-block').forEach(function (b) {
    b.classList.toggle('active', b.dataset.lang === lang);
  });
  document.querySelectorAll('[data-lang-text]').forEach(function (el) {
    el.style.display = el.dataset.langText === lang ? '' : 'none';
  });
  document.documentElement.lang = lang === 'zh' ? 'zh-TW' : lang; // zh→zh-TW、en→en、ja→ja（無障礙/字型）

  // 掛鉤：頁面若定義 window.onLangChange，切完語言後呼叫它做額外的事。
  // 大多數頁面用不到；像 evacuation（避難圖）會插上「重貼樓層副標」。
  // 因 onLangChange 定義在該頁自己的 script 內，可存取該頁私有變數（LANG、地圖等）。
  if (typeof window.onLangChange === 'function') window.onLangChange(lang);
}
