// 簡易 .env loader（避免 dotenv 依賴）。
// 在 scripts 開頭呼叫 require('./lib/env').load() 即可。
// 注意：只在 key 尚未存在時才設值，不覆蓋既有環境變數（與 dotenv 行為一致）。

const fs = require('fs');
const path = require('path');

function load(envPath) {
  const p = envPath || path.join(__dirname, '..', '..', '.env');
  if (!fs.existsSync(p)) return;
  const text = fs.readFileSync(p, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const key = m[1];
    if (key in process.env) continue;
    process.env[key] = m[2].replace(/^["']|["']$/g, '');
  }
}

module.exports = { load };
