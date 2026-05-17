// 中華電信既有 PDF 檔名改新格式（西元年月 + 計費期間）
// 對 Drive Desktop 同步路徑上的檔案直接重命名（原地 rename）。
//
// 中華電信計費期間規律：「YYY 年 MM 月帳單」對應「YYY 年 (MM-1) 月 1 日至最末日」
//   譬如 115年05月帳單 → 計費期間 115/04/01-115/04/30
//
// 用法：node scripts/rename-telecom-drive.js [--dry-run]

import fs from 'fs';
import path from 'path';

const DRIVE_FOLDER = 'D:/Google One Cultural City/06. 社區廠商/01. 公共事業/中華電信/中華電信台北營運處繳費通知暨繳費憑證';
const DRY = process.argv.includes('--dry-run');

function pad(n) { return String(n).padStart(2, '0'); }

function computeBillingPeriod(rocYear, rocMonth) {
  // 帳單期間 = 前一個月（自然月，1 日至最末日）
  let y = rocYear + 1911;
  let m = rocMonth - 1;
  if (m === 0) { m = 12; y -= 1; }
  const start = `${y}${pad(m)}01`;
  const lastDay = new Date(y, m, 0).getDate(); // Date(y, m, 0) = 該月最末日
  const end = `${y}${pad(m)}${pad(lastDay)}`;
  return { start, end };
}

function buildNewName(rocYear, rocMonth, docType) {
  const y = rocYear + 1911;
  const yyyyMm = `${y}-${pad(rocMonth)}`;
  const { start, end } = computeBillingPeriod(rocYear, rocMonth);
  return `中華電信台北營運處${docType} ${yyyyMm}（${start}-${end}）.pdf`;
}

const files = fs.readdirSync(DRIVE_FOLDER).filter(f => f.endsWith('.pdf'));
console.log(`Found ${files.length} PDFs in ${DRIVE_FOLDER}\n`);

let renamed = 0;
let skipped = 0;
for (const oldName of files) {
  const m = oldName.match(/^中華電信台北營運處(\d{3})年(\d{2})月(繳費通知|繳費結果通知)\.pdf$/);
  if (!m) {
    console.log(`⊘ ${oldName}: 已是新格式或無法解析，跳過`);
    skipped++;
    continue;
  }
  const rocYear = parseInt(m[1]);
  const rocMonth = parseInt(m[2]);
  const docType = m[3];
  const newName = buildNewName(rocYear, rocMonth, docType);
  if (newName === oldName) {
    console.log(`= ${oldName}: 檔名已是目標格式`);
    skipped++;
    continue;
  }
  const oldPath = path.join(DRIVE_FOLDER, oldName);
  const newPath = path.join(DRIVE_FOLDER, newName);
  console.log(`${DRY ? '[DRY]' : '✓'} ${oldName}`);
  console.log(`   → ${newName}`);
  if (!DRY) fs.renameSync(oldPath, newPath);
  renamed++;
}

console.log(`\n${DRY ? '[DRY RUN] ' : ''}Renamed: ${renamed}, Skipped: ${skipped}`);
