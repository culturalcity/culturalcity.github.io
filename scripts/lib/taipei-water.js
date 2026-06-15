// 從北水智慧水管家 (webpms.water.gov.taipei) 抓閱大安公水（1-19-0068279）昨日用水度數。
//
// 兩層 session：
//   - mbr.water.gov.taipei  (會員主站，rememberMe 可撐 90 天)
//   - webpms.water.gov.taipei (智慧水管家內部，session 較短)
//   webpms session 失效時，從 mbr 點「相關資訊 → 智慧水管家」走一遍 SSO 重建。
//
// 流程：
//   1. 找/開 webpms page，試 fetch /api/system/profile/waterNum/{n}
//   2. 若回 401/403 或 redirect to /login → 視為 webpms session 失效，
//      從 mbr 點「智慧水管家」入口重建 webpms session，再試
//   3. 拿到 waterId 後，fetch /api/report/profile/{wid}/record?sampling=day
//   4. 找指定日期的 volume
//
// 環境變數：
//   WATER_METER     目標水號（預設 1-19-0068279）

const WEBPMS_BASE = 'https://webpms.water.gov.taipei';
const WEBPMS_PROFILE_URL = WEBPMS_BASE + '/profile';
const WEBPMS_DOMAIN = 'webpms.water.gov.taipei';
const MBR_DASHBOARD_URL = 'https://mbr.water.gov.taipei/WTSVCL055F';
const MBR_LOGIN_PATTERN = /\/Home\/UserLogin/;
const MBR_DOMAIN = 'mbr.water.gov.taipei';

class TaipeiWaterSessionExpiredError extends Error {
  constructor(layer) {
    super(`北水 ${layer} session 失效，請手動登入 https://mbr.water.gov.taipei/Home/UserLogin`);
    this.name = 'TaipeiWaterSessionExpiredError';
  }
}

class TaipeiWaterScrapeError extends Error {
  constructor(message) {
    super('北水抓取失敗: ' + message);
    this.name = 'TaipeiWaterScrapeError';
  }
}

// 找 webpms tab，優先 non-login 的。沒有就 navigate 試試。
async function findOrCreateWebpmsPage(browser) {
  const pages = await browser.pages();
  // 優先找 non-login 的 webpms tab
  let page = pages.find((p) => p.url().includes(WEBPMS_DOMAIN) && !p.url().includes('/login'));
  if (page) return page;
  // 退而求其次：login tab 也行（之後 fetch 會 throw sessionExpired 觸發 rebuild）
  page = pages.find((p) => p.url().includes(WEBPMS_DOMAIN));
  if (page) return page;
  // 都沒有：開新 tab
  page = await browser.newPage();
  await page.goto(WEBPMS_PROFILE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await new Promise((r) => setTimeout(r, 500));
  return page;
}

// 從 mbr 點「相關資訊 → 智慧水管家」重建 webpms session。
// 完成後回傳 fresh webpms page。
//
// 重點：a.moreinfo 是 toggle，每次 click 反轉展開/收合狀態。
// 為了確保每次 rebuild 行為一致，先 reload mbr 重置狀態，再展開、點進去。
async function rebuildWebpmsSession(browser) {
  let pages = await browser.pages();
  let mbr = pages.find((p) => p.url().includes(MBR_DOMAIN));
  if (!mbr) {
    mbr = await browser.newPage();
  }
  // Reload 重置任何 toggle 狀態到初始（收合）
  await mbr.goto(MBR_DASHBOARD_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await new Promise((r) => setTimeout(r, 1500));
  if (MBR_LOGIN_PATTERN.test(mbr.url())) {
    throw new TaipeiWaterSessionExpiredError('mbr');
  }

  // 記下既有 webpms tab 數，方便判定「新開的 tab」
  const beforeWebpmsCount = (await browser.pages()).filter((p) =>
    p.url().includes(WEBPMS_DOMAIN)
  ).length;

  // 展開「相關資訊」面板（reload 後初始是收合）
  await mbr.evaluate(() => {
    const btn = document.querySelector('a.moreinfo');
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 1500));

  // 點「智慧水管家」(div#goSmart4Related) → 開新 webpms tab
  const clicked = await mbr.evaluate(() => {
    const el = document.querySelector('#goSmart4Related');
    if (!el || el.offsetParent === null) return false;
    el.click();
    return true;
  });
  if (!clicked) {
    throw new TaipeiWaterScrapeError('rebuild: #goSmart4Related 不可見（相關資訊面板沒展開？）');
  }

  // 等 webpms tab 數量增加，且新 tab 不在 /login
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const ps = await browser.pages();
    const webpmsTabs = ps.filter((p) => p.url().includes(WEBPMS_DOMAIN));
    if (webpmsTabs.length > beforeWebpmsCount) {
      // 找新開的 non-login tab
      const wp = webpmsTabs.find((p) => !p.url().includes('/login'));
      if (wp) {
        // 等一下確保頁面 init
        await new Promise((r) => setTimeout(r, 1200));
        // 關掉舊的 /login webpms tab 避免下次混淆
        for (const old of webpmsTabs) {
          if (old !== wp && old.url().includes('/login')) {
            try { await old.close(); } catch (_) {}
          }
        }
        return wp;
      }
    }
  }
  throw new TaipeiWaterScrapeError('rebuild webpms session: 10 秒內沒看到新 webpms tab');
}

// 在 page context fetch API，自動偵測 redirect to /login = session 失效。
async function fetchApiInPage(page, url) {
  return page.evaluate(async (u) => {
    const r = await fetch(u, { credentials: 'same-origin', redirect: 'follow' });
    if (r.url.includes('/login')) {
      return { ok: false, sessionExpired: true };
    }
    if (!r.ok) {
      return { ok: false, status: r.status, statusText: r.statusText };
    }
    return { ok: true, data: await r.json() };
  }, url);
}

async function fetchWaterId(page, waterNum) {
  const url = `/api/system/profile/waterNum/${encodeURIComponent(waterNum)}`;
  const result = await fetchApiInPage(page, url);
  if (!result.ok) {
    if (result.sessionExpired || result.status === 401 || result.status === 403) {
      throw new TaipeiWaterSessionExpiredError('webpms');
    }
    throw new TaipeiWaterScrapeError(`profile API: HTTP ${result.status} ${result.statusText}`);
  }
  if (!result.data.waterId) {
    throw new TaipeiWaterScrapeError(`waterId 不在 profile response`);
  }
  return result.data.waterId;
}

async function fetchDailyRecord(page, waterId, dateISO) {
  const url = `/api/report/profile/${encodeURIComponent(waterId)}/record?start=${dateISO}&end=${dateISO}&sampling=day`;
  const result = await fetchApiInPage(page, url);
  if (!result.ok) {
    if (result.sessionExpired || result.status === 401 || result.status === 403) {
      throw new TaipeiWaterSessionExpiredError('webpms');
    }
    throw new TaipeiWaterScrapeError(`record API: HTTP ${result.status} ${result.statusText}`);
  }
  return result.data;
}

/**
 * 抓昨日（或指定日期）閱大安公水用水度數。
 * 自動處理 webpms session 失效 → 從 mbr 重建。
 *
 * @param {Browser} browser  puppeteer-core browser (CDP 連線好的)
 * @param {string} dateISO   'YYYY-MM-DD'
 * @returns {Promise<number>} 度數
 */
async function fetchDailyWater(browser, dateISO) {
  const waterNum = process.env.WATER_METER || '1-19-0068279';

  let page = await findOrCreateWebpmsPage(browser);
  let waterId;

  try {
    waterId = await fetchWaterId(page, waterNum);
  } catch (e) {
    if (e instanceof TaipeiWaterSessionExpiredError && e.message.includes('webpms')) {
      // webpms session 失效，從 mbr 重建
      console.log('[taipei-water] webpms session 失效，從 mbr 重建...');
      page = await rebuildWebpmsSession(browser);
      waterId = await fetchWaterId(page, waterNum);
    } else {
      throw e;
    }
  }

  const records = await fetchDailyRecord(page, waterId, dateISO);

  if (!Array.isArray(records) || records.length === 0) {
    throw new TaipeiWaterScrapeError(`日期 ${dateISO} 沒有資料`);
  }
  const row = records.find((r) => r.startOn === dateISO) || records[0];
  const volume = row.volumeAdjusted != null ? row.volumeAdjusted : row.volume;
  if (volume == null) {
    throw new TaipeiWaterScrapeError(`日期 ${dateISO} volume 為 null（資料未回傳）`);
  }
  return Math.round(volume * 100) / 100;
}

module.exports = {
  fetchDailyWater,
  TaipeiWaterSessionExpiredError,
  TaipeiWaterScrapeError,
};
