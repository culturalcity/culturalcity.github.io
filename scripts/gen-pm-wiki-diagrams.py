# -*- coding: utf-8 -*-
"""總幹事 Wiki 三張圖解產生器：設備位置、年度行事曆、滲水流程。
改圖改這支再執行：python scripts/gen-pm-wiki-diagrams.py（圖內容只能取自 pm-wiki.md 現有文字）。"""
import os
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'images', 'diagrams')
INK, SUB, ACC, BG, LINE = '#2d3142', '#4f5d75', '#eb6c36', '#f5f5f5', '#d4d4d4'
FONT = "'Noto Sans TC','Microsoft JhengHei','PingFang TC',sans-serif"

def esc(t):
    return t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

def head(w, h, tid, title, desc):
    return [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" aria-labelledby="{tid}-title {tid}-desc" font-family="{FONT}">',
            f'  <title id="{tid}-title">{esc(title)}</title>',
            f'  <desc id="{tid}-desc">{esc(desc)}</desc>',
            f'  <rect width="{w}" height="{h}" fill="{BG}"/>']

def text(x, y, t, size=12, fill=INK, weight=None, anchor=None):
    a = f' font-weight="{weight}"' if weight else ''
    b = f' text-anchor="{anchor}"' if anchor else ''
    return f'  <text x="{x}" y="{y}" fill="{fill}" font-size="{size}"{a}{b}>{esc(t)}</text>'

# ---------------- 1. 設備位置 ----------------
def equipment():
    # (樓層, [(橘點?, 文字, 顏色/粗體)])
    rows = [
        ('R3F', [(False, '電梯機房', INK)]),
        ('R2F', [(False, '水錶室・頂樓水塔', INK)]),
        ('RF', []),
        ('3F–15F', []),
        ('2F', [(False, '儲藏室文件櫃：竣工圖紙本', INK)]),
        ('1F', [(True, '管理中心櫃檯：火警受信總機', INK),
                (True, '櫃檯後方：監控主機（NVR×4，共 55 支攝影機）', INK),
                (True, '櫃檯後方櫃：中央監控・瓦斯緊急遮斷・緊急廣播・鑰匙盒', INK),
                (False, '文具箱資料袋：另一組鑰匙（清冊在 Notion「財產清冊」）', INK),
                (False, '電錶室', INK),
                (False, '包裹室鐵架第三格：防水閘門固定螺絲零件', INK),
                (True, '颱風時：防水閘門裝在前門、後門', 'ACC')]),
        ('B1', [(False, '配電室（限廠商進入）', INK),
                (True, '電錶走廊：防水閘門平時存放處', INK)]),
        ('B2', [(True, '發電機房：緊急發電機', INK)]),
        ('B3', []),
        ('B4', [(True, '消防機房：防颱沙包平時收在這裡', INK),
                (True, '水箱：揚水馬達（沉水式×2）', INK)]),
    ]
    LH, PAD = 22, 10
    y = 84
    body, grid = [], []
    for name, items in rows:
        h = max(40, PAD * 2 + LH * len(items))
        if name == '3F–15F':
            h = 32
        fill = 'rgba(235,108,54,0.08)' if name == '1F' else ('#e9e9e9' if not items else '#ffffff')
        body.append(f'  <rect x="40" y="{y}" width="120" height="{h}" fill="{fill}" stroke="{INK}" stroke-width="1"/>')
        body.append(text(100, y + h / 2 + 6, name, 16, INK, 700, 'middle'))
        n = len(items)
        y0 = y + h / 2 - (n * LH) / 2 + 15
        for i, (dot, t, col) in enumerate(items):
            ty = y0 + i * LH
            if dot:
                body.append(f'  <circle cx="190" cy="{ty - 4}" r="4" fill="{ACC}"/>')
            if col == 'ACC':
                body.append(text(202, ty, t, 12, ACC, 700))
            else:
                body.append(text(202, ty, t))
        y += h
        grid.append(f'  <line x1="160" y1="{y}" x2="696" y2="{y}" stroke="{LINE}" stroke-width="1"/>')
        if name == '1F':
            ground = y
    W, H = 720, y + 96
    out = head(W, H, 'eq', '閱大安關鍵設備與鑰匙位置',
               '大樓剖面示意，由上而下列出各樓層的關鍵設備：R3F 電梯機房；R2F 水錶室與頂樓水塔；2F 儲藏室文件櫃存放竣工圖紙本；'
               '1F 管理中心櫃檯有火警受信總機，櫃檯後方有監控主機（4 台、55 支攝影機），櫃檯後方櫃有中央監控、瓦斯緊急遮斷、緊急廣播與鑰匙盒，'
               '文具箱資料袋有另一組鑰匙，另有電錶室，包裹室鐵架第三格放防水閘門固定螺絲，颱風時防水閘門裝在前門與後門；'
               'B1 配電室（限廠商進入）與電錶走廊（防水閘門平時存放處）；B2 發電機房；B4 消防機房（防颱沙包）與水箱內兩台沉水式揚水馬達。'
               '總電源開關與給水總閥位置待確認。')
    out.append(text(40, 40, '關鍵設備與鑰匙位置', 20, INK, 700))
    out.append(text(40, 64, '大樓剖面示意（非比例），只列總幹事 Wiki 有記載的設備；灰底空白層不代表沒有設備。'))
    out += grid + body
    out.append(f'  <line x1="24" y1="{ground}" x2="696" y2="{ground}" stroke="{SUB}" stroke-width="2" stroke-dasharray="6,4"/>')
    out.append(text(696, ground - 6, '地面', 12, SUB, None, 'end'))
    ly = y + 22
    out.append(f'  <circle cx="46" cy="{ly - 4}" r="4" fill="{ACC}"/>')
    out.append(text(58, ly, '橘點＝停電、漏水、火警、颱風時要先找到的東西'))
    out.append(f'  <rect x="40" y="{ly + 14}" width="656" height="32" rx="4" fill="#ffffff" stroke="{ACC}" stroke-width="1" stroke-dasharray="4,4"/>')
    out.append(text(56, ly + 35, '待確認：總電源開關、給水總閥的位置。確認後補進本圖。'))
    out.append('</svg>')
    return out

# ---------------- 2. 年度行事曆 ----------------
def calendar():
    cols = ['治理與會議', '物業換約', '保險與電梯合約', '設施與法規', '節慶公告']
    cx = [128, 256, 384, 512, 640]
    heights = {m: 40 for m in range(1, 13)}
    heights[11] = 48
    top = {}
    y = 112
    for m in range(1, 13):
        top[m] = y
        y += heights[m]
    end_y = y
    # 工作塊：(欄, 起月, 迄月, [行], 樣式) 樣式 key=關鍵, gen=一般, opt=非每年
    blocks = [
        (0, 3, 4, ['區權會前置作業', '（任期年）'], 'opt'),
        (0, 5, 5, ['召開區權會'], 'key'),
        (0, 6, 6, ['月底換屆交接', '（任期年）'], 'opt'),
        (1, 1, 1, ['用印完成', '合約存查'], 'gen'),
        (1, 9, 9, ['討論：續約或招標'], 'gen'),
        (1, 10, 10, ['刊登招標（如招標）'], 'opt'),
        (1, 11, 11, ['月初書審、月中簡報', '月底決定續約對象'], 'key'),
        (1, 12, 12, ['合約用印'], 'gen'),
        (2, 10, 10, ['電梯議價（到期年）', '換廠商 9/30 前通知'], 'opt'),
        (2, 11, 11, ['公責險・火險比價'], 'key'),
        (2, 12, 12, ['保險續保完成'], 'gen'),
        (3, 1, 2, ['公共安全檢查', '1 月議價、2 月執行', '（每 3 年）'], 'opt'),
        (3, 4, 4, ['流出抑制設施', '維護文件上傳'], 'gen'),
        (3, 10, 11, ['大公電', '契約容量檢討'], 'gen'),
        (4, 2, 2, ['農曆新年公告'], 'gen'),
        (4, 7, 8, ['中元普渡籌備', '（依農曆）'], 'gen'),
    ]
    W, H = 720, end_y + 104
    out = head(W, H, 'cal', '閱大安年度循環行事曆',
               '以月份為列、五類工作為欄的年度行事曆。治理與會議：3 至 4 月區權會前置作業（任期年）、5 月召開區權會、6 月底換屆交接（任期年）。'
               '物業換約：1 月用印完成與合約存查、9 月討論續約或招標、10 月如招標則刊登、11 月月初書審月中簡報月底決定續約對象、12 月合約用印。'
               '保險與電梯合約：10 月電梯保養合約議價（合約到期年；合約會照原條件自動續約，要換廠商須在 9/30 前書面通知），11 月公共意外險與火險比價，12 月保險續保完成。'
               '設施與法規：公共安全檢查每 3 年一次，1 月議價、2 月執行；4 月流出抑制設施維護文件上傳（法定，每年）；10 至 11 月大公電契約容量檢討。'
               '節慶公告：2 月農曆新年公告、7 至 8 月中元普渡籌備（依農曆）。每月固定追蹤台電四張帳單並更新氣候行動獎明細。')
    out.append(text(40, 40, '年度循環行事曆', 20, INK, 700))
    out.append(text(40, 64, '每月初對照當月要啟動的事。農曆節日依當年日期調整；標「任期年」的只在換屆那年做'))
    for c, x in zip(cols, cx):
        out.append(text(x, 100, c, 12, INK, 700, 'middle'))
    out.append(f'  <line x1="16" y1="108" x2="704" y2="108" stroke="{LINE}" stroke-width="1"/>')
    for m in range(1, 13):
        yb = top[m] + heights[m]
        out.append(f'  <line x1="16" y1="{yb}" x2="704" y2="{yb}" stroke="{LINE}" stroke-width="1"/>')
        out.append(text(56, top[m] + heights[m] / 2 + 4, f'{m} 月', 12, SUB, None, 'end'))

    def box(col, y1, h, lines, style):
        x = cx[col] - 60
        if style == 'key':
            r = f'  <rect x="{x}" y="{y1}" width="120" height="{h}" rx="4" fill="{INK}" stroke="{INK}" stroke-width="1"/>'
            tc, tw = '#ffffff', 700
        elif style == 'opt':
            r = f'  <rect x="{x}" y="{y1}" width="120" height="{h}" rx="4" fill="#ffffff" stroke="{SUB}" stroke-width="1" stroke-dasharray="4,3"/>'
            tc, tw = INK, None
        else:
            r = f'  <rect x="{x}" y="{y1}" width="120" height="{h}" rx="4" fill="#ffffff" stroke="{INK}" stroke-width="1"/>'
            tc, tw = INK, None
        res = [r]
        n = len(lines)
        ly0 = y1 + h / 2 - (n * 16) / 2 + 12
        for i, t in enumerate(lines):
            col_ = SUB if (t.startswith('（') and style != 'key') else tc
            res.append(text(cx[col], ly0 + i * 16, t, 12, col_, tw if i == 0 else None, 'middle'))
        return res

    for col, m1, m2, lines, style in blocks:
        y1 = top[m1] + 4
        h = top[m2] + heights[m2] - 4 - y1
        out += box(col, y1, h, lines, style)

    ly = end_y + 28
    out.append(f'  <rect x="40" y="{ly - 10}" width="20" height="12" rx="2" fill="{INK}"/>')
    out.append(text(68, ly, '決定或執行的關鍵月'))
    out.append(f'  <rect x="216" y="{ly - 10}" width="20" height="12" rx="2" fill="#ffffff" stroke="{INK}"/>')
    out.append(text(244, ly, '每年例行'))
    out.append(f'  <rect x="336" y="{ly - 10}" width="20" height="12" rx="2" fill="#ffffff" stroke="{SUB}" stroke-dasharray="4,3"/>')
    out.append(text(364, ly, '非每年都有（任期年、每 3 年、合約到期年、選擇招標時）'))
    out.append(f'  <rect x="40" y="{ly + 18}" width="640" height="32" rx="4" fill="#ffffff" stroke="{LINE}"/>')
    out.append(f'  <text x="56" y="{ly + 39}" fill="{INK}" font-size="12"><tspan font-weight="700">每月固定：</tspan>追蹤台電四張帳單、更新氣候行動獎明細</text>')
    out.append('</svg>')
    return out

# ---------------- 3. 滲水流程 ----------------
def seepage():
    W = 720
    out = []
    A = 'marker-end="url(#sp-arrow)"'
    L = lambda x1, y1, x2, y2, arrow=False: f'  <line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{SUB}" stroke-width="1.5" fill="none"{(" " + A) if arrow else ""}/>'
    def rbox(x, y, w, h, lines, stroke=INK, fill='#ffffff', rx=6, first_fill=INK, first_bold=True, other=SUB):
        r = [f'  <rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="1"/>']
        n = len(lines)
        y0 = y + h / 2 - (n * 18) / 2 + 13
        for i, t in enumerate(lines):
            r.append(text(x + w / 2, y0 + i * 18, t, 12, first_fill if i == 0 else other, 700 if (i == 0 and first_bold) else None, 'middle'))
        return r
    body = []
    body += rbox(160, 84, 400, 44, ['① 發現：拍照記錄位置與日期', '不開閃光燈（會蓋掉水痕）；雨後再拍一次對照'])
    body.append(L(360, 128, 360, 150, True))
    body += rbox(160, 152, 400, 32, ['② 回報：管委會群組，或列入下次會議'])
    body.append(L(360, 184, 360, 206, True))
    body += rbox(160, 208, 400, 44, ['③ 會勘、報價：判斷原因，經管委會議決後施工', '建設公司（敦寶、福一）或信盛工程帶防水廠商到場'])
    body.append(L(360, 252, 360, 284))
    body.append(text(372, 272, '對照過去案例，看原因與保固狀態', 12, SUB))
    body.append(L(96, 284, 624, 284))
    for x in (96, 272, 448, 624):
        body.append(L(x, 284, x, 298, True))
    conds = ['仍在保固期內', '判定為施工缺失', '已過保固期', '連續壁先天滲水']
    for x, t in zip((24, 200, 376, 552), conds):
        body.append(f'  <rect x="{x}" y="300" width="144" height="32" rx="16" fill="rgba(79,93,117,0.10)" stroke="{SUB}" stroke-width="1"/>')
        body.append(text(x + 72, 321, t, 12, INK, 700, 'middle'))
        body.append(L(x + 72, 332, x + 72, 350, True))
    res = [
        (24, ['建設公司出資', '社區不付費', '', '前例：021、083'], INK, INK),
        (200, ['發函敦寶、福一', '請信創營造負', '管理監督責任', '前例：122'], INK, INK),
        (376, ['社區付費', '報價單寫明施工保固', '', '前例：131'], ACC, ACC),
        (552, ['社區付費', '導水（角鐵、落水頭）', '', '前例：167'], ACC, ACC),
    ]
    for x, lines, stroke, ff in res:
        body.append(f'  <rect x="{x}" y="352" width="144" height="92" rx="6" fill="#ffffff" stroke="{stroke}" stroke-width="1"/>')
        for i, t in enumerate(lines):
            if not t:
                continue
            body.append(text(x + 72, 376 + i * 20, t, 12, ff if i == 0 else SUB, 700 if i == 0 else None, 'middle'))
    for x in (96, 272, 448, 624):
        body.append(L(x, 444, x, 464))
    body.append(L(96, 464, 624, 464))
    body.append(L(360, 464, 360, 482, True))
    body += rbox(160, 484, 400, 62, ['④ 驗收：確認不再滲漏', '雨季或颱風過後再看，或由社區自行試水', '社區付費的案件，驗收通過才付款'],
                 stroke=INK, fill=INK, first_fill='#ffffff', other='#ffffff')
    notes = ['修繕窗口：信盛工程（信創營造旗下）；展裕防水是信盛找來施工的外包廠商。',
             '外牆屬公設：需進入住戶專有部分施工時，依公寓大廈管理條例第 6 條第 3 款書面通知該戶（前例 039）。',
             '前例數字是 Notion 議題事項追蹤的 ID，可查當時的會勘與決議經過。',
             '日常預防：連續壁排水孔每月至少巡視兩次、颱風前預防性清孔（第四章 §1.9）。']
    for i, t in enumerate(notes):
        body.append(text(40, 576 + i * 20, t, 12, SUB))
    H = 576 + 20 * len(notes) + 8
    out = head(W, H, 'sp', '滲水的處理流程與費用歸屬',
               '流程圖：發現滲水後拍照記錄（不開閃光燈）並在雨後再拍一次；回報管委會群組或列入會議；由建設公司或信盛工程帶防水廠商會勘、報價並判斷原因，經管委會議決後施工。'
               '對照過去案例分四種：仍在保固期內由建設公司出資；判定為施工缺失則發函敦寶、福一並請信創營造負管理監督責任；'
               '已過保固期由社區付費，報價單寫明施工保固；連續壁先天滲水以導水處理、社區付費。'
               '最後都要驗收確認不再滲漏，社區付費的案件驗收通過才付款。修繕窗口是信盛工程；外牆入戶施工須書面通知；排水孔每月至少巡視兩次。')
    out.append('  <defs>')
    out.append('    <marker id="sp-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">')
    out.append(f'      <path d="M0,0 L10,5 L0,10 z" fill="{SUB}"/>')
    out.append('    </marker>')
    out.append('  </defs>')
    out.append(text(40, 40, '滲水的處理流程與費用歸屬', 20, INK, 700))
    out.append(text(40, 64, '地下室外牆是連續壁，本身會滲水；先判斷屬於哪一類，再決定找誰、誰付費'))
    out += body
    out.append('</svg>')
    return out

for name, fn in [('equipment-locations', equipment), ('annual-calendar', calendar), ('seepage-decision', seepage)]:
    svg = '\n'.join(fn()) + '\n'
    assert not any(ord(c) < 32 and c not in '\n\t' for c in svg)
    open(os.path.join(OUT, name + '.svg'), 'w', encoding='utf-8', newline='\n').write(svg)
    print(name, 'ok')
