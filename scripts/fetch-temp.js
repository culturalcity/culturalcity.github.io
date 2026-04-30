// 抓「昨天」（台北時區）的每日高低溫，從 CWA CODiS API。
// 無須 API key（CODiS 是公開端點）。
//
// 用法：
//   node scripts/fetch-temp.js                    # 預設：抓昨天所在的月份（涵蓋月初到昨天的所有缺漏）
//   node scripts/fetch-temp.js 2026-04            # 指定起始月份到昨天
//   node scripts/fetch-temp.js 2022-02            # 從 2022-02 補滿到昨天（全回填）
//   node scripts/fetch-temp.js 2026-03 2026-03    # 指定單月
//
// 排程：
//   GitHub Actions 每天凌晨跑（見 .github/workflows/deploy.yml）。
//   因為 CODiS 拿的是「昨天」settled 完整資料，凌晨後跑都 OK，
//   不用擔心半夜 23~24 點才出現的最低溫沒抓到。
//
// 寫到：utility/data/daily-temp.json，格式 [{d:'YYYY-MM-DD', tmax, tmin}, ...]

const fs = require('fs');
const path = require('path');
const https = require('https');

const STATION_ID = '466920'; // 466920 臺北
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_PATH = path.join(PROJECT_ROOT, 'utility', 'data', 'daily-temp.json');

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
    return {
      d: d.DataDate.slice(0, 10),
      tmax: Number.isFinite(tmax) ? tmax : null,
      tmin: Number.isFinite(tmin) ? tmin : null,
    };
  }).filter(r => r.tmax !== null && r.tmin !== null);
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

(async () => {
  const args = process.argv.slice(2);
  const yestISO = yesterdayTaipeiISO();
  const yestYM = yestISO.slice(0, 7);

  // 預設：只抓昨天所在的那個月（單月查詢，涵蓋月初到昨天的所有缺漏）
  const startYM = args[0] || yestYM;
  const endYM = args[1] || yestYM;

  console.log(`📥 CODiS 抓資料：${startYM} ~ ${endYM}（截至 ${yestISO}）`);

  let existing = [];
  if (fs.existsSync(DATA_PATH)) {
    try { existing = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')); }
    catch (e) { existing = []; }
  }
  const map = new Map(existing.map(r => [r.d, r]));
  const before = map.size;

  const months = ymsBetween(startYM, endYM);
  let added = 0, updated = 0;
  for (const [y, m] of months) {
    process.stdout.write(`  ${y}-${fmt2(m)}: `);
    try {
      const recs = await fetchMonth(y, m);
      let mAdd = 0, mUpd = 0;
      for (const r of recs) {
        if (r.d > yestISO) continue; // 跳過今天 / 未來
        const old = map.get(r.d);
        if (!old) { map.set(r.d, r); mAdd++; added++; }
        else if (old.tmax !== r.tmax || old.tmin !== r.tmin) {
          map.set(r.d, r); mUpd++; updated++;
        }
      }
      console.log(`✓ +${mAdd} ⟳${mUpd}（API 回 ${recs.length} 天）`);
    } catch (e) {
      console.log(`✗ ${e.message}`);
      // 單月查詢失敗就 fail loud，讓 GitHub Actions 知道有問題
      if (months.length === 1) process.exit(1);
    }
    // 多月查詢時禮貌性間隔
    if (months.length > 1) await new Promise(r => setTimeout(r, 250));
  }

  if (added === 0 && updated === 0) {
    const last = [...map.values()].sort((a, b) => b.d.localeCompare(a.d))[0];
    console.log(`\nℹ️  無新資料（既有 ${before} 天，最後一天 ${last ? last.d : 'N/A'}）`);
    return;
  }

  const all = [...map.values()].sort((a, b) => a.d.localeCompare(b.d));
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(all) + '\n');
  console.log(`\n✅ 完成：${all.length} 天（既有 ${before} → 新增 ${added} / 更新 ${updated}）`);
  console.log(`   範圍：${all[0].d} ~ ${all[all.length - 1].d}`);
})().catch(e => {
  console.error('❌ 失敗：', e.message);
  process.exit(1);
});
