// 高溫關懷自動提醒：每天 17:00 台北跑一次
//
// 雙軌設計（呼應臺北市氣候行動獎「高溫警報時關懷獨居長者」要求）：
//   主軌：CWA W-C0033-005 高溫資訊（黃/橘/紅燈）有發布 → 「必須關懷」
//   副軌：CWA F-D0047-063 大安區明日 MaxT ≥ 36°C → 「建議關懷」（與 CWA 黃燈門檻一致，
//        當作「明日很可能會發黃燈」的前置提醒，給總幹事一晚的準備時間）
// 兩條獨立判斷，可能同日都觸發，由 Apps Script bridge 用標題 + 日期去重。
//
// 環境變數：
//   CWA_API_KEY                  CWA OpenData 平台 authkey
//   APPS_SCRIPT_WEBHOOK_URL      Apps Script Web App 部署 URL
//   APPS_SCRIPT_SHARED_SECRET    雙方共用 token（避免被亂打）
//
// 排程：
//   .github/workflows/deploy.yml 內 cron '0 9 * * *'（UTC 09:00 = 台北 17:00）
//
// 手動測試：
//   node scripts/check-heat-alert.js           # 真打 API、真送 webhook
//   node scripts/check-heat-alert.js --dry-run # 真打 API、不送 webhook（只 console.log payload）

const https = require('https');

const CWA_BASE = 'https://opendata.cwa.gov.tw/api/v1/rest/datastore';
const WARNING_DATASET = 'W-C0033-005';    // 高溫資訊
const FORECAST_DATASET = 'F-D0047-063';   // 臺北市鄉鎮 1 週預報（有「最高溫度」element；
                                          // F-D0047-061 是逐 3 小時，只有「溫度」沒有 MaxT）
const DISTRICT = '大安區';
const FORECAST_THRESHOLD_C = 36;          // 副軌門檻：明日 MaxT ≥ 36°C（與 CWA 黃燈門檻一致）

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
        // Apps Script Web App 對非 2xx 也可能回 200 + error JSON，要看 body
        try {
          const parsed = JSON.parse(buf);
          if (res.statusCode >= 200 && res.statusCode < 300 && parsed.ok) {
            resolve(parsed);
          } else {
            reject(new Error(`Webhook failed (HTTP ${res.statusCode}): ${buf.slice(0, 300)}`));
          }
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

// ---- 副軌：明日預報 ----
async function checkForecast(apiKey) {
  const url = `${CWA_BASE}/${FORECAST_DATASET}`
    + `?Authorization=${encodeURIComponent(apiKey)}`
    + `&format=JSON`
    + `&LocationName=${encodeURIComponent(DISTRICT)}`
    + `&ElementName=${encodeURIComponent('最高溫度')}`;
  const json = await get(url);
  const locations = (json.records && json.records.Locations && json.records.Locations[0] && json.records.Locations[0].Location) || [];
  if (locations.length === 0) {
    throw new Error(`${FORECAST_DATASET} 找不到 ${DISTRICT} 的資料`);
  }
  const loc = locations[0];
  const elements = loc.WeatherElement || [];
  const maxT = elements.find(e => (e.ElementName || '').includes('最高溫度'));
  if (!maxT) throw new Error('找不到「最高溫度」WeatherElement');

  const tomorrowDate = tomorrowTaipei(); // YYYY-MM-DD
  const times = maxT.Time || [];
  // 明日有多筆時段（白天 06-18、夜間 18-06），取明日所有時段裡最高的
  let peak = null;
  for (const t of times) {
    const start = (t.StartTime || '').slice(0, 10);
    if (start !== tomorrowDate) continue;
    const valStr = t.ElementValue && t.ElementValue[0] && (t.ElementValue[0].MaxTemperature || t.ElementValue[0].Temperature || t.ElementValue[0].value);
    const val = Number(valStr);
    if (!Number.isFinite(val)) continue;
    if (peak === null || val > peak.value) {
      peak = { value: val, startTime: t.StartTime, endTime: t.EndTime };
    }
  }
  if (peak === null) return null;
  if (peak.value < FORECAST_THRESHOLD_C) return { hit: false, peakC: peak.value, date: tomorrowDate };
  return { hit: true, peakC: peak.value, date: tomorrowDate };
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
    const fc = await checkForecast(apiKey);
    if (fc && fc.hit) {
      console.log(`🌡️  副軌：明日（${fc.date}）大安區預報 ${fc.peakC}°C ≥ ${FORECAST_THRESHOLD_C}°C`);
      events.push({
        track: 'forecast',
        date: fc.date,
        title: `🌡️ 預報高溫・建議關懷獨居長者（明日 ${Math.round(fc.peakC)}°C）`,
        description:
          `大安區明日預報最高溫 ${fc.peakC}°C，達中央氣象署高溫資訊黃燈門檻（36°C）。\n` +
          `中央氣象署可能於明日早晨發布正式警報；社區提前在前一晚啟動關懷，\n` +
          `讓總幹事能事先安排訪視時段，建議致電獨居長者確認狀況。\n\n` +
          `📌 由 heat-alert 系統自動建立\n` +
          `資料來源：CWA F-D0047-063`,
        color: 'TANGERINE',
      });
    } else if (fc) {
      console.log(`ℹ️  副軌：明日（${fc.date}）大安區預報 ${fc.peakC}°C < ${FORECAST_THRESHOLD_C}°C，不觸發`);
    }
  } catch (e) {
    console.error('❌ 副軌（F-D0047-061）失敗：', e.message);
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
