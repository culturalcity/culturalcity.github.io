/* 閱大安・三語切換的「共通預設機制」 ── 全站唯一標準實作
 *
 * 由 base.njk 在頁面 frontmatter 設 `trilingual: true` 時自動載入。
 * 配套 HTML 慣例（見 CLAUDE.md「三語標準實現」）：
 *   - 語言鈕：<button class="lang-btn" data-lang="zh|en|ja" onclick="setLang('zh')">…</button>
 *   - 內容塊：<div class="lang-block" data-lang="zh|en|ja">…</div>（預設 zh 那塊加 active）
 *   - 行內小字：<span data-lang-text="zh|en|ja">…</span>
 * 樣式在 global.css 的「三語切換」段；預設靠 CSS .active 顯示中文，JS 壞了也能看中文。
 *
 * ⚠️ 例外（不走這支，各自有正當理由，勿硬併）：
 *   - evacuation：setLang 綁樓層圖的 LANG 變數（重繪地圖）→ 保留頁內自有版
 *   - welcome/index、welcome/transition：用 #btn-zh/#content-zh 的 ID 慣例 → 保留自有版
 *   - notice.njk：模板已單一來源服務所有公告，且多 #type-label 處理 → 保留自有版
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
}
