# 每日水電自動抓取（fetch-utility.js）

## 它做什麼

每天早上自動：
1. 從台電 ebpps2 抓昨日大公電（00815173019）用電度數
2. 從北水智慧水管家抓昨日公水（1-19-0068279）用水度數
3. 寫到 `https://culturalcity.org/admin/utility/api/data`（KV）

開啟 `https://culturalcity.org/admin/utility/` 時看到的就是抓好的數字。

## 它怎麼運作

- 連到「自動化 Chrome」(port 9222) 的既有 session
- 走真實使用者瀏覽器，**避開** 台電 CloudFlare Turnstile 和北水 CAPTCHA
- 寫入 KV 用普通 HTTP request（沒有任何防護）

完整架構見 `raw/UTILITY-AUTOMATION-PLAN.md`。

## 日常使用流程

### 1. 啟動自動化 Chrome（保持開著）

雙擊 `raw/CHROME-AUTOMATION-SHORTCUT.bat`。

第一次開啟時：
- 預設兩個 tab：台電 ebpps2 登入頁、北水登入頁
- 手動填密碼、過 Turnstile、解 CAPTCHA、按登入
- 之後不要關 Chrome（最小化可以）

Session 失效時（預估每數天到數週一次）：
- 自動化會發桌面通知「session 失效」
- 重新打開那個 tab 手動登入即可（cookies 會 refresh）

### 2. 排程

每天 06:30 由 Windows 工作排程器自動觸發 `scripts/fetch-utility.bat`。

第一次設定請開 PowerShell（**以系統管理員**）執行：

```powershell
$action = New-ScheduledTaskAction `
  -Execute "cmd.exe" `
  -Argument "/c `"D:\OneDrive\06. 房地產\閱大安\閱大安社區\culturalcity.github.io\scripts\fetch-utility.bat`""

$trigger = New-ScheduledTaskTrigger -Daily -At "06:30"

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 10)

Register-ScheduledTask `
  -TaskName "閱大安_每日水電抓取" `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "每天 06:30 抓前一日大公電與公水度數，寫入 culturalcity.org KV"
```

> `-StartWhenAvailable` 表示如果 06:30 電腦睡著錯過了，醒來後會補跑。

刪除排程：

```powershell
Unregister-ScheduledTask -TaskName "閱大安_每日水電抓取" -Confirm:$false
```

### 3. 看 log

每次跑的輸出 append 到 `raw/fetch-utility.log`。需要時開來看。

## 手動執行

```bash
# 抓昨天並寫入
node scripts/fetch-utility.js

# 抓但不寫入（看結果）
node scripts/fetch-utility.js --dry-run

# 抓指定日期（限本月內）
node scripts/fetch-utility.js --date=2026-05-23

# 只抓電
node scripts/fetch-utility.js --skip-water

# 只抓水
node scripts/fetch-utility.js --skip-electric
```

## 退出碼

| Code | 意義 |
|---|---|
| 0 | 成功（兩來源都抓到並寫入）|
| 1 | 部分成功（一個來源失敗，另一個已寫入）|
| 2 | 完全失敗（Chrome 沒開 / KV 寫入失敗 / 兩來源都失敗）|

## 除錯

### 「Chrome 沒在 port 9222 listening」
→ 用 `raw/CHROME-AUTOMATION-SHORTCUT.bat` 啟動 Chrome。

### 「台電 session 失效」/「北水 session 失效」
→ 在自動化 Chrome 中重新登入該網站。
- 台電登入：`https://service.taipower.com.tw/ebpps2/login`
- 北水登入：`https://mbr.water.gov.taipei/Home/UserLogin`

### 「每日 chart 沒在 20 秒內載入」
→ 通常是 Chrome 背景 tab 被 throttled。已用 interval polling 避開。
   如果仍頻繁出現，可能網路慢，把 timeout 拉長（taipower.js 內）。

### 「目前頁面顯示本月，無法查跨月日期」
→ v0.1 限制：只支援查本月日期。月初要查上月最後一天請手動補。

### 月初幾天要查上個月最後一天怎辦
→ v0.1 不處理。建議手動到 `admin/utility/` 補上前一日。
   v0.2 會加入月份切換邏輯。

## 檔案結構

```
scripts/
├── fetch-utility.js          主腳本
├── fetch-utility.bat         Windows Task Scheduler 包裝
├── verify-kv.js              KV 連線測試（一次性）
├── README-fetch-utility.md   本文件
└── lib/
    ├── env.js                 .env loader（無外部依賴）
    ├── kv-utility.js          culturalcity KV API
    ├── chrome-cdp.js          CDP 連 Chrome
    ├── taipower.js            台電 AMI 抓取
    └── taipei-water.js        北水 webpms API 抓取
```

## 相關文件

- 完整架構與決策：`raw/UTILITY-AUTOMATION-PLAN.md`
- 啟動腳本：`raw/CHROME-AUTOMATION-SHORTCUT.bat`
- 密碼配置：`.env`（gitignored）
