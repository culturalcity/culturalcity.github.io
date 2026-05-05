// 抓「昨天」（台北時區）的每日氣象資料，從 CWA CODiS API。
// 目前抓：高低溫、累積降雨。未來要加更多維度（濕度、日照…）都從同一個 API
// response 多解析一個欄位即可，不用多打 API。
//
// 無須 API key（CODiS 是公開端點）。
//
// 用法：
//   node scripts/fetch-weather.js                    # 預設：抓昨天所在的月份
//   node scripts/fetch-weather.js 2026-04            # 指定起始月份到昨天
//   node scripts/fetch-weather.js 2022-02            # 從 2022-02 補滿到昨天（全回填）
//   node scripts/fetch-weather.js 2026-03 2026-03    # 指定單月
//
// 排程：
//   GitHub Actions 每天凌晨跑（見 .github/workflows/deploy.yml）。
//   CODiS 拿的是「昨天」settled 完整資料，凌晨後跑都 OK。
//
// 輸出檔（by-dimension，一個維度一個檔）：
//   utility/data/daily-temp.json  ← [{d, tmax, tmin}, ...]
//   utility/data/daily-rain.json  ← [{d, rain}, ...]    rain 單位 mm

const fs = require('fs');
const path = require('path');
const https = require('https');

const STATION_ID = '466920'; // 466920 臺北
const PROJECT_ROOT = path.resolve(__dirname, '..');
const TEMP_PATH = path.join(PROJECT_ROOT, 'utility', 'data', 'daily-temp.json');
const RAIN_PATH = path.join(PROJECT_ROOT, 'utility', 'data', 'daily-rain.json');

function fmt2(n) { return String(n).padStart(2, '0'); }
function lastDayOfMonth(year, month1) { return new Date(year, month1, 0).getDate(); }

function postForm(url, params) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = new URLSearchParams(params).toString();
    const req = https.request({
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://codis.cwa.gov.tw/StationData',
        'X-Requested-With': 'XMLHttpRequest',
      },
    }, res => {
      let buf = '';
      res.on('data', c => (buf += c));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}: ${buf.slice(0, 200)}`));
        }
        try { resolve(JSON.parse(buf)); }
        catch (e) { reject(new Error('Invalid JSON: ' + buf.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function fetchMonth(year, month) {
  const lastDay = lastDayOfMonth(year, month);
  const json = await postForm('https://codis.cwa.gov.tw/api/station', {
    date: `${year}-${fmt2(month)}-01`,
    type: 'report_month',
    stn_ID: STATION_ID,
    stn_type: 'cwb',
    more: '',
    start: `${year}-${fmt2(month)}-01T00:00:00`,
    end:   `${year}-${fmt2(month)}-${fmt2(lastDay)}T23:59:59`,
  });
  if (json.code !== 200) {
    throw new Error(`API error: ${JSON.stringify(json).slice(0, 300)}`);
  }
  const dts = (json.data && json.data[0] && json.data[0].dts) || [];
  return dts.map(d => {
    const tmax = d.AirTemperature ? d.AirTemperature.Maximum : null;
    const tmin = d.AirTemperature ? d.AirTemperature.Minimum : null;
    const rawRain = d.Precipitation ? d.Precipitation.Accumulation : null;
    // CWA sentinel：-9.8 = 微量降雨（trace，< 0.1 mm，澆水判斷視為 0）
    //               其他負數（-9.9 等）= 缺值
    let rain = null;
    if (Number.isFinite(rawRain)) {
      if (rawRain === -9.8) rain = 0;
      else if (rawRain >= 0) rain = rawRain;
    }
    return {
      d: d.DataDate.slice(0, 10),
      tmax: Number.isFinite(tmax) ? tmax : null,
      tmin: Number.isFinite(tmin) ? tmin : null,
      rain,
    };
  });
}

function ymsBetween(startYM, endYM) {
  const [sy, sm] = startYM.split('-').map(Number);
  const [ey, em] = endYM.split('-').map(Number);
  const list = [];
  let y = sy, m = sm;
  while (y < ey || (y === ey && m <= em)) {
    list.push([y, m]);
    if (++m > 12) { m = 1; y++; }
  }
  return list;
}

// 「昨天」（台北時區）的 ISO 字串
function yesterdayTaipeiISO() {
  const taipeiMs = Date.now() + 8 * 60 * 60 * 1000;
  const t = new Date(taipeiMs);
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}

function loadJson(p) {
  if (!fs.existsSync(p)) return [];
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { return []; }
}

function writeJson(p, arr) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(arr) + '\n');
}

(async () => {
  const args = process.argv.slice(2);
  const yestISO = yesterdayTaipeiISO();
  const yestYM = yestISO.slice(0, 7);

  const startYM = args[0] || yestYM;
  const endYM = args[1] || yestYM;

  console.log(`📥 CODiS 抓資料：${startYM} ~ ${endYM}（截至 ${yestISO}）`);

  // 同時維護兩個 by-dimension JSON：temp 與 rain 各自獨立
  const tempMap = new Map(loadJson(TEMP_PATH).map(r => [r.d, r]));
  const rainMap = new Map(loadJson(RAIN_PATH).map(r => [r.d, r]));
  const tempBefore = tempMap.size;
  const rainBefore = rainMap.size;

  const months = ymsBetween(startYM, endYM);
  let tAdd = 0, tUpd = 0, rAdd = 0, rUpd = 0;

  for (const [y, m] of months) {
    process.stdout.write(`  ${y}-${fmt2(m)}: `);
    try {
      const recs = await fetchMonth(y, m);
      let mtA = 0, mtU = 0, mrA = 0, mrU = 0;
      for (const r of recs) {
        if (r.d > yestISO) continue; // 跳過今天 / 未來

        // temp（沿用舊欄位 tmax/tmin；缺值才不寫）
        if (r.tmax !== null && r.tmin !== null) {
          const cur = { d: r.d, tmax: r.tmax, tmin: r.tmin };
          const old = tempMap.get(r.d);
          if (!old) { tempMap.set(r.d, cur); mtA++; tAdd++; }
          else if (old.tmax !== cur.tmax || old.tmin !== cur.tmin) {
            tempMap.set(r.d, cur); mtU++; tUpd++;
          }
        }

        // rain（已正規化：trace=0、缺值=null 跳過）
        if (r.rain !== null) {
          const cur = { d: r.d, rain: r.rain };
          const old = rainMap.get(r.d);
          if (!old) { rainMap.set(r.d, cur); mrA++; rAdd++; }
          else if (old.rain !== cur.rain) {
            rainMap.set(r.d, cur); mrU++; rUpd++;
          }
        }
      }
      console.log(`✓ temp +${mtA} ⟳${mtU}, rain +${mrA} ⟳${mrU}（API 回 ${recs.length} 天：${recs.map(r => r.d).join(',')}）`);
    } catch (e) {
      console.log(`✗ ${e.message}`);
      if (months.length === 1) process.exit(1);
    }
    if (months.length > 1) await new Promise(r => setTimeout(r, 250));
  }

  if (tAdd === 0 && tUpd === 0) {
    console.log(`ℹ️  daily-temp.json 無新資料（既有 ${tempBefore} 天）`);
  } else {
    const all = [...tempMap.values()].sort((a, b) => a.d.localeCompare(b.d));
    writeJson(TEMP_PATH, all);
    console.log(`✅ daily-temp.json：${all.length} 天（${tempBefore} → +${tAdd} ⟳${tUpd}）`);
  }

  if (rAdd === 0 && rUpd === 0) {
    console.log(`ℹ️  daily-rain.json 無新資料（既有 ${rainBefore} 天）`);
  } else {
    const all = [...rainMap.values()].sort((a, b) => a.d.localeCompare(b.d));
    writeJson(RAIN_PATH, all);
    console.log(`✅ daily-rain.json：${all.length} 天（${rainBefore} → +${rAdd} ⟳${rUpd}）`);
  }
})().catch(e => {
  console.error('❌ 失敗：', e.message);
  process.exit(1);
});
