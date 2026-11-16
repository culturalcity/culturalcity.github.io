---
layout: handbook.njk
permalink: /admin/staff/brand/index.html
title: 閱大安識別應用規範
docTitle: 識別應用規範
eyebrow: CULTURAL CITY · BRAND GUIDE
headerSub: 閱大安管理委員會・logo、環境指標與影片聲音
lastUpdate: '2026-11-16'
eleventyExcludeFromCollections: true
---
<style>
  /* 本頁專用：色票、logo 示範、圖示。顏色一律讀 global.css 設計表；色票塊本身是「被展示的資料」，色碼寫在 HTML 上 */
  .br-sw { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: var(--sp-12); margin: var(--sp-12) 0 var(--sp-20); }
  .br-sw div { background: var(--white); border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden;
    font-size: var(--fs-caption); line-height: var(--lh-tight); }
  .br-sw i { display: block; height: 56px; border-bottom: 1px solid var(--line); }
  .br-sw span { display: block; padding: var(--sp-8); color: var(--wg41); }
  .br-row { display: flex; flex-wrap: wrap; gap: var(--sp-16); align-items: flex-start; margin: var(--sp-12) 0 var(--sp-20); }
  .br-fig { background: var(--white); border: 1px solid var(--line); border-radius: var(--radius); padding: var(--sp-16);
    font-size: var(--fs-caption); color: var(--wg9); max-width: 320px; flex: 1 1 240px; }
  .br-fig.dark { background: var(--logo-green); color: var(--wg1); }
  .br-fig img { display: block; width: 100%; height: auto; margin-bottom: var(--sp-8); }
  .br-icons { display: flex; flex-wrap: wrap; gap: var(--sp-16); margin: var(--sp-12) 0 var(--sp-20); }
  .br-icons div { text-align: center; font-size: var(--fs-caption); color: var(--wg9); }
  .br-icons i { display: flex; width: 64px; height: 64px; border-radius: 50%; background: var(--logo-green); color: var(--white);
    align-items: center; justify-content: center; margin-bottom: var(--sp-4); }
  .br-ex { display: flex; flex-wrap: wrap; gap: var(--sp-20); align-items: flex-start; }
  .br-ex img { width: 260px; max-width: 100%; height: auto; border: 1px solid var(--line); }
  .br-ex ul { flex: 1 1 240px; margin-top: 0; }
  .hb-main th, .hb-main td { min-width: 9em; } /* 手機上表格改左右捲，不把欄擠成一字一行 */
  .hb-main td:first-child { white-space: nowrap; min-width: 0; } /* 表格首欄是短標籤，不讓它被擠成一字一行 */
</style>

# 這一頁是什麼

閱大安有兩套正式的視覺系統：一套是社區 logo（深綠＋金），一套是 2024 年委託設計師製作的環境指標規範（暖灰，正本是社區雲端「09. 美工檔案」的《閱大安環境指標 V.8》）。兩套都對，問題是不同場合該用哪一套。本頁依「這件東西在哪裡、要被看多久」分成三層，並整理 logo、字型、影片的共用做法。

本頁給製作對外成品的人參考（公告圖卡、影片、簡報、招牌等）。要在大樓內新增或更換任何張貼物，仍依《總幹事 Wiki》[第二章 §2.3「視覺形象一致性」](/admin/staff/pm-wiki/)先向主委確認。

# 三層分工

| 層 | 主色 | 用在哪裡 | 原則 |
|---|---|---|---|
| **品牌層**<br>logo | 深綠＋金箔 | 任何場合 | 只當署名（頁尾、角落、片尾），綠金不擴散成整個版面的主色。 |
| **空間資訊層**<br>環境指標系統 | 暖灰＋深咖啡黑 | 大樓室內的指標、貼紙、警語；社區網站；規約、財報、會議紀錄；張貼在大樓內的公告 | 安靜、好讀、融入石材與木紋的室內空間。消防紅只用於安全訊息。 |
| **溝通層**<br>綠金外框 | 深綠＋金，內文區用暖灰 | LINE 圖卡、颱風圖卡、施工進度卡、影片片頭片尾、活動海報、對外招牌（如店面招租板） | 要在手機或街上抓住目光：特大主標、綠金刊頭與頁尾；內文區沿用暖灰的底色與字色，所以仍讀得出是同一個社區。 |

不在色票裡的飽和色（例如磚紅、橘）在任何一層都只能當點綴；圖卡可以多一點，招牌壓到最低，因為路人會把最搶眼的顏色當成社區的識別色。

# 色票

<div class="br-sw">
<div><i style="background:var(--logo-green)"></i><span>logo 綠<br>#2D5837</span></div>
<div><i style="background:var(--logo-gold)"></i><span>logo 金（螢幕平塗）<br>#D7B454</span></div>
<div><i style="background:var(--wg1)"></i><span>Warm Grey 1C<br>網站 --wg1 #EAE7E1</span></div>
<div><i style="background:var(--wg11)"></i><span>Warm Grey 11C<br>網站 --wg11 #696460</span></div>
<div><i style="background:#F6F2EA /* design-ok: 色票展示，圖卡與實體指標用色、網站不用 */"></i><span>圖卡內文底（暖白）<br>#F6F2EA</span></div>
<div><i style="background:#2A2724 /* design-ok: 色票展示，圖卡與實體指標用色、網站不用 */"></i><span>圖卡內文字<br>#2A2724</span></div>
<div><i style="background:var(--wg41)"></i><span>412C<br>網站 --wg41 #3C3835</span></div>
<div><i style="background:#BA0C2F /* design-ok: 色票展示，圖卡與實體指標用色、網站不用 */"></i><span>消防紅 200C<br>只用於安全訊息</span></div>
</div>

本表為節選：《環境指標 V.8》另有 Warm Grey 9C、消防橘紅 7256C 與回收室分類色，請查原規範。螢幕色碼取自社區網站與圖卡的設計表，是近似值，不是 Pantone 的精確換算。金色在 logo 裡是箔紋，排版時用平塗色，不要自己做假金屬漸層。

# 字型

- **實體指標**：思源宋體（Noto Serif TC）Medium／SemiBold，水平寬度 95%，照指標規範。
- **螢幕成品**（網站、圖卡、簡報、影片字卡）：思源黑體／微軟正黑體等無襯線字，標題 700、內文 400。
- logo 裡的明體字是特製字形，不拿來排文字。不使用標楷體。

# 跨層共用的元素

## 字標與 S 標

logo 由兩部分組成：字標「閱大安 Cultural city」說「我是誰」；S 標（原檔名「編織 LOGO」，四股金色緞帶交纏）是輔助圖形，負責氣氛與辨識，本身不帶名字。字標是主、S 是從；大樓外柱面字與拒馬指標都只用字標，就是這個關係。淺底用全標，深綠底用反白全標（「閱大安」改白、金色不變）。四周留白至少一個「閱」字寬。

| 用法 | 場景 | 理由 |
|---|---|---|
| **只用字標** | 指標、貼紙、文件頁尾、網站、圖卡頁尾署名 | 名字清楚，在多數底色與尺寸下都讀得出來 |
| **全標**<br>字標＋S | 儀式性場合：區權會簡報封面、大門、影片片頭與片尾卡（年報、會議紀錄屬空間資訊層，只用字標；影片縮圖不放） | 隆重，S 有足夠空間展開 |
| **只用 S** | 溝通層點綴：圖卡角落、影片浮水印與轉場、LINE 群組頭像、活動識別 | 當記號用；同一畫面要另有字標交代名字（LINE 群組頭像由群組名稱交代） |
| **不建議** | 鋪成背景花紋、改成金色以外的顏色、旋轉或截斷、放在室內指標上、小於約 40px | 稀釋辨識度，或細線糊成一團 |

S 的限制：四股細線在約 40px 以下會糊掉；金色在淺底對比低，放深綠底上最亮；箔紋金屬感與室內指標的霧面暖灰不同調，所以不進空間資訊層。它交纏的造型適合做動畫（例如片頭片尾四股線編織成 S、再浮出字標）。S 的設計原意待查證設計說明，對外講解前勿自行詮釋。

<div class="br-row">
<div class="br-fig"><img src="/images/brand/logo-full.png" alt="閱大安全標" width="600" height="264">全標（淺底）</div>
<div class="br-fig dark"><img src="/images/brand/logo-full-reverse.png" alt="閱大安反白全標" width="600" height="264">反白全標（深綠底）</div>
</div>

## 「閱」字的格柵直線

logo 的「閱」把門字旁改成直線、把「兌」改成橫線，看起來呼應大樓立面的格柵（這是應用上的詮釋，設計原意待查證）。可以縮成幾條細直線，當段落標題前的記號。只用在標題，不鋪成背景花紋。

## 線條圖示

照指標規範的圖示風格：單一粗細的線條、以線為主、少量實心點綴。規範裡已有 20 個圖示（無障礙、回收、警示、攝影中等），缺的照同樣風格補畫；下列水濺、植栽、完成、接下來為 2026-11 新增，警示為原有圖示的重繪。放在圖卡上時用綠色圓底＋白線。

<div class="br-icons">
<div><i><svg viewBox="0 0 48 48" width="36" height="36" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linejoin="miter" stroke-linecap="butt" aria-hidden="true"><path d="M24 7 C24 7 12 21 12 29 A12 12 0 0 0 36 29 C36 21 24 7 24 7 Z"/><path d="M18 30 A6 6 0 0 0 24 36"/></svg></i>水濺</div>
<div><i><svg viewBox="0 0 48 48" width="36" height="36" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linejoin="miter" stroke-linecap="butt" aria-hidden="true"><line x1="24" y1="41" x2="24" y2="22"/><path d="M24 27 C15 27 10 21 10 13 C18 13 24 18 24 27 Z"/><path d="M24 22 C24 14 30 9 38 9 C38 17 32 22 24 22 Z"/><line x1="14" y1="41" x2="34" y2="41"/></svg></i>植栽</div>
<div><i><svg viewBox="0 0 48 48" width="36" height="36" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M24 7 L42 39 H6 Z"/><line x1="24" y1="18" x2="24" y2="29"/><circle cx="24" cy="34" r="1.6" fill="currentColor" stroke="none"/></svg></i>警示</div>
<div><i><svg viewBox="0 0 48 48" width="36" height="36" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linejoin="miter" stroke-linecap="butt" aria-hidden="true"><polyline points="11,25 20,34 37,15"/></svg></i>完成</div>
<div><i><svg viewBox="0 0 48 48" width="36" height="36" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linejoin="miter" stroke-linecap="butt" aria-hidden="true"><line x1="9" y1="24" x2="37" y2="24"/><polyline points="27,14 37,24 27,34"/></svg></i>接下來</div>
</div>

# 影片

公告短片、AI 代言人影片等所有對外影片共用以下做法。

| 項目 | 做法 | 理由 |
|---|---|---|
| **logo** | 片頭卡放全標（淺底）或反白全標（深綠底）；片尾卡用 logo 取代「閱大安管理委員會」文字落款 | 只當署名；片頭片尾是儀式性位置，S 標有空間展開 |
| **配樂** | 用閱大安主題曲（2026-10-31 選定，92 BPM、C 大調）。動態圖形短片：主題曲在片頭開始後 0.5 秒進來，疊上轉場、數字跳動等打點音效，結尾淡出。有旁白的影片：講話時把主題曲壓低 | 每支影片聽得出是同一個社區；音效讓畫面節奏清楚 |
| **識別音** | 不使用（2026-11-14 起） | 與主題曲並用時像兩段不同的旋律 |
| **縮圖** | 一般公告：片頭主旨大字那一格。數據類月報（如大公電帳單）：本期關鍵數字那一格。直式短片上傳後是 Shorts，只做直式縮圖 | 一般公告的主旨每支不同，片頭就有辨識度；月報片頭每月相同，放數字才看得出是哪一期、多少錢 |
| **說明欄** | 末行註明「配樂以 Suno AI 生成」 | 主題曲以 Suno 生成，照實標示 |

# 範例：外牆清洗進度卡

<div class="br-ex">
<img src="/images/brand/example-wall-cleaning-card.jpg" alt="外牆清洗進度卡範例（2026-11-03）" width="640" height="1600">
<ul>
<li>刊頭與頁尾＝溝通層的綠金；右上角 S 標，頁尾反白字標＋「管理委員會」。</li>
<li>內文區＝空間資訊層的暖白底與深咖啡字。</li>
<li>章節標題前用格柵直線，提醒用線條圖示。</li>
</ul>
</div>

# 素材在哪裡

全部在社區雲端「09. 美工檔案\閱大安識別應用\素材\」：

- **logo**：閱大安logo_全標.png、閱大安logo_反白全標.png、閱大安logo_反白字標.png、閱大安logo_S標.png（透明底，從「09. 美工檔案\S LOGO\logo OK」原檔裁出）。原始向量檔以「S LOGO」夾裡的 logo OK（Illustrator 檔）為準。
- **圖示**：上面五個線條圖示的 SVG。
- **主題曲**：閱大安主題曲.wav（高音質，剪影片用）、閱大安主題曲.mp3，以及說明與 Suno 風格描述。
