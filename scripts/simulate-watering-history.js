// 對歷史 daily-rain.json + daily-temp.json 跑現行澆水規則，
// 統計每年「應該澆水」的天數。
//
// 用法：node scripts/simulate-watering-history.js
//
// 限制：
//   · Rule 0（即時雨量）/ Rule 2（CWA 預報）回測不到 → water 天數略偏高
//   · Rule 3 hot-dry 用「該日實際 tmax」代替「預報 tmax」（合理近似）
//   · Rule 1 / Rule 4 / Rule 5 完整套用
//
// CONFIG 跟 apps-script/watering-reminder.gs 保持一致；改 rule 也要同步改。

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const RAIN_PATH = path.join(PROJECT_ROOT, 'utility', 'data', 'daily-rain.json');
const TEMP_PATH = path.join(PROJECT_ROOT, 'utility', 'data', 'daily-temp.json');

const CONFIG = {
  RAIN_YESTERDAY_SKIP: 5,
  RAIN_PAST_3D_SKIP: 8,
  RAIN_PAST_3D_DRY: 2,
  RAIN_PAST_5D_LIGHT: 5,
  HIGH_TEMP: 28,
};

const rainArr = JSON.parse(fs.readFileSync(RAIN_PATH, 'utf8'));
const tempArr = JSON.parse(fs.readFileSync(TEMP_PATH, 'utf8'));

const rainMap = {};
for (const r of rainArr) rainMap[r.d] = r.rain;

const tempMap = {};
for (const t of tempArr) tempMap[t.d] = t.tmax;

function getRainNDaysAgo(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() - n);
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  const key = `${y}-${m}-${day}`;
  return rainMap[key] ?? 0;
}

function sumPastRain(dateStr, n) {
  let sum = 0;
  for (let i = 1; i <= n; i++) sum += getRainNDaysAgo(dateStr, i);
  return sum;
}

function decide(dateStr) {
  const r1 = getRainNDaysAgo(dateStr, 1);
  const past3 = sumPastRain(dateStr, 3);
  const past5 = sumPastRain(dateStr, 5);
  const tmax = tempMap[dateStr] ?? null;

  // Rule 1
  if (r1 >= CONFIG.RAIN_YESTERDAY_SKIP) return { action: 'skip', kind: 'rule1a-yesterday' };
  if (past3 >= CONFIG.RAIN_PAST_3D_SKIP) return { action: 'skip', kind: 'rule1b-past3' };

  // Rule 4
  if (past5 < CONFIG.RAIN_PAST_5D_LIGHT) return { action: 'water', kind: 'dry-spell' };

  // Rule 3 (用實際 tmax)
  if (past3 < CONFIG.RAIN_PAST_3D_DRY && tmax != null && tmax >= CONFIG.HIGH_TEMP) {
    return { action: 'water', kind: 'hot-dry' };
  }

  // Rule 5
  return { action: 'skip', kind: 'rule5-neutral' };
}

// 找兩個 dataset 都有的日期，從第 6 天起（讓 past5 lookback 完整）
const dates = Object.keys(rainMap).filter(d => tempMap[d] != null).sort();
const startIdx = 5; // 跳過前 5 天讓 past5 完整

const stats = {};
for (let i = startIdx; i < dates.length; i++) {
  const d = dates[i];
  const year = d.slice(0, 4);
  const result = decide(d);
  if (!stats[year]) stats[year] = { total: 0, water: 0, byKind: {} };
  stats[year].total++;
  if (result.action === 'water') stats[year].water++;
  stats[year].byKind[result.kind] = (stats[year].byKind[result.kind] || 0) + 1;
}

// 列印
console.log('資料範圍：' + dates[startIdx] + ' ~ ' + dates[dates.length - 1]);
console.log('總天數：' + (dates.length - startIdx));
console.log('');
console.log('年份  | 涵蓋天數 | 應澆水 | 比例   | dry-spell(Rule4) | hot-dry(Rule3) | rule1a-昨日雨 | rule1b-3日雨 | rule5-中性');
console.log('------+---------+--------+--------+------------------+----------------+--------------+-------------+----------');
let totalDays = 0, totalWater = 0;
for (const [year, s] of Object.entries(stats).sort()) {
  const pct = (s.water / s.total * 100).toFixed(1) + '%';
  const dry = s.byKind['dry-spell'] || 0;
  const hot = s.byKind['hot-dry'] || 0;
  const r1a = s.byKind['rule1a-yesterday'] || 0;
  const r1b = s.byKind['rule1b-past3'] || 0;
  const r5 = s.byKind['rule5-neutral'] || 0;
  console.log(`${year}  | ${String(s.total).padStart(7)} | ${String(s.water).padStart(6)} | ${pct.padStart(6)} | ${String(dry).padStart(16)} | ${String(hot).padStart(14)} | ${String(r1a).padStart(12)} | ${String(r1b).padStart(11)} | ${String(r5).padStart(8)}`);
  totalDays += s.total;
  totalWater += s.water;
}
console.log('');
console.log(`整段平均：${totalDays} 天中 ${totalWater} 天應澆水（${(totalWater / totalDays * 100).toFixed(1)}%）`);
console.log(`年化估算：每年約 ${(totalWater / totalDays * 365).toFixed(0)} 天 ≈ ${(totalWater / totalDays * 12).toFixed(1)} 天/月`);
