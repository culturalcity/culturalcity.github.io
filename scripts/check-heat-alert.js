// 高溫關懷自動提醒：每天 17:00 台北跑一次
//
// 雙軌設計（呼應臺北市氣候行動獎「高溫警報時關懷獨居長者」要求）：
//   主軌：CWA W-C0033-005 高溫資訊（OpenData JSON） → 當日已 settled 警報「必須關懷」
//   副軌：CWA Warning_Content.js + Warning_Taiwan.js → 明日 W29 燈號預測「建議關懷」
//        副軌資料源是 W29.html 的 source，CWA 17:30 publish 明日預測時已含明日燈號
//        （F-D0047-063 只給 MaxT 數字、無法區分黃/橙/紅；2026-05-25 換掉）
// 兩條判斷：若同一個 advisory 同時被主軌 (validTime.startTime=今日) 與副軌
// (validto.date=明日) 命中，靠不同 title + date 在 Calendar 上呈現為兩件事。
//
// 環境變數：
//   CWA_API_KEY                  CWA OpenData 平台 authkey（僅主軌需要）
//   APPS_SCRIPT_WEBHOOK_URL      Apps Script Web App 部署 URL
//   APPS_SCRIPT_SHARED_SECRET    雙方共用 token（避免被亂打）
//
// 排程：
//   .github/workflows/heat-alert.yml 內 cron '0 9 * * *'（UTC 09:00 = 台北 17:00）
//
// 手動測試：
//   node scripts/check-heat-alert.js           # 真打 API、真送 webhook
//   node scripts/check-heat-alert.js --dry-run # 真打 API、不送 webhook（只 console.log payload）

const https = require('https');

const CWA_BASE = 'https://opendata.cwa.gov.tw/api/v1/rest/datastore';
const WARNING_DATASET = 'W-C0033-005';    // 主軌：高溫資訊（OpenData）

// 副軌：W29 高溫資訊 page 的 JS source（含明日燈號預測，CWA 17:30 publish）
const CWA_W29_BASE = 'https://www.cwa.gov.tw/Data/js/warn';
const TAIPEI_COUNTY_CODE = '63';          // CWA 縣市代號：臺北市
const W29_LEVELS = {
  '1': { zh: '黃', en: 'Yellow',  color: 'TANGERINE' },
  '2': { zh: '橙', en: 'Orange',  color: 'TANGERINE' },
  '3': { zh: '紅', en: 'Red',     color: 'TOMATO'    },
};

const DRY_RUN = process.argv.includes('--dry-run');

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'culturalcity-heat-alert' } }, res => {
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

// 抓純文字（給副軌的 CWA frontend JS 模組用，不是 JSON）
function getText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'culturalcity-heat-alert' } }, res => {
      let buf = '';
      res.on('data', c => (buf += c));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}: ${buf.slice(0, 200)}`));
        }
        resolve(buf);
      });
    }).on('error', reject);
  });
}

// 從 `var X = {...};` 形式的 CWA JS 取出 X 物件
// 用 new Function() 在 sandbox 內 evaluate；CWA 內容都是 literal assignment、無 side effect，
// 來源是政府網站可信。若日後 CWA 改寫法導致 parse 失敗，會丟出明確 Error。
function evalJsModule(jsText, varName) {
  const fn = new Function(jsText + `\nreturn typeof ${varName} !== 'undefined' ? ${varName} : null;`);
  return fn();
}

// Apps Script Web App 永遠回 302 把 client 導到 script.googleusercontent.com/macros/echo，
// 必須 follow redirect 才會拿到真 JSON。用 Node 22 內建 fetch，預設 redirect:'follow' 即可，
// POST→302 規範下會自動改成 GET，剛好對應 echo endpoint 的拿法。
async function postJson(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    redirect: 'follow',
  });
  const buf = await res.text();
  try {
    const parsed = JSON.parse(buf);
    if (res.ok && parsed.ok) return parsed;
    throw new Error(`Webhook failed (HTTP ${res.status}): ${buf.slice(0, 300)}`);
  } catch (e) {
    if (e.message.startsWith('Webhook failed')) throw e;
    throw new Error(`Webhook returned non-JSON (HTTP ${res.status}): ${buf.slice(0, 300)}`);
  }
}

// 台北時區「明天」的 YYYY-MM-DD
function tomorrowTaipei() {
  const taipeiMs = Date.now() + 8 * 60 * 60 * 1000;
  const t = new Date(taipeiMs);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}

// ---- 主軌：高溫警報 ----
async function checkWarning(apiKey) {
  const url = `${CWA_BASE}/${WARNING_DATASET}?Authorization=${encodeURIComponent(apiKey)}&format=JSON`;
  const json = await get(url);
  const records = (json.records && json.records.record) || [];
  if (records.length === 0) return null;

  // 任何一筆 record 的 affectedAreas 含「臺北市」就算大安區受影響
  for (const rec of records) {
    const hazards = (rec.hazardConditions && rec.hazardConditions.hazards) || [];
    for (const h of hazards) {
      const phenomena = (h.info && h.info.phenomena) || '';
      if (!phenomena.includes('高溫')) continue;
      const areas = (h.info.affectedAreas && h.info.affectedAreas.location) || [];
      const hitTaipei = areas.some(a => (a.locationName || '').includes('臺北市'));
      if (!hitTaipei) continue;

      const significance = (h.info.significance && h.info.significance.value) || '';
      const validTime = (rec.datasetInfo && rec.datasetInfo.validTime) || {};
      const contentText = (rec.contents && rec.contents.content && rec.contents.content.contentText) || '';
      return {
        significance,           // 燈號 / 警報等級
        startTime: validTime.startTime || '',
        endTime: validTime.endTime || '',
        contentText: contentText.trim().slice(0, 500),
      };
    }
  }
  return null;
}

// ---- 副軌：明日燈號預測（CWA W29 Warning_Content.js + Warning_Taiwan.js） ----
//
// CWA 在每天 17:30 publish「明日各縣市燈號」資訊，發送給 W29 高溫資訊 page。
// 結構化資料在 Warning_Taiwan.js（county code → ['W29-N']），N=1 黃 / 2 橙 / 3 紅。
// 人類可讀全文在 Warning_Content.js（W29.C.content）。我們把兩個都拉。
//
// validto 用來判斷這份 advisory 涵蓋的日期：
//   - validto.date == 明日 → 是「前一日 17:30 發的明日預測」，副軌觸發
//   - validto.date == 今日 → 是「當日 07:30 發的今日 advisory」，副軌跳過（主軌處理）
//   - 其他 → 過期或異常，跳過
async function checkForecast() {
  // 1. 拉結構化燈號表
  const taiwanJs = await getText(`${CWA_W29_BASE}/Warning_Taiwan.js`);
  const WarnTown = evalJsModule(taiwanJs, 'WarnTown');
  if (!WarnTown) throw new Error('Warning_Taiwan.js 解析失敗（找不到 WarnTown 變數）');

  const taipeiEntry = WarnTown[TAIPEI_COUNTY_CODE];
  if (!taipeiEntry) return null; // 臺北無任何警報

  // T/G/M/N/C 是不同 map layer，但 W29 燈號在所有 layer 應一致；取第一個 W29-N
  let w29Code = null;
  for (const key of Object.keys(taipeiEntry)) {
    const codes = taipeiEntry[key] || [];
    const found = codes.find(c => typeof c === 'string' && c.startsWith('W29-'));
    if (found) { w29Code = found; break; }
  }
  if (!w29Code) return null; // 臺北有其他警報但無 W29

  const levelNum = w29Code.split('-')[1];
  const level = W29_LEVELS[levelNum];
  if (!level) throw new Error(`未知 W29 等級代號：${w29Code}`);

  // 2. 拉文字內容：取 issued/validto/原文
  const contentJs = await getText(`${CWA_W29_BASE}/Warning_Content.js`);
  const WarnContent = evalJsModule(contentJs, 'WarnContent');
  const w29Content = WarnContent && WarnContent.W29 && WarnContent.W29.C;
  if (!w29Content) throw new Error('Warning_Content.js 找不到 W29.C');

  // validto 格式：'2026/05/26 17:00' → 取日期部分轉成 YYYY-MM-DD
  const validto = w29Content.validto || '';
  const validtoDate = validto.slice(0, 10).replace(/\//g, '-');
  const tomorrowDate = tomorrowTaipei();

  // 若 validto 不是明日，是「今日 advisory」（07:30 publish 的），副軌跳過讓主軌處理
  if (validtoDate !== tomorrowDate) {
    return {
      level,
      validto,
      validtoDate,
      content: w29Content.content || '',
      isToday: true,
      date: validtoDate,
    };
  }

  return {
    level,
    validto,
    issued: w29Content.issued || '',
    content: w29Content.content || '',
    isToday: false,
    date: tomorrowDate,
  };
}

// ---- 主流程 ----
(async () => {
  const apiKey = process.env.CWA_API_KEY;
  if (!apiKey) {
    console.error('❌ 缺少 CWA_API_KEY 環境變數');
    process.exit(1);
  }

  const events = []; // 要送給 bridge 的事件清單

  // 主軌
  try {
    const warning = await checkWarning(apiKey);
    if (warning) {
      console.log(`⚠️  主軌：CWA 高溫警報 [${warning.significance}] 含臺北市`);
      events.push({
        track: 'warning',
        date: (warning.startTime || '').slice(0, 10) || tomorrowTaipei(),
        title: `⚠️ CWA 高溫警報・必須關懷獨居長者${warning.significance ? '（' + warning.significance + '）' : ''}`,
        description:
          `中央氣象署發布高溫資訊，臺北市在影響範圍內。\n\n` +
          `**等級**：${warning.significance || '（未標示）'}\n` +
          `**生效時間**：${warning.startTime} ~ ${warning.endTime}\n\n` +
          `${warning.contentText}\n\n` +
          `📌 由 heat-alert 系統自動建立\n` +
          `資料來源：CWA W-C0033-005`,
        color: 'TOMATO',
      });
    } else {
      console.log('ℹ️  主軌：目前無高溫警報');
    }
  } catch (e) {
    console.error('❌ 主軌（W-C0033-005）失敗：', e.message);
  }

  // 副軌
  try {
    const fc = await checkForecast();
    if (fc && !fc.isToday) {
      console.log(`🌡️  副軌：CWA 預測明日（${fc.date}）臺北為 ${fc.level.zh}燈`);
      events.push({
        track: 'forecast',
        date: fc.date,
        title: `🌡️ 預報明日臺北${fc.level.zh}燈・建議關懷獨居長者`,
        description:
          `中央氣象署預測明日（${fc.date}）臺北市為${fc.level.zh}色燈號。\n\n` +
          `CWA 發布時間：${fc.issued}\n` +
          `有效至：${fc.validto}\n\n` +
          `--- CWA 原文 ---\n${fc.content}\n\n` +
          `📌 由 heat-alert 系統自動建立\n` +
          `資料來源：CWA W29 Warning_Content.js + Warning_Taiwan.js`,
        color: fc.level.color,
      });
    } else if (fc && fc.isToday) {
      console.log(`ℹ️  副軌：CWA 當前 W29 advisory 涵蓋今日（${fc.date}），副軌跳過（主軌處理）`);
    } else {
      console.log('ℹ️  副軌：CWA 目前無臺北 W29 警報');
    }
  } catch (e) {
    console.error('❌ 副軌（W29 JS）失敗：', e.message);
  }

  if (events.length === 0) {
    console.log('✅ 無需建立任何事件');
    return;
  }

  if (DRY_RUN) {
    console.log('\n--- DRY RUN：以下事件不會送出 ---');
    console.log(JSON.stringify(events, null, 2));
    return;
  }

  const webhookUrl = process.env.APPS_SCRIPT_WEBHOOK_URL;
  const secret = process.env.APPS_SCRIPT_SHARED_SECRET;
  if (!webhookUrl || !secret) {
    console.error('❌ 缺少 APPS_SCRIPT_WEBHOOK_URL 或 APPS_SCRIPT_SHARED_SECRET');
    process.exit(1);
  }

  const result = await postJson(webhookUrl, { secret, events });
  console.log(`✅ Bridge 回應：${JSON.stringify(result)}`);
})().catch(e => {
  console.error('❌ heat-alert 失敗：', e.message);
  process.exit(1);
});
