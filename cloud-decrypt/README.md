# cloud-decrypt — 閱大安公用事業帳單 PDF 解密與類型辨識服務

跑在 Google Cloud Run 的 Node.js + Express 微服務，由 Apps Script 呼叫。功能：

- 解開台電加密 PDF（密碼為社區公務行動門號）
- 用內容偵測帳單類型（6 種：台電帳單/憑證 × 自來水帳單/憑證 × 中華電信帳單/憑證）
- 從 PDF 抽取電號、計費期間、帳單月份、用電地址
- 生成標準命名，回傳重新加密版 PDF（base64）
- 回傳建議 Drive 子資料夾名

## API

### `GET /health`
回傳 `ok`。供 Cloud Run health probe / 你手動測試。

### `POST /decrypt-bill`

Request:
```json
{ "pdf_b64": "<base64-encoded PDF bytes>" }
```

Response 200:
```json
{
  "type": "taipower-bill | taipower-receipt | water-bill | water-receipt | telecom-bill | telecom-receipt",
  "filename": "台灣電力公司電費電子帳單 電號00-81-5173-02-0 B1電信室 2026-03（20260112-20260310）.pdf",
  "folder": "電號00-81-5173-02-0 B1電信室",
  "extracted": { "meter": "...", "rocYearMonth": "115/03", "periodStart": "...", "periodEnd": "..." },
  "wasEncrypted": true,
  "decryptedPdf_b64": "<base64-encoded decrypted PDF>"
}
```

Response 422 (Unknown type / parse failure):
```json
{ "error": "Unknown bill type", "textPreview": "<前 500 字內容供 debug>" }
```

Response 401 (PDF 密碼錯誤 — 寄件單位可能改了密碼):
```json
{ "error": "PDF 密碼錯誤" }
```

## 一次性部署到 Cloud Run

### 1. 準備 gcloud CLI

如果還沒裝：
```bash
# Windows (PowerShell):
(New-Object Net.WebClient).DownloadFile("https://dl.google.com/dl/cloudsdk/channels/rapid/GoogleCloudSDKInstaller.exe", "$env:Temp\GoogleCloudSDKInstaller.exe")
& "$env:Temp\GoogleCloudSDKInstaller.exe"
```

裝完 restart terminal，跑 `gcloud --version` 確認。

### 2. 登入 + 設專案

```bash
gcloud auth login          # 用 culturalcity85@gmail.com 登入
gcloud projects create yda-public-utility --name="閱大安公用事業"   # 第一次建專案；之後跳過
gcloud config set project yda-public-utility
gcloud services enable run.googleapis.com cloudbuild.googleapis.com
```

### 3. 部署

從 repo 根目錄：
```bash
cd cloud-decrypt
gcloud run deploy yda-cloud-decrypt \
  --source . \
  --region asia-east1 \
  --platform managed \
  --allow-unauthenticated \
  --memory 1Gi \
  --timeout 60s \
  --max-instances 3
```

> ⚠️ **一定是 `--allow-unauthenticated`（大門公開）**。實際擋人的是 app 層的
> `X-Auth-Secret` 共享密鑰（index.js 對 /health 以外所有路徑驗證）。
> Apps Script 沒有辦法產生 Cloud Run 認得的 OIDC token，所以大門一鎖
> （`--no-allow-unauthenticated`）整條管線就斷。2026-07-04 曾因照舊版
> README 用錯參數部署，導致 07/06 永豐、07/08 台電兩筆歸檔 403 失敗。

第一次 build & deploy 約 3-5 分鐘。完成會印出 service URL，譬如：
```
Service URL: https://yda-cloud-decrypt-abcdef123-de.a.run.app
```

**這個 URL 就是 Apps Script Properties 要設的 `CLOUD_RUN_URL`。**

### 4. 授權 Apps Script 呼叫

**兩層門禁**：Cloud Run 大門公開（allUsers 可呼叫），app 層自驗 `X-Auth-Secret`
共享密鑰——Apps Script 的 Script Properties `SHARED_SECRET` 必須跟 Cloud Run
環境變數 `SHARED_SECRET` 一致。

若大門被鎖回去（症狀：日誌全是 403、連不到 app 層），用這行恢復公開呼叫：

```bash
gcloud run services add-iam-policy-binding yda-cloud-decrypt \
  --region asia-east1 \
  --member="allUsers" \
  --role="roles/run.invoker"
```

### 5. 測試

從本機（不需 gcloud token，帶共享密鑰即可；密鑰值見 Apps Script Properties）：
```bash
curl -X GET "https://yda-cloud-decrypt-xxx.run.app/health"
# 應回 "ok"（/health 不驗密鑰；若這裡就 403，代表大門被鎖、回去看第 4 節）

# 用一份本地測試 PDF
BASE64=$(base64 -w0 < some-bill.pdf)
curl -X POST "https://yda-cloud-decrypt-xxx.run.app/decrypt-bill" \
  -H "X-Auth-Secret: <SHARED_SECRET值>" \
  -H "Content-Type: application/json" \
  -d "{\"pdf_b64\":\"$BASE64\"}"
```

## 環境變數

| Var | 預設 | 說明 |
|---|---|---|
| `PORT` | `8080` | Cloud Run 預期、不要改 |
| `PDF_PASSWORD` | `0989648285` | 台電加密 PDF 密碼。若帳單寄件單位改密碼，跑 `gcloud run services update yda-cloud-decrypt --update-env-vars PDF_PASSWORD=新密碼` |

## 成本估算

每月處理 ~30 份 PDF × 平均 300ms：
- 請求數：~30 次 → 遠低於 200 萬／月免費額度
- vCPU-秒：~10 秒 → 遠低於 180,000 秒／月免費額度
- 記憶體-秒：~20 秒 → 遠低於 360,000 秒／月免費額度

**預期月費：$0**。

## 本地開發

```bash
cd cloud-decrypt
npm install
PORT=8090 npm run dev
# 另開 terminal:
curl http://localhost:8090/health
```

## 故障排除

### `gcloud run deploy` 卡在 Cloud Build

第一次 build 慢、3-5 分鐘正常。如果 >10 分鐘看 [Cloud Build console](https://console.cloud.google.com/cloud-build/builds)。

### 部署完了 Apps Script 呼叫卻回 403

確認步驟 4 的 IAM 角色設好了；用 `gcloud run services get-iam-policy yda-cloud-decrypt --region asia-east1` 驗證能看到 culturalcity85 + roles/run.invoker。

### 改 code 重新部署

```bash
gcloud run deploy yda-cloud-decrypt --source . --region asia-east1
```

同個 service 會原地更新、不用重設 IAM。
