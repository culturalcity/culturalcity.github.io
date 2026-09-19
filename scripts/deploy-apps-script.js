// 把 repo 裡的 Apps Script 底稿部署到 culturalcity85 帳號的對應專案（取代「複製貼上到後台」）。
//
// 怎麼找到對應專案：culturalcity85 的專案命名慣例是「閱大安・輸入 → 輸出（檔名）」，
// 括號內就是 repo 的原始檔名，腳本用它自動配對，所以 repo 裡不必記 scriptId。
// 一個專案含多支檔時括號寫「a／b」。
//
// 用法：
//   node scripts/deploy-apps-script.js                     # 總覽：每支專案線上 vs repo 是否一致
//   node scripts/deploy-apps-script.js heat-poll           # 只看差異，不部署
//   node scripts/deploy-apps-script.js heat-poll --push    # 部署，推完再拉回核對
//
// 一次性設定（換主委／換電腦時）：
//   clasp login --user cc85 --no-localhost   （在 PowerShell 跑，用 culturalcity85 授權；
//   詳細步驟見 apps-script/README.md「部署方式」）
//
// 安全設計：
//   - 每次都在暫存夾操作，一個專案只推它自己的檔（舊的 .clasp.json 會把整個
//     apps-script/ 資料夾 8 支程式全灌進同一個專案，已廢除）。
//   - appsscript.json 一律沿用線上那份，不動權限範圍與時區。
//   - 部署前先印出「線上 vs repo」差異：若線上有 repo 沒有的內容（有人直接在後台改過），
//     會被這次部署蓋掉，看差異時要留意 - 開頭的行。

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CLASP = path.join(ROOT, 'node_modules', '@google', 'clasp', 'build', 'src', 'index.js');
const USER = 'cc85';
const SOURCE_DIRS = ['apps-script', 'scripts/apps-script'];

// 這幾支的 repo 檔只是範本，線上才是正本（內含真實的試算表 ID／網頁應用程式設定），
// 用 repo 蓋上去會讓它停擺。要改就直接在後台改；若要納入本腳本，先把 repo 檔同步成
// 線上版本，並把設定值改放「指令碼屬性」，再從這裡移除。
const BACKEND_IS_SOURCE = {
  'facility-backup': 'repo 的 SHEET_ID 是範本字串，線上填的是真的備份試算表',
  'visitor-backup': 'repo 的 SHEET_ID 是範本字串，線上填的是真的備份試算表',
  'calendar-bridge': '網頁應用程式（Web App）走固定版本部署，推程式碼不會生效，且線上有 repo 沒有的授權函式',
  'apps-script-bills': 'repo 與線上內容分歧已久（函式排列與內容皆不同），未逐一核對前不覆蓋',
};

function clasp(args, cwd) {
  const r = spawnSync(process.execPath, [CLASP, '--user', USER, ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) {
    const msg = (r.stderr || r.stdout || '').trim();
    throw new Error(`clasp ${args.join(' ')} 失敗：${msg}\n` +
      '（若是權限錯誤，多半是還沒用 culturalcity85 登入：clasp login --user cc85 --no-localhost）');
  }
  return r.stdout;
}

// 專案名稱括號內的檔名 → 本機原始檔清單
function resolveSources(key) {
  const dir = path.join(ROOT, key);
  if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
    return fs.readdirSync(dir).filter(f => f.endsWith('.gs')).map(f => path.join(dir, f));
  }
  for (const d of SOURCE_DIRS) {
    const f = path.join(ROOT, d, key + '.gs');
    if (fs.existsSync(f)) return [f];
  }
  return null;
}

function listProjects() {
  const out = clasp(['list', '--json'], os.tmpdir());
  const json = JSON.parse(out.slice(out.indexOf('[')));
  return json.map(p => {
    const m = p.name.match(/（([^（）]+)）\s*$/);
    const keys = m ? m[1].split('／').map(s => s.trim()) : [];
    const sources = keys.length ? keys.map(resolveSources) : [];
    return {
      id: p.id, name: p.name, keys,
      sources: sources.every(Boolean) && sources.length ? sources.flat() : null,
    };
  });
}

function tmpDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `yda-gas-${tag}-`));
}

function pull(project) {
  const dir = tmpDir('pull');
  fs.writeFileSync(path.join(dir, '.clasp.json'), JSON.stringify({ scriptId: project.id, rootDir: '.' }));
  clasp(['pull'], dir);
  return dir;
}

// 忽略行尾空白、換行符與連續空行，只比實質內容
const norm = s => s.replace(/\r/g, '').split('\n').map(l => l.trimEnd()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
const codeFiles = dir => fs.readdirSync(dir).filter(f => /\.(js|gs)$/.test(f)).sort();

// 線上與本機的程式碼各自串成一份（依檔名排序）比對；檔名不同（如線上「程式碼」）不影響判定
function joined(dir, files) {
  return files.map(f => norm(fs.readFileSync(path.join(dir, f), 'utf8'))).join('\n');
}
function localJoined(sources) {
  return sources.slice().sort().map(f => norm(fs.readFileSync(f, 'utf8'))).join('\n');
}

function showDiff(serverDir, sources) {
  const a = path.join(tmpDir('diff'), '線上');
  const b = path.join(path.dirname(a), 'repo');
  fs.writeFileSync(a, joined(serverDir, codeFiles(serverDir)) + '\n');
  fs.writeFileSync(b, localJoined(sources) + '\n');
  const r = spawnSync('git', ['diff', '--no-index', '--no-color', '-U2', a, b], { encoding: 'utf8' });
  process.stdout.write(r.stdout || '（無差異）\n');
}

function overview() {
  for (const p of listProjects()) {
    if (!p.sources) { console.log(`?  ${p.name}\n     → repo 找不到對應原始檔`); continue; }
    const blocked = p.keys.find(k => BACKEND_IS_SOURCE[k]);
    if (blocked) { console.log(`－ ${p.name}\n     → 後台為準，不由本腳本部署：${BACKEND_IS_SOURCE[blocked]}`); continue; }
    const dir = pull(p);
    const same = joined(dir, codeFiles(dir)) === localJoined(p.sources);
    console.log(`${same ? '✓' : '✗'}  ${p.name}${same ? '' : '\n     → 線上與 repo 不一致，跑 node scripts/deploy-apps-script.js ' + p.keys[0] + ' 看差異'}`);
  }
}

function deploy(key, doPush) {
  const p = listProjects().find(x => x.keys.includes(key));
  if (!p) throw new Error(`找不到專案名稱括號內含「${key}」的 Apps Script 專案`);
  if (!p.sources) throw new Error(`「${p.name}」在 repo 找不到對應原始檔`);
  console.log(`專案：${p.name}\n原始檔：${p.sources.map(f => path.relative(ROOT, f)).join('、')}\n`);

  const server = pull(p);
  if (joined(server, codeFiles(server)) === localJoined(p.sources)) {
    console.log('線上已與 repo 一致，不需部署。');
    return;
  }
  console.log('── 差異（- 線上　+ repo）──');
  showDiff(server, p.sources);
  if (!doPush) { console.log('\n只看差異，未部署。確認後加 --push。'); return; }
  const blocked = p.keys.find(k => BACKEND_IS_SOURCE[k]);
  if (blocked) throw new Error(`「${p.name}」後台為準，拒絕部署：${BACKEND_IS_SOURCE[blocked]}`);

  const out = tmpDir('push');
  fs.copyFileSync(path.join(server, '.clasp.json'), path.join(out, '.clasp.json'));
  fs.copyFileSync(path.join(server, 'appsscript.json'), path.join(out, 'appsscript.json'));
  for (const f of p.sources) fs.copyFileSync(f, path.join(out, path.basename(f)));
  clasp(['push', '--force'], out);

  const check = pull(p);
  if (joined(check, codeFiles(check)) !== localJoined(p.sources)) {
    throw new Error('推完拉回核對不一致，請到 Apps Script 後台檢查。');
  }
  console.log('\n✓ 已部署，拉回核對與 repo 一致。觸發器綁函式名稱，不受影響。');
}

try {
  const [key, flag] = process.argv.slice(2);
  if (!key) overview();
  else deploy(key, flag === '--push');
} catch (e) {
  console.error('✗ ' + e.message);
  process.exit(1);
}
