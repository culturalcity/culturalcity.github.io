// 產生「閱大安資料連動圖」主委版（私人頁面，發布成 claude.ai artifact）。
// 用法：node scripts/gen-data-map.js
// 讀 src/_data/dataMap.json（總幹事版，公開 repo）＋ raw/data-map-chair.json（主委專屬，gitignored），
// 合併後輸出 raw/data-map/閱大安資料連動圖.html。畫法與網站版共用 src/_includes/datamap.js／datamap.css。
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const pub = JSON.parse(fs.readFileSync(path.join(root, 'src/_data/dataMap.json'), 'utf8'));
const chairPath = path.join(root, 'raw/data-map-chair.json');
const chair = fs.existsSync(chairPath) ? JSON.parse(fs.readFileSync(chairPath, 'utf8')) : {};

const data = {
  actors: Object.assign({}, pub.actors, chair.actorLabels || {}),
  tiers: { ext: pub.tiers.ext, ...(chair.tiers || {}), gm: pub.tiers.gm, res: pub.tiers.res },
  cols: pub.cols,
  defaultNode: pub.defaultNode,
  nodes: pub.nodes.concat(chair.nodes || []),
  links: pub.links.concat(chair.links || []),
  principles: pub.principles.concat(chair.principles || []),
};
const ids = new Set(data.nodes.map(n => n[0]));
data.links.forEach(l => { if (!ids.has(l[0]) || !ids.has(l[1])) throw new Error('連線指到不存在的節點：' + l.join(' → ')); });

const css = fs.readFileSync(path.join(root, 'src/_includes/datamap.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'src/_includes/datamap.js'), 'utf8');
const html = `<title>閱大安資料連動圖</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&display=swap">
<style>
/* 主委版：與網站版同一套畫法，這裡只定義顏色與字級 token */
:root{--bg:#EAE7E1;--dm-panel:#F7F5F2;--dm-fg:#3C3835;--dm-muted:#5F5A55;--dm-line:rgba(60,56,53,.25);
 --dm-auto:#2B4A6B;--dm-ai:#1F5C38;--dm-gm:#8C5A00;--dm-chair:#6B3F72;
 --dm-t-ext:#E3DED6;--dm-t-chair:#E6DCEA;--dm-t-gm:#F3E7D8;--dm-t-res:#DCE6E0;
 --fs-caption:13px;--fs-text:15px;--fs-body:17px;--fs-title:24px;--sp-4:4px;--sp-8:8px;--sp-16:16px;--sp-20:20px;--radius:6px;
 --font:'Noto Sans TC','Microsoft JhengHei','PingFang TC',sans-serif}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#24211F;--dm-panel:#2E2B28;--dm-fg:#EAE7E1;--dm-muted:#ADA8A2;--dm-line:#4A4541;
 --dm-auto:#8FB0CF;--dm-ai:#7CC2A8;--dm-gm:#E0A867;--dm-chair:#C7A3CF;--dm-t-ext:#3A3633;--dm-t-chair:#3E3242;--dm-t-gm:#43392C;--dm-t-res:#2E3D36;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#24211F;--dm-panel:#2E2B28;--dm-fg:#EAE7E1;--dm-muted:#ADA8A2;--dm-line:#4A4541;
 --dm-auto:#8FB0CF;--dm-ai:#7CC2A8;--dm-gm:#E0A867;--dm-chair:#C7A3CF;--dm-t-ext:#3A3633;--dm-t-chair:#3E3242;--dm-t-gm:#43392C;--dm-t-res:#2E3D36;color-scheme:dark}
html,body{background:var(--bg);color:var(--dm-fg)}
body{font-family:var(--font);font-size:var(--fs-text);line-height:1.7;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));padding-block:24px 48px}
svg text{font-family:var(--font)}
.wrap{max-width:1120px;margin:0 auto;display:grid;gap:20px}
h1{font-size:var(--fs-title);margin:0;letter-spacing:.06em}
.sub{color:var(--dm-muted);margin:4px 0 0;max-width:65ch}
h2.sec{font-size:var(--fs-body);margin:8px 0 0}
ul{margin:0;padding-left:1.2em}
${css}
</style>
<div class="wrap">
  <header><h1>閱大安資料連動圖</h1>
  <p class="sub">主委版：比網站上的總幹事版多了只有主委看得到的文件與說明。每一份文件是一個點，箭頭代表資料流向；點任一個點看上下游。</p></header>
  <div class="dm-legend" id="dmLegend" aria-label="圖例"></div>
  <div class="dm-tabs" role="tablist"><button class="dm-tab" id="dmTabNet" role="tab" aria-selected="true">網狀圖</button><button class="dm-tab" id="dmTabFlow" role="tab" aria-selected="false">輸入 → 輸出</button></div>
  <div class="dm-box dm-scroll" id="dmNetView"><svg id="dmNet" role="img" aria-label="各文件之間的連動網狀圖"></svg></div>
  <div class="dm-box dm-scroll" id="dmFlowView" hidden><svg id="dmFlow" role="img" aria-label="輸入與輸出的連動圖"></svg></div>
  <section class="dm-box dm-detail" aria-live="polite"><h2 id="dmTitle"></h2><p class="dm-hint" id="dmHint"></p>
  <div class="dm-tw"><table class="dm-table"><thead><tr><th>方向與文件</th><th>由誰</th><th>時機與做法</th></tr></thead><tbody id="dmBody"></tbody></table></div></section>
  <h2 class="sec">原則</h2><ul id="dmPrinciples"></ul>
  <h2 class="sec">全部連動一覽</h2>
  <div class="dm-box dm-detail dm-tw"><table class="dm-table"><thead><tr><th>來源</th><th>連動到</th><th>由誰</th><th>時機與做法</th></tr></thead><tbody id="dmAll"></tbody></table></div>
</div>
<script>
${js}
renderDataMap(${JSON.stringify(data)});
</script>
`;
const outDir = path.join(root, 'raw/data-map');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, '閱大安資料連動圖.html');
fs.writeFileSync(out, html);
console.log('ok', out, data.nodes.length, 'nodes', data.links.length, 'links');
