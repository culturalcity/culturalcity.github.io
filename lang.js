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
 * 插自己的動作。例：evacuation 重貼樓層副標（地圖標籤）；welcome 改 header 標題文字。
 *
 * ⚠️ 唯一未走這支：notice.njk（公告「模板」，setLang 已單一來源服務所有公告、且有
 *   #type-label 特例）→ 保留模板自有版（本來就 DRY、非重複，故未強迫併入）。
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
