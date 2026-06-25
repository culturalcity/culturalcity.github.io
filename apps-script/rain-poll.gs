// ═══════════════════════════════════════════════════════════════
// 閱大安 強降雨即時警報 Polling（Apps Script）
// ═══════════════════════════════════════════════════════════════
//
// 目的：短時強降雨會讓地下室／車道進水。這支盯著「大安森林(CAAH60)
//       即時過去 1 小時雨量(時雨量)」，達門檻就 email 警衛室／總幹事，
//       請其立刻去顧地下室車道、必要時下放擋水閘門、確認抽水馬達。
//
// 跟 wind-poll.gs 同型（自己當判官、即時觀測 → email）：
//   - 颱風/豪雨 CWA 有官方特報，但那是「整天總量」尺度、且地下室淹水看的是
//     「時雨量(強度)」而非 24h 總量，官方特報抓不到「午後雷陣雨 1 小時爆量」。
//   - 故這支用「即時時雨量」自訂門檻，補官方特報的時間/尺度盲區。
//   - 官方豪雨特報（提前準備層、走行事曆）另由別支處理，與此互補。
//
// ── 門檻怎麼來的（誠實交代）──
//   觸發＝「過去 10 分鐘雨量 ≥ 13 mm」。這個 13 不是亂訂：
//   台北市雨水下水道設計保護標準 ≈ 78.8 mm/hr（5 年重現期），逼近這個速率
//   排水才會被灌爆、路面積水、地下室才有風險。把 78.8 mm/hr 換算成 10 分鐘
//   視窗：78.8 ÷ 6 ≈ 13 mm/10min。
//   為什麼用「過去 10 分鐘」不用「過去 1 小時」：地下室淹水是「短時爆雨」造成
//   （30 分鐘灌 60mm 就能淹車道），但這種爆雨的「過去 1 小時」可能才 60 < 78.8、
//   會漏報；10 分鐘視窗反應快、抓得到爆量、雷陣雨一開始就響。
//   寫成可調 CONFIG，跑一兩場大雨後依現場校準。
//
// Script Properties 需設定（專案設定 → 指令碼屬性）：
//   CWA_KEY         — CWA OpenData 授權碼（複製本 repo .env 的 CWA_API_KEY 值）
//   ALERT_EMAIL     — 收警報的信箱，預設 culturalcity85@gmail.com（自寄自收）
//   RAIN_10MIN_ALERT — （選填）過去 10 分鐘雨量門檻 mm，不填預設 13（≈78.8mm/hr）
//
// 安裝：跑 setup() 一次，建每 10 分鐘 trigger（強降雨變化快，比風的 15 分密一點）。

// ── 常數 ──────────────────────────────────────────

// CAAH60 大安森林：社區所在大安區的地理中心，能 catch 局部對流雨；
// 自動雨量站 O-A0002-001 才有 Past1hr 等完整累積值（O-A0001-001 沒有）。
var RAIN_STATION = 'CAAH60';
var RAIN_DATASET = 'O-A0002-001';
var DRAINAGE_MMHR = 78.8;       // 台北市雨水下水道設計保護標準（mm/hr），門檻換算依據
var DEFAULT_10MIN_ALERT = 13;   // 預設過去10分雨量門檻 mm（≈78.8mm/hr÷6；見檔頭）
var OBS_COOLDOWN_H = 2;         // 即時警報冷卻：N 小時內不重寄（雨勢再增強才立即再報）
var RAIN_STEP_REALERT = 5;      // 冷卻期內，過去10分雨量再 +5 mm 視為升級、立即再報

// ── Helpers ────────────────────────────────────────

function prop(name) {
  return PropertiesService.getScriptProperties().getProperty(name);
}
function setProp(name, val) {
  PropertiesService.getScriptProperties().setProperty(name, val);
}

function rainThreshold() {
  var v = parseFloat(prop('RAIN_10MIN_ALERT'));
  return isNaN(v) ? DEFAULT_10MIN_ALERT : v;
}

function alertEmail() {
  return prop('ALERT_EMAIL') || 'culturalcity85@gmail.com';
}

function cwaKey() {
  var k = prop('CWA_KEY');
  if (!k) throw new Error('CWA_KEY not set in Script Properties');
  return k;
}

function cwaFetch(dataset, params) {
  var url = 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/' + dataset +
    '?Authorization=' + encodeURIComponent(cwaKey());
  for (var k in params) {
    url += '&' + k + '=' + encodeURIComponent(params[k]);
  }
  var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (resp.getResponseCode() >= 400) {
    throw new Error('CWA ' + dataset + ': ' + resp.getResponseCode() + ' ' +
      resp.getContentText().substring(0, 200));
  }
  return JSON.parse(resp.getContentText());
}

function sendAlert(subject, body) {
  MailApp.sendEmail({ to: alertEmail(), subject: subject, body: body });
  Logger.log('Sent: ' + subject);
}

// ── 即時觀測：CAAH60 過去 10 分鐘雨量（爆雨偵測）─────

function checkRainObservation() {
  var data = cwaFetch(RAIN_DATASET, { StationId: RAIN_STATION });
  var stations = data.records && data.records.Station;
  if (!stations || !stations.length) { Logger.log('No station data'); return; }

  var st = stations[0];
  var re = st.RainfallElement;
  if (!re) { Logger.log('No RainfallElement (dataset 換錯了？)'); return; }

  // 主觸發＝過去 10 分鐘雨量（反應快、抓得到短時爆雨）；過去 1 小時僅供 email 補充
  var raw10 = re.Past10Min && re.Past10Min.Precipitation;
  var mm10 = parseFloat(raw10);
  var raw1h = re.Past1hr && re.Past1hr.Precipitation;   // 小寫 h（CWA schema 不統一）
  var mm1h = parseFloat(raw1h);
  var obsTime = (st.ObsTime && st.ObsTime.DateTime) || '';
  Logger.log(RAIN_STATION + ' Past10Min=' + raw10 + ' Past1hr=' + raw1h + ' (' + obsTime + ')');

  // CWA 對 missing data 用 -99 等負值 → 視為無資料、不報
  if (isNaN(mm10) || mm10 < 0) { Logger.log('No valid Past10Min this run'); return; }

  var threshold = rainThreshold();
  var rateHr = mm10 * 6; // 換算時雨量 mm/hr
  if (mm10 < threshold) {
    Logger.log('過去10分 ' + mm10 + ' mm（≈' + rateHr.toFixed(0) + 'mm/hr）< 門檻 ' + threshold + '，不報');
    return;
  }

  // 冷卻：OBS_COOLDOWN_H 內不重寄；雨勢再 +RAIN_STEP_REALERT 才升級立即再報
  var nowMs = new Date().getTime();
  var last = {};
  try { last = JSON.parse(prop('rainObsAlert') || '{}'); } catch (e) {}
  if (last.ts && (nowMs - last.ts) < OBS_COOLDOWN_H * 3600 * 1000 &&
      mm10 < (last.mm || 0) + RAIN_STEP_REALERT) {
    Logger.log('Within cooldown, not escalated enough, skip');
    return;
  }

  var oneHrLine = (isNaN(mm1h) || mm1h < 0)
    ? '・過去 1 小時累積：（無資料）'
    : '・過去 1 小時累積：' + mm1h.toFixed(1) + ' mm';

  var subject = '🌧️ 強降雨即時警報・過去10分 ' + mm10.toFixed(0) + ' mm（時雨量約 ' + rateHr.toFixed(0) + 'mm/hr，請顧地下室車道）';
  var body =
    '大安森林站剛測到短時強降雨，地下室／車道有進水風險。\n\n' +
    '・過去 10 分鐘雨量：' + mm10.toFixed(1) + ' mm（換算時雨量約 ' + rateHr.toFixed(0) + ' mm/hr）\n' +
    oneHrLine + '\n' +
    '・測站：大安森林（' + RAIN_STATION + '）\n' +
    '・觀測時間：' + obsTime + '\n' +
    '・觸發門檻：過去 10 分 ' + threshold + ' mm（≈' + (threshold * 6).toFixed(0) + 'mm/hr，台北下水道設計上限）\n\n' +
    '【請立即處理】\n' +
    '1. 到地下室車道入口查看積水情形\n' +
    '2. 必要時下放停車場擋水閘門\n' +
    '3. 確認抽水馬達／集水井運作正常\n' +
    '4. 清除車道、中庭排水孔阻塞物\n\n' +
    '※ 大安森林站與社區門口實際雨勢仍可能略有落差，請以現場為準。\n' +
    '※ 由 Apps Script rain-poll 自動寄出。';
  sendAlert(subject, body);
  setProp('rainObsAlert', JSON.stringify({ ts: nowMs, mm: mm10 }));
}

// ── 主函數（trigger 呼叫） ────────────────────────

function checkRain() {
  try {
    checkRainObservation();
  } catch (e) {
    Logger.log('Observation error: ' + e.message);
  }
}

// ── 測試用：手動跑一次、忽略冷卻 ──────────────────

function testRainNow() {
  setProp('rainObsAlert', ''); // 清冷卻
  checkRainObservation();
}

// ── Setup（跑一次即可） ───────────────────────────

function setup() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'checkRain') {
      ScriptApp.deleteTrigger(triggers[i]);
      Logger.log('Deleted existing trigger');
    }
  }
  ScriptApp.newTrigger('checkRain').timeBased().everyMinutes(10).create();
  Logger.log('Created trigger: checkRain every 10 minutes');
  Logger.log('Script Properties needed: CWA_KEY, ALERT_EMAIL (預設 culturalcity85), RAIN_10MIN_ALERT (選填，預設 13)');
}
