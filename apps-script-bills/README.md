# 閱大安・公用事業帳單自動歸檔（Apps Script）

每小時掃 culturalcity85 的 Gmail，找到台電/自來水/中華電信寄來的電子帳單與繳費憑證 PDF，呼叫 `cloud-decrypt`（Cloud Run）解密 + 解析後，重新命名存到 Drive 對應子資料夾。

> 為什麼有這個工具？舊 workflow 每月要手動下載 6 張 PDF（其中 3 張加密）、解密、選資料夾、改檔名——每張 3-5 分鐘，一年 ~5 小時的耗神工作，且容易搞錯。

## 部署在哪

- **Google 帳號**：`culturalcity85@gmail.com`
- **Apps Script**：另開一個專案「閱大安帳單歸檔」（跟既有的「閱大安澆水提醒」是不同專案）
- **觸發時機**：每小時跑一次 `processBills()`
- **依賴的服務**：`cloud-decrypt`（Cloud Run，跑在同一個 GCP 專案下；詳 `cloud-decrypt/README.md`）

## 一次性 setup

### 1. 部署 `cloud-decrypt` 到 Cloud Run

詳見 `../cloud-decrypt/README.md`。完成後會拿到一個 URL，譬如：
```
https://yda-cloud-decrypt-xxxxx-an.a.run.app
```
記下這 URL，下面要用。

### 2. 確定 3 個 Drive 資料夾 ID

開 Google Drive（用 culturalcity85 登入）：

| 資料夾 | 路徑 | 用途 |
|---|---|---|
| **台電 parent** | `06. 社區廠商/01. 公共事業/臺灣電力公司/台電電費電子帳單暨繳費憑證` | 其下含 4 個電號子資料夾 |
| **自來水** | `06. 社區廠商/01. 公共事業/台北自來水事業處/台北自來水事業處水費電子帳單暨繳費憑證` | 直接存 |
| **中華電信** | `06. 社區廠商/01. 公共事業/中華電信/中華電信台北營運處繳費通知暨繳費憑證` | 直接存 |

點開每個資料夾，從網址 `https://drive.google.com/drive/folders/<ID>` 抓 `<ID>`，記下 3 個 ID。

> ⚠️ 台電 parent 下必須有 4 個子資料夾，名稱完全是這格式（程式按名比對）：
> ```
> 電號00-81-5173-01-9 大公電
> 電號00-81-5173-02-0 B1電信室
> 電號00-81-5172-02-9 B1充電座
> 電號00-81-5173-06-4 B3充電座
> ```

### 3. 建立 Apps Script 專案

用 culturalcity85 登入後到 [script.google.com](https://script.google.com) → **New project** → 取名「閱大安帳單歸檔」。

把 `Code.gs` 內容貼進預設的 `Code.gs`（取代預設內容）→ **Ctrl + S** 存檔。

### 4. Apps Script Properties 設定

左側齒輪 ⚙ Project Settings → Script properties → 加 4 條：

| Property | Value |
|---|---|
| `CLOUD_RUN_URL` | （步驟 1 拿到的 Cloud Run URL）|
| `TAIPOWER_PARENT_FOLDER_ID` | （步驟 2 的台電 parent ID）|
| `WATER_FOLDER_ID` | （步驟 2 的自來水 ID）|
| `TELECOM_FOLDER_ID` | （步驟 2 的中華電信 ID）|

### 5. 首次跑授權

編輯器上方 function 下拉選 `debugSearch` → ▶ Run。

Google 跳「Google 尚未驗證這個應用程式」黃色警告 → 點「進階」→「前往閱大安帳單歸檔（不安全）」→ 列出 Gmail / Drive / 外部請求權限 → 「允許」。

跑完下方執行紀錄會印「Search query: ...」+「Threads found: N」。

### 6. 裝 trigger

選 `installTrigger` → ▶ Run → 完成後查看左側 ⏰ Triggers 應該有一條 `processBills` 每小時跑一次。

### 7. 手動跑一次驗證

選 `processBills` → ▶ Run → 等執行完。看：
- Gmail 應該有新標籤「帳單已歸檔」貼在已處理的 thread 上
- Drive 對應子資料夾應該出現新命名的 PDF
- culturalcity85 信箱應該收到一封 `[閱大安] 帳單歸檔 ✓N` 摘要信

## 日常運作

裝好 trigger 後就**完全自動**。每小時跑一次，處理新進的帳單信。

每次跑完寄一封摘要信。若沒有新帳單可處理，**不發信**（避免噪音）。

## 故障排除

### 症狀：摘要信看到「⚠ N」失敗

去 Gmail 搜尋 `label:帳單需檢視` 看是哪些信。常見原因：

1. **Cloud Run service down 或網路問題**——重試一次（手動跑 `processBills`）多半自動恢復。如果連續失敗看 Cloud Run logs。
2. **PDF 內容超出規則辨識範圍**（譬如台電換版面）——Cloud Run 會回傳 422 + `textPreview`，根據 preview 微調 cloud-decrypt 的 regex。
3. **PDF 密碼錯誤**——表示帳單寄到時用了新密碼。改 cloud-decrypt 的 `PDF_PASSWORD` 環境變數。

### 症狀：明明有帳單，但 `debugSearch` 找不到

檢查搜尋條件（`CONFIG.searchQuery`）。寄件人 email 可能跟我寫的不一致。實際確認後改 `Code.gs`。

### 症狀：跑 `processBills` 報「Drive 子資料夾不存在：電號XX-XX-XXXX-XX-X B1電信室」

該電號（譬如某天台電新增第 5 個電號）在 Drive parent 下沒對應子資料夾。先到 Drive 手動建好子資料夾，再重跑 `processBills`。

### 症狀：同一份 PDF 被處理兩次

不會發生——Apps Script 會檢查 thread 是否已有「帳單已歸檔」標籤；同時存檔前會檢查 Drive 同名檔案是否已存在。

## 相關檔案

- `Code.gs`（此資料夾）— Apps Script 主程式
- `appsscript.json` — manifest（OAuth scopes、timezone）
- `../cloud-decrypt/` — Cloud Run 解密服務
