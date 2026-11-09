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
      'class': 'dm-link' + (l.a === 'auto' ? '' : ' dm-manual'), style: 'stroke:var(' + ACV[l.a] + ')', 'marker-end': 'url(#dm-ar-' + l.a + ')' }, lg);
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
    b.style.color = 'var(' + ACV[a] + ')'; b.textContent = D.actors[a] + (a === 'auto' ? '' : '・手動'); return b;
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
    ['自動（不用人開口）', '手動（要有人動手或下指令）'].forEach(function (t, i) {
      var s = document.createElement('span'); s.innerHTML = '<svg class="dm-ls" width="26" height="6"><line x1="0" y1="3" x2="26" y2="3"' + (i ? ' stroke-dasharray="5 3"' : '') + '/></svg>';
      s.appendChild(document.createTextNode(t)); leg.appendChild(s);
    });
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
  // ── 輸入 → 輸出（兩欄）──
  var fsvg = document.getElementById('dmFlow');
  var flowPick = function () {};
  if (fsvg) {
    var LX = 16, LW = 250, RX = 600, RW = 300, RH = 30, GAP = 8, FW = 920;
    var srcs = nodes.filter(function (n) { return links.some(function (l) { return l.s === n; }); });
    var outsByTier = {};
    nodes.forEach(function (n) { if (links.some(function (l) { return l.t === n; })) (outsByTier[n.tier] = outsByTier[n.tier] || []).push(n); });
    var ly = {}, ry = {}, lel = {}, rel = {}, y = 40, ry0 = 40, fl = [];
    var fmk = function (tag, attrs, parent) { var e = document.createElementNS(NS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); (parent || fsvg).appendChild(e); return e; };
    var ftxt = function (x, yy, s, cls, p) { var t = fmk('text', { x: x, y: yy, 'class': cls || '' }, p); t.textContent = s; return t; };
    var fe = fmk('g', {});
    ftxt(LX, 22, '輸入（資料從這裡出發）', 'dm-grp'); ftxt(RX, 22, '輸出（連動更新的地方）', 'dm-grp');
    var addNode = function (n, x, yy, w, side) {
      var g = fmk('g', { 'class': 'dm-node', tabindex: 0, role: 'button', 'aria-label': n.label });
      fmk('rect', { x: x, y: yy, width: w, height: RH, rx: 4, 'class': 'dm-base' }, g);
      fmk('rect', { x: x, y: yy, width: w, height: RH, rx: 4, style: 'fill:var(' + TIV[n.tier] + ')' }, g);
      ftxt(x + 10, yy + 20, n.label, '', g);
      g.addEventListener('click', function () { flowPick(side, n); });
      g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flowPick(side, n); } });
      return g;
    };
    srcs.forEach(function (n) { lel[n.id] = addNode(n, LX, y, LW, 's'); ly[n.id] = y + RH / 2; y += RH + GAP; });
    ['res', 'gm', 'chair', 'ext'].filter(function (t) { return outsByTier[t]; }).forEach(function (t, gi) {
      if (gi) ry0 += 14;
      ftxt(RX, ry0 + 12, D.tiers[t] || t, 'dm-grp');
      fmk('line', { x1: RX, x2: RX + RW, y1: ry0 + 18, y2: ry0 + 18, 'class': 'dm-grpline' });
      ry0 += 26;
      outsByTier[t].forEach(function (n) { rel[n.id] = addNode(n, RX, ry0, RW, 'o'); ry[n.id] = ry0 + RH / 2; ry0 += RH + GAP; });
    });
    var FH = Math.max(y, ry0) + 16;
    fsvg.setAttribute('viewBox', '0 0 ' + FW + ' ' + FH); fsvg.setAttribute('width', FW); fsvg.setAttribute('height', FH);
    links.forEach(function (l) {
      var y1 = ly[l.s.id], y2 = ry[l.t.id], x1 = LX + LW, x2 = RX, mx = (x1 + x2) / 2;
      fl.push({ l: l, el: fmk('path', { d: 'M' + x1 + ',' + y1 + ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2, 'class': 'dm-link' + (l.a === 'auto' ? '' : ' dm-manual'), style: 'stroke:var(' + ACV[l.a] + ')' }, fe) });
    });
    flowPick = function (kind, n) {
      var hit = fl.filter(function (f) { return kind === 's' ? f.l.s === n : f.l.t === n; });
      var onS = {}, onO = {}; hit.forEach(function (f) { onS[f.l.s.id] = 1; onO[f.l.t.id] = 1; });
      fl.forEach(function (f) { var on = hit.indexOf(f) >= 0; f.el.classList.toggle('on', on); f.el.classList.toggle('dm-dim', !on); });
      Object.keys(lel).forEach(function (k) { lel[k].classList.toggle('on', !!onS[k]); lel[k].classList.toggle('dm-dim', !onS[k]); });
      Object.keys(rel).forEach(function (k) { rel[k].classList.toggle('on', !!onO[k]); rel[k].classList.toggle('dm-dim', !onO[k]); });
      document.getElementById('dmTitle').textContent = kind === 's' ? n.label + ' 更新時' : n.label + ' 的資料來自';
      document.getElementById('dmHint').textContent = kind === 's' ? '連動 ' + hit.length + ' 個地方' : '來自 ' + Object.keys(onS).length + ' 個來源';
      var tb = document.getElementById('dmBody'); tb.innerHTML = '';
      hit.forEach(function (f) { tb.appendChild(row([(kind === 's' ? '連到　' + f.l.t.label : '來自　' + f.l.s.label), badge(f.l.a), f.l.how])); });
    };
  }
  var tN = document.getElementById('dmTabNet'), tF = document.getElementById('dmTabFlow');
  var vN = document.getElementById('dmNetView'), vF = document.getElementById('dmFlowView');
  var show = function (net) {
    vN.hidden = !net; vF.hidden = net; tN.setAttribute('aria-selected', net); tF.setAttribute('aria-selected', !net);
    if (net) pick(byId[D.defaultNode] || nodes[0]); else flowPick('s', byId.mdocx || nodes[0]);
  };
  if (tN && tF && vN && vF) { tN.addEventListener('click', function () { show(true); }); tF.addEventListener('click', function () { show(false); }); }
  pick(byId[D.defaultNode] || nodes[0]);
}
