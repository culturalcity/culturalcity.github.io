// 每天 08:00 台北跑：偵測臺北 W29 燈號 → 生成公告草稿 → workflow 開 PR
//
// 資料源：CWA W29 高溫資訊 page 的 JS source
//   Warning_Taiwan.js  → 結構化燈號（county 63 = 臺北市 → ['W29-N']）
//   Warning_Content.js → 原文（issued/validto/content）
// CWA 在每天 07:30 publish 當日 settled 等級，08:00 cron 跑時可信賴。
//
// 連續第 N 日：從 src/notice/ 檔名往前數，匹配 'YYYY-MM-DD-高溫{黃|橙|紅}燈提醒.html'
// 直到找不到前一日為止；當日 = (連續前置數) + 1。
//
// CLI:
//   node scripts/draft-heat-notice.js              # 真寫檔到 src/notice/
//   node scripts/draft-heat-notice.js --dry-run    # 印生成內容、不寫檔
//
// Workflow output (寫到 $GITHUB_OUTPUT)：
//   filepath  生成檔案的相對路徑（若無燈號則 empty）
//   level     等級中文字（黃/橙/紅）
//   day       連續第幾日（數字）
//   date      日期 YYYY-MM-DD

const https = require('https');
const fs = require('fs');
const path = require('path');

const CWA_W29_BASE = 'https://www.cwa.gov.tw/Data/js/warn';
const TAIPEI_COUNTY_CODE = '63';
const W29_LEVELS = {
  '1': { zh: '黃', en: 'Yellow', ja: '黄' },
  '2': { zh: '橙', en: 'Orange', ja: '橙' },
  '3': { zh: '紅', en: 'Red',    ja: '赤' },
};
const NOTICE_DIR = 'src/notice';
const DRY_RUN = process.argv.includes('--dry-run');

// ── helpers ────────────────────────────────────────────

function getText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'culturalcity-draft-heat-notice' } }, res => {
      let buf = '';
      res.on('data', c => (buf += c));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}: ${buf.slice(0, 200)}`));
        }
        resolve(buf);
      });
    }).on('error', reject);
  });
}

function evalJsModule(jsText, varName) {
  const fn = new Function(jsText + `\nreturn typeof ${varName} !== 'undefined' ? ${varName} : null;`);
  return fn();
}

function todayTaipei() {
  const t = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return t.toISOString().slice(0, 10);
}

function addDays(yyyyMmDd, deltaDays) {
  const d = new Date(yyyyMmDd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

// ── 偵測今日臺北 W29 等級 ───────────────────────────────

async function detectLevel() {
  const taiwanJs = await getText(`${CWA_W29_BASE}/Warning_Taiwan.js`);
  const WarnTown = evalJsModule(taiwanJs, 'WarnTown');
  if (!WarnTown) throw new Error('Warning_Taiwan.js 解析失敗');

  const taipeiEntry = WarnTown[TAIPEI_COUNTY_CODE];
  if (!taipeiEntry) return null;

  let w29Code = null;
  for (const key of Object.keys(taipeiEntry)) {
    const codes = taipeiEntry[key] || [];
    const found = codes.find(c => typeof c === 'string' && c.startsWith('W29-'));
    if (found) { w29Code = found; break; }
  }
  if (!w29Code) return null;

  const levelNum = w29Code.split('-')[1];
  const level = W29_LEVELS[levelNum];
  if (!level) throw new Error(`未知 W29 等級代號：${w29Code}`);

  // 再拉 content 取 issued/validto 做時序檢查（避免抓到「明日」advisory）
  const contentJs = await getText(`${CWA_W29_BASE}/Warning_Content.js`);
  const WarnContent = evalJsModule(contentJs, 'WarnContent');
  const w29Content = WarnContent && WarnContent.W29 && WarnContent.W29.C;
  if (!w29Content) throw new Error('Warning_Content.js 找不到 W29.C');

  const validto = w29Content.validto || '';
  const validtoDate = validto.slice(0, 10).replace(/\//g, '-');
  const today = todayTaipei();
  if (validtoDate !== today) {
    // 若 validto 不是今日（譬如還在前一日 17:30 的明日預測階段），不開草稿
    return null;
  }

  return { ...level, levelNum, issued: w29Content.issued || '', validto, content: w29Content.content || '' };
}

// ── 從 src/notice/ 數連續第 N 日 ───────────────────────

function countConsecutiveDay(today) {
  let consecutive = 0;
  for (let i = 1; i <= 14; i++) {
    const day = addDays(today, -i);
    const found = fs.existsSync(NOTICE_DIR) && fs.readdirSync(NOTICE_DIR).some(f =>
      /^\d{4}-\d{2}-\d{2}-高溫(黃|橙|紅)燈提醒\.html$/.test(f) && f.startsWith(day)
    );
    if (!found) break;
    consecutive++;
  }
  return consecutive + 1;
}

// ── 模板生成 ────────────────────────────────────────────

function generateNotice(level, day, today) {
  const displayDate = today.replace(/-/g, '/');
  const isOrangeOrAbove = level.levelNum === '2' || level.levelNum === '3';
  const isRed = level.levelNum === '3';

  // ── 連續日語氣
  const dayPhraseZh = day >= 2 ? `・連續第 ${day} 日` : '';
  const dayPhraseEn = day >= 2 ? ` — Day ${day}` : '';
  const dayPhraseJa = day >= 2 ? `・${day}日連続` : '';
  const dayContextZh = day >= 3
    ? `連 ${day} 日高溫累積，提醒大家加倍注意。`
    : (day === 2 ? '連兩日高溫累積疲勞，提醒大家彼此關照。' : '');
  const dayContextEn = day >= 3
    ? `After ${day} consecutive days of heat, please take extra care.`
    : (day === 2 ? 'Sustained heat over two days accumulates fatigue; please look out for one another.' : '');
  const dayContextJa = day >= 3
    ? `${day}日連続の高温で疲労が累積していますので、より一層のご注意をお願いいたします。`
    : (day === 2 ? '連日の高温で疲労が累積しやすい時期ですので、お互いに気遣いをお願いいたします。' : '');

  // ── 等級說明（黃/橙/紅）
  const levelDescZh = {
    '1': '黃燈是高溫資訊中最輕的等級，代表有 36°C 高溫機率',
    '2': '橙燈代表「連續 36°C 高溫」的持續性風險，較黃燈一個等級為高',
    '3': '紅燈代表有「連續 38°C 極端高溫」的機率，是高溫資訊最高等級',
  }[level.levelNum];
  const levelDescEn = {
    '1': 'Yellow is the mildest tier, indicating a likelihood of temperatures reaching 36°C',
    '2': 'Orange indicates sustained risk of consecutive 36°C days, one tier higher than Yellow',
    '3': 'Red is the highest tier, indicating consecutive 38°C extreme heat',
  }[level.levelNum];
  const levelDescJa = {
    '1': '黄信号は高温情報の中で最も軽い注意レベルで、36℃の高温になる可能性を示します',
    '2': '橙信号は「連続36℃の高温」が続くリスクを示し、黄信号より一段階高いレベルです',
    '3': '赤信号は「連続38℃の極端な高温」のリスクを示し、最高レベルの高温情報です',
  }[level.levelNum];

  // ── 三件事內容
  const a1TitleZh = isOrangeOrAbove ? '多補水・避免長時間日曬' : '補水・防曬・避開正午外出';
  const a1BodyZh = isOrangeOrAbove
    ? '連續高溫下身體流失水分加快，比平常多喝水、少喝含糖或含咖啡因飲料（會加速脫水）。白天 11:00–15:00 最熱時段盡量留在室內或陰涼處；必要外出時撐傘、戴帽、隨身帶水。'
    : '白天 11:00–15:00 是最熱時段，盡量在室內或陰涼處活動；外出時撐傘、戴帽、隨身帶水。';

  const a2TitleZh = isOrangeOrAbove ? '室內全日降溫、夜間不要過早關冷氣' : '室內降溫小撇步';
  const a2BodyZh = isOrangeOrAbove
    ? '連續高溫日夜溫差變小，夜間室內仍可能悶熱。拉上窗簾／百葉減少陽光直射；冷氣搭配電風扇加速循環、設定 26–28°C 兼顧舒適與節電；睡前不要過早關冷氣，避免熱壓力延續到夜間影響睡眠與恢復。'
    : '拉上窗簾／百葉減少陽光直射；冷氣搭配電風扇加速循環、設定 26–28°C 兼顧舒適與節電；回家先開窗排出悶熱空氣再開冷氣。';

  const a3TitleZh = isOrangeOrAbove ? '主動問候敏感族群' : '彼此關心';
  const a3BodyZh = isOrangeOrAbove
    ? `${day >= 3 ? `連續第 ${day} 日，` : ''}家中或鄰居有長輩、小孩、慢性病親友的話，今天主動致電或敲門問一聲。若有人出現頭暈、噁心、皮膚乾熱無汗、意識不清的徵兆，請立刻協助移至涼處、補水降溫，並聯繫管理中心；若狀況嚴重請直接撥 119。`
    : '家中或鄰居有長輩、小孩、慢性病親友的話，今天多看一眼、多問一聲。若有人出現頭暈、噁心、皮膚乾熱無汗的徵兆，請立刻協助移至涼處並聯繫管理中心。';

  const noteZh = isOrangeOrAbove
    ? '若您或家人有身體不適或需任何協助，請隨時聯繫管理中心；緊急狀況請撥 119。'
    : '若您或家人有身體不適或需任何協助，請隨時聯繫管理中心。';

  // ── 說明段（連續起始日用 addDays 算，避免跨月 bug）
  const streakStart = addDays(today, -(day - 1)); // YYYY-MM-DD
  const streakStartMd = `${parseInt(streakStart.slice(5, 7), 10)}/${parseInt(streakStart.slice(8, 10), 10)}`;
  const explainZh = day >= 3
    ? `${streakStartMd} 起臺北已連續第 ${day} 日高溫警示，今日為${level.zh}燈，代表 36°C 高溫已不是「一天的事」、而是持續模式。連續高溫對身體散熱機制是累積壓力，對長者、小孩、慢性病友、孕婦特別嚴峻。本則整理今天我們可以一起留意的三件事，邀請大家彼此關照。`
    : (day === 2
      ? `${level.zh}燈雖${isOrangeOrAbove ? '' : '非嚴重等級，但'}連續高溫對長者、小孩、慢性病友、孕婦的負擔會逐日累積。本則整理今天我們可以一起留意的三件事，邀請大家彼此關照。`
      : `${level.zh}燈${isOrangeOrAbove ? '代表 36°C 連續高溫的持續性風險' : '雖非嚴重等級，但持續高溫對長者、小孩、慢性病友、孕婦仍是負擔'}。本則整理今天我們可以一起留意的三件事，邀請大家彼此關照。`);

  // ── EN 三件事（簡化版本）
  const a1TitleEn = isOrangeOrAbove ? 'Hydrate More, Avoid Prolonged Sun' : 'Hydrate, Stay Shaded, Avoid Midday Outings';
  const a1BodyEn = isOrangeOrAbove
    ? 'Sustained heat accelerates water loss; drink more water than usual, and avoid sugary or caffeinated drinks (they speed up dehydration). Stay indoors or in the shade during the hottest hours (11:00–15:00).'
    : '11:00–15:00 is the hottest stretch; stay indoors or in the shade when possible. If going out, carry an umbrella, wear a hat, and bring water.';

  const a2TitleEn = isOrangeOrAbove ? "Cool Your Home All Day; Don't Turn Off AC Too Early at Night" : 'Cool Your Home Smartly';
  const a2BodyEn = isOrangeOrAbove
    ? "Day-night temperature gaps shrink during sustained heat, and indoor spaces may stay warm at night. Draw curtains or blinds to block direct sun; pair the AC with a fan, set it to 26–28°C; don't turn off the AC too early before bed so heat stress doesn't carry into your sleep."
    : 'Draw curtains or blinds to block direct sun; pair the AC with a fan for faster circulation and set it to 26–28°C for comfort and energy savings.';

  const a3TitleEn = isOrangeOrAbove ? 'Reach Out to Vulnerable Neighbors and Family' : 'Check on Each Other';
  const a3BodyEn = isOrangeOrAbove
    ? `${day >= 3 ? `On this ${day}-day stretch of heat, ` : ''}if you have older family members, young children, or neighbors with chronic conditions, make a point to call or knock and check in today. If anyone shows signs of dizziness, nausea, hot dry skin without sweating, or altered consciousness, move them to a cool place, help them cool down and hydrate, and contact the Management Center. For serious cases, call 119 directly.`
    : 'If you have older family members, young children, or neighbors with chronic conditions, take a moment to look in on them today. If anyone shows signs of dizziness, nausea, or hot dry skin without sweating, move them to a cool place immediately and contact the Management Center.';

  const noteEn = isOrangeOrAbove
    ? 'If you or a family member feels unwell or needs any assistance, please contact the Management Center at any time. For emergencies, call 119.'
    : 'If you or a family member feels unwell or needs any assistance, please contact the Management Center at any time.';

  const explainEn = day >= 3
    ? `This is day ${day} of consecutive heat advisory in Taipei, with today's level at ${level.en}. The ${day}-day pattern means 36°C heat is no longer a single-day event but a sustained condition. Continuous heat compounds the strain on the body's cooling mechanisms, especially for older residents, young children, those with chronic conditions, and expectant mothers.`
    : (day === 2
      ? `While ${level.en} ${isOrangeOrAbove ? 'is a sustained-heat-level advisory' : 'is the lowest tier'}, consecutive days of heat compound the strain on older residents, young children, those with chronic conditions, and expectant mothers.`
      : `${isOrangeOrAbove ? `${level.en} indicates sustained risk of consecutive 36°C days. ` : `While ${level.en} is the lowest tier, sustained heat still strains older residents, young children, those with chronic conditions, and expectant mothers. `}Here are three things we can all keep in mind today.`);

  // ── JA 三件事（簡化版本）
  const a1TitleJa = isOrangeOrAbove ? '水分をいつもより多めに・長時間の直射日光を避ける' : '水分補給・日焼け対策・正午の外出回避';
  const a1BodyJa = isOrangeOrAbove
    ? '連続する高温で身体の水分損失が早まります。普段より多めに水分を取り、糖分・カフェインを含む飲料は控えめに（脱水を促進します）。日中の11:00〜15:00はできるだけ室内や日陰でお過ごしください。'
    : '日中の11:00〜15:00が最も暑い時間帯です。できるだけ室内や日陰でお過ごしください。外出の際は日傘・帽子・お水をお持ちください。';

  const a2TitleJa = isOrangeOrAbove ? '室内は一日中涼しく・夜間も早めにエアコンを切らない' : '室内を上手に涼しく';
  const a2BodyJa = isOrangeOrAbove
    ? '連続高温では昼夜の温度差が小さくなり、夜間も室内が蒸し暑くなる可能性があります。カーテンやブラインドを閉めて直射日光を遮り、エアコンと扇風機を併用して循環させ、26〜28℃に設定。就寝前にエアコンを早く切りすぎないことで、熱ストレスが夜間や翌朝の回復に影響するのを防げます。'
    : 'カーテンやブラインドを閉めて直射日光を遮りましょう。エアコンと扇風機を併用すると空気が循環しやすくなります（26〜28℃の設定が快適さと省エネを両立）。';

  const a3TitleJa = isOrangeOrAbove ? '気遣いの一声を、特に敏感な方へ' : 'お互いを気遣う';
  const a3BodyJa = isOrangeOrAbove
    ? `${day >= 3 ? `${day}日連続の高温日となります。` : ''}ご家族やご近所にご高齢の方・小さなお子様・慢性疾患をお持ちの方がいらっしゃる場合、本日は積極的にお電話やお声がけをお願いします。めまい・吐き気・汗をかかず肌が乾いて熱い・意識がもうろうとするといった症状が見られた場合は、すぐに涼しい場所へ移動させ、水分補給と体温を下げる対応をし、管理センターまでご連絡ください。重症の場合は119へ直接お電話ください。`
    : 'ご家族やご近所にご高齢の方・小さなお子様・慢性疾患をお持ちの方がいらっしゃる場合、今日はひと声かけてみてください。めまい・吐き気・汗をかかず肌が乾いて熱いといった症状が見られた場合は、すぐに涼しい場所へ移動させ、管理センターまでご連絡ください。';

  const noteJa = isOrangeOrAbove
    ? 'ご自身またはご家族のお身体の不調や、何かお手伝いが必要な際は、いつでも管理センターまでご連絡ください。緊急の場合は119へお電話ください。'
    : 'ご自身またはご家族のお身体の不調や、何かお手伝いが必要な際は、いつでも管理センターまでご連絡ください。';

  const explainJa = day >= 3
    ? `台北市では本日で${day}日連続の高温注意報となり、本日は${level.ja}信号です。36℃の高温は「一日だけの出来事」ではなく持続的なパターンになっています。連続する高温は身体の体温調節機能に負担を累積させ、特に高齢者・お子様・慢性疾患をお持ちの方・妊婦の皆様にとって厳しい状況です。`
    : (day === 2
      ? `${level.ja}信号は${isOrangeOrAbove ? '持続的な高温に対する注意レベル' : '重大なレベルではありません'}が、連日の高温は高齢者・お子様・慢性疾患をお持ちの方・妊婦の皆様にとって負担が累積しやすくなります。`
      : `${isOrangeOrAbove ? `${level.ja}信号は連続36℃高温の持続的リスクを示します。` : `${level.ja}信号は重大なレベルではありませんが、長時間の高温は高齢者・お子様・慢性疾患をお持ちの方・妊婦の皆様にとっては負担となります。`}本日皆で気をつけたい3つのポイントをまとめましたので、お互いに気遣う一日にいたしましょう。`);

  // ── summary
  const summary = day >= 2
    ? `連續第 ${day} 日臺北市高溫${level.zh}燈・建議補水防曬、室內降溫、彼此關照`
    : `今日臺北市為高溫${level.zh}燈・建議補水防曬、室內降溫、彼此關照`;

  // ── 組裝 HTML
  return `---
layout: notice.njk
permalink: /notice/${today}-高溫${level.zh}燈提醒.html
title: 臺北市高溫${level.zh}燈・社區提醒
titleZh: 臺北市高溫${level.zh}燈・社區提醒
titleEn: 'Heat Advisory (${level.en}): Community Reminder'
titleJa: 台北市高温注意報（${level.ja}信号）・コミュニティのご案内
displayDate: ${displayDate}
typeZh: 安全警示
typeEn: Safety Alert
typeJa: 安全のお知らせ
pillType: safety
summary: ${summary}
extraStyles: |
  .body-text{font-size:17px;color:var(--wg41);line-height:1.9;}
  .body-text p{margin-bottom:1em;}
  .body-text p:last-child{margin-bottom:0;}
  .heat-alert{background:rgba(140,90,0,0.06);border:1px solid rgba(140,90,0,0.22);border-left:4px solid #8C5A00;border-radius:var(--radius);padding:14px 18px;margin-bottom:24px;font-size:15px;color:var(--wg41);line-height:1.75;}
  .heat-alert strong{color:#8C5A00;}
  .care-list{list-style:none;padding:0;margin:4px 0;}
  .care-list li{display:flex;gap:14px;padding:12px 0;border-bottom:1px solid var(--line);font-size:15px;color:var(--wg11);line-height:1.75;align-items:flex-start;}
  .care-list li:last-child{border-bottom:none;}
  .care-num{flex-shrink:0;width:22px;height:22px;background:var(--wg41);color:var(--wg1);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;margin-top:2px;}
  .care-content strong{color:var(--wg41);}
---
<div class="lang-block active" data-lang="zh">
  <div class="heat-alert">
    🌡️ <strong>高溫${level.zh}燈${dayPhraseZh}：</strong>中央氣象署今（${parseInt(today.slice(5, 7), 10)}/${parseInt(today.slice(8, 10), 10)}）日發布高溫資訊，<strong>臺北市為${level.zh}色燈號</strong>（${levelDescZh}）。${dayContextZh}
  </div>
  <div class="sec">
    <div class="sec-label">說明</div>
    <div class="body-text">
      <p>${explainZh}</p>
    </div>
  </div>
  <div class="sec">
    <div class="sec-label">建議行動</div>
    <ol class="care-list">
      <li>
        <span class="care-num">1</span>
        <span class="care-content"><strong>${a1TitleZh}：</strong>${a1BodyZh}</span>
      </li>
      <li>
        <span class="care-num">2</span>
        <span class="care-content"><strong>${a2TitleZh}：</strong>${a2BodyZh}</span>
      </li>
      <li>
        <span class="care-num">3</span>
        <span class="care-content"><strong>${a3TitleZh}：</strong>${a3BodyZh}</span>
      </li>
    </ol>
  </div>
  <div class="note">${noteZh}</div>
</div>

<div class="lang-block" data-lang="en">
  <div class="heat-alert">
    🌡️ <strong>Heat Advisory (${level.en})${dayPhraseEn}:</strong> The Central Weather Administration issued a heat advisory today. <strong>Taipei City is under ${level.en} alert</strong> — ${levelDescEn}. ${dayContextEn}
  </div>
  <div class="sec">
    <div class="sec-label">Notice</div>
    <div class="body-text">
      <p>${explainEn}</p>
    </div>
  </div>
  <div class="sec">
    <div class="sec-label">Suggested Actions</div>
    <ol class="care-list">
      <li>
        <span class="care-num">1</span>
        <span class="care-content"><strong>${a1TitleEn}:</strong> ${a1BodyEn}</span>
      </li>
      <li>
        <span class="care-num">2</span>
        <span class="care-content"><strong>${a2TitleEn}:</strong> ${a2BodyEn}</span>
      </li>
      <li>
        <span class="care-num">3</span>
        <span class="care-content"><strong>${a3TitleEn}:</strong> ${a3BodyEn}</span>
      </li>
    </ol>
  </div>
  <div class="note">${noteEn}</div>
</div>

<div class="lang-block" data-lang="ja">
  <div class="heat-alert">
    🌡️ <strong>高温注意報（${level.ja}信号）${dayPhraseJa}：</strong>中央気象署は本日高温情報を発表しました。<strong>台北市は${level.ja}信号</strong>（${levelDescJa}）。${dayContextJa}
  </div>
  <div class="sec">
    <div class="sec-label">お知らせ</div>
    <div class="body-text">
      <p>${explainJa}</p>
    </div>
  </div>
  <div class="sec">
    <div class="sec-label">推奨される行動</div>
    <ol class="care-list">
      <li>
        <span class="care-num">1</span>
        <span class="care-content"><strong>${a1TitleJa}：</strong>${a1BodyJa}</span>
      </li>
      <li>
        <span class="care-num">2</span>
        <span class="care-content"><strong>${a2TitleJa}：</strong>${a2BodyJa}</span>
      </li>
      <li>
        <span class="care-num">3</span>
        <span class="care-content"><strong>${a3TitleJa}：</strong>${a3BodyJa}</span>
      </li>
    </ol>
  </div>
  <div class="note">${noteJa}</div>
</div>
`;
}

// ── 主流程 ────────────────────────────────────────────

(async () => {
  const today = todayTaipei();

  let level;
  try {
    level = await detectLevel();
  } catch (e) {
    console.error(`❌ 偵測 CWA W29 失敗：${e.message}`);
    process.exit(1);
  }

  if (!level) {
    console.log('ℹ️  臺北今日無 W29 警報，今日不開草稿');
    return;
  }

  const day = countConsecutiveDay(today);
  const filename = `${today}-高溫${level.zh}燈提醒.html`;
  const filepath = path.join(NOTICE_DIR, filename);

  if (fs.existsSync(filepath)) {
    console.log(`ℹ️  ${filepath} 已存在，skip`);
    return;
  }

  const content = generateNotice(level, day, today);

  if (DRY_RUN) {
    console.log(`--- DRY RUN: 將寫入 ${filepath} ---`);
    console.log(content);
    console.log(`---`);
    console.log(`偵測：今日臺北 ${level.zh}燈・連續第 ${day} 日`);
    return;
  }

  fs.mkdirSync(NOTICE_DIR, { recursive: true });
  fs.writeFileSync(filepath, content, 'utf8');
  console.log(`✅ 已寫入 ${filepath}`);
  console.log(`等級：${level.zh}燈・連續第 ${day} 日`);

  // workflow 輸出
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `filepath=${filepath}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `level=${level.zh}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `day=${day}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `date=${today}\n`);
  }
})();
