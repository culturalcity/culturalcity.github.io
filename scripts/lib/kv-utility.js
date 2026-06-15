// 與 culturalcity.org Cloudflare KV API 對話的 helper。
//
// API endpoint: https://culturalcity.org/admin/utility/api/data
// 全站 Basic Auth 由 Cloudflare Worker culturalcity-auth 保護
// （只比對 password，username 隨便填，見 repo CLAUDE.md「Cloudflare Worker」段）。
//
// KV value 結構（見 admin/utility/index.html 行 255 emptyStore）：
//   {water:{}, electric:{}, temperature:{}, cleanDay:{}, irrigationMin:{}, note:{}}
//   各子欄位 key 為 'YYYY-MM-DD'，value 為 number / boolean / string
//
// 環境變數（從 .env 讀）：
//   CC_BASIC_AUTH_USER   預設 'user'
//   CC_BASIC_AUTH_PASS   必填
//   CC_API_URL           預設 https://culturalcity.org/admin/utility/api/data

const DEFAULT_API = 'https://culturalcity.org/admin/utility/api/data';

function getApiUrl() {
  return process.env.CC_API_URL || DEFAULT_API;
}

function authHeader() {
  const user = process.env.CC_BASIC_AUTH_USER || 'user';
  const pass = process.env.CC_BASIC_AUTH_PASS;
  if (!pass) {
    throw new Error('CC_BASIC_AUTH_PASS not set in .env');
  }
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

async function getStore() {
  const res = await fetch(getApiUrl(), {
    headers: { Authorization: authHeader() },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`KV GET failed: HTTP ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function postStore(store) {
  const res = await fetch(getApiUrl(), {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(store),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`KV POST failed: HTTP ${res.status} ${res.statusText} ${body}`);
  }
  return res.text();
}

/**
 * Merge 昨日水電到既有 KV，不覆寫其他欄位。
 * 傳入 water / electric 為 null/undefined 表示「本次沒抓到，不要動」。
 *
 * @param {Object} opts
 * @param {string} opts.date     ISO date 'YYYY-MM-DD'
 * @param {number} [opts.water]  昨日用水度數（公水）
 * @param {number} [opts.electric] 昨日用電度數（大公電）
 * @returns {Promise<{updated: string[], skipped: string[]}>}
 */
async function mergeDailyUtility({ date, water, electric }) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`mergeDailyUtility: invalid date '${date}'`);
  }

  const store = await getStore();
  store.water = store.water || {};
  store.electric = store.electric || {};

  const updated = [];
  const skipped = [];

  if (water != null && Number.isFinite(Number(water))) {
    store.water[date] = Number(water);
    updated.push('water');
  } else {
    skipped.push('water');
  }

  if (electric != null && Number.isFinite(Number(electric))) {
    store.electric[date] = Number(electric);
    updated.push('electric');
  } else {
    skipped.push('electric');
  }

  if (updated.length > 0) {
    await postStore(store);
  }

  return { updated, skipped };
}

module.exports = { getStore, postStore, mergeDailyUtility, getApiUrl };
