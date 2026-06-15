// 透過 CDP 連到既有 Chrome（用 raw/CHROME-AUTOMATION-SHORTCUT.bat 啟動的）。
//
// 為什麼這樣做：台電 ebpps2 有 CloudFlare Turnstile、北水有 CAPTCHA，
// 自動化瀏覽器會被擋。連到使用者已登入的 Chrome session 是穩定路徑。
// 詳見 raw/UTILITY-AUTOMATION-PLAN.md 第 2 節。

const puppeteer = require('puppeteer-core');

const DEFAULT_PORT = 9222;

class ChromeNotRunningError extends Error {
  constructor(port) {
    super(`Chrome 沒在 port ${port} listening。請執行 raw\\CHROME-AUTOMATION-SHORTCUT.bat 開啟自動化 Chrome。`);
    this.name = 'ChromeNotRunningError';
  }
}

async function connect(port) {
  const p = port || Number(process.env.CDP_PORT) || DEFAULT_PORT;
  try {
    const browser = await puppeteer.connect({
      browserURL: `http://localhost:${p}`,
      defaultViewport: null,
    });
    return browser;
  } catch (e) {
    if (e.message.includes('ECONNREFUSED') || e.message.includes('fetch failed')) {
      throw new ChromeNotRunningError(p);
    }
    throw e;
  }
}

/**
 * 找一個已存在的 tab 是該 URL（或子路徑）；找不到就開新 tab 導航過去。
 * 用「找既有 tab 優先」是因為某些 SPA 重新 navigate 會丟掉 session state。
 */
async function getOrOpenPage(browser, urlPrefix, openUrl) {
  const pages = await browser.pages();
  for (const p of pages) {
    try {
      if (p.url().startsWith(urlPrefix)) return p;
    } catch (_) {}
  }
  const page = await browser.newPage();
  await page.goto(openUrl || urlPrefix, { waitUntil: 'domcontentloaded' });
  return page;
}

/**
 * 偵測是否被導回登入頁。各站登入頁 URL 不同，由 caller 傳入判斷規則。
 *
 * @param {Page} page
 * @param {string|RegExp} loginUrlPattern  登入頁 URL pattern（字串為 includes，RegExp 為 test）
 * @returns {boolean} true = session 失效
 */
function isOnLoginPage(page, loginUrlPattern) {
  const url = page.url();
  if (loginUrlPattern instanceof RegExp) return loginUrlPattern.test(url);
  return url.includes(loginUrlPattern);
}

module.exports = {
  connect,
  getOrOpenPage,
  isOnLoginPage,
  ChromeNotRunningError,
  DEFAULT_PORT,
};
