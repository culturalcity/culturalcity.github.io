/**
 * Calendar Bridge - 閱大安社區自動化提醒 → Google Calendar 寫入器
 *
 * 部署位置：culturalcity85@gmail.com 的 Apps Script
 * 使用者：scripts/check-heat-alert.js（高溫關懷），未來其他 GitHub Actions 自動化也可共用
 *
 * 部署流程：
 *   1. 用 culturalcity85 登入 https://script.google.com，建立新專案「閱大安 Calendar Bridge」
 *   2. 把這份檔案內容貼進去（取代預設 Code.gs）
 *   3. 專案設定 → 指令碼屬性 → 加 SHARED_SECRET = <自訂長 token>
 *   4. 部署 → 新增部署作業 → 類型「網頁應用程式」
 *      執行身分：我（culturalcity85@gmail.com）
 *      存取權：所有人（靠 SHARED_SECRET 保護，不靠 Google 登入）
 *   5. 取得 Web App URL，貼到 GitHub Secrets APPS_SCRIPT_WEBHOOK_URL
 *
 * 安全性：
 *   payload.secret 必須等於 PropertiesService 內的 SHARED_SECRET，否則 401
 *   （Web App 設定為「所有人」是因為 Google 服務帳號 + 個人 Gmail 沒法做 OAuth；
 *    用 shared secret + URL 不公開即可，secret 從未在 client side 出現）
 *
 * 去重邏輯：
 *   每筆 event 用 title 前綴 + date 在 calendar 上搜尋，已有就 update description，沒有才 create
 */

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);

    const expectedSecret = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
    if (!expectedSecret || payload.secret !== expectedSecret) {
      return jsonOut({ ok: false, error: 'unauthorized' }, 401);
    }

    const events = payload.events || [];
    const calendar = CalendarApp.getDefaultCalendar();
    const results = [];

    events.forEach(function(ev) {
      try {
        const result = upsertAllDayEvent(calendar, ev);
        results.push({ track: ev.track, date: ev.date, action: result.action, id: result.id });
      } catch (err) {
        results.push({ track: ev.track, date: ev.date, action: 'error', error: String(err) });
      }
    });

    return jsonOut({ ok: true, count: events.length, results: results });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) }, 500);
  }
}

function doGet() {
  // 健康檢查
  return jsonOut({ ok: true, service: 'culturalcity calendar bridge', time: new Date().toISOString() });
}

function upsertAllDayEvent(calendar, ev) {
  const date = parseDate(ev.date);

  // 用標題前綴去重：取 title 的第一個字（emoji），加日期當搜尋鍵
  const titlePrefix = (ev.title || '').split('・')[0]; // 「⚠️ CWA 高溫警報」這段
  const startOfDay = new Date(date.getTime());
  const endOfDay = new Date(date.getTime() + 24 * 60 * 60 * 1000);

  const existing = calendar.getEventsForDay(date).filter(function(e) {
    return e.getTitle().indexOf(titlePrefix) === 0;
  });

  if (existing.length > 0) {
    const evt = existing[0];
    evt.setTitle(ev.title);
    evt.setDescription(ev.description || '');
    if (ev.color && CalendarApp.EventColor[ev.color]) {
      evt.setColor(CalendarApp.EventColor[ev.color]);
    }
    return { action: 'updated', id: evt.getId() };
  }

  const created = calendar.createAllDayEvent(ev.title, date, { description: ev.description || '' });
  if (ev.color && CalendarApp.EventColor[ev.color]) {
    created.setColor(CalendarApp.EventColor[ev.color]);
  }
  return { action: 'created', id: created.getId() };
}

function parseDate(yyyymmdd) {
  const parts = String(yyyymmdd).split('-');
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}

function jsonOut(obj, statusCode) {
  // Apps Script Web App 無法直接設 HTTP status code，所以把 status 嵌進 body
  // client 端用 obj.ok 判斷成敗
  if (statusCode) obj._status = statusCode;
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
