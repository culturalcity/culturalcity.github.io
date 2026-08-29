// 驗證 apps-script/weather-fetch.gs 的純邏輯（解析、合併、序列化）與
// scripts/fetch-weather.js 產出「逐位元相同」。兩支解析規則須同步改，改完跑這支。
//
// 用法：node scripts/test-weather-fetch-equiv.js
// 會真的打一次 CODiS（昨天所在月份），需要網路；不寫任何檔案。
// 三個情境：① repo 缺昨天 → 合併後與現行 json 逐位元相同
//           ② repo 已有昨天 → 無變化
//           ③ CODiS 若含今天 → 不寫入

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'apps-script', 'weather-fetch.gs'), 'utf8');

function grab(name) {
  const m = src.match(new RegExp('function ' + name + '\\([\\s\\S]*?\\n}\\n'));
  if (!m) throw new Error('weather-fetch.gs 找不到 function ' + name);
  return m[0];
}
const fnSrc = ['fmt2', 'mergeRecords', 'serialize', 'fetchMonth'].map(grab).join('\n');

// 假 UrlFetchApp：Apps Script 是同步 API，用 curl 同步打 CODiS
const UrlFetchApp = {
  fetch(url, o) {
    const body = Object.entries(o.payload).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
    const cmd = 'curl -s -X POST ' + url +
      ' -H "Content-Type: application/x-www-form-urlencoded" -H "User-Agent: Mozilla/5.0"' +
      ' -H "Referer: https://codis.cwa.gov.tw/StationData" -H "X-Requested-With: XMLHttpRequest"' +
      ' --data "' + body + '"';
    const out = execSync(cmd, { maxBuffer: 1e7 }).toString();
    return { getResponseCode: () => 200, getContentText: () => out };
  }
};
const STATION_ID = '466920';
eval(fnSrc); // eslint-disable-line no-eval

function yesterdayTaipeiISO() {
  const t = new Date(Date.now() + 8 * 3600 * 1000);
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}
const yest = yesterdayTaipeiISO();
const todayISO = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

const tempFile = fs.readFileSync(path.join(ROOT, 'utility/data/daily-temp.json'), 'utf8');
const rainFile = fs.readFileSync(path.join(ROOT, 'utility/data/daily-rain.json'), 'utf8');
if (!JSON.parse(tempFile).some(r => r.d === yest)) {
  console.log('⚠️  現行 daily-temp.json 還沒有 ' + yest + '，情境① 無法比對；先跑 node scripts/fetch-weather.js 再測');
  process.exit(2);
}

const tempBase = JSON.parse(tempFile).filter(r => r.d !== yest);
const rainBase = JSON.parse(rainFile).filter(r => r.d !== yest);
const recs = fetchMonth(Number(yest.slice(0, 4)), Number(yest.slice(5, 7)));
console.log('CODiS 回', recs.length, '天，最後：', JSON.stringify(recs[recs.length - 1]));

const m1 = mergeRecords(tempBase, rainBase, recs, yest);
const outT = serialize(m1.temp), outR = serialize(m1.rain);
console.log('情境① 缺昨天→合併：', m1.summary,
  '| temp 位元組相同:', outT === tempFile, '| rain 位元組相同:', outR === rainFile);

const m2 = mergeRecords(JSON.parse(tempFile), JSON.parse(rainFile), recs, yest);
console.log('情境② 已有昨天：', m2.summary, '| changed:', m2.tempChanged, m2.rainChanged);

const m3 = mergeRecords(tempBase, rainBase, recs, yest);
console.log('情境③ 合併結果含今天？', m3.temp.some(r => r.d === todayISO));

const ok = outT === tempFile && outR === rainFile && !m2.tempChanged && !m2.rainChanged && !m3.temp.some(r => r.d === todayISO);
console.log(ok ? '\n✅ 全部通過' : '\n❌ 有不符');
process.exit(ok ? 0 : 1);
