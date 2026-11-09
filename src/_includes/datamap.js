/* 閱大安資料連動圖：共用畫圖程式。
   網站版（/admin/staff/data-map/）與主委版（scripts/gen-data-map.js 產出）共用；改畫法只改這支。
   資料格式見 src/_data/dataMap.json。顏色一律用 CSS 變數 --dm-*，由各頁面定義。 */
function renderDataMap(D) {
  var NS = 'http://www.w3.org/2000/svg';
  var ACV = { auto: '--dm-auto', ai: '--dm-ai', gm: '--dm-gm', chair: '--dm-chair' };
  var TIV = { ext: '--dm-t-ext', chair: '--dm-t-chair', gm: '--dm-t-gm', res: '--dm-t-res' };
  var svg = document.getElementById('dmNet');
  var W = 1080, H = 0;
  var nodes = D.nodes.map(function (n) {
    return { id: n[0], label: n[1], tier: n[2], x: D.cols[n[3]], y: n[4], w: n[1].length * 13.5 + 22, h: 28 };
  });
  nodes.forEach(function (n) { H = Math.max(H, n.y + 30); });
  var byId = {}; nodes.forEach(function (n) { byId[n.id] = n; });
  var links = D.links.map(function (l) { return { s: byId[l[0]], t: byId[l[1]], a: l[2], how: l[3] }; });
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.setAttribute('width', W); svg.setAttribute('height', H);
  function mk(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    (parent || svg).appendChild(e); return e;
  }
  var defs = mk('defs', {});
  Object.keys(ACV).forEach(function (k) {
    var m = mk('marker', { id: 'dm-ar-' + k, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs);
    mk('path', { d: 'M0,0L10,5L0,10z', style: 'fill:var(' + ACV[k] + ')' }, m);
  });
  function clip(a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var s = Math.min((b.w / 2 + 3) / Math.abs(dx || 1e-6), (b.h / 2 + 3) / Math.abs(dy || 1e-6));
    return [b.x - dx * s, b.y - dy * s];
  }
  var lg = mk('g', {});
  links.forEach(function (l) {
    var p = clip(l.s, l.t), mx = (l.s.x + p[0]) / 2, my = (l.s.y + p[1]) / 2 - 18;
    l.el = mk('path', { d: 'M' + l.s.x + ',' + l.s.y + ' Q' + mx + ',' + my + ' ' + p[0] + ',' + p[1],
      'class': 'dm-link', style: 'stroke:var(' + ACV[l.a] + ')', 'marker-end': 'url(#dm-ar-' + l.a + ')' }, lg);
  });
  var ng = mk('g', {});
  nodes.forEach(function (n) {
    var g = mk('g', { 'class': 'dm-node', tabindex: 0, role: 'button', 'aria-label': n.label,
      transform: 'translate(' + (n.x - n.w / 2) + ',' + (n.y - n.h / 2) + ')' }, ng);
    mk('rect', { width: n.w, height: n.h, rx: 14, 'class': 'dm-base' }, g);
    mk('rect', { width: n.w, height: n.h, rx: 14, style: 'fill:var(' + TIV[n.tier] + ')' }, g);
    var t = mk('text', { x: 11, y: 19 }, g); t.textContent = n.label;
    g.addEventListener('click', function () { pick(n); });
    g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(n); } });
    n.el = g;
  });
  function badge(a) {
    var b = document.createElement('span'); b.className = 'dm-who';
    b.style.color = 'var(' + ACV[a] + ')'; b.textContent = D.actors[a]; return b;
  }
  function row(cells) {
    var tr = document.createElement('tr');
    cells.forEach(function (c) { var td = document.createElement('td'); if (typeof c === 'string') td.textContent = c; else td.appendChild(c); tr.appendChild(td); });
    return tr;
  }
  function pick(n) {
    var hit = links.filter(function (l) { return l.s === n || l.t === n; });
    var nb = new Set([n]); hit.forEach(function (l) { nb.add(l.s); nb.add(l.t); });
    links.forEach(function (l) { var on = hit.indexOf(l) >= 0; l.el.classList.toggle('on', on); l.el.classList.toggle('dm-dim', !on); });
    nodes.forEach(function (m) { m.el.classList.toggle('on', m === n); m.el.classList.toggle('dm-dim', !nb.has(m)); });
    var ins = hit.filter(function (l) { return l.t === n; });
    document.getElementById('dmTitle').textContent = n.label;
    document.getElementById('dmHint').textContent = '資料來自 ' + ins.length + ' 處、連動到 ' + (hit.length - ins.length) + ' 處';
    var tb = document.getElementById('dmBody'); tb.innerHTML = '';
    hit.sort(function (a, b) { return (a.t === n ? 0 : 1) - (b.t === n ? 0 : 1); }).forEach(function (l) {
      tb.appendChild(row([(l.t === n ? '來自　' + l.s.label : '連到　' + l.t.label), badge(l.a), l.how]));
    });
  }
  // 全部連動一覽（依來源排列），手機或不便點圖時查表用
  var all = document.getElementById('dmAll');
  if (all) {
    nodes.forEach(function (n) {
      links.filter(function (l) { return l.s === n; }).forEach(function (l) { all.appendChild(row([l.s.label, l.t.label, badge(l.a), l.how])); });
    });
  }
  var leg = document.getElementById('dmLegend');
  if (leg) {
    var used = {}; links.forEach(function (l) { used[l.a] = 1; });
    Object.keys(ACV).filter(function (k) { return used[k]; }).forEach(function (k) {
      var s = document.createElement('span'); s.innerHTML = '<i class="dm-sw"></i>'; s.firstChild.style.background = 'var(' + ACV[k] + ')';
      s.appendChild(document.createTextNode(D.actors[k])); leg.appendChild(s);
    });
    Object.keys(D.tiers).forEach(function (k) {
      var s = document.createElement('span'); s.innerHTML = '<i class="dm-tier"></i>'; s.firstChild.style.background = 'var(' + TIV[k] + ')';
      s.appendChild(document.createTextNode(D.tiers[k])); leg.appendChild(s);
    });
  }
  var pr = document.getElementById('dmPrinciples');
  if (pr && D.principles) D.principles.forEach(function (p) { var li = document.createElement('li'); li.textContent = p; pr.appendChild(li); });
  pick(byId[D.defaultNode] || nodes[0]);
}
