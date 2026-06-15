// 每日早上自動抓前一日大公電 + 公水度數，寫到 culturalcity.org KV。
//
// 排程：Windows 工作排程器每天 06:30 觸發 scripts\fetch-utility.bat
// 規劃文件：raw/UTILITY-AUTOMATION-PLAN.md
//
// 用法：
//   node scripts/fetch-utility.js                # 抓昨天並寫入
//   node scripts/fetch-utility.js --dry-run      # 抓但不寫入（log 出結果）
//   node scripts/fetch-utility.js --date=YYYY-MM-DD  # 抓指定日期
//   node scripts/fetch-utility.js --skip-water    # 只抓電
//   node scripts/fetch-utility.js --skip-electric # 只抓水
//
// 退出碼：
//   0 = 成功（兩個來源都抓到並寫入）
//   1 = 部分失敗（至少一個來源失敗，已寫入抓到的部分）
//   2 = 完全失敗（Chrome 沒開 / KV 寫入失敗 / 兩來源都失敗）

require('./lib/env').load();
const cdp = require('./lib/chrome-cdp');
const kv = require('./lib/kv-utility');
const taipower = require('./lib/taipower');
const taipeiWater = require('./lib/taipei-water');

function yesterdayISO() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.getFullYear() + '-'
    + String(d.getMonth() + 1).padStart(2, '0') + '-'
    + String(d.getDate()).padStart(2, '0');
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { dryRun: false, date: yesterdayISO(), skipWater: false, skipElectric: false };
  for (const a of args) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--skip-water') out.skipWater = true;
    else if (a === '--skip-electric') out.skipElectric = true;
    else if (a.startsWith('--date=')) out.date = a.slice(7);
  }
  return out;
}

function notify(title, message) {
  // 簡易桌面通知（用 msg.exe，Windows 內建）。失敗不影響主流程。
  const { spawn } = require('child_process');
  try {
    spawn('msg', [process.env.USERNAME || '*', `${title}: ${message}`], {
      stdio: 'ignore',
      detached: true,
    }).unref();
  } catch (_) {}
}

function ts() {
  return new Date().toISOString();
}

async function main() {
  const { date, dryRun, skipWater, skipElectric } = parseArgs();
  console.log(`[${ts()}] target=${date}${dryRun ? ' (DRY RUN)' : ''}`);

  let browser;
  try {
    browser = await cdp.connect();
  } catch (e) {
    if (e instanceof cdp.ChromeNotRunningError) {
      console.error(e.message);
      notify('閱大安水電抓取', '自動化 Chrome 沒開');
      process.exit(2);
    }
    throw e;
  }

  const results = { water: null, electric: null, errors: [] };

  if (!skipElectric) {
    try {
      results.electric = await taipower.fetchDailyElectric(browser, date);
      console.log(`[${ts()}] 台電 e_yd = ${results.electric} kWh`);
    } catch (e) {
      results.errors.push(e.message);
      console.error(`[${ts()}] 台電失敗: ${e.message}`);
    }
  }

  if (!skipWater) {
    try {
      results.water = await taipeiWater.fetchDailyWater(browser, date);
      console.log(`[${ts()}] 北水 w_yd = ${results.water} 度`);
    } catch (e) {
      results.errors.push(e.message);
      console.error(`[${ts()}] 北水失敗: ${e.message}`);
    }
  }

  browser.disconnect();

  if (results.water == null && results.electric == null) {
    console.error(`[${ts()}] 兩個來源都失敗，不寫入 KV`);
    notify('閱大安水電抓取', `失敗：${results.errors.join('; ')}`);
    process.exit(2);
  }

  if (dryRun) {
    console.log(`[${ts()}] DRY RUN：跳過 KV 寫入。結果:`, results);
    return;
  }

  try {
    const { updated, skipped } = await kv.mergeDailyUtility({
      date,
      water: results.water,
      electric: results.electric,
    });
    console.log(`[${ts()}] KV updated=[${updated.join(',')}] skipped=[${skipped.join(',')}]`);
  } catch (e) {
    console.error(`[${ts()}] KV 寫入失敗:`, e.message);
    notify('閱大安水電抓取', `KV 寫入失敗: ${e.message}`);
    process.exit(2);
  }

  if (results.errors.length > 0) {
    notify('閱大安水電抓取', `部分成功 (${date}): ${results.errors.join('; ')}`);
    process.exit(1);
  }

  console.log(`[${ts()}] 完成。`);
}

main().catch((e) => {
  console.error(`[${ts()}] FATAL:`, e);
  notify('閱大安水電抓取', `非預期錯誤: ${e.message}`);
  process.exit(2);
});
