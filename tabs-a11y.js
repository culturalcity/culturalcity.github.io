/* 頁籤無障礙漸進增強（全站共用；finance.njk 與長期財務模型共用這一份）。
   內容檔的頁籤維持極簡寫法：<div class="tabs"><div class="tab" onclick="sw('key')">…</div></div>
   ＋ <div id="tab-key" class="tab-content">，本檔在載入後補 role／aria-selected／
   aria-controls／aria-labelledby 與鍵盤操作（Enter／Space 觸發、左右方向鍵移焦）。
   內容檔與產月報的 skill 都不用改；要調頁籤無障礙行為只改這裡。
   以 <script src="/tabs-a11y.js" defer> 載入（defer 保證 DOM 已就緒）。 */
(function a11yTabs(){
  var bar = document.querySelector('.tabs');
  if (!bar) return;
  bar.setAttribute('role', 'tablist');
  var tabs = Array.prototype.slice.call(bar.querySelectorAll('.tab'));
  tabs.forEach(function(t){
    t.setAttribute('role', 'tab');
    var m = (t.getAttribute('onclick') || '').match(/sw\('([\w-]+)'\)/);
    if (m && document.getElementById('tab-' + m[1])) {
      t.id = 'tab-btn-' + m[1];
      t.setAttribute('aria-controls', 'tab-' + m[1]);
      var panel = document.getElementById('tab-' + m[1]);
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', t.id);
    }
    t.addEventListener('click', sync);
    t.addEventListener('keydown', function(e){
      var i = tabs.indexOf(t);
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); t.click(); }
      if (e.key === 'ArrowRight') { e.preventDefault(); moveFocus((i + 1) % tabs.length); }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); moveFocus((i - 1 + tabs.length) % tabs.length); }
    });
  });
  // 方向鍵移焦（manual activation：只移焦，Enter/Space 才切換）——roving tab stop 要跟著焦點走，
  // 否則移焦後按 Tab 會彈回原選中頁籤而不是離開 tablist。aria-selected 不動，由 sync() 在切換時處理。
  function moveFocus(idx){
    tabs.forEach(function(x, k){ x.setAttribute('tabindex', k === idx ? '0' : '-1'); });
    tabs[idx].focus();
  }
  // roving tabindex：Tab 鍵只停在「目前選中」的頁籤（tabindex 0），其餘 -1；頁籤之間用方向鍵移動。
  // 否則 Tab 會逐一停在每個頁籤，且進入時停在第一個而非選中的那個（長期財務模型預設選第 6 個）。
  function sync(){
    tabs.forEach(function(t){
      var on = t.classList.contains('active');
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.setAttribute('tabindex', on ? '0' : '-1');
    });
  }
  sync();
})();
