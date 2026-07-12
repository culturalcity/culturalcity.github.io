// 颱風自動提醒：偵測「陸上颱風警報」狀態變化，建立 Calendar 事件
//
// 觸發點：
//   inactive → 陸上颱風警報（臺北市在警戒區）：建「🌀 颱風陸上警報・防颱準備清單」事件
//   陸上颱風警報 → inactive（解除）：建「🔍 颱風後巡查清單」事件（隔日）
//
// 狀態記錄：utility/data/typhoon-state.json
//   { active: boolean, activeSince: ISO, phenomena: string, lastCheck: ISO }
//
// 環境變數：
//   CWA_API_KEY、APPS_SCRIPT_WEBHOOK_URL、APPS_SCRIPT_SHARED_SECRET
//
// 排程：每天 06:00 / 12:00 / 18:00 台北（GitHub Actions 實際觸發約 +51-60min）
//
// 為什麼一天 3 次：颱風警報發布/升級/解除可能任何時間發生；3 次能在 4-12 小時內反應。
// 為什麼用 W-C0033-001 不用颱風專屬 dataset：W-C0033-001 直接按縣市組織，
// 臺北市格子有「陸上颱風警報」hazard 就代表大安區在警戒區，不必再 cross-reference。
//
// 手動測試：
//   node scripts/check-typhoon-alert.js --dry-run

const fs = require('fs');
const path = require('path');
const https = require('https');

const CWA_URL = 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/W-C0033-001';
const TARGET_CITY = '臺北市';
const LAND_TYPHOON_KEYWORD = '陸上颱風警報';   // 「海上陸上颱風警報」也含此 substring
// ⚠ 2026-07-10 巴威颱風實測：CWA 把警報拆成 phenomena=「海上陸上颱風」+ significance=「警報」
// 兩個欄位，比對時必須把兩欄串起來才含得住關鍵字（當天因此漏觸發，人工補發現此 bug）。

const STATE_PATH = path.resolve(__dirname, '..', 'utility', 'data', 'typhoon-state.json');
const DRY_RUN = process.argv.includes('--dry-run');

// 2026-07-11 方案A（單一資料源）：事件不再內嵌施作清單，改連到主委親撰的 canonical SOP。
// 防颱準備＝Notion「颱風公設防颱準備施作項目」（12 項、每項含現場照片，公開分享連結）；
// 災後巡查＝總幹事 Wiki 第五章 §1.2.2。改清單內容一律改該兩處，不要回頭在這裡加項目
// ——本檔曾內嵌一份 AI 代擬、未經主委審核的 9 項清單，2026-07-10 巴威颱風實戰時發現與
// 實際 SOP 不符（閘門是手動組裝式、非「下放」式），故廢除內嵌清單。
const PREP_SOP_URL = 'https://dynamic-jaw-6be.notion.site/227a3786c38980e08baade2670e06396';
const PM_WIKI_URL = 'https://culturalcity.org/admin/staff/pm-wiki/';

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'culturalcity-typhoon-alert' } }, res => {
      let buf = '';
      res.on('data', c => (buf += c));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}: ${buf.slice(0, 200)}`));
        }
        try { resolve(JSON.parse(buf)); }
        catch (e) { reject(new Error('Invalid JSON: ' + buf.slice(0, 200))); }
      });
    }).on('error', reject);
  });
}

function postJson(url, payload) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let buf = '';
      res.on('data', c => (buf += c));
      res.on('end', () => {
        // ⚠ Apps Script 對 POST 一律回 302 轉址到結果頁（此時 doPost 已執行完、事件已建立），
        // 必須跟隨轉址 GET 一次才拿得到 JSON 回應。2026-07-11 巴威颱風實測：不跟隨會誤判失敗、
        // 跳過 state commit，下一輪重複觸發事件。
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          get(res.headers.location)
            .then(parsed => {
              if (parsed && parsed.ok) resolve(parsed);
              else reject(new Error(`Webhook redirect result not ok: ${JSON.stringify(parsed).slice(0, 300)}`));
            })
            .catch(reject);
          return;
        }
        try {
          const parsed = JSON.parse(buf);
          if (res.statusCode >= 200 && res.statusCode < 300 && parsed.ok) resolve(parsed);
          else reject(new Error(`Webhook failed (HTTP ${res.statusCode}): ${buf.slice(0, 300)}`));
        } catch (e) {
          reject(new Error(`Webhook returned non-JSON (HTTP ${res.statusCode}): ${buf.slice(0, 300)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function todayTaipei() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function tomorrowTaipei() {
  const t = new Date(Date.now() + 8 * 60 * 60 * 1000);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}
function nowTaipeiISO() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
}

function loadState() {
  if (!fs.existsSync(STATE_PATH)) {
    return { active: false, activeSince: null, phenomena: null, lastCheck: null };
  }
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); }
  catch (e) { return { active: false, activeSince: null, phenomena: null, lastCheck: null }; }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

(async () => {
  const apiKey = process.env.CWA_API_KEY;
  if (!apiKey) { console.error('❌ 缺少 CWA_API_KEY'); process.exit(1); }

  const url = `${CWA_URL}?Authorization=${encodeURIComponent(apiKey)}&format=JSON`;
  const json = await get(url);
  const locations = (json.records && json.records.location) || [];
  const city = locations.find(l => l.locationName === TARGET_CITY);
  if (!city) {
    console.error(`❌ W-C0033-001 找不到 ${TARGET_CITY} 資料`);
    process.exit(1);
  }

  const hazards = (city.hazardConditions && city.hazardConditions.hazards) || [];
  const landTyphoon = hazards.find(h => {
    const info = (h && h.info) || {};
    const phen = (info.phenomena || '') + (info.significance || '');   // 兩欄串接，新舊格式都吃
    return phen.includes(LAND_TYPHOON_KEYWORD);
  });

  const prevState = loadState();
  const currentlyActive = !!landTyphoon;
  const currentPhenomena = landTyphoon
    ? ((landTyphoon.info.phenomena || '') + (landTyphoon.info.significance || ''))
    : null;

  console.log(`📡 CWA 查詢結果：${TARGET_CITY} ${currentlyActive ? `「${currentPhenomena}」` : '無陸上颱風警報'}`);
  console.log(`📂 上次狀態：${prevState.active ? `active 自 ${prevState.activeSince}` : 'inactive'}`);

  const events = [];

  // Transition 1: inactive → active
  if (!prevState.active && currentlyActive) {
    console.log('🌀 偵測到「進入陸上颱風警報」→ 建立防颱清單事件');
    events.push({
      track: 'typhoon-pre',
      date: todayTaipei(),
      title: `🌀 颱風陸上警報・防颱準備清單（${currentPhenomena}）`,
      description:
        `中央氣象署發布陸上颱風警報，臺北市在警戒區。\n\n` +
        `**防颱準備施作項目（12 項，含現場照片）**：\n${PREP_SOP_URL}\n\n` +
        `⏱ 時效提醒（詳細步驟見上方連結）：\n` +
        `  ・前後門防水閘門「支柱」趁風雨未明顯時先裝好（前後門各約 40 分鐘，門片可先暫放定位）\n` +
        `  ・沙包平時收在 B4 消防機房，先運上頂樓室內空間出入口\n` +
        `  ・1F/B1F 排水溝清淤、A 梯各樓層地排蓋拔除\n\n` +
        `**警報資訊**：${currentPhenomena}\n` +
        `**生效時間**：${(landTyphoon.validTime && landTyphoon.validTime.startTime) || '（未標示）'}\n` +
        `**預計結束**：${(landTyphoon.validTime && landTyphoon.validTime.endTime) || '（未標示）'}\n\n` +
        `📌 由 typhoon-alert 系統自動建立\n` +
        `資料來源：CWA W-C0033-001`,
      color: 'TOMATO',
    });
  }

  // Transition 2: active → inactive (警報解除)
  if (prevState.active && !currentlyActive) {
    console.log('🔍 偵測到「陸上颱風警報解除」→ 建立災後巡查清單事件');
    events.push({
      track: 'typhoon-post',
      date: tomorrowTaipei(), // 隔天巡查，給天氣 settle 的時間
      title: `🔍 颱風後巡查清單（${prevState.phenomena || '陸上警報'} 解除後）`,
      description:
        `陸上颱風警報已解除。建議於今日視天氣狀況、明日全面執行災後巡查。\n\n` +
        `**災後巡查清單**：見總幹事 Wiki 第五章 §1.2.2\n${PM_WIKI_URL}\n\n` +
        `巡查發現異常處請拍照記錄、通知主委、視損害程度決定是否動用社區公基金修繕。\n\n` +
        `**本次警報期間**：${prevState.activeSince || '?'} ~ ${nowTaipeiISO()}\n\n` +
        `📌 由 typhoon-alert 系統自動建立\n` +
        `資料來源：CWA W-C0033-001`,
      color: 'BLUE',
    });
  }

  // 無 transition 時 print 一行 status，方便看 log
  if (events.length === 0) {
    if (currentlyActive) console.log(`ℹ️  陸上颱風警報持續中（自 ${prevState.activeSince}），無需重複建立事件`);
    else console.log('ℹ️  無變化（無陸上颱風警報）');
  }

  // 更新 state（即使 dry-run 也要看到下一輪邏輯是否正確；但 dry-run 不寫檔）
  const newState = {
    active: currentlyActive,
    activeSince: currentlyActive ? (prevState.active ? prevState.activeSince : nowTaipeiISO()) : null,
    phenomena: currentPhenomena,
    lastCheck: nowTaipeiISO(),
  };

  if (DRY_RUN) {
    console.log('\n--- DRY RUN ---');
    console.log('Would write state:', JSON.stringify(newState, null, 2));
    if (events.length > 0) console.log('Would send events:', JSON.stringify(events, null, 2));
    return;
  }

  // 寫 state 檔（即使無事件也要寫，記錄 lastCheck）
  saveState(newState);
  console.log(`💾 typhoon-state.json 已更新（active=${newState.active}）`);

  // 供 GitHub Actions 後續步驟判斷：有「進入/解除」轉換 → 觸發網站重建
  // （首頁颱風橫條認 typhoon-state 的 active，重建後即時上/下架；2026-07-12 全自動化）
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `transition=${events.length > 0}\n`);
  }

  if (events.length === 0) return;

  const webhookUrl = process.env.APPS_SCRIPT_WEBHOOK_URL;
  const secret = process.env.APPS_SCRIPT_SHARED_SECRET;
  if (!webhookUrl || !secret) {
    console.error('❌ 缺少 APPS_SCRIPT_WEBHOOK_URL 或 APPS_SCRIPT_SHARED_SECRET');
    process.exit(1);
  }

  const result = await postJson(webhookUrl, { secret, events });
  console.log(`✅ Bridge 回應：${JSON.stringify(result)}`);
})().catch(e => {
  console.error('❌ typhoon-alert 失敗：', e.message);
  process.exit(1);
});
