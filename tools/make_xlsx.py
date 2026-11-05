from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.formatting.rule import ColorScaleRule
from openpyxl.comments import Comment
from openpyxl.utils import get_column_letter

F="Arial"
def font(**k): return Font(name=F, **k)
BLUE=font(color="0000FF"); BLACK=font(); BOLD=font(bold=True); GREEN=font(color="008000")
H1=font(bold=True,size=14); HDR=font(bold=True,color="FFFFFF")
YEL=PatternFill("solid",fgColor="FFFF00"); HFILL=PatternFill("solid",fgColor="1B2038"); SUB=PatternFill("solid",fgColor="EEF0F6")
thin=Side(style="thin",color="C8CCD8"); BOX=Border(left=thin,right=thin,top=thin,bottom=thin)
C=Alignment(horizontal="center",vertical="center"); L=Alignment(horizontal="left",vertical="center",wrap_text=True)

wb=Workbook()
# ---------- 速算 ----------
ws=wb.active; ws.title="速算"
ws["A1"]="真距離對戰・距離補償速算"; ws["A1"].font=H1
ws["A2"]="黃底藍字 = 可以改的數字；黑字 = 自動計算。這是粗估，跟網站實際對戰會有出入（見「說明」分頁）。"; ws["A2"].font=font(italic=True,color="5A6182")
ws.merge_cells("A2:D2")

ws["A4"]="全域設定"; ws["A4"].font=BOLD
rows=[("補償係數 k",1.0,"短手傷害 ×（1 + k × 距離差 ÷ 長手距離）；k=0.5 最多 1.5 倍，k=1.0 最多 2 倍"),
      ("血量",100,"真距離對戰雙方血量都是 100"),]
for i,(a,v,n) in enumerate(rows):
    r=5+i; ws.cell(r,1,a).font=BLACK; c=ws.cell(r,2,v); c.font=BLUE; c.fill=YEL; c.alignment=C; c.border=BOX
    ws.cell(r,3,n).font=font(color="5A6182")
ws["B5"].number_format="0.00"

ws["A8"]="雙方角色"; ws["A8"].font=BOLD
for j,h in enumerate(["項目","短手","長手","說明"]):
    c=ws.cell(9,1+j,h); c.font=HDR; c.fill=HFILL; c.alignment=C; c.border=BOX
side=[("角色","天神宙斯熊大","白女巫克拉拉","範例：資料庫的兩隻角色"),
      ("攻擊距離",50,550,"資料庫的「攻擊範圍」"),
      ("每下基礎傷害",20,20,"普攻 15、技能1 30、技能2 40，混著出招大約 20"),
      ("出手間隔（秒）",1.5,1.5,"取決於動作長度，一般 1～2 秒"),
      ("移動速度（點/秒）",130,100,"資料庫的「移動速度」")]
for i,(a,s,l,n) in enumerate(side):
    r=10+i; ws.cell(r,1,a).border=BOX
    for j,v in enumerate((s,l)):
        c=ws.cell(r,2+j,v); c.font=BLUE; c.fill=YEL; c.alignment=C; c.border=BOX
    ws.cell(r,4,n).font=font(color="5A6182"); ws.cell(r,4).border=BOX

ws["A16"]="計算結果"; ws["A16"].font=BOLD
for j,h in enumerate(["項目","短手","長手","說明"]):
    c=ws.cell(17,1+j,h); c.font=HDR; c.fill=HFILL; c.alignment=C; c.border=BOX
calc=[
 ("傷害倍率","=IF(C11>B11,1+$B$5*(C11-B11)/C11,1)","=1","只加成短手；距離相同時都是 1","0.00"),
 ("每下傷害","=B12*B18","=C12*C18","基礎傷害 × 倍率","0.0"),
 ("傷害比（短 ÷ 長）","=IFERROR(B19/C19,0)","","","0.00"),
 ("長手白打時間（秒）","=IF(C11>B11,(C11-B11)/B14,0)","","短手從長手射程走到自己射程這段，只有長手能打","0.00"),
 ("長手白打下數","=IF(B21>0,INT(B21/C13)+1,0)","","白打時間內長手能先打幾下","0"),
 ("打倒對手要幾下","=ROUNDUP($B$6/B19,0)","=ROUNDUP($B$6/C19,0)","血量 ÷ 每下傷害，無條件進位","0"),
 ("打倒對手的時間（秒）","=B21+(B23-1)*B13","=(C23-1)*C13","短手要先走完白打時間才開始打","0.00"),
 ("預估勝者",'=IF(B24<C24,"短手",IF(C24<B24,"長手","平手"))',"","先把對手打倒的一方","@"),
]
for i,(a,b,c_,n,fmt) in enumerate(calc):
    r=18+i; ws.cell(r,1,a).border=BOX
    for j,v in enumerate((b,c_)):
        c=ws.cell(r,2+j,v if v!="" else None); c.alignment=C; c.border=BOX; c.number_format=fmt
    ws.cell(r,4,n).font=font(color="5A6182"); ws.cell(r,4).border=BOX
ws.merge_cells("B25:C25"); ws["B25"].font=font(bold=True,size=12)
for col,w in zip("ABCD",(22,16,16,52)): ws.column_dimensions[col].width=w
ws.freeze_panes="A4"

# ---------- 倍率表 ----------
t=wb.create_sheet("倍率表")
t["A1"]="短手傷害倍率對照表"; t["A1"].font=H1
t["A2"]="係數 k（從「速算」分頁連過來）"; t["C2"]="=速算!B5"; t["C2"].font=GREEN; t["C2"].number_format="0.00"
t["A3"]="直列 = 短手攻擊距離，橫欄 = 長手攻擊距離。只顯示短手比長手短的格子。"; t["A3"].font=font(italic=True,color="5A6182")
rng=[25,50,75,100,125,150,200,250,300,400,500,600,800]
c=t.cell(5,1,"短 \\ 長"); c.font=HDR; c.fill=HFILL; c.alignment=C
for j,v in enumerate(rng):
    c=t.cell(5,2+j,v); c.font=font(bold=True,color="0000FF"); c.fill=SUB; c.alignment=C
for i,v in enumerate(rng):
    c=t.cell(6+i,1,v); c.font=font(bold=True,color="0000FF"); c.fill=SUB; c.alignment=C
    for j in range(len(rng)):
        S=f"$A{6+i}"; Lc=f"{get_column_letter(2+j)}$5"
        cc=t.cell(6+i,2+j,f'=IF({S}<{Lc},1+$C$2*({Lc}-{S})/{Lc},"")'); cc.number_format="0.00"; cc.alignment=C; cc.border=BOX
end=f"{get_column_letter(1+len(rng))}{5+len(rng)}"
t.conditional_formatting.add(f"B6:{end}",ColorScaleRule(start_type="num",start_value=1,start_color="FFFFFF",end_type="num",end_value=2,end_color="FF7FA5"))
t.column_dimensions["A"].width=10
for j in range(len(rng)): t.column_dimensions[get_column_letter(2+j)].width=7.5
t["A5"].comment=Comment("表頭的距離數字也可以改（藍字）","Ranger 惡搞工坊")

# ---------- 實測結果 ----------
m=wb.create_sheet("實測結果")
m["A1"]="網站實際模擬：短手勝場數（每組 16 場）"; m["A1"].font=H1
m["A2"]="來源：本機用網站程式實際對戰，2026-11-02。每組左右互換各 8 場（你來我往 1 場 + 隨機對打 7 場）。數字為固定紀錄，不會隨上面的設定變動。"; m["A2"].font=font(italic=True,color="5A6182")
m.merge_cells("A2:G2"); m["A2"].alignment=L; m.row_dimensions[2].height=32
hdr=["對戰（短 vs 長）","原本反比","固定基準 220","k = 0.5","k = 0.8","k = 1.0"]
for j,h in enumerate(hdr):
    c=m.cell(4,1+j,h); c.font=HDR; c.fill=HFILL; c.alignment=C; c.border=BOX
data=[("天神宙斯熊大 50 vs 白女巫克拉拉 550",16,6,2,2,6),
      ("恐龍熊大 75 vs 粉紅兔兔 370",16,13,5,10,11),
      ("黑白風之痕 125 vs 白女巫克拉拉 550",16,3,1,5,7),
      ("天神宙斯熊大 50 vs 粉紅兔兔 370",16,7,4,7,6)]
for i,row in enumerate(data):
    r=5+i
    for j,v in enumerate(row):
        c=m.cell(r,1+j,v); c.border=BOX; c.alignment=C if j else L
        if j: c.font=BLUE
m.cell(9,1,"短手總勝場").font=BOLD; m.cell(10,1,"短手勝率").font=BOLD; m.cell(11,1,"總場數")
for j in range(2,7):
    col=get_column_letter(j)
    m.cell(9,j,f"=SUM({col}5:{col}8)").alignment=C
    m.cell(11,j,"=16*COUNT(A5:A8)+0*COUNTA(A5:A8)").alignment=C
    c=m.cell(10,j,f"=IFERROR({col}9/{col}11,0)"); c.number_format="0%"; c.alignment=C; c.font=BOLD
    for r in (9,10,11): m.cell(r,j).border=BOX
# total games: 16 per pair
for j in range(2,7): m.cell(11,j,"=16*COUNTA($A$5:$A$8)")
m.cell(13,1,"50% 左右代表長短手互有輸贏；越高代表短手越強。").font=font(color="5A6182")
m.column_dimensions["A"].width=38
for col in "BCDEF": m.column_dimensions[col].width=14

# ---------- 說明 ----------
d=wb.create_sheet("說明")
d["A1"]="說明"; d["A1"].font=H1
notes=["怎麼用：在「速算」分頁改黃底藍字的數字，看預估勝者和傷害比；「倍率表」會跟著係數 k 一起變。",
 "公式：短手傷害 ×（1 + k × (長手距離 − 短手距離) ÷ 長手距離），長手 ×1。",
 "白打時間：開場距離 = 長手距離 + 100。雙方先一起走近，到長手射程後長手停下開打，短手還要再走 (長手距離 − 短手距離) 才能出手。",
 "這是粗估，沒有算到：每招在動作中的命中時間點、傷害 ±25% 浮動、技能與普攻混著出、投射物飛行時間、跌破半血的擊退打斷。",
 "所以速算的勝負只能看趨勢；實際比例請以「實測結果」分頁為準。",
 "預設角色數值：攻擊距離與移動速度取自資料庫（天神宙斯熊大 50 / 130，白女巫克拉拉 550 / 100）；每下基礎傷害與出手間隔是估計值。"]
for i,n in enumerate(notes):
    c=d.cell(3+i,1,n); c.alignment=L; d.row_dimensions[3+i].height=34
d.column_dimensions["A"].width=110

for sh in wb.worksheets:
    for row in sh.iter_rows():
        for c in row:
            if c.value is not None and (c.font is None or c.font.name!=F):
                f=c.font; c.font=Font(name=F,bold=f.bold,italic=f.italic,size=f.size,color=f.color)
wb.save(str(__import__("pathlib").Path(__file__).resolve().parent / "距離補償速算.xlsx"))
