// 抓臺北站 (466920) 當日高低溫，存到 utility/data/daily-temp.json
//
// 用法：
//   node scripts/fetch-temp.js          # 抓現在的當日高低溫
//
// 排程建議：
//   每天 23:55 執行一次，捕捉當日接近最終的高低溫
//   （CWA 的 D_TX/D_TN 一過 00:00 就會清空為新一天）
//
// 設定：
//   .env 內需有 CWA_API_KEY（中央氣象署開放資料平台金鑰）
//
// 資料來源：
//   https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0001-001
//   StationId=466920（臺北站，與 CODIS 同一筆觀測資料）

const fs = require('fs');
const path = require('path');
const https = require('https');

const STATION_ID = '466920';
const PROJECT_ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(PROJECT_ROOT, '.env');
const DATA_PATH = path.join(PROJECT_ROOT, 'utility', 'data', 'daily-temp.json');

function loadEnv() {
  const raw = fs.readFileSync(ENV_PATH, 'utf8');
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim().startsWith('#') || !line.includes('=')) continue;
    const eq = line.indexOf('=');
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    env[k] = v;
  }
  return env;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP ${res.statusCode}: ${buf.slice(0, 200)}`));
          }
          try {
            resolve(JSON.parse(buf));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

(async () => {
  const env = loadEnv();
  const key = env.CWA_API_KEY;
  if (!key) {
    console.error('❌ 找不到 CWA_API_KEY，請檢查專案根目錄的 .env 檔');
    process.exit(1);
  }

  const url = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0001-001?Authorization=${key}&StationId=${STATION_ID}`;
  const json = await fetchJson(url);
  const station = json && json.records && json.records.Station && json.records.Station[0];
  if (!station) {
    console.error('❌ CWA 回應沒有測站資料：', JSON.stringify(json).slice(0, 200));
    process.exit(1);
  }

  const obsDate = station.ObsTime.DateTime.slice(0, 10);
  const ext = station.WeatherElement.DailyExtreme;
  const tmax = parseFloat(ext.DailyHigh.TemperatureInfo.AirTemperature);
  const tmin = parseFloat(ext.DailyLow.TemperatureInfo.AirTemperature);

  if (!Number.isFinite(tmax) || !Number.isFinite(tmin)) {
    console.error('❌ 高低溫數值異常：tmax=', tmax, 'tmin=', tmin);
    process.exit(1);
  }

  const entry = { d: obsDate, tmax, tmin };

  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  let records = [];
  if (fs.existsSync(DATA_PATH)) {
    records = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  }
  const idx = records.findIndex((r) => r.d === entry.d);
  const action = idx >= 0 ? '更新' : '新增';
  if (idx >= 0) records[idx] = entry;
  else records.push(entry);
  records.sort((a, b) => a.d.localeCompare(b.d));
  fs.writeFileSync(DATA_PATH, JSON.stringify(records) + '\n');

  console.log(
    `✅ 已${action} ${entry.d} 466920 臺北站：高 ${entry.tmax}°C / 低 ${entry.tmin}°C  → ${path.relative(PROJECT_ROOT, DATA_PATH)}`
  );
})().catch((e) => {
  console.error('❌ 抓取失敗：', e.message);
  process.exit(1);
});
