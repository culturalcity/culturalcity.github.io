# 閱大安 VI 規範

> CSS 是 single source of truth；本文件是說明性整理，CSS 異動請同步更新本文。
> 最後一節「實作現況」記錄已知差異。

## 色票（global.css `:root`）

| 變數 | 色碼 | 用途 |
|---|---|---|
| `--wg1`   | `#EAE7E1` | 背景米白 |
| `--white` | `#F7F5F2` | 卡片底色 |
| `--wg9`   | `#898480` | 灰文字（次要、標籤） |
| `--wg11`  | `#696460` | 灰文字（中等強度） |
| `--wg41`  | `#3C3835` | 主文字（最深） |
| `--line`  | `rgba(60,56,53,0.12)` | 分隔線、邊框 |
| `--dp`    | `#1F5C38` | 正向強調（達標、通過） |
| `--dn`    | `#8C1F1F` | 負向強調（警告、否決） |
| `--radius`| `2px`     | 圓角統一 2px（極微） |

獨立頁面／工具新增時**不要 redeclare** 上述基底變數；只在需要新顏色時補新變數（譬如 `--warn`、`--blue`）。

## 字型

- `Noto Sans TC` 從 Google Fonts CDN 載入，weight 300 / 400 / 500 / 700
- fallback：`Microsoft JhengHei`, sans-serif
- 內文：17px / 行高 1.75

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

## 實作現況（已知差異）

以下是目前 CSS 與本文 spec 的偏離，未來重構時整理：

- **`minutes.css :root` 重新宣告 `--dp` / `--dn`**——違反「不要 redeclare 基底變數」原則，屬歷史遺留
- **`minutes.css` 額外變數**：`--warn: #8C5A00`（警示棕黃）、`--blue: #2B4A6B`（會議紀錄專用藍）
- **`finance.css` 自帶平行命名系統**：使用 `--ink` / `--paper` / `--gold` / `--red` / `--green` / `--blue` / `--border`，**不直接讀 `--wg*` 家族**。源自財報設計 separate evolution，視覺輸出仍與全站對齊（色值對應），但變數名稱沒整合
- **`notice.css` / `regulations.css`**：依規範使用 `--wg*` 家族，符合本文 spec
