# 一次性腳本：以第四屆第一次區權會 docx 為模板（保留 styles/theme/header/footer/font），
# 重寫 document.xml 為第五屆第一次區權會內容，輸出至 raw/1150516第五屆第一次區分所有權人會議紀錄.docx
#
# 用法： powershell -ExecutionPolicy Bypass -File scripts\build-agm-5-1-doc.ps1
#
# 依據：src/minutes/minutes-5-agm-1.html 的會議紀錄內容
# 議程架構沿用 raw/1140517第四屆第一次區分所有權人會議紀錄-草.docx

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$srcDocx = Join-Path $repoRoot 'raw\1140517第四屆第一次區分所有權人會議紀錄-草.docx'
$outDocx = Join-Path $repoRoot 'raw\1150516第五屆第一次區分所有權人會議紀錄.docx'
$workDir = Join-Path $env:TEMP ('agm5-1-build-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))

if (-not (Test-Path $srcDocx)) { throw "找不到模板：$srcDocx" }

# ── Step 1：解壓模板 docx 到 workDir
Add-Type -AssemblyName System.IO.Compression.FileSystem
New-Item -ItemType Directory -Path $workDir | Out-Null
[System.IO.Compression.ZipFile]::ExtractToDirectory($srcDocx, $workDir)
Write-Host "✓ 模板已解壓 → $workDir"

# ── Step 2：建構新 document.xml
# 採用 PowerShell 字串拼接（StringBuilder）。Helper 產生標準段落／run／表格。

$sb = New-Object System.Text.StringBuilder

# XML 開頭 + namespace（複製模板的 root）
[void]$sb.AppendLine('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')
[void]$sb.Append('<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" xmlns:cx="http://schemas.microsoft.com/office/drawing/2014/chartex" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:w10="urn:schemas-microsoft-com:office:word" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk" xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" mc:Ignorable="w14 wp14">')
[void]$sb.Append('<w:body>')

# ── Helper：XML escape
function Esc([string]$s) {
  if ($null -eq $s) { return '' }
  return $s.Replace('&', '&amp;').Replace('<', '&lt;').Replace('>', '&gt;')
}

# ── Helper：粗體段落（章節標題用）「一、開會時間：XX」這類，前段加粗、冒號後正常
# 但為了簡化，整段都做 mixed runs。
$FONT = '<w:rFonts w:ascii="微軟正黑體" w:eastAsia="微軟正黑體" w:hAnsi="微軟正黑體"/>'

function Para {
  param([string]$Text, [switch]$Bold, [string]$Align = '', [int]$Size = 0, [switch]$Center, [int]$IndentChars = 0)
  $sb2 = New-Object System.Text.StringBuilder
  [void]$sb2.Append('<w:p><w:pPr><w:pStyle w:val="a8"/>')
  if ($IndentChars -gt 0) { [void]$sb2.Append('<w:ind w:firstLineChars="' + ($IndentChars * 100) + '" w:firstLine="' + ($IndentChars * 240) + '"/>') }
  if ($Center) { [void]$sb2.Append('<w:jc w:val="center"/>') }
  [void]$sb2.Append('<w:rPr>' + $FONT)
  if ($Bold) { [void]$sb2.Append('<w:b/>') }
  if ($Size -gt 0) { [void]$sb2.Append('<w:sz w:val="' + $Size + '"/><w:szCs w:val="' + $Size + '"/>') }
  [void]$sb2.Append('<w:szCs w:val="24"/></w:rPr></w:pPr>')
  [void]$sb2.Append('<w:r><w:rPr>' + $FONT)
  if ($Bold) { [void]$sb2.Append('<w:b/>') }
  if ($Size -gt 0) { [void]$sb2.Append('<w:sz w:val="' + $Size + '"/><w:szCs w:val="' + $Size + '"/>') }
  [void]$sb2.Append('<w:szCs w:val="24"/></w:rPr><w:t xml:space="preserve">' + (Esc $Text) + '</w:t></w:r></w:p>')
  return $sb2.ToString()
}

# 標題段（置中、大字、粗體）
function Title([string]$Text) {
  return '<w:p><w:pPr><w:spacing w:afterLines="100" w:after="360"/><w:jc w:val="center"/><w:rPr>' + $FONT + '<w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:pPr>' +
    '<w:r><w:rPr>' + $FONT + '<w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr><w:t>' + (Esc $Text) + '</w:t></w:r></w:p>'
}

# 章節標題段：前半粗體（如「一、開會時間」）+ 後半正常（「：14:00 ...」）
function SectionLine([string]$BoldPart, [string]$Rest) {
  $r = '<w:p><w:pPr><w:pStyle w:val="a8"/><w:rPr>' + $FONT + '<w:szCs w:val="24"/></w:rPr></w:pPr>'
  $r += '<w:r><w:rPr>' + $FONT + '<w:b/><w:szCs w:val="24"/></w:rPr><w:t xml:space="preserve">' + (Esc $BoldPart) + '</w:t></w:r>'
  if ($Rest) {
    $r += '<w:r><w:rPr>' + $FONT + '<w:szCs w:val="24"/></w:rPr><w:t xml:space="preserve">' + (Esc $Rest) + '</w:t></w:r>'
  }
  $r += '</w:p>'
  return $r
}

# 空段落
function EmptyPara { return '<w:p><w:pPr><w:pStyle w:val="a8"/><w:rPr>' + $FONT + '<w:szCs w:val="24"/></w:rPr></w:pPr></w:p>' }

# 表格 cell（單純文字）
function TableCell([string]$Text, [int]$WidthDxa, [switch]$Bold) {
  $cell = '<w:tc><w:tcPr><w:tcW w:w="' + $WidthDxa + '" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tcBorders></w:tcPr>'
  $cell += '<w:p><w:pPr><w:rPr>' + $FONT + '<w:szCs w:val="24"/></w:rPr></w:pPr>'
  $cell += '<w:r><w:rPr>' + $FONT
  if ($Bold) { $cell += '<w:b/>' }
  $cell += '<w:szCs w:val="24"/></w:rPr><w:t xml:space="preserve">' + (Esc $Text) + '</w:t></w:r></w:p></w:tc>'
  return $cell
}

# ════════════════════════════════════════════════════════════════════
# 開始建構正文
# ════════════════════════════════════════════════════════════════════

# 標題
[void]$sb.Append((Title '閱大安社區第五屆第一次區分所有權人會議紀錄'))

# 一、開會時間
[void]$sb.Append((SectionLine '一、開會時間' '：115年5月16日（星期六）下午14時00分至15時45分'))

# 二、開會地點
[void]$sb.Append((SectionLine '二、開會地點' '： 閱大安2樓管委會使用空間'))

# 三、召集人 / 主席
[void]$sb.Append((SectionLine '三、召集人' '：第四屆主任委員 許文泰'))
[void]$sb.Append((SectionLine '    主  席' '：第四屆主任委員 許文泰'))

# 四、主席（簽名）/ 紀錄
[void]$sb.Append((SectionLine '四、主席：' '    （簽名或蓋章）      紀錄：社區主任 譚安順'))

# 五、出席人員
[void]$sb.Append((SectionLine '五、出席人員' '：'))
[void]$sb.Append((Para '本次出席區分所有權人（含代理出席）計56人，詳如出席人員名冊（簽到簿）。'))
[void]$sb.Append((Para '依據區分所有權人名冊，應出席區分所有權人數總計 90 人，區分所有權總計 2515.94 坪 。'))
[void]$sb.Append((Para '合於本公寓大廈規約規定之開議額數，全體區分所有權人數與區分所有權比例均達半數以上。'))
[void]$sb.Append((Para '已出席區分所有權人數計56人，占全體區分所有權人數62.22％。'))
[void]$sb.Append((Para '已出席區分所有權比例計1655.49坪，占全體區分所有權65.80％。'))

# 六、列席人員
[void]$sb.Append((SectionLine '六、列席人員' '：潤泰公寓大廈管理維護股份有限公司-鄒治平部長'))
[void]$sb.Append((Para '              潤泰公寓大廈管理維護股份有限公司-楊莉莉部長'))

# 七、主席報告
[void]$sb.Append((SectionLine '七、主席報告' '：'))
[void]$sb.Append((Para '第四屆管理委員會團隊（2025/7/1 成立、2026/6/30 任期結束）' -Bold))
[void]$sb.Append((Para '主任委員　　許文泰' -IndentChars 1))
[void]$sb.Append((Para '副主任委員　張美媛' -IndentChars 1))
[void]$sb.Append((Para '監察委員　　許奕偉' -IndentChars 1))
[void]$sb.Append((Para '財務委員　　范家瑋' -IndentChars 1))
[void]$sb.Append((Para '一般委員　　郭易芹' -IndentChars 1))
[void]$sb.Append((Para '管理中心成員' -Bold))
[void]$sb.Append((Para '社區主任　　譚安順' -IndentChars 1))
[void]$sb.Append((EmptyPara))

# 八、年度工作報告
[void]$sb.Append((SectionLine '八、年度工作報告' '：'))
[void]$sb.Append((Para '本屆任期 2025/7/1 – 2026/4/30 共 10 個月。處理事項統計：已結案 32 案／未結案 15 案／總計 47 案（其中第三屆延續 11 案、第四屆新事項 36 案）。主要工作分類整理如下：'))
[void]$sb.Append((EmptyPara))

# 八、表格：類別 | 事項 | 說明
$cellW1 = 1200
$cellW2 = 1800
$cellW3 = 5400

$tbl = '<w:tbl><w:tblPr><w:tblW w:w="8400" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr>'
$tbl += '<w:tblGrid><w:gridCol w:w="' + $cellW1 + '"/><w:gridCol w:w="' + $cellW2 + '"/><w:gridCol w:w="' + $cellW3 + '"/></w:tblGrid>'

# Header row
$tbl += '<w:tr>' + (TableCell '類別' $cellW1 -Bold) + (TableCell '事項' $cellW2 -Bold) + (TableCell '說明' $cellW3 -Bold) + '</w:tr>'

# Body rows
$workItems = @(
  @{ Cat='行政換約'; Item='物業續約決定'; Desc='透明招標流程 16 家投標 → 4 家簡報 → 1 家議價；最終議價 +3.28%（305,000 → 315,000 元／月），決定與潤泰續約。入選理由（非價格因素）：服務延續性與穩定性、財務系統可靠（新都興 + 總公司財會支援）、不定期機動人員支援、集團技術備援（潤泰機電可備援太古華電）。' },
  @{ Cat='行政換約'; Item='總幹事人事穩定'; Desc='2025 年連續四任總幹事（13 個月內更迭 4 任）因健康或外部因素離職，社區陷入動盪。9 月份譚安順總幹事接任，本會以「至少穩定一年」為原則。目前現任總幹事仍在任，是社區成立以來在職時間第二長的總幹事。同步儲備未來總幹事人才。' },
  @{ Cat='行政換約'; Item='社區契約廠商'; Desc='本屆所有屆滿合約除大門保養外，均已完成比價或審查續約。主要合約：物業（潤泰 1,512,000/年）、保全（潤泰 2,268,000/年）、電梯保養（三菱 154,440/年至 2027/11）、機電保養（太古華電 55,200/年至 2028/01）、垃圾清運（極速環保 126,000/年至 2027/01）、園藝維護（綠石 52,500/年）、AED（新光電通 15,120/年）、公共意外責任險（國泰 6,350/年）、商業火險（富邦 4,620/年）。一樓大門保養（美德亞 28,000/年）合約待續約。' },
  @{ Cat='修繕維護'; Item='第四屆修繕明細'; Desc='2025/07 – 2026/04 共 10 個月已入帳修繕 16 筆，合計 155,528 元；另有已議定但 5、6 月始入帳項目 3 筆（信盛 B4 電梯旁牆面止漏 45,000、金耀後玻璃門 31,290、太古華電揚水馬達防震軟管 17,440），合計 93,730 元。全年化推估約 24-28 萬／年，已建模為「不定期修繕雜支」科目納入長期財務模型。' },
  @{ Cat='修繕維護'; Item='水之修繕（本屆主軸）'; Desc='智慧水管家警示 → 委員會逐案處理。本屆共 8 起水系統相關事件，已議定／已支付 98,339 元：R2 水塔頂樓排水口漏水、R2 上水塔極棒故障（4,599）、B2 水塔定水位閥（25,200，太古 31,500 → 潤泰機電比價）、B4 水塔定水位閥（暫緩，報價偏高）、B4 電梯旁牆面滲水跨 9 次會議討論（議定 45,000，信盛保固 1 年觀察至梅雨後）、2F 公廁馬桶水箱（600）、RF 澆灌馬達漏水（5,500）、B4 揚水馬達防震軟管（17,440）。' },
  @{ Cat='修繕維護'; Item='貨梯重現'; Desc='裝潢期保護板自 2023/10 第二屆討論「等所有裝潢戶完工才能拆」；本屆 2025/11/04 由 14F-5 工班一併拆除所有保護板。同時三菱新鍍鈦門板抵達更換（2025/09/30）；貨梯石材地板鋪設與瑕疵收尾。' },
  @{ Cat='節能環境'; Item='2025 氣候行動獎銀獎'; Desc='從 2024 零碳標竿獎典範獎延續至 2025 氣候行動獎銀獎。建構期措施：建築先天條件（公設冷氣 1 級能效、LED、車道防水閘門、玻璃隔熱膜、雨水回收）、設備管理（能源管理系統、電梯三分鐘待機、地下排風分段運轉）、空調溫控 27 度規則、地下室照明 232→87 支（−63%）。實績：節電 21.7%（省電費 66,223）、節水 43%（省水費 4,045）、公電契約容量 99→50 kW。獎金 90,000 元入本年度收入。' },
  @{ Cat='節能環境'; Item='2024→2025 趨勢觀察'; Desc='2025 全年用電 +4.8%、用水 +6.3%。原因：住戶入住率提升 + 2025 夏季氣溫偏高（用電）；下半年自動澆灌系統無意間被打開造成下半年天天澆水（用水）。' },
  @{ Cat='節能環境'; Item='進行中 5 項計畫'; Desc='① 每日水電公告（異常警示 + 住戶節能促進）；② B1-B4 感應式燈管全面推廣（微波感應，每日省 10+ 度）；③ 澆灌系統制度化（CODiS 降雨 + 氣象署預測，Gmail + Google Calendar 提醒澆／不澆）；④ 緊急避難圖設置（氣候行動獎要求項目，與社區 VI 一致）；⑤ 節能減稅研議（能效標章 1 級可享 5 年房屋稅減免 5%，全社區 5 年估約 58.6 萬）。' },
  @{ Cat='節能環境'; Item='面向未來研究'; Desc='4 項待時機成熟再評估：風電（市中心低頻噪音與震動疑慮）、儲能設施（評估新興技術）、電梯電力回生系統（下降時動能回收）、綠屋頂（樓地板隔熱、可食地景、社區交流）。2024/06 太陽能評估後因鄰棟遮蔽嚴重、日照時數不足，不適合導入太陽能光電。' },
  @{ Cat='消防安全'; Item='地下室車道反光鏡安全改善'; Desc='市府公有設施，反光鏡底座螺帽突出造成行車／行人安全隱患。研議三個方案排除後採折衷方案：保留原鏡與固定方式、原址左移 15cm（市府實際移 20cm），將底座螺帽移離車輛／行人路徑。跨 4 次會議協調完成。' },
  @{ Cat='消防安全'; Item='電動車消防防災研議'; Desc='研議 2 個方案：① 防火毯（每張 58,000 元，6×9m、20kg、需 2 人部署）——委員會研議後認為實務無法部署，電動車起火黃金時間短、爆燃風險高，無人能安全部署 20kg 毯子。② 細水霧滅火系統（日熙防災報價 買斷 140 萬／租賃 36 期 152 萬，不含每車位拉線 7,000 元）——真正能起作用之方案，但屬區權會等級支出；委員會研議未立即導入之理由：（1）住戶緊迫感未到位（台灣尚未發生韓國式電動車延燒整棟之案例）；（2）屬區權會等級支出。委員會決議：防火毯實務不可行，不採；細水霧屬區權會等級支出，保留至未來區權會討論。' },
  @{ Cat='工程評估'; Item='大樓外牆清洗・住戶意向徵詢'; Desc='現況：屋齡 4 年，外觀目前仍屬乾淨；已比價 4 家廠商，價格落在 20-38 萬元之間；若執行屬非經常性支出，需於下年度預算編列；若決議執行，預計可於 2027 農曆年前完工。委員會 2026/04 第九次會議傾向：暫緩執行（屋齡 5-6 年時再評估）。本次區權會徵詢：非正式表決，僅就「是否該洗」徵詢現場意向，作為第五屆委員會後續評估之方向。若住戶意向偏向贊成執行，由第五屆委員會選定廠商與方案後另行公告。' }
)

foreach ($w in $workItems) {
  $tbl += '<w:tr>' + (TableCell $w.Cat $cellW1) + (TableCell $w.Item $cellW2) + (TableCell $w.Desc $cellW3) + '</w:tr>'
}
$tbl += '</w:tbl>'
[void]$sb.Append($tbl)
[void]$sb.Append((EmptyPara))

# 九、財務年度報告
[void]$sb.Append((SectionLine '九、財務年度報告' '：詳如附件一（社區內部「長期財務模型」互動工具已上傳社區網站，於會議現場演示）'))
[void]$sb.Append((EmptyPara))
[void]$sb.Append((Para '【第一幕｜第四會計年度執行進度（2025/7/1 – 2026/4/30，10 個月實際）】' -Bold))
[void]$sb.Append((Para '・累計總收入 442.5 萬元（月均 44.2 萬）／累計總支出 436.9 萬元（月均 43.7 萬）'))
[void]$sb.Append((Para '・帳面累計損益 +5.5 萬元；加計維修基金提撥 60 萬元 → 實質累積 +65.5 萬元'))
[void]$sb.Append((Para '・業主權益總計（2026/4/30）609.6 萬元；資產總計 637.8 萬元；應收帳款期末 0 元（收齊率 100%）'))
[void]$sb.Append((Para '・氣候行動獎獎金 90,000 元（入年度收入）'))
[void]$sb.Append((Para '・四個虧損月份：8 月（−66,513，社區維護 + 修繕集中）、11 月（−16,600，雜項偏高）、12 月（−27,683，年度保險集中）、26/4（−16,367，地下停車場燈管 + 消防燈具更新）'))
[void]$sb.Append((EmptyPara))
[void]$sb.Append((Para '【第二幕｜資產分布（2026/4/30，總資產 637.8 萬）】' -Bold))
[void]$sb.Append((Para '・永豐 #31219（活儲，管理費收支主戶）613,718 元'))
[void]$sb.Append((Para '・永豐 #31202（活儲，公共基金）392,980 元'))
[void]$sb.Append((Para '・永豐 #33932（活儲，充電樁公用線路維護專戶）44,505 元'))
[void]$sb.Append((Para '・零用金 10,000 元 ／ 在途未入帳（智生活信用卡）16,632 元'))
[void]$sb.Append((Para '・永豐 #31219（一年期定存）1,700,000 元 ／ 永豐 #31202（一年期定存）3,600,000 元'))
[void]$sb.Append((Para '・資產合計 6,377,835 元（100.0%；定存占 83.1%）'))
[void]$sb.Append((EmptyPara))
[void]$sb.Append((Para '【第五會計年度預算編列（2026/7/1 – 2027/6/30）】' -Bold))
[void]$sb.Append((Para '・編列方法：物業＋保全切月（上半年現價、下半年依續約假設 +3.28%）；其他合約現行價'))
[void]$sb.Append((Para '・年支出 4,696,792 元；結餘（帳面）+302,300 元'))
[void]$sb.Append((Para '・維修基金提撥 720,000 元（每月 6 萬累積）'))
[void]$sb.Append((Para '・實質結餘（扣維修基金提撥）−417,700 元（接段下段 46 年長期論述起點）'))
[void]$sb.Append((EmptyPara))
[void]$sb.Append((Para '【第三幕｜46 年長期財務展望】' -Bold))
[void]$sb.Append((Para '・46 年（2026-2072）累積支出 6.68 億元名目；結構占比：經常性支出 86% ／ 不定期修繕雜支 7% ／ 非經常性支出 7%'))
[void]$sb.Append((Para '・主推方案：5 年週期 × 4.2%（起 180、2062 凍結 750 元）'))
[void]$sb.Append((Para '・主推軌跡：2027:180 → 2032:220 → 2037:270 → 2042:330 → 2047:410 → 2052:500 → 2057:610 → 2062:750（凍結至都更）'))
[void]$sb.Append((Para '・結果：50 年資產 +555 萬，46 年內全程不破產、不跌警戒'))
[void]$sb.Append((Para '・設計哲學：「死後不留遺產」— cover 2042 + 2062 兩波大修，之後凍結讓資產自然消耗至都更時點'))
[void]$sb.Append((EmptyPara))
[void]$sb.Append((Para '本議程僅為意見交流，不正式議決費率調整。具體費率調整案由新一屆委員會提出，於下次區權會議決。本次會議僅完成住戶意見蒐集與長期模型透明化。' -Bold))
[void]$sb.Append((EmptyPara))

# 十、討論事項及決議
[void]$sb.Append((SectionLine '十、討論事項及決議' '：無議題'))
[void]$sb.Append((EmptyPara))

# 十一、管理委員選任事項
[void]$sb.Append((SectionLine '十一、管理委員選任事項' '：'))
[void]$sb.Append((Para '    本公寓大廈規約相關規定：' -IndentChars 0))
[void]$sb.Append((Para '第十二條第一項第一款：' -Bold))
[void]$sb.Append((Para '主任委員，副主任委員，監察委員及財務委員，由具區分所有權人身分或其配偶或直系血親之住戶任之，一般委員由住戶任之。'))
[void]$sb.Append((Para '第十二條第二項第一款：' -Bold))
[void]$sb.Append((Para '管理委員之選任方式：採無記名複記法選舉，並以獲該分區區分所有權人較多者為當選人。'))
[void]$sb.Append((EmptyPara))
[void]$sb.Append((Para '    第五屆管理委員會選舉結果：' -Bold))
[void]$sb.Append((Para '當選委員（共五名）：' -Bold))
[void]$sb.Append((Para '85號08樓－0     蔡貞貞／許文泰  15票  （連任）'))
[void]$sb.Append((Para '85號06樓－51   潘以文          09票'))
[void]$sb.Append((Para '85號07樓－2     許承基          08票'))
[void]$sb.Append((Para '85號15樓－2     高浩哲          08票'))
[void]$sb.Append((Para '85號03樓－6     張美媛／賴思璇  07票'))
[void]$sb.Append((Para '第五屆候補委員（共二名）：' -Bold))
[void]$sb.Append((Para '85號14樓        陳克莊          06票'))
[void]$sb.Append((Para '85號05樓－3   潘以如          01票'))
[void]$sb.Append((EmptyPara))
[void]$sb.Append((Para '　　第五屆委員職務推選：' -Bold))
[void]$sb.Append((Para '主任委員    ______________'))
[void]$sb.Append((Para '副主任委員  ______________'))
[void]$sb.Append((Para '監察委員    ______________'))
[void]$sb.Append((Para '財務委員    ______________'))
[void]$sb.Append((Para '一般委員    ______________'))
[void]$sb.Append((Para '（職務推選由第五屆委員會於首次會議互推產生，後續另行公告。）'))
[void]$sb.Append((EmptyPara))

# 十二、臨時動議及決議
[void]$sb.Append((SectionLine '十二、臨時動議及決議' '：無議題'))
[void]$sb.Append((EmptyPara))

# 十三、散會
[void]$sb.Append((SectionLine '十三、散會' '：下午15時45分'))
[void]$sb.Append((EmptyPara))
[void]$sb.Append((EmptyPara))

# 附件一
[void]$sb.Append((Para '附件一' -Bold -Center))
[void]$sb.Append((Para '第四會計年度財務報表（年度結算暫估）／第五會計年度預算編列／46 年長期財務模型示意'))
[void]$sb.Append((Para '※ 完整互動式長期財務模型工具已上傳社區網站 https://culturalcity.org/finance/長期財務模型.html，可即時試算不同方案。'))

# Section properties（複製模板的，含頁首頁尾參考）
$sectPr = '<w:sectPr><w:headerReference r:id="rId6" w:type="default"/><w:footerReference r:id="rId7" w:type="default"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="851" w:footer="992" w:gutter="0"/><w:cols w:space="425"/><w:docGrid w:type="lines" w:linePitch="360"/></w:sectPr>'
[void]$sb.Append($sectPr)

[void]$sb.Append('</w:body></w:document>')

# ── Step 3：覆寫 document.xml（UTF-8 無 BOM）
$docXmlPath = Join-Path $workDir 'word\document.xml'
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($docXmlPath, $sb.ToString(), $utf8NoBom)
Write-Host "✓ 新 document.xml 已寫入（$([System.Text.Encoding]::UTF8.GetByteCount($sb.ToString())) bytes）"

# ── Step 4：檢查 _rels/document.xml.rels 是否有 rId6/rId7（header/footer reference）
$relsPath = Join-Path $workDir 'word\_rels\document.xml.rels'
$relsContent = [System.IO.File]::ReadAllText($relsPath, [System.Text.Encoding]::UTF8)
if ($relsContent -notmatch 'rId6' -or $relsContent -notmatch 'rId7') {
  Write-Warning "rels 內找不到 rId6/rId7，header/footer 可能失聯。請手動檢查 $relsPath"
} else {
  Write-Host "✓ header/footer rels 對應正常"
}

# ── Step 5：刪除 customXml（這份模板有 customXml 但我們不需要）
$customXmlDir = Join-Path $workDir 'customXml'
if (Test-Path $customXmlDir) {
  Remove-Item -Recurse -Force $customXmlDir
  Write-Host "✓ 已移除 customXml（不影響功能）"
}

# 同步移除 [Content_Types].xml 與 _rels/.rels 對 customXml 的引用
$ctPath = Join-Path $workDir '[Content_Types].xml'
$ct = [System.IO.File]::ReadAllText($ctPath, [System.Text.Encoding]::UTF8)
$ct = $ct -replace '<Override[^/]+customXml[^/]+/>', ''
[System.IO.File]::WriteAllText($ctPath, $ct, $utf8NoBom)

$relsRootPath = Join-Path $workDir '_rels\.rels'
$relsRoot = [System.IO.File]::ReadAllText($relsRootPath, [System.Text.Encoding]::UTF8)
$relsRoot = $relsRoot -replace '<Relationship[^/]+customXml[^/]+/>', ''
[System.IO.File]::WriteAllText($relsRootPath, $relsRoot, $utf8NoBom)

# ── Step 6：移除 document.xml.rels 中的 customXml relationship（若有）
$docRels = [System.IO.File]::ReadAllText($relsPath, [System.Text.Encoding]::UTF8)
$docRels = $docRels -replace '<Relationship[^/]+customXml[^/]+/>', ''
[System.IO.File]::WriteAllText($relsPath, $docRels, $utf8NoBom)

# ── Step 7：重新壓縮為 docx
if (Test-Path $outDocx) { Remove-Item $outDocx -Force }
[System.IO.Compression.ZipFile]::CreateFromDirectory($workDir, $outDocx, [System.IO.Compression.CompressionLevel]::Optimal, $false)
Write-Host "✓ 已產生新 docx：$outDocx"

# ── Step 8：清理 workDir
Remove-Item -Recurse -Force $workDir
Write-Host "✓ 工作目錄已清理"

Write-Host ""
Write-Host "完成。請以 Word 開啟驗證："
Write-Host "  $outDocx"
