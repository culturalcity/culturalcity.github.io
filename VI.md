# 閱大安 VI 規範

> CSS 是 single source of truth；本文件是說明性整理，CSS 異動請同步更新本文。
> 最後一節「實作現況」記錄已知差異。

## 設計表（global.css `:root` 是唯一來源；2026-09-19 補齊）

全站寫第一個元件前就先定好的「表」：色票、字級、字重、行高、字距、間距。**元件只准引用變數，不寫數字、不寫色碼**；要加新值先說明現有級數為何不夠。這張表的由來：2026-09-19 產品設計稽核量到字級收斂後，行高仍有 20 種、字距 22 種、寫死顏色 261 種，還有三個從沒定義的變數（`--amber`、`--c-staff`、`--wg3`）讓標記靜默失色。

### 色票

`--wg*` ＝ **w**arm **g**ray（暖灰），**數字越大越深**；編號不連續是正常的，只給實際用到的階。

| 分組 | 變數 | 值 | 用途 |
|---|---|---|---|
| 文字（淺底） | `--wg41` | `#3C3835` | 主文字；也是深色 header／深色按鈕底 |
| | `--wg11` | `#696460` | 中灰：強調一點的標籤、左邊線、hover 底 |
| | `--wg9` | `#5F5A55` | 次要文字（說明、標籤、日期、廠商名） |
| 文字（深底） | `--wg1` | `#EAE7E1` | 深底主文字；也是頁面底色 |
| | `--wg7` | `#ADA8A2` | 深底次要文字 |
| 背景 | `--white` | `#F7F5F2` | 卡片底 |
| | `--tint` | ink 4% | 淺底上的淡填：表頭、hover、區塊底（一串近似米白 #F0EDE8／#F2F0EC… 已全併入） |
| | `--tint-dark`／`--tint-dark-strong` | wg1 3%／10% | 深底上的淡填／hover |
| 線 | `--line-soft`／`--line`／`--line-strong` | ink 6%／12%／25% | 表內格線／一般分隔與卡片框／輸入框與強調框 |
| | `--line-dark` | wg1 20% | 深底上的線 |
| 狀態 | `--dp`、`--dn`、`--warn`、`--blue` | 綠／紅／琥珀／藍 | 各一組 `-bg`（6%）、`-line`（25%）、`-on-dark`（深底用淺色版） |
| 公告類別 | `--c-meeting` `--c-work` `--c-equip` `--c-safety` `--c-rule` `--c-event` `--c-staff` | | 公告 pill、列表篩選共用（安全類棕、設備類紅，刻意區分） |
| 資料視覺化 | `--viz-blue` `--viz-orange` `--viz-green` `--viz-alert` `--viz-gold`(`-bg`) `--viz-gray` `--viz-line` `--viz-yellow` | | 圖表與圖例；不佔文字／背景額度。**JS 一律用 `VIZ.*` 讀本組，不自己寫色碼**（見下節） |
| 網站分區色 | `--sec-notice` `--sec-minutes` `--sec-finance` `--sec-regulation` `--sec-guide` `--sec-other` `--sec-vendor` | | 首頁模組卡與時間軸、搜尋結果、列表頁的區塊強調。2026-09-21 由 7 頁的 18 處自行宣告收回；只有公告棕 `#6B3A1F`（會議紀錄列表的 AGM 強調共用）與通訊錄墨綠 `#3C5A4A` 是新值，其餘引用既有色 |
| 其他 | `--alert-bg`／`--alert-ink` | 黃 #FFD33D／黑 | 緊急橫條（國際慣例黃黑，刻意不走 wg） |
| | `--overlay` | | 全螢幕燈箱遮罩 |

**對比規則（WCAG AA ≥ 4.5:1）**：次要灰字依**底色明暗**二擇一——淺底用 `--wg9`、深底用 `--wg7`；深底上的狀態色一律用 `-on-dark` 版（原本 `#D08585` 在深底只有 4.1:1，已換掉）。`--wg9` 2026-06 由 `#898480` 調深至 `#5F5A55` 才過 AA，連半透明深色卡片（notice-box，疊後約 #e1ded8）上也達標。

獨立頁面與工具**不要 redeclare** 上述變數，缺顏色就在 global.css 設計表補一個有名字的變數。2026-09-19 已把各頁重宣告（finance.css 的 `--ink／--paper／--red…` 別名、minutes.css 與各頁的 `--warn／--blue`、公告兩處不一致的類別色）全部收回 global；2026-09-21 再收回首頁、搜尋、會議紀錄列表、通訊錄、避難、用電與用水目標 7 頁的 18 處，頁內色 token 宣告歸零。

### 圖表色：JS 用 `VIZ.*`，不寫色碼

`viz.js` 開頭以 `getComputedStyle` 把資料視覺化色盤讀成 `VIZ` 物件，圖表頁在 frontmatter 加 `viz: true`（base.njk 會在圖表程式之前同步載入；不走版型的獨立頁自己加 `<script src="/viz.js"></script>`）：

```js
borderColor: VIZ.green,                       // 目標線
borderColor: VIZ.alert,                       // 警戒線
backgroundColor: VIZ.alpha(VIZ.blue, 0.28),   // 同一個色的半透明版
ticks: { color: VIZ.axis }, grid: { color: VIZ.token('--line-soft') }
```

**為什麼**：色碼寫在 JS 就等於色盤有兩份，改色只改一邊就會走鐘——用電目標頁的警戒線圖例是 `--c-warn`(#A8481F)、線卻畫成 #C45A30，軸標籤還用著 2026-06 已淘汰、沒過 AA 的 #898480（2026-09-21 一併修）。`scripts/check-design-tokens.js` 的 `jsColors()` 會擋 JS 裡的色碼字面值（含色盤色的自訂透明度版），真有例外在同一行寫 `// design-ok: 理由`。

**兩處已知例外**（寫在守門的 `EXEMPT_JS_COLOR`／此處）：①財務月報存檔頁 `finance/YYYY-MM.html`——一頁一個月、發布後凍結，且由 culturalcity-finance-monthly skill 產生（範本在本 repo 外），等該 skill 改成輸出 `VIZ.*` 再拿掉豁免。（原本的第二個例外「`utility/data/*-chart.json` 的年度系列色」已於 2026-09-22 取消：資料檔不再存色，改由 `src/utility/index.html` 的 `seriesColor()` 從資料視覺化色盤指派——最新年 `--viz-blue`、往前 `--viz-gray` 遞淺；`scripts/extract-telecom-bills.js` 與大公電帳單 skill 的說明同步改為「只寫資料、不寫色」。順帶汰除資料檔裡 2026-06 已淘汰的舊灰 #898480。）

### 行高・字距・間距

| 變數 | 值 | 用途 |
|---|---|---|
| `--lh-solid` | 1 | 單行元件：圖示、徽章、大數字 |
| `--lh-tight` | 1.4 | 標題、表格、標籤、按鈕 |
| `--lh-text` | 1.75 | 正文（body 預設） |
| `--lh-loose` | 2 | 條文、需要逐行對照的長清單 |
| `--ls-text` | .04em | 中文標籤、按鈕微調 |
| `--ls-label` | .1em | 小標、h1、表頭 |
| `--ls-caps` | .18em | 英文 eyebrow、全大寫標籤、header 副標 |
| `--sp-4` … `--sp-80` | 4 8 12 16 20 24 28 32 40 48 56 64 80 px | margin／padding／gap。1～2px 髮絲線可直接寫 |

## 容器覆寫規則（2026-08 定案，新頁必守）

`.main` 的完整規格在 global.css：桌面置中、600–840px 平板帶左右 40px、手機 20px。頁面若需要不同的**上下** padding，**只能寫 longhand**：

```css
.main { padding-top: 32px; padding-bottom: 72px; }   /* ✅ 左右交給 global */
.main { padding: 32px 0 72px; }                      /* ❌ 四向縮寫會把 global 的平板帶側距蓋成 0 */
```

原因：頁面樣式載於 global 之後，同 specificity 的非 media 縮寫規則會壓過 global 的 `@media` 側距——這正是 2026-07「26 頁平板直立貼邊」歷史 bug 的根源。

寬版頁（容器寬 W ≠ 760）只覆寫 `--page-max-width: Wpx`，並自補側距帶：

```css
@media (min-width: 601px) and (max-width: W+80px) {
  .main { padding-left: 40px; padding-right: 40px; max-width: calc(var(--page-max-width) + 80px); }
}
```

三個細節都有理由：**601 起算**（600 以下由 global 手機規則接管，帶若涵蓋手機會把側距壓成 40）；上限 **W+80**（視窗比這窄時容器才會碰到邊）；**帶內 max-width 放寬 80px**——全站是 `box-sizing: border-box`，只加 padding 會把 80px 吃進 W 裡（內容縮成 W−80），跨過斷點又跳回 W——內容寬一次跳 80px、左右邊界各移 40px；放寬後內容寬連續。例外：admin／保全機台系列頁刻意「全寬度一律 20px 側距」，那是不同容器規格，保留 shorthand 並加註解。

## 字型

- `Noto Sans TC` 從 Google Fonts CDN 載入，只載 weight 400 / 500 / 700
- fallback：`Microsoft JhengHei`, sans-serif

### 字級表（2026-09 收斂，global.css `:root` 是唯一來源）

走 gov.uk「大、少」精神：可讀性優先、用少數幾階、**不低於 13px**（受眾含長輩）。
**相鄰兩級至少差 2px**：差 1px 讀者看不出來，等於沒有層級（手機、桌機都要成立）。

| 變數 | px | 用途 |
|---|---|---|
| `--fs-caption` | 13 | 標籤、表頭、區塊小標、徽章（**最小級**）|
| `--fs-text`    | 16 | 次要資訊與密集內容：日期、廠商名、頁尾、按鈕、表格、清單、提示框 |
| `--fs-body`    | 18 | 正文段落（手機同為 18） |
| `--fs-heading` | 22 | 頁內小標、數字重點 |
| `--fs-title`   | 26（手機 22） | 頁面主標題 h1 |
| `--fs-display` | 32 | 首頁刊頭、大數字 |

**寫法規則**：`font-size` 一律寫 `var(--fs-*)`，不寫數字；圖示要放大才用 `calc(var(--fs-*) * N)`。
要調整全站字級，只改 global.css 那六個數字。

### 字重：只用三級

`400` 一般、`500` 中等、`700` 粗。**不用 600**：網路字型沒有 600 這一檔，瀏覽器會直接顯示成 700，寫 600 以為是半粗，其實跟標題一樣粗（2026-09 前全站有 110 處這種假層級）。

### 建置守門

兩支腳本掛在 `.eleventy.js`，本機 build 與 GitHub Actions 都會跑：

- `scripts/check-type-scale.js`（建置前）：掃 `src/`、根目錄 css、根目錄 `admin/`，出現數字字級或 400／500／700 以外的字重，**建置失敗**並列檔名行號。
- `scripts/check-design-tokens.js`：建置前對寫死的顏色／行高／字距／間距與 global 色票近似色（ΔE<3）**列警示**；建置後逐頁把頁面與它連結的站內 CSS 合起來看，**用了 `var(--x)` 卻沒定義就讓建置失敗**（瀏覽器遇到未定義變數不報錯，只會靜默失色）。單獨執行：`node scripts/check-design-tokens.js [輸出資料夾]`。

例外（不掃）：`minutes/agm-5-1-deck.html`（簡報用 vw 單位）、`admin/utility/`（每日公告卡片是凍結像素）、`images/` 下的 SVG。Chart.js 圖表標籤與線色由 JS 設定，不在範圍內。

## Header 紋理（全站共用）

深褐 `#3C3835` 底上疊兩層極低對比的「石材紋路」，製造低調的織紋感。新頁面套 `<div class="header">` 自動有。

實作（`global.css`）：

```css
.header::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    repeating-linear-gradient(92deg,  transparent, transparent 120px, rgba(234,231,225,0.03) 120px, rgba(234,231,225,0.03) 121px),
    repeating-linear-gradient(178deg, transparent, transparent 60px,  rgba(234,231,225,0.02) 60px,  rgba(234,231,225,0.02) 61px);
  pointer-events: none;
}
```

標準 header 三段結構（class 名稱固定，不要自創縮寫版）：

1. 英文 eyebrow（`.header-eyebrow`，`--fs-text` / `--ls-caps`）
2. 中文 h1（`--fs-title` / `--ls-label` / 粗體）
3. 副標（`.header-sub`，`--fs-text` / `--ls-caps`）——通常寫「`CULTURAL CITY COMMUNITY ・ 閱大安管理委員會`」

範例頁見 `src/index.html`。

## 共用元件

| 類別 | 說明 |
|---|---|
| `.notice-box` | 提示框，灰底邊框 |
| `.back-link`  | 返回連結，前綴箭頭 ← |
| `.footer`     | 頁尾灰文字 |
| `.dp` / `.dn` | 正向／負向強調文字 |

## 單獨頁面（離線單檔・非 11ty build）

少數頁面是「自包式單一 HTML」，不走本 repo 的 11ty build、要能雙擊開啟或離線（例如得獎自評分析頁）。這類頁**吃不到 `base.njk` 與 `global.css`**，必須**自我內含**以下，才能與全站一致：

- **設計表／字型／圓角**：把上方設計表用到的變數、`Noto Sans TC`、`--radius:2px` 直接寫進該檔。此處 redeclare 是**必要例外**（與站內頁「不要 redeclare」相反——因為沒有 global 可繼承）。
- **字級**：把上方字級表的六個 `--fs-*` 變數一起寫進該檔的 `:root`，其餘照站內寫法用 `var(--fs-*)`。
- **Header 紋理**：用上方官方那組 `repeating-linear-gradient`（120px／60px・wg1 3%/2%），**勿自創密斜紋**（2px/6px 那種）。
- **Favicon（最易漏）**：不能用 `/favicon.svg` 絕對路徑（單檔無網站根 → 404）。改把 repo 根 `favicon.svg` 內嵌成 data-URI：
  ```html
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,…">
  ```
  產生：`python -c "import base64;print(base64.b64encode(open('favicon.svg','rb').read()).decode())"`

## 實作現況（已知差異）

- **豁免區仍用自己的值**：AGM 簡報 deck（`minutes/agm-5-1-deck.html`，vw 單位、自帶 `--wg2` 等）與每日水電公告產生器（`admin/utility/`，卡片凍結像素）不套設計表。
- **Chart.js 線色在 JS**：財報、用電頁的圖表顏色寫在 `<script>` 裡，與 `--viz-*`／狀態色同值但不連動；改色時兩邊一起改。
- **頁籤無障礙**：內容檔的頁籤是 `<div class="tab" onclick="sw('key')">` 極簡寫法，role／aria／roving tabindex／鍵盤操作由共用 `tabs-a11y.js` 在載入後補上；要改頁籤行為只改那一檔。**它不會自動套用到所有 `.tabs`**——啟用方式：套 `base.njk` 的頁在 frontmatter 加 `tabsA11y: true`（finance.njk 已加，所有財報月報自動有）；不套 base 的獨立 HTML 自行在 `<head>` 加 `<script src="{{ '/tabs-a11y.js' | cssBust }}" defer></script>`（長期財務模型即此例）
