// CI 用：從 Cloudflare Worker 抓 KV（每日水電手填資料），驗證後覆蓋 utility/data/kv-snapshot.json。
// 認證：帶總幹事 cookie token（GitHub Actions secret YDA_DATA_TOKEN）。
// 安全設計：抓失敗 / 401 / 格式不對 → 不覆蓋舊備份、exit 0（不讓部署整個失敗）。
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.YDA_DATA_TOKEN;
const URL = 'https://culturalcity.org/admin/utility/api/data';
const DST = path.join(__dirname, '..', 'utility', 'data', 'kv-snapshot.json');

(async () => {
  if (!TOKEN) { console.warn('⚠ 無 YDA_DATA_TOKEN，跳過 KV 抓取'); return; }
  let res;
  try {
    res = await fetch(URL, { headers: { Cookie: 'yda_auth=' + TOKEN }, cache: 'no-store' });
  } catch (e) { console.warn('⚠ KV 連線失敗，跳過：', e.message); return; }
  if (!res.ok) { console.warn('⚠ KV HTTP ' + res.status + '（token 失效？），跳過、保留舊備份'); return; }
  let data;
  try { data = await res.json(); } catch (e) { console.warn('⚠ KV 回應非 JSON，跳過'); return; }
  // 結構檢查：必須像 KV（有 water/electric 物件），避免把 {error:...} 或空物件蓋進備份
  if (!data || typeof data !== 'object' || typeof data.water !== 'object' || typeof data.electric !== 'object'
      || Object.keys(data.water).length === 0) {
    console.warn('⚠ KV 內容不符預期（無 water/electric），跳過、保留舊備份');
    return;
  }
  fs.writeFileSync(DST, JSON.stringify(data), 'utf8');
  console.log('✓ kv-snapshot.json 更新：水 ' + Object.keys(data.water).length + ' 天、電 ' + Object.keys(data.electric).length + ' 天');
})();
