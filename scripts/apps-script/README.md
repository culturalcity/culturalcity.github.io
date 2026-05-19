# 閱大安 Apps Script 部署

這資料夾存放 Apps Script 程式碼**備份**。
**真正執行的版本**位於 `culturalcity85@gmail.com` 的 Google Apps Script，這裡只是讓 Claude Code / 接班主委能在 repo 內看到、改了之後手動同步上去。

## calendar-bridge.gs：Calendar 寫入器

讓 GitHub Actions 自動化（目前是 `check-heat-alert.js`，未來其他自動化也可共用）能寫事件到 culturalcity85 主 Calendar。

### 為什麼用 Apps Script Web App 當橋接

- 個人 Gmail 帳號（非 Workspace）無法用 service account 寫 Calendar
- OAuth refresh token 流程繁瑣，且 token 過期要重新 grant
- Apps Script 以 culturalcity85 身分執行，天生有 `CalendarApp` 權限
- 一條 Web App URL + 一個 shared secret 即可，最簡單

### 部署步驟（第一次）

1. **用 `culturalcity85@gmail.com` 登入** https://script.google.com
2. **新增專案**，命名「閱大安 Calendar Bridge」
3. **貼程式碼**：把本資料夾的 `calendar-bridge.gs` 內容貼進 `Code.gs`，存檔
4. **設定 Script Property**：
   - 左側齒輪「專案設定」→「指令碼屬性」→「新增指令碼屬性」
   - Key：`SHARED_SECRET`
   - Value：自訂的長字串（建議 32+ 字元隨機，可用 `openssl rand -hex 32` 產出；稍後也要貼到 GitHub Secrets）
5. **部署為 Web App**：
   - 右上「部署」→「新增部署作業」
   - 類型：**網頁應用程式**
   - 說明：「v1 - heat-alert bridge」
   - 執行身分：**我（culturalcity85@gmail.com）**
   - 存取權：**所有人**（靠 SHARED_SECRET 保護；不是依賴 Google 帳號）
   - 按「部署」→ Google 會跳授權流程，**允許讓這個 script 管理你的 calendar**
6. **複製 Web App URL**（長得像 `https://script.google.com/macros/s/AKfy.../exec`）

### GitHub Secrets 需要設定的 3 個

到 GitHub repo → Settings → Secrets and variables → Actions → New repository secret：

| Secret 名稱 | 值 | 從哪來 |
|---|---|---|
| `CWA_API_KEY` | `CWA-XXXXXXXX-XXXX-...` | https://opendata.cwa.gov.tw/user/authkey（已有的話用既有的）|
| `APPS_SCRIPT_WEBHOOK_URL` | `https://script.google.com/macros/s/AKfy.../exec` | 上面步驟 6 |
| `APPS_SCRIPT_SHARED_SECRET` | 跟 Script Property 一模一樣的長字串 | 步驟 4 自訂的 |

### 測試流程

#### 1. Bridge 健康檢查（瀏覽器即可）
直接打開 Web App URL，應該看到：
```json
{"ok":true,"service":"culturalcity calendar bridge","time":"2026-05-19T..."}
```

#### 2. 本機 dry run（不真送 webhook，只看會送什麼）
```powershell
$env:CWA_API_KEY = "你的-CWA-key"
node scripts/check-heat-alert.js --dry-run
```
看 console 印出 events JSON。沒高溫警報、明日預報也 <35°C 時會印「無需建立任何事件」——這是常態。

#### 3. 本機真打 webhook（事件會真的出現在 calendar）
```powershell
$env:CWA_API_KEY = "你的-CWA-key"
$env:APPS_SCRIPT_WEBHOOK_URL = "https://script.google.com/.../exec"
$env:APPS_SCRIPT_SHARED_SECRET = "你的-shared-secret"
node scripts/check-heat-alert.js
```

#### 4. GitHub Actions 手動觸發
Actions tab → Heat Alert (CWA → Google Calendar) → Run workflow

### 預期上線觸發頻率

- **主軌（CWA 高溫資訊含臺北市）**：黃燈 36°C / 橘燈 38°C / 紅燈連 3 天 38°C，台北一年觸發 0-30 天
- **副軌（預報 MaxT ≥ 36°C）**：與黃燈門檻一致，當「明日很可能發黃燈」的前置提醒。

兩條同門檻的好處：副軌等於是「明天會發警報的早一晚提示」，主軌等到當天 CWA 正式發布才確認。
副軌誤觸發（隔天沒真的發警報）也無傷，總幹事多打一通電話而已。

如果副軌想再寬鬆（譬如想含到 35°C 的悶熱日），改 `scripts/check-heat-alert.js` 的 `FORECAST_THRESHOLD_C`。

### 修改 bridge 後的同步

`calendar-bridge.gs` 改完後**必須手動同步到 Apps Script editor**（這 repo 只是備份，Google 不會自己拉）：

1. 編輯本 repo 的 `.gs` 並 commit
2. 開 script.google.com 對應的專案，貼新內容
3. 「部署」→「管理部署作業」→ 編輯既有部署 → 版本「新版本」→ 部署
   （**不要新增部署作業**——會產生新 URL，要更新 GitHub Secrets，麻煩）

`check-heat-alert.js`（在 GitHub Actions 跑）改完直接 push 就會生效，不用同步。
