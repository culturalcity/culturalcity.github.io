// scripts/build-vendor-directory.js
// ─────────────────────────────────────────────────────────────────────────
// 廠商聯絡簿（住戶版）資料產生器
//
// 讀 Notion 匯出的廠商資料庫 CSV → 過濾出「住戶會自己接觸」的廠商 + 建商保固
// 窗口 → 只留必要欄位 → 產出 src/_data/vendors.json，供 /directory/ 查詢頁使用。
//
// ── 為什麼需要這支腳本 ──
// 主檔在 Notion（含合作狀態、備註、合約、評價、集團關係等管委會內部欄位）。
// 那些內部欄位「絕不可」出現在公開網站，repo 又是 public，連原始 CSV 都不能
// commit。所以流程是：CSV 留在 gitignore 的 raw/，這支腳本把它「投影」成只含
// 公開欄位的 vendors.json，只有 vendors.json 進 repo。
//
// ── 更新方式（給接班主委 / 總幹事）──
//   1. 從 Notion 重新匯出「廠商名錄」資料庫成 CSV
//   2. 覆蓋 raw/廠商名錄/廠商名錄-source.csv
//   3. 在專案根目錄執行：node scripts/build-vendor-directory.js
//   4. 看一下終端機有沒有「找不到廠商 / 缺電話」的警告，再 git diff 檢查
//      src/_data/vendors.json，沒問題就 commit
//
// ── 設計原則（凍結，改前先想清楚）──
//   - 住戶版只收「住戶會自己打電話」的設備廠商 + 建商/保固修繕窗口。
//     公設（電梯、機電、物業保全、垃圾清運、保險、政府、外牆、園藝…）一律
//     不收——那些留在 Notion，是管委會的事，不是住戶查詢的東西。
//   - 收哪些廠商由下方 CATEGORIES 明列（白名單）。新廠商不會自動跑上住戶版，
//     要顯示得手動加進來——這是刻意的，避免內部廠商誤上公開頁。
//   - 只輸出 廠商名稱・服務項目・品牌・電話。內部欄位一律不碰。
//   - 窗口（聯絡人）：另從「廠商聯絡人」表 join，只收「現任」窗口，絕不收
//     「已離職」或狀態空白者。每家取第一位有手機的現任窗口當主要窗口；都沒
//     手機就只顯示姓名＋公司市話。這是交屋當時的對接人，會過期——所以頁面
//     明標「交屋時資訊」並附警語，請住戶發現窗口異動時回報更新。
// ─────────────────────────────────────────────────────────────────────────

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SRC_CSV = path.join(ROOT, "raw", "廠商名錄", "廠商名錄-source.csv");
const CONTACTS_CSV = path.join(ROOT, "raw", "廠商名錄", "廠商聯絡人-source.csv");
const OUT_JSON = path.join(ROOT, "src", "_data", "vendors.json");

// ── 住戶版收錄白名單（依設備分類）──────────────────────────────────────────
// vendors 內每一項可以是字串（廠商名稱，服務/品牌沿用 CSV），或物件可覆寫顯示：
//   { name: "CSV 裡的廠商全名", service: "覆寫服務項目（選填）", phone: "覆寫電話（選填）" }
// phone 覆寫用於：CSV/Notion 沒填電話、但我們另外查到的情況。優先序：phone 覆寫
// > CSV 公司總機。理想上還是回填到 Notion，這裡只是讓網站先有號碼。
// 廠商名稱必須與 CSV 的「廠商名稱」欄完全一致，否則會跳警告。
const CATEGORIES = [
  {
    name: "建商・保固報修",
    icon: "🏗️",
    note: "保固期內，或結構、防水、多戶共通的問題，請依您的買賣契約聯繫原建商；管委會可協助釐清。一般設備若已過保固，可直接聯繫各設備廠商（見以下分類）。",
    vendors: [
      "敦實建設股份有限公司",
      "福一建設股份有限公司",
      // 信盛工程（營建層級房屋修繕）已移除：住戶端不會直接接觸，屬管委會範圍；
      // 真有結構層級問題循建商（敦實/福一）即可。
    ],
  },
  {
    name: "門窗・玻璃",
    icon: "🪟",
    vendors: [
      "祐昀有限公司",
      "銓鋐鋁業有限公司",
      "金亞金屬工業（股）公司",
      "俊林實業（股）公司",
    ],
  },
  {
    name: "廚具・衛浴",
    icon: "🚿",
    vendors: [
      "麗舍生活國際（股）公司",
      "佳程企業有限公司",
      "品協企業（股）公司",
      "達冠科技（股）公司",
      // 電話為文泰提供（CSV/Notion 未填）。待回填 Notion 後可移除覆寫。
      { name: "今冠實業有限公司", phone: "0225962080" },
      // 富合利建材行與富譁工程為同一家的兩個法人身分（市話相同），只留富合利
      "富合利建材行",
    ],
  },
  {
    name: "空調",
    icon: "❄️",
    vendors: [
      "強發冷氣熱泵工程有限公司",
    ],
  },
  {
    name: "淨水",
    icon: "💧",
    vendors: [
      "諾德淨水（股）公司",
    ],
  },
  {
    name: "地板・室內維修",
    icon: "🔧",
    vendors: [
      "諾貝達精品磁磚（股）公司",
      "本家室內裝修設計有限公司",
      "大昕工程有限公司",
      // 電話為網路查得（中華黃頁 iyp.com.tw，公司身分以登記代表人「吳孟恩」
      // 與名錄聯絡人一致確認；另有一線 02-8668-0220）。待回填 Notion 後可移除覆寫。
      { name: "億輝工程有限公司", phone: "0286680370" },
    ],
  },
  {
    // 非原始交屋設備、會改變外觀的灰色項目。住戶向來低調自行加裝，故用軟講法：
    // 不談申請/報備，只以「外觀一致」為由柔性建議沿用同一家，管委會僅輕邀討論。
    name: "陽台遮陽",
    icon: "☀️",
    note: "陽台電動百葉窗為住戶自行加裝的設備（非交屋原始配備）。為維持社區外觀的整體一致，若您打算加裝，建議沿用既有的規格與廠商。",
    vendors: [
      "宏太金屬工程有限公司",
    ],
  },
];

// ── 最小 RFC4180 CSV 解析器（處理引號內逗號、換行、跳脫引號）─────────────────
function parseCSV(text) {
  // 去掉 UTF-8 BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\r") { /* skip, \n 收尾 */ }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else field += c;
    }
  }
  // 收尾最後一筆（檔尾無換行時）
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// ── 電話格式化 ──
//   手機 0933029833 → 0933-029-833；市話 0287735636 → 02-8773-5636；
//   高雄等 9 碼 073105219 → 07-310-5219
function fmtPhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return { display: "", tel: "" };
  let display = digits;
  if (/^09\d{8}$/.test(digits)) {                      // 手機（09 開頭 10 碼）
    display = digits.slice(0, 4) + "-" + digits.slice(4, 7) + "-" + digits.slice(7);
  } else if (/^0\d{9}$/.test(digits)) {                // 市話 10 碼（02 區碼）
    display = digits.slice(0, 2) + "-" + digits.slice(2, 6) + "-" + digits.slice(6);
  } else if (/^0\d{8}$/.test(digits)) {                // 市話 9 碼（07 等）
    display = digits.slice(0, 2) + "-" + digits.slice(2, 5) + "-" + digits.slice(5);
  }
  return { display, tel: digits };
}

// ── 從「廠商聯絡人」表建立 公司 → 主要現任窗口 的對照 ──────────────────────
// 只收「現任」；每家取第一位「有手機」的現任窗口，都沒手機則取第一位現任。
function buildContactMap() {
  if (!fs.existsSync(CONTACTS_CSV)) return new Map();  // 沒名冊就略過窗口，不擋
  const rows = parseCSV(fs.readFileSync(CONTACTS_CSV, "utf8"));
  const h = rows[0];
  const ci = (n) => h.indexOf(n);
  const iName = ci("聯絡人"), iCo = ci("公司"), iTitle = ci("職稱"),
        iMob = ci("行動電話"), iStat = ci("聯絡人狀態");
  const stripLink = (s) => String(s || "").replace(/\s*\(https?:\/\/[^)]*\)\s*/g, "").trim();
  // 名冊狀態欄漏填、但已人工確認為「現任」的窗口（待 Notion 更正後可移除）
  const STATUS_FIX = {
    "許庭瑄": "現任",   // 諾德淨水；文泰近期仍找她換濾心，確認現任
  };
  const byCo = new Map();
  for (let r = 1; r < rows.length; r++) {
    const co = stripLink(rows[r][iCo]);
    if (!co) continue;
    const name = (rows[r][iName] || "").trim();
    let stat = (rows[r][iStat] || "").trim();
    if (!stat && STATUS_FIX[name]) stat = STATUS_FIX[name];
    if (stat !== "現任") continue;                            // 只收現任
    if (!byCo.has(co)) byCo.set(co, []);
    byCo.get(co).push({
      name,
      title: (rows[r][iTitle] || "").trim(),
      mobile: fmtPhone(rows[r][iMob]),
    });
  }
  // 每家挑主要窗口：優先有手機者
  const primary = new Map();
  byCo.forEach((list, co) => {
    const pick = list.find((p) => p.mobile.display) || list[0];
    if (pick) primary.set(co, pick);
  });
  return primary;
}

// ── 主流程 ──────────────────────────────────────────────────────────────
function main() {
  if (!fs.existsSync(SRC_CSV)) {
    console.error(`✗ 找不到來源 CSV：${SRC_CSV}`);
    console.error(`  請先從 Notion 匯出「廠商名錄」資料庫，放到該路徑（raw/ 已 gitignore）。`);
    process.exit(1);
  }

  const rows = parseCSV(fs.readFileSync(SRC_CSV, "utf8"));
  const header = rows[0];
  const col = (name) => header.indexOf(name);
  const iName = col("廠商名稱");
  const iService = col("主要業務/服務範圍");
  const iBrand = col("品牌");
  const iPhone = col("公司總機（代表號）");
  if (iName < 0 || iService < 0 || iPhone < 0) {
    console.error("✗ CSV 欄位對不上（廠商名稱／主要業務/服務範圍／公司總機）。Notion 匯出格式可能變了。");
    console.error("  實際表頭：", header.join(" | "));
    process.exit(1);
  }

  // 建索引：廠商名稱 → row
  const byName = new Map();
  for (let r = 1; r < rows.length; r++) {
    const nm = (rows[r][iName] || "").trim();
    if (nm) byName.set(nm, rows[r]);
  }

  const contactMap = buildContactMap();   // 公司 → 主要現任窗口
  const warnings = [];
  const outCategories = CATEGORIES.map((cat) => {
    const vendors = cat.vendors.map((v) => {
      const name = typeof v === "string" ? v : v.name;
      const override = typeof v === "object" ? v : {};
      const row = byName.get(name);
      if (!row) {
        warnings.push(`找不到廠商「${name}」（${cat.name}）— 確認 CSV 廠商名稱是否一致`);
        return null;
      }
      const phone = fmtPhone(override.phone || row[iPhone]);
      if (!phone.display) warnings.push(`「${name}」沒有電話 → 顯示為「待補」`);
      // 中文項目分隔正規化：CSV 用半形逗號分隔（"門A, 門B"），換行也可能出現，
      // 一律轉成中文頓號「、」。手寫的 note/disclaimer 不經這裡，保留原全形標點。
      const toDun = (s) => String(s || "").trim().replace(/\s*[,\n]\s*/g, "、");
      const brand = toDun(row[iBrand]);
      const contact = contactMap.get(name) || null;
      if (!contact) warnings.push(`「${name}」無現任窗口 → 只顯示公司市話`);
      return {
        name,
        service: toDun(override.service || row[iService]),
        brand,
        phone: phone.display,   // 空字串 = 待補
        tel: phone.tel,
        // 窗口：交屋時對接的現任窗口（可能異動）。無則為 null
        // 職稱不輸出到公開頁（部分為自行標註、且實際多稱「老闆」，掛上反不準）；
        // 名冊仍保有職稱，未來內部版要用再取。
        contactName: contact ? contact.name : "",
        contactMobile: contact ? contact.mobile.display : "",
        contactMobileTel: contact ? contact.mobile.tel : "",
      };
    }).filter(Boolean);
    return { name: cat.name, icon: cat.icon || "", note: cat.note || "", vendors };
  });

  const out = {
    // 時點標註——強調這是交屋當時的資訊，會過期
    asOf: "本名單為約四年前交屋時，建商提供之原始供應廠商與對接窗口，整理供住戶查詢參考。",
    // 性質說明（對話定稿版）
    disclaimer:
      "名單不代表管委會推薦或背書。各項設備保固年限與是否仍在保固期內，請住戶自行向建商或廠商確認；" +
      "如涉及結構、防水或多戶共通問題，建議先反映給管委會協助釐清。",
    // 聯繫前須知 / 警語
    notices: [
      "窗口為交屋當時的對接人員，可能已轉調、離職或更換電話。<strong>若您撥打時發現窗口已不在、或電話有誤，煩請告知管理中心，我們會更新名單</strong>，方便之後的住戶。",
      "名單所列為廠商提供給社區的工作聯絡方式，請於上班時間以禮貌方式聯繫，並僅用於設備維修洽詢。",
      "若有窗口希望調整或移除其聯絡資訊，亦請告知管理中心，我們會立即處理。",
    ],
    categories: outCategories,
  };

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2) + "\n", "utf8");

  const total = outCategories.reduce((s, c) => s + c.vendors.length, 0);
  console.log(`✓ 已產生 ${OUT_JSON}`);
  console.log(`  ${outCategories.length} 類、共 ${total} 家廠商`);
  if (warnings.length) {
    console.log("\n⚠ 提醒：");
    warnings.forEach((w) => console.log("  - " + w));
  }
}

main();
