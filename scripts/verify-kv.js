// 一次性驗證腳本：確認 culturalcity.org KV API 能讀寫。
// 用法：node scripts/verify-kv.js
//
// 流程：
//   1. GET 現有 KV
//   2. 印出 water/electric/temperature 各有幾筆、最後一筆是哪天哪個值
//   3. （可選）若帶 --write-test 旗標：寫一個 note['__verify__'] 然後再讀回確認
//
// 不會寫入任何 water/electric/temperature 資料。

require('./lib/env').load();
const kv = require('./lib/kv-utility');

async function main() {
  const writeTest = process.argv.includes('--write-test');

  console.log('→ GET', process.env.CC_API_URL || '(default)');
  const store = await kv.getStore();

  for (const k of ['water', 'electric', 'temperature', 'cleanDay', 'irrigationMin', 'note']) {
    const obj = store[k] || {};
    const dates = Object.keys(obj).sort();
    const last = dates[dates.length - 1];
    console.log(
      `  ${k.padEnd(14)} ${String(dates.length).padStart(4)} 筆` +
      (last ? `  最後: ${last} = ${JSON.stringify(obj[last])}` : '')
    );
  }

  if (writeTest) {
    console.log('\n→ Write test: 寫入 note["__verify__"]');
    store.note = store.note || {};
    store.note['__verify__'] = `verified at ${new Date().toISOString()}`;
    await kv.postStore(store);
    console.log('  POST OK');

    const re = await kv.getStore();
    console.log('  Read back note["__verify__"]:', re.note?.['__verify__']);

    // Cleanup
    delete re.note['__verify__'];
    await kv.postStore(re);
    console.log('  Cleanup OK');
  } else {
    console.log('\n（要驗證寫入，加 --write-test 旗標重跑）');
  }
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
