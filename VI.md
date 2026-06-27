# 閱大安 VI 規範

> CSS 是 single source of truth；本文件是說明性整理，CSS 異動請同步更新本文。
> 最後一節「實作現況」記錄已知差異。

## 色票（global.css `:root`）

`--wg*` ＝ **w**arm **g**ray（暖灰）灰階，**數字越大越深**（wg1 最淺 → wg41 最深）。編號不連續是正常的——只給實際用到的幾階編號，沒有 wg2～wg6 等中間號。

| 變數 | 色碼 | 用途 |
|---|---|---|
| `--wg1`   | `#EAE7E1` | 背景米白 |
| `--white` | `#F7F5F2` | 卡片底色 |
| `--wg7`   | `#ADA8A2` | 次要文字（**深色底**用：深 header／深卡片） |
| `--wg9`   | `#5F5A55` | 次要文字（**淺色底**用：說明、標籤、日期） |
| `--wg11`  | `#696460` | 灰文字（中等強度：邊框、強調一點的標籤） |
| `--wg41`  | `#3C3835` | 主文字（最深）／深色 header 底色 |
| `--line`  | `rgba(60,56,53,0.12)` | 分隔線、邊框 |
| `--dp`    | `#1F5C38` | 正向強調（達標、通過） |
| `--dn`    | `#8C1F1F` | 負向強調（警告、否決） |
| `--radius`| `2px`     | 圓角統一 2px（極微） |

### 次要文字對比規則（WCAG AA）

次要灰字依**底色明暗**二擇一，確保對比 ≥ 4.5:1（含半透明深色卡片如 notice-box 疊後約 #e1ded8 的情況）：

- **淺底** 的次要文字 → `--wg9`（深灰 #5F5A55）
- **深底**（深 header／深色卡片）的次要文字 → `--wg7`（淺灰 #ADA8A2）

> `--wg9` 2026-06 由舊值 `#898480` 調深至 `#5F5A55`；`--wg7` 為同次無障礙修正新增。詳見 axe 體檢結論（全站 0 對比違規）。

獨立頁面／工具新增時**不要 redeclare** 上述基底變數；只在需要新顏色時補新變數（譬如 `--warn`、`--blue`）。⚠️ 站內仍有約 14 頁 inline `:root` 重宣告了 `--wg9`/`--wg11`（歷史遺留），改色票時這些頁吃不到 global，須逐頁同步——這正是「不要 redeclare」的理由。

## 字型

- `Noto Sans TC` 從 Google Fonts CDN 載入，weight 300 / 400 / 500 / 700
- fallback：`Microsoft JhengHei`, sans-serif
- 內文：18px / 行高 1.75（手機 17px）

### 字級階梯（2026-06 向 gov.uk 對齊放大一級）

走 gov.uk「大、少」精神：可讀性優先、用少數幾階、**不低於 13px**（受眾含長輩）。

| 級 | px | 用途 |
|---|---|---|
| 內文 | 18（手機 17） | 正文 body |
| 次要 | 15 | 說明、表格欄、卡片描述、callout |
| 小標/meta | 13 | eyebrow、副標、日期、標籤、footer、圖註（**最小級，勿再低於此**）|
| 中標 | 16 / 17 | 區塊小標、強調文字 |
| 標題 | 19 / 22 / 24 / 26 / 44 | h1／章節標題（未動，本就夠大）|

> ⚠️ 字級散落各檔硬寫 px（**無 token**），改階梯需逐檔掃。2026-06 全站一次性放大（11/12→13、13/14→15、15→16、16→17、17→18、18→19）。
> **例外不動**：`admin/`（總幹事工具＋每日公告卡片是**凍結像素**）、`minutes/agm-5-1-deck.html`（簡報用 vw 單位）、Chart.js 圖表內標籤（JS 設定）。

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

1. 英文 eyebrow（`.header-eyebrow`，13px / letter-spacing .25em）
2. 中文 h1（26px / letter-spacing .1em / 粗體）
3. 副標（`.header-sub`，14px / letter-spacing .16em）——通常寫「`CULTURAL CITY COMMUNITY ・ 閱大安管理委員會`」

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

- **色票／字型／圓角**：把上方 `:root` 變數、`Noto Sans TC`、`--radius:2px` 直接寫進該檔。此處 redeclare 是**必要例外**（與站內頁「不要 redeclare」相反——因為沒有 global 可繼承）。
- **字級**：`body{font-size:18px; line-height:1.75}`，套上方字級階梯；資料密集表格可酌減但**不低於 13px**。
- **Header 紋理**：用上方官方那組 `repeating-linear-gradient`（120px／60px・wg1 3%/2%），**勿自創密斜紋**（2px/6px 那種）。
- **Favicon（最易漏）**：不能用 `/favicon.svg` 絕對路徑（單檔無網站根 → 404）。改把 repo 根 `favicon.svg` 內嵌成 data-URI：
  ```html
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,…">
  ```
  產生：`python -c "import base64;print(base64.b64encode(open('favicon.svg','rb').read()).decode())"`

## 實作現況（已知差異）

以下是目前 CSS 與本文 spec 的偏離，未來重構時整理：

- **`minutes.css :root` 重新宣告 `--dp` / `--dn`**——違反「不要 redeclare 基底變數」原則，屬歷史遺留
- **`minutes.css` 額外變數**：`--warn: #8C5A00`（警示棕黃）、`--blue: #2B4A6B`（會議紀錄專用藍）
- **`finance.css` 自帶平行命名系統**：使用 `--ink` / `--paper` / `--gold` / `--red` / `--green` / `--blue` / `--border`，**不直接讀 `--wg*` 家族**。源自財報設計 separate evolution，視覺輸出仍與全站對齊（色值對應），但變數名稱沒整合
- **`notice.css` / `regulations.css`**：依規範使用 `--wg*` 家族，符合本文 spec
