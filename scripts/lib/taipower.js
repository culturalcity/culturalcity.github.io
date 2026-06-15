// 從台電 ebpps2 AMI 抓大公電（00815173019）昨日用電度數。
//
// 流程：
//   1. 訪問 /ebpps2/bill/myebill-overview（檢查 session、找電號表）
//   2. 點含「大公電」row 的 .btn-ami → 跳轉到 /amichart/amidashball/{token}
//   3. 點「智慧電表(AMI)用電統計」link → 跳轉到 /amichart/amichartindex/{period}/{token}
//   4. 點 #monthchartlink（「每日」標籤）
//   5. 從 AmCharts.charts[2].dataProvider 抓昨日的 chartCol4
//
// 注意：
//   - chartCol4 與 chartCol5 通常同值（同一個度數放兩欄），取 chartCol4 即可
//   - 月初幾天會看不到目標月，因為頁面顯示「本月」；昨天若是上個月最後一天
//     會需要切換月份（v0.1 不處理，月初手動補）
//   - dataProvider 中 chartUnit 為 "1日", "2日", ... "31日"，未來日 chartCol4 = null
//
// 環境變數：
//   TPC_METER       目標電號（預設 00815173019）

const OVERVIEW_URL = 'https://service.taipower.com.tw/ebpps2/bill/myebill-overview';
const LOGIN_URL_PATTERN = /\/ebpps2\/login/;
const TPC_DOMAIN = 'service.taipower.com.tw';

class TaipowerSessionExpiredError extends Error {
  constructor() {
    super('台電 session 失效，請重新登入 ebpps2');
    this.name = 'TaipowerSessionExpiredError';
  }
}

class TaipowerScrapeError extends Error {
  constructor(message) {
    super('台電抓取失敗: ' + message);
    this.name = 'TaipowerScrapeError';
  }
}

async function findOrCreateTaipowerPage(browser) {
  const pages = await browser.pages();
  let page = pages.find((p) => p.url().includes(TPC_DOMAIN));
  if (!page) {
    page = await browser.newPage();
  }
  return page;
}

async function navigateAndAssertLoggedIn(page) {
  await page.goto(OVERVIEW_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1000));
  if (LOGIN_URL_PATTERN.test(page.url())) {
    throw new TaipowerSessionExpiredError();
  }
}

async function clickMeterAmiButton(page, meterId) {
  const navPromise = page
    .waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 })
    .catch(() => null);
  const result = await page.evaluate((targetMeter) => {
    // 帳單頁面同時有 desktop 與 mobile 兩套 row（mobile 預設 display:none）。
    // 只找 visible 的 .btn-ami button，且其所在 row 含目標電號或「大公電」。
    const buttons = [...document.querySelectorAll('.btn-ami')].filter(
      (b) => b.offsetParent !== null
    );
    const btn = buttons.find((b) => {
      const row = b.closest('tr');
      if (!row) return false;
      const t = row.innerText || '';
      return t.includes(targetMeter) || /大公電/.test(t);
    });
    if (!btn) return { ok: false, reason: 'no visible .btn-ami for 大公電 row' };
    btn.click();
    return { ok: true };
  }, meterId);
  if (!result.ok) throw new TaipowerScrapeError(result.reason);
  await navPromise;
  if (!/\/amichart\/amidash/.test(page.url())) {
    throw new TaipowerScrapeError(`AMI dashboard 沒載入，目前 URL: ${page.url()}`);
  }
  await new Promise((r) => setTimeout(r, 1500));
}

async function clickUsageStatsLink(page) {
  const navPromise = page
    .waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 })
    .catch(() => null);
  const clicked = await page.evaluate(() => {
    const link = [...document.querySelectorAll('a')].find((a) =>
      /智慧電表.*用電統計/.test(a.innerText || '')
    );
    if (!link) return false;
    link.click();
    return true;
  });
  if (!clicked) throw new TaipowerScrapeError('找不到「智慧電表(AMI)用電統計」連結');
  await navPromise;
  if (!/\/amichart\/amichartindex/.test(page.url())) {
    throw new TaipowerScrapeError(`用電統計頁沒載入，目前 URL: ${page.url()}`);
  }
  await new Promise((r) => setTimeout(r, 1500));
}

// 從所有 AmCharts.charts 中找含「N日」chartUnit 的 chart（即「每日」chart）。
// 不依賴固定 idx，因為 chart 載入順序在 fresh navigate 時不穩。
function findDailyChartFn() {
  if (typeof AmCharts === 'undefined' || !AmCharts.charts) return null;
  for (const c of AmCharts.charts) {
    if (!Array.isArray(c.dataProvider) || c.dataProvider.length === 0) continue;
    const sample = c.dataProvider[0];
    if (sample && typeof sample.chartUnit === 'string' && /^\d+日$/.test(sample.chartUnit)) {
      return c;
    }
  }
  return null;
}

async function clickDailyTab(page) {
  // 等 monthchartlink 元素先出現再 click，避免 race condition
  try {
    await page.waitForSelector('#monthchartlink', { timeout: 10000 });
  } catch (_) {
    throw new TaipowerScrapeError('#monthchartlink selector 沒在 10 秒內出現');
  }
  await page.evaluate(() => {
    document.querySelector('#monthchartlink').click();
  });
  try {
    await page.waitForFunction(
      () => {
        if (typeof AmCharts === 'undefined' || !AmCharts.charts) return false;
        for (const c of AmCharts.charts) {
          if (!Array.isArray(c.dataProvider) || c.dataProvider.length === 0) continue;
          const s = c.dataProvider[0];
          if (s && typeof s.chartUnit === 'string' && /^\d+日$/.test(s.chartUnit)) return true;
        }
        return false;
      },
      // polling: 500ms interval (預設 'raf' 在背景 tab 會被 throttle)
      { timeout: 20000, polling: 500 }
    );
  } catch (_) {
    throw new TaipowerScrapeError('每日 chart 沒在 20 秒內載入');
  }
  await new Promise((r) => setTimeout(r, 800));
}

async function extractDailyReading(page, targetDay) {
  const data = await page.evaluate((day) => {
    let dailyChart = null;
    for (const c of AmCharts.charts) {
      if (!Array.isArray(c.dataProvider) || c.dataProvider.length === 0) continue;
      const s = c.dataProvider[0];
      if (s && typeof s.chartUnit === 'string' && /^\d+日$/.test(s.chartUnit)) {
        dailyChart = c;
        break;
      }
    }
    if (!dailyChart) return { ok: false, reason: 'no daily chart found' };
    const dp = dailyChart.dataProvider;
    const label = day + '日';
    const row = dp.find((r) => r.chartUnit === label);
    if (!row) return { ok: false, reason: `no row for ${label}`, available: dp.map(r => r.chartUnit) };
    const val = row.chartCol4 != null ? row.chartCol4 : row.chartCol5;
    if (val == null) return { ok: false, reason: `${label} 為 null（尚未回傳）` };
    return { ok: true, value: val, custNo: row.custNo };
  }, targetDay);
  if (!data.ok) throw new TaipowerScrapeError(data.reason + (data.available ? ` available: ${data.available.join(',')}` : ''));
  return Math.round(data.value * 100) / 100;
}

/**
 * 抓昨日（或指定日期）大公電用電度數。
 *
 * @param {Browser} browser  puppeteer-core browser (CDP 連線好的)
 * @param {string} dateISO   'YYYY-MM-DD'
 * @returns {Promise<number>} 度數（kWh）
 */
async function fetchDailyElectric(browser, dateISO) {
  const meter = process.env.TPC_METER || '00815173019';

  const page = await findOrCreateTaipowerPage(browser);
  await navigateAndAssertLoggedIn(page);
  await clickMeterAmiButton(page, meter);
  await clickUsageStatsLink(page);
  await clickDailyTab(page);

  const targetDay = parseInt(dateISO.slice(-2), 10);
  // v0.1 限制：只支援查本月日期。月初要查上月最後一天時抛錯讓主流程通知。
  const todayMonth = new Date().getMonth() + 1;
  const targetMonth = parseInt(dateISO.slice(5, 7), 10);
  if (targetMonth !== todayMonth) {
    throw new TaipowerScrapeError(`目前頁面顯示本月，無法查跨月日期 ${dateISO}（v0.1 限制）`);
  }

  return extractDailyReading(page, targetDay);
}

module.exports = {
  fetchDailyElectric,
  TaipowerSessionExpiredError,
  TaipowerScrapeError,
};
