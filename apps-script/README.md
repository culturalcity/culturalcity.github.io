# 閱大安・自動澆水提醒（Apps Script）

每天清晨 5 點自動判斷今天該不該澆水，該澆就在 `culturalcity85@gmail.com` 的主 Calendar 建一個 06:30 的事件，給總幹事看。

> 為什麼有這個工具？社區自動澆灌系統的雨水感測器壞了、原廠商倒閉，短期內用氣象資料模擬「該不該澆」的判斷，等之後找到第三方廠商裝實體感測器再退役。

## 部署在哪

- **Google 帳號**：`culturalcity85@gmail.com`（社區共用帳號）
- **Apps Script**：[script.google.com](https://script.google.com) 用 culturalcity85 登入後可看到專案「閱大安澆水提醒」
- **觸發時機**：每天 05:00–06:00（台北）跑一次 `runDaily()`
- **資料來源**：
  - 歷史降雨：`https://raw.githubusercontent.com/culturalcity/culturalcity.github.io/main/utility/data/daily-rain.json`（GitHub Pages 同 repo，每天清晨 06:00 由 `scripts/fetch-weather.js` 自動更新）
  - 預報：CWA OpenData F-D0047-063（臺北市 / 大安區 / 12 小時降雨機率＋最高溫度）
- **輸出**：建在 culturalcity85 主 Calendar 的事件，標題以「💧」開頭

## 第一次部署步驟（給接手的人）

1. 用 culturalcity85@gmail.com 登入 Google
2. 開 [script.google.com](https://script.google.com) → New project → 取名「閱大安澆水提醒」
3. 把 `watering-reminder.gs` 整個檔案貼進 `Code.gs`（取代預設內容）
   - **務必按 `Ctrl + S` 存檔**——不存檔的話編輯器頂部不會出現「▶ 執行」按鈕和 function 下拉選單，後續步驟會卡住
   - 存檔成功後，標題旁的「尚未儲存變更」字樣會消失
4. 左側齒輪 ⚙ Project Settings → Script properties → Add property：
   - `CWA_API_KEY` = 你的 CWA OpenData 金鑰（在 [opendata.cwa.gov.tw](https://opendata.cwa.gov.tw) 申請；本社區的 key 也存在 repo 根目錄 `.env`）
   - `NOTIFY_EMAIL` = `culturalcity85@gmail.com`（出錯通知 / 月報。寄到社區共用信箱本身，主委交接時不用換；登入 culturalcity85 就能看到所有歷史月報）
5. **第一次跑 function 走完授權流程**——直接設 trigger 會卡在授權，先跑一次無副作用的 function 把授權通過：
   - 編輯器頂部下拉選 `dryRunToday`，按 ▶ 執行
   - Google 會跳「Google 尚未驗證這個應用程式」黃色警告（**這是正常的，因為這支 script 沒送 Google 審核**）
   - 點左下角小字 **「進階」** → 出現「前往閱大安澆水提醒（不安全）」 → 點它
   - 列出 Calendar / UrlFetch / Gmail 權限 → 按 **「允許」**
   - 跑完下方「執行紀錄」應該會印 `[dryRunToday] ... → SKIP/WATER ...`
6. 左側 ⏰ Triggers → Add Trigger 兩個：
   - **每日澆水判斷**
     - Function: `runDaily`
     - Event source: Time-driven
     - Type: Day timer
     - Time of day: `5am to 6am`
   - **月報統計**
     - Function: `monthlySummary`
     - Event source: Time-driven
     - Type: Month timer
     - Day of month: `1`
     - Time of day: `7am to 8am`
   - ⚠ **如果儲存 trigger 時跳「指令碼授權失敗。請檢查您的彈出式視窗攔截器」紅字**：是瀏覽器擋了彈窗。Chrome 網址列右側會有 ⛔ icon，點它 → 「一律允許 script.google.com 顯示彈出式視窗」→ F5 重整頁面 → 再儲存。或直接用無痕視窗開 Apps Script 重設。

## 測試怎麼跑

在 Apps Script Editor 上方的 function 下拉選單選擇要跑的 function，按 ▶ Run，看下方 Execution log。

| Function | 用途 |
|---|---|
| `testHistoricalCases()` | 跑 6 個歷史日期，比對預期結果（不建事件） |
| `simulate('2024-05-13')` | 模擬指定日期清晨的判斷（純歷史降雨，不抓預報） |
| `dryRunToday()` | 跑今天的完整邏輯但只印 log，不建事件 |
| `runDaily()` | 正式版：跑今天 + 該澆就建事件（trigger 跑的就是這個） |
| `testCheckYesterday()` | 印昨天澆水事件的完成狀態（依顏色判斷） |
| `testMonthlySummary()` | 立刻寄上個月的月報 mail（測試用） |
| `testForecastLog()` | 立刻寫一筆 forecast snapshot 到 Sheet + backfill 既有列；印 Sheet URL |

## 總幹事的工作流程

每天早上 6 點手機響，會看到 culturalcity85 主 Calendar 的「💧 今日建議澆水」事件：

1. 開閥門澆水
2. 澆完開 Calendar，把事件**顏色改成「灰色 / Graphite」**——隔天清晨腳本會偵測，月報才會算她有澆完
3. 沒看到事件 = 今天不需澆水（下雨 / 預報雨 / 中性日）

事件顏色語意：
- 🟧 橘色：高溫無雨，強烈建議澆
- 🟦 藍色：連日少雨，一般建議澆
- 🟨 黃色：預報資料缺，依歷史判斷建議澆
- ⬜ 灰色：總幹事手動標記「已澆」

## 預報精度日誌（Forecast Log）

每天清晨 5 點 `runDaily` 跑完澆水判斷後，會把今日的 CWA 預報快照寫進
一個 Google Sheet「閱大安澆水提醒・預報精度日誌」（首次跑時自動建立在
culturalcity85 的 My Drive 根目錄）。

每一列：

```
date | popToday | popTomorrow | tempToday | actualRainToday | actualTmaxToday | recordedAt
```

`actualRainToday / actualTmaxToday` 在當天還是空的；隔天清晨腳本會自動
從 `daily-rain.json / daily-temp.json` backfill。跑滿 1-2 個月後可以分析：

- CWA 預報 PoP 70% 的日子，實際下雨比例多少？
- PoP 30% 的日子卻下雨的「surprise rain」有多少？
- 預報 tmax 跟實際 tmax 的平均誤差幾度？

這就是預報的「校準曲線（calibration curve）」。有了它才能合理調整
70% / 80% 等閾值。

要找這個 Sheet：登入 culturalcity85 → Google Drive → 搜尋「預報精度日誌」。
Sheet ID 同時也存在 Apps Script 的 Script Property `FORECAST_SHEET_ID`。

如果想一次性 reset（譬如想換新表）：刪掉 Script Property `FORECAST_SHEET_ID`，
下次跑 `testForecastLog()` 會重新建一張。

## 怎麼修改閾值

`watering-reminder.gs` 最上方的 `CONFIG` 物件，每個閾值都有註解：

```javascript
const CONFIG = {
  RAIN_YESTERDAY_SKIP: 5,    // 昨日 ≥ 5 mm 跳過
  RAIN_PAST_3D_SKIP: 8,      // 過去 3 日累積 ≥ 8 mm 跳過
  ...
  HIGH_TEMP: 28,             // 今日預報 ≥ 28°C 視為高溫
  POP_TODAY_SKIP: 70,        // 今日降雨機率 ≥ 70% 跳過
  ...
};
```

改完存檔即可，下次 trigger 跑時生效，不用重新部署。

## 怎麼新增 / 移除收件人

事件本身建在 culturalcity85 主 Calendar；總幹事看到事件是因為這個 Calendar 已分享給她。要新增 / 移除「能看到澆水提醒」的人，**不用改 Apps Script**，只要改 Calendar 分享設定：

1. Google Calendar → 左側「我的日曆」→ culturalcity85 主日曆 → ⚙ Settings and sharing
2. Share with specific people → 增加 / 刪除
3. 權限：總幹事建議「Make changes to events」（讓她可改顏色標完成），其他人「See all event details」即可

錯誤通知 mail 是 `NOTIFY_EMAIL` 那個 Script Property，要改的話直接改 Property，不用改 code。

## 出錯時怎麼除錯

### 症狀：早上沒收到提醒

1. 開 Apps Script Editor → 左側「Executions」看最近一次 `runDaily` 結果
2. 如果有錯誤，點進去看 stack trace
3. 同時 `NOTIFY_EMAIL` 應該也會收到 mail（自身錯誤除外）
4. 常見錯誤：
   - `CWA HTTP 401` → API key 過期或被改，重申請
   - `降雨歷史 HTTP ...` → GitHub raw 短暫不可用（自動降級到只看歷史；隔天通常自動恢復）
   - `Script Property CWA_API_KEY 未設` → 設定步驟 4 沒做

### 症狀：明明該澆卻沒提醒（誤跳過）

跑 `simulate('YYYY-MM-DD')` 模擬該日，看 reason 為何跳過。對照 CONFIG 的閾值判斷是不是要調整。

### 症狀：明明剛下完雨還在提醒（誤報）

通常是預報 API 失敗，走了 fallback 而歷史也乾燥（Rule fallback-dry）。看 `Executions` log 的 forecast 欄位是不是 null。

## 修改 / 維護的快捷指令

```
# 看最近執行紀錄
Apps Script Editor → 左側 Executions

# 暫停整個系統
Apps Script Editor → 左側 Triggers → 找到 runDaily → 刪除（或停用）

# 永久關閉
刪除整個 Apps Script 專案，主 Calendar 留下的歷史事件不會自動消失
```

## 相關檔案

- `watering-reminder.gs`（此資料夾）— Apps Script 主程式
- `scripts/fetch-weather.js` — 抓 CODiS 每日氣溫＋降雨，寫到 `utility/data/daily-*.json`
- `utility/data/daily-rain.json` — 降雨歷史（Apps Script fetch 的就是這個）
- `raw/閱大安_澆水提醒_GoogleCalendar_requirement.md` — 原始 spec，閾值 / 設計依據都在這
