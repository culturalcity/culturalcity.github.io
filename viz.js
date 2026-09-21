/* 資料視覺化色盤橋接（2026-09-21）：圖表 JS 不再自己寫色碼，一律用 VIZ.*。
 *
 * 為什麼要有這支：色盤定義在 global.css 的 --viz-*，但 Chart.js 的 borderColor 只吃字串，
 * 過去各頁在 JS 裡重寫一次色碼，改色就得兩邊一起改——用電目標頁的警戒線就這樣走鐘過：
 * 圖例色塊是 --c-warn(#A8481F)、實際畫出來的線卻是 #C45A30，兩個橘紅不一樣（2026-09-21 修）。
 *
 * 用法：<script src="/viz.js"></script>（要在圖表程式之前；本檔同步執行、不加 defer）
 *   borderColor: VIZ.blue, backgroundColor: VIZ.blueSoft, ticks:{ color: VIZ.axis }
 * 新增色請先在 global.css 的資料視覺化色盤加 --viz-*，再加到下面 KEYS。
 */
(function (w, d) {
  var KEYS = {
    blue: '--viz-blue', blueSoft: '--viz-blue-soft', orange: '--viz-orange',
    green: '--viz-green', alert: '--viz-alert', gold: '--viz-gold', goldBg: '--viz-gold-bg',
    gray: '--viz-gray', yellow: '--viz-yellow',
    navy: '--viz-navy', red: '--viz-red', purple: '--viz-purple', brown: '--viz-brown',
    olive: '--viz-olive', sky: '--viz-sky', moss: '--viz-moss',
    line: '--viz-line',      // 格線
    axis: '--wg9',           // 軸標籤與軸標題（淺底次要文字，過 AA）
    ink: '--wg41', onFill: '--white'
  };
  var cs = w.getComputedStyle(d.documentElement), VIZ = {};
  for (var k in KEYS) {
    var v = cs.getPropertyValue(KEYS[k]).trim();
    VIZ[k] = v || '#000'; /* design-ok: 取不到 CSS 變數時（極舊瀏覽器）的最後退路，不是主題色 */
  }
  VIZ.token = function (name) { return cs.getPropertyValue(name).trim(); };
  // 同一個色的半透明版（面積填色、淡化的線）：只從色盤取色，不另外寫色碼
  VIZ.alpha = function (color, a) {
    var m = /^#([0-9a-f]{6})$/i.exec(color);
    if (m) {
      var n = parseInt(m[1], 16);
      return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
    }
    m = /^rgba?\(([^)]+)\)$/.exec(color);          // 來源本身已是 rgba：換掉 alpha
    return m ? 'rgba(' + m[1].split(',').slice(0, 3).join(',') + ',' + a + ')' : color;
  };
  // 分類色盤（財報月報圓餅／長條）：VIZ.cat(i, alpha) 依序取色，超過長度就循環
  VIZ.CAT = ['navy', 'red', 'gold', 'green', 'purple', 'brown', 'olive', 'sky', 'moss', 'gray'];
  VIZ.cat = function (i, a) {
    // 超過色盤長度就會循環＝兩個類別同色且看不出來（2026-09-22 冰兒審閱指出）。
    // 這裡出聲警告，請到 global.css 的分類色盤加色並補進 VIZ.CAT，別讓它默默撞色。
    if (i >= VIZ.CAT.length && w.console && console.warn) {
      console.warn('[VIZ] 分類色盤只有 ' + VIZ.CAT.length + ' 色，第 ' + (i + 1) + ' 類會與第 ' +
        (i % VIZ.CAT.length + 1) + ' 類同色——請在 global.css 加 --viz-* 並補進 VIZ.CAT');
    }
    var c = VIZ[VIZ.CAT[i % VIZ.CAT.length]];
    return a == null ? c : VIZ.alpha(c, a);
  };
  w.VIZ = VIZ;
})(window, document);
