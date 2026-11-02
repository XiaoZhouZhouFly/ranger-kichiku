#!/usr/bin/env python3
"""產生兩隻自製測試角色（不使用任何官方素材）到 custom/ 資料夾。

角色全部用程式畫出零件、用程式寫出每一格的動作，格式跟同步下來的官方角色資料完全相同，
用來證明網站的播放、剪輯、對戰、錄影都不依賴官方素材。

用法：python3 tools/make_custom_chars.py   （需要 Pillow）
產出：
  custom/units.json                角色清單
  custom/skills.json               技能名稱與說明
  custom/stats.json                原始數值（原始數值對戰用）
  custom/units/<id>.json           動畫資料
  custom/res/<id>/<id>-body.png    零件圖集
  custom/res/<id>/<id>-thum-140.png 縮圖
"""
from __future__ import annotations

import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "custom"
SS = 4  # 先放大 4 倍畫再縮小，邊緣比較平滑


# ---------- 畫零件 ----------
def canvas(w, h):
    return Image.new("RGBA", (w * SS, h * SS), (0, 0, 0, 0))


def done(img):
    w, h = img.size
    return img.resize((w // SS, h // SS), Image.LANCZOS)


def S(v):
    return [round(x * SS) for x in v]


INK = (27, 32, 56, 255)


def rrect(d, box, r, fill, outline=INK, width=3):
    d.rounded_rectangle(S(box), radius=r * SS, fill=fill, outline=outline, width=width * SS)


def ell(d, box, fill, outline=INK, width=3):
    d.ellipse(S(box), fill=fill, outline=outline, width=width * SS)


def poly(d, pts, fill, outline=INK, width=3):
    d.polygon([(x * SS, y * SS) for x, y in pts], fill=fill)
    if outline:
        d.line([(x * SS, y * SS) for x, y in pts + [pts[0]]], fill=outline, width=width * SS, joint="curve")


def cube_parts():
    P = {}
    BLUE, BLUE2, STEEL = (74, 144, 226, 255), (52, 108, 186, 255), (210, 220, 235, 255)
    im = canvas(34, 30); d = ImageDraw.Draw(im); rrect(d, (2, 2, 32, 28), 6, BLUE)
    d.rectangle(S((6, 8, 28, 13)), fill=(36, 48, 84, 255)); d.rectangle(S((19, 9, 25, 12)), fill=(120, 240, 255, 255))
    P["head"] = done(im)
    im = canvas(40, 34); d = ImageDraw.Draw(im); rrect(d, (2, 2, 38, 32), 7, BLUE2)
    rrect(d, (10, 8, 30, 26), 4, (250, 204, 64, 255), width=2)
    P["torso"] = done(im)
    for name, col in (("armF", BLUE), ("armB", BLUE2)):
        im = canvas(12, 28); d = ImageDraw.Draw(im); rrect(d, (1, 1, 11, 27), 5, col); P[name] = done(im)
    for name, col in (("legF", BLUE), ("legB", BLUE2)):
        im = canvas(14, 24); d = ImageDraw.Draw(im); rrect(d, (1, 1, 13, 20), 4, col); rrect(d, (0, 15, 14, 23), 3, (60, 70, 100, 255), width=2)
        P[name] = done(im)
    im = canvas(14, 60); d = ImageDraw.Draw(im)
    poly(d, [(7, 1), (12, 10), (12, 44), (2, 44), (2, 10)], STEEL)
    d.rectangle(S((0, 44, 14, 49)), fill=(250, 204, 64, 255), outline=INK, width=2 * SS)
    rrect(d, (4, 49, 10, 59), 2, (120, 80, 50, 255), width=2)
    P["sword"] = done(im)
    im = canvas(90, 90); d = ImageDraw.Draw(im)
    for k in range(5):
        d.arc(S((6 + k * 2, 6 + k * 2, 84 - k * 2, 84 - k * 2)), start=-70, end=70, fill=(180, 230, 255, 230 - k * 40), width=4 * SS)
    P["slash"] = done(im)
    im = canvas(120, 30); d = ImageDraw.Draw(im)
    d.ellipse(S((4, 4, 116, 26)), outline=(255, 210, 90, 255), width=5 * SS); d.ellipse(S((22, 9, 98, 21)), outline=(255, 245, 200, 255), width=3 * SS)
    P["wave"] = done(im)
    return P


def orb_parts():
    P = {}
    ORANGE, DARK = (255, 150, 60, 255), (220, 110, 40, 255)
    im = canvas(64, 58); d = ImageDraw.Draw(im); ell(d, (2, 2, 62, 56), ORANGE)
    ell(d, (10, 30, 22, 38), (255, 120, 120, 200), outline=None); ell(d, (44, 30, 56, 38), (255, 120, 120, 200), outline=None)
    d.arc(S((26, 34, 40, 44)), start=20, end=160, fill=INK, width=2 * SS)
    P["body"] = done(im)
    im = canvas(10, 14); d = ImageDraw.Draw(im); ell(d, (1, 1, 9, 13), INK, outline=None); ell(d, (3, 3, 6, 7), (255, 255, 255, 255), outline=None)
    P["eye"] = done(im)
    im = canvas(50, 46); d = ImageDraw.Draw(im)
    poly(d, [(25, 2), (40, 34), (10, 34)], (140, 90, 220, 255)); rrect(d, (1, 32, 49, 44), 6, (120, 70, 200, 255))
    ell(d, (21, 16, 29, 24), (255, 230, 90, 255), width=2)
    P["hat"] = done(im)
    im = canvas(12, 40); d = ImageDraw.Draw(im); rrect(d, (4, 10, 8, 39), 2, (130, 90, 60, 255), width=2)
    poly(d, [(6, 0), (8, 5), (12, 5), (9, 8), (10, 12), (6, 10), (2, 12), (3, 8), (0, 5), (4, 5)], (255, 230, 90, 255), width=2)
    P["wand"] = done(im)
    for name in ("footF", "footB"):
        im = canvas(18, 10); d = ImageDraw.Draw(im); ell(d, (1, 1, 17, 9), DARK); P[name] = done(im)
    im = canvas(26, 26); d = ImageDraw.Draw(im)
    ell(d, (1, 1, 25, 25), (255, 120, 40, 255), outline=(255, 220, 120, 255)); ell(d, (7, 7, 19, 19), (255, 240, 160, 255), outline=None)
    P["fire"] = done(im.filter(ImageFilter.GaussianBlur(SS * 0.6)))
    im = canvas(16, 16); d = ImageDraw.Draw(im)
    poly(d, [(8, 0), (10, 6), (16, 8), (10, 10), (8, 16), (6, 10), (0, 8), (6, 6)], (255, 255, 200, 255), outline=None)
    P["spark"] = done(im)
    im = canvas(120, 34); d = ImageDraw.Draw(im)
    d.ellipse(S((3, 3, 117, 31)), outline=(120, 255, 170, 255), width=4 * SS); d.ellipse(S((18, 8, 102, 26)), outline=(200, 255, 220, 220), width=2 * SS)
    P["ring"] = done(im)
    return P


# ---------- 矩陣 ----------
def mul(a, b):
    return [a[0] * b[0] + a[1] * b[3], a[0] * b[1] + a[1] * b[4], a[0] * b[2] + a[1] * b[5] + a[2],
            a[3] * b[0] + a[4] * b[3], a[3] * b[1] + a[4] * b[4], a[3] * b[2] + a[4] * b[5] + a[5]]


def T(x, y): return [1, 0, x, 0, 1, y]
def R(deg):
    r = math.radians(deg); c, s = math.cos(r), math.sin(r); return [c, -s, 0, s, c, 0]
def SC(sx, sy=None): return [sx, 0, 0, 0, sx if sy is None else sy, 0]


def chain(*ms):
    out = [1, 0, 0, 0, 1, 0]
    for m in ms:
        out = mul(out, m)
    return out


def ease(t): return 0.5 - 0.5 * math.cos(math.pi * max(0, min(1, t)))
def lerp(a, b, t): return a + (b - a) * t
def seg(k, n, a, b):
    """第 k 格在區段 [a,b) 裡的進度（0~1），區段外回傳 None。"""
    t = k / max(1, n - 1)
    return None if t < a or t > b else (t - a) / max(1e-9, b - a)


# ---------- 動作 ----------
def cube_pose(anim, k, n):
    """回傳 {零件: (矩陣, 透明度)}，矩陣把「零件中心為原點」的座標換到角色座標（腳底中央為原點，y 向下）。"""
    p = dict(bob=0, lean=0, jump=0, spin=0, armF=20, armB=-15, legF=0, legB=0, sword=10, head=0, slash=None, wave=None, sx=1)
    t = k / max(1, n - 1)
    if anim == "idle":
        p["bob"] = 2 * math.sin(2 * math.pi * t); p["armF"] = 20 + 6 * math.sin(2 * math.pi * t); p["armB"] = -15 - 5 * math.sin(2 * math.pi * t)
    elif anim == "walk":
        s = math.sin(2 * math.pi * t); p.update(bob=-2 * abs(s), legF=28 * s, legB=-28 * s, armF=20 - 22 * s, armB=-15 + 22 * s, lean=4)
    elif anim == "attack":
        if t < 0.4: u = ease(t / 0.4); p.update(armF=lerp(20, -130, u), sword=lerp(10, 30, u), lean=lerp(0, -8, u))
        elif t < 0.6: u = ease((t - 0.4) / 0.2); p.update(armF=lerp(-130, 60, u), sword=lerp(30, 0, u), lean=lerp(-8, 12, u)); p["slash"] = (u, 1)
        else: u = ease((t - 0.6) / 0.4); p.update(armF=lerp(60, 20, u), sword=lerp(0, 10, u), lean=lerp(12, 0, u)); p["slash"] = (1, 1 - u)
    elif anim == "s_attack":
        if t < 0.25: u = ease(t / 0.25); p.update(armF=lerp(20, -90, u), bob=lerp(0, 4, u), legF=lerp(0, 15, u), legB=lerp(0, -15, u))
        elif t < 0.75: u = (t - 0.25) / 0.5; p.update(spin=720 * ease(u), armF=-90, sword=0, jump=-14 * math.sin(math.pi * u)); p["slash"] = (min(1, u * 3), 1 - max(0, u - 0.7) / 0.3)
        else: u = ease((t - 0.75) / 0.25); p.update(armF=lerp(-90, 20, u), sword=lerp(0, 10, u))
    elif anim == "s2_attack":
        # 蹲 → 跳起 → 落地重擊（落地在 50%，跟網站的命中時間一致）→ 衝擊波
        if t < 0.25: u = ease(t / 0.25); p.update(bob=lerp(0, 6, u), armF=lerp(20, -160, u), sx=lerp(1, 1.08, u))
        elif t < 0.45: u = (t - 0.25) / 0.2; p.update(jump=-70 * math.sin(math.pi / 2 * u), armF=-160, lean=-6)
        elif t < 0.5: u = (t - 0.45) / 0.05; p.update(jump=lerp(-70, 0, u), armF=lerp(-160, 70, u), lean=lerp(-6, 16, u))
        else: u = ease((t - 0.5) / 0.5); p.update(armF=lerp(70, 20, u), lean=lerp(16, 0, u), bob=lerp(3, 0, u)); p["wave"] = (u, 1 - u)
    elif anim == "knockback":
        u = math.sin(math.pi * min(1, t * 1.4)); p.update(lean=-35 * u, jump=-18 * u, armF=-40 * u, armB=50 * u, legF=-20 * u, legB=25 * u, head=-15 * u)
    root = chain(T(0, p["bob"] + p["jump"]), R(p["lean"]), T(0, -40), R(p["spin"]), SC(p["sx"]), T(0, 40))
    parts = {}
    parts["legB"] = (chain(root, T(-6, -22), R(p["legB"]), T(0, 11)), 1)
    parts["armB"] = (chain(root, T(-15, -60), R(p["armB"]), T(0, 12)), 1)
    parts["torso"] = (chain(root, T(0, -40)), 1)
    parts["legF"] = (chain(root, T(7, -22), R(p["legF"]), T(0, 11)), 1)
    parts["head"] = (chain(root, T(0, -60), R(p["head"]), T(2, -14)), 1)
    arm = chain(root, T(13, -60), R(-p["armF"]))
    parts["armF"] = (chain(arm, T(0, 12)), 1)
    parts["sword"] = (chain(arm, T(0, 24), R(70 + p["sword"]), T(0, -24)), 1)
    if p["slash"]:
        g, a = p["slash"]; parts["slash"] = (chain(root, T(38, -44), SC(0.6 + 0.5 * g)), max(0, a))
    if p["wave"]:
        g, a = p["wave"]; parts["wave"] = (chain(T(40, -2), SC(0.4 + 1.2 * g, 0.6 + 0.6 * g)), max(0, a))
    return parts


def orb_pose(anim, k, n):
    p = dict(bob=0, squash=1, wand=-20, eye=1, hat=0, feet=0, lean=0, jump=0, fire=[], spark=[], ring=None)
    t = k / max(1, n - 1)
    if anim == "idle":
        p["bob"] = 3 * math.sin(2 * math.pi * t); p["squash"] = 1 + 0.03 * math.sin(2 * math.pi * t)
        p["eye"] = 0.15 if 0.7 < t < 0.76 else 1; p["hat"] = 4 * math.sin(2 * math.pi * t)
    elif anim == "walk":
        s = math.sin(2 * math.pi * t * 2); p.update(bob=-4 * abs(s), squash=1 - 0.05 * abs(s), feet=s, lean=5, hat=-6)
    elif anim == "attack":
        if t < 0.45: u = ease(t / 0.45); p.update(wand=lerp(-20, -120, u), squash=lerp(1, 0.94, u), lean=lerp(0, -6, u))
        elif t < 0.6: u = ease((t - 0.45) / 0.15); p.update(wand=lerp(-120, 40, u), lean=lerp(-6, 10, u))
        else: u = ease((t - 0.6) / 0.4); p.update(wand=lerp(40, -20, u), lean=lerp(10, 0, u))
        if t >= 0.5: u = (t - 0.5) / 0.5; p["fire"].append((lerp(40, 150, u), -40 - 10 * math.sin(math.pi * u), 0.8, 1 - max(0, u - 0.75) / 0.25))
    elif anim == "s_attack":
        p["wand"] = -110 + 30 * math.sin(2 * math.pi * t * 3); p["squash"] = 1 + 0.05 * math.sin(2 * math.pi * t * 3)
        for j in range(3):
            st = 0.2 + j * 0.15; u = (t - st) / 0.45
            if 0 <= u <= 1: p["fire"].append((lerp(40, 190, u), -48 + j * 10 - 14 * math.sin(math.pi * u), 1.1, 1 - max(0, u - 0.8) / 0.2))
    elif anim == "s2_attack":
        u = math.sin(math.pi * t); p.update(wand=-150 * u - 20 * (1 - u), jump=-10 * u, squash=1 + 0.06 * u, hat=8 * math.sin(2 * math.pi * t * 2))
        p["ring"] = (t, min(1, 3 * u))
        for j in range(6):
            ph = (t * 1.5 + j / 6) % 1; ang = j * 60 + t * 200
            p["spark"].append((34 * math.cos(math.radians(ang)), -30 - 70 * ph, 0.6 + 0.6 * (1 - ph), (1 - ph) * min(1, 3 * u)))
    elif anim == "knockback":
        u = math.sin(math.pi * min(1, t * 1.4)); p.update(lean=-30 * u, jump=-20 * u, squash=1 - 0.1 * u, eye=0.2 if u > 0.3 else 1, hat=-25 * u, wand=40 * u)
    root = chain(T(0, p["bob"] + p["jump"]), R(p["lean"]), SC(1 / p["squash"] ** 0.5, p["squash"]))
    parts = {}
    if p["ring"]:
        g, a = p["ring"]; parts["ring"] = (chain(T(0, -4), SC(0.6 + 0.6 * g, 0.7 + 0.4 * g)), a)
    parts["footB"] = (chain(T(0, p["jump"] * 0.8), T(-12 - 4 * p["feet"], -5)), 1)
    parts["body"] = (chain(root, T(0, -32)), 1)
    parts["eyeB"] = (chain(root, T(4, -38), SC(1, p["eye"])), 1)
    parts["eyeF"] = (chain(root, T(18, -38), SC(1, p["eye"])), 1)
    parts["hat"] = (chain(root, T(-2, -60), R(p["hat"]), T(0, -14)), 1)
    parts["footF"] = (chain(T(0, p["jump"] * 0.8), T(12 + 4 * p["feet"], -5)), 1)
    parts["wand"] = (chain(root, T(26, -30), R(p["wand"]), T(0, -14)), 1)
    for j, (x, y, s, a) in enumerate(p["fire"]):
        parts[f"fire{j}"] = (chain(T(x, y), SC(s), R(k * 25)), max(0, a))
    for j, (x, y, s, a) in enumerate(p["spark"]):
        parts[f"spark{j}"] = (chain(T(x, y), SC(s), R(k * 15)), max(0, a))
    return parts


# ---------- 組成角色資料 ----------
def build(uid, parts_img, pose, anims, order, alias):
    pad = 2
    ids = list(parts_img)
    W = sum(parts_img[k].width + pad for k in ids) + pad; H = max(parts_img[k].height for k in ids) + pad * 2
    atlas = Image.new("RGBA", (W, H), (0, 0, 0, 0)); x = pad
    sprites, images, index = {}, [], {}
    for k in ids:
        im = parts_img[k]; atlas.paste(im, (x, pad))
        nm = f"{uid}-body_{k}.png"
        sprites[nm] = {"rect": [x, pad, im.width, im.height], "rotated": False}
        index[k] = len(images)
        images.append({"name": nm, "m": [1, 0, 0, 1, -im.width / 2, -im.height / 2]})
        x += im.width + pad
    animations = {}
    for name, n in anims.items():
        frames = []
        for k in range(n):
            ps = pose(name, k, n); fr = []
            for depth, key in enumerate(sorted(ps, key=lambda q: order.index(alias(q)))):
                m, a = ps[key]
                if a <= 0.01: continue
                fr.append([depth + 1, index[alias(key)], [round(v, 3) for v in (m[0], m[1], m[3], m[4], m[2], m[5])], [255, 255, 255, round(255 * min(1, a))]])
            frames.append(fr)
        animations[name] = {"frame_count": n, "frames": frames}
    d = OUT / "res" / uid; d.mkdir(parents=True, exist_ok=True)
    atlas.save(d / f"{uid}-body.png", optimize=True)
    meta = {"unit_id": uid, "parts": {"body": {"anim_rate": 30, "png": f"res/{uid}/{uid}-body.png", "images": images, "sprites": sprites, "animations": animations}}}
    (OUT / "units").mkdir(parents=True, exist_ok=True)
    (OUT / "units" / f"{uid}.json").write_text(json.dumps(meta, separators=(",", ":")), encoding="utf-8")
    # 縮圖：畫待機第一格
    thumb = Image.new("RGBA", (560, 560), (0, 0, 0, 0))
    items = animations["idle"]["frames"][0]
    pts = []
    for it in items:
        im = parts_img[ids[it[1]]]; a, b, c, dd, e, f = it[2]
        for px, py in ((0, 0), (im.width, 0), (0, im.height), (im.width, im.height)):
            X, Y = px - im.width / 2, py - im.height / 2; pts.append((a * X + b * Y + e, c * X + dd * Y + f))
    x0 = min(p[0] for p in pts); x1 = max(p[0] for p in pts); y0 = min(p[1] for p in pts); y1 = max(p[1] for p in pts)
    sc = 0.86 * 560 / max(x1 - x0, y1 - y0); ox = 280 - sc * (x0 + x1) / 2; oy = 280 - sc * (y0 + y1) / 2
    for it in items:
        im = parts_img[ids[it[1]]]; a, b, c, dd, e, f = it[2]
        # 零件中心座標 → 縮圖座標：M = [sc*a, sc*b, sc*e+ox; sc*c, sc*dd, sc*f+oy]，再換回零件像素座標（左上為原點）
        M = [sc * a, sc * b, sc * (a * -im.width / 2 + b * -im.height / 2 + e) + ox, sc * c, sc * dd, sc * (c * -im.width / 2 + dd * -im.height / 2 + f) + oy]
        det = M[0] * M[4] - M[1] * M[3]
        inv = [M[4] / det, -M[1] / det, (M[1] * M[5] - M[4] * M[2]) / det, -M[3] / det, M[0] / det, (M[3] * M[2] - M[0] * M[5]) / det]
        layer = im.transform((560, 560), Image.AFFINE, inv, resample=Image.BICUBIC)
        thumb.alpha_composite(layer)
    thumb.resize((140, 140), Image.LANCZOS).save(d / f"{uid}-thum-140.png", optimize=True)


def main():
    anims = {"idle": 40, "walk": 24, "attack": 18, "s_attack": 30, "s2_attack": 36, "knockback": 24}
    cp = cube_parts()
    build("x001-cube", cp, cube_pose, anims, ["wave", "legB", "armB", "torso", "legF", "head", "armF", "sword", "slash"], lambda q: q)
    op = orb_parts(); op["eyeB"] = op["eyeF"] = op.pop("eye")
    op_sprites = {k: v for k, v in op.items()}
    alias = lambda q: "fire" if q.startswith("fire") else "spark" if q.startswith("spark") else q
    build("x002-orb", op_sprites, orb_pose, anims, ["ring", "footB", "body", "eyeB", "eyeF", "hat", "footF", "wand", "fire", "spark"], alias)
    units = [
        {"id": "x001-cube", "name": "【自製】方塊騎士", "star": "自製測試", "type": "力量型", "element": "無", "date": "2026/11/02", "custom": True},
        {"id": "x002-orb", "name": "【自製】圓圓法師", "star": "自製測試", "type": "魔法型", "element": "無", "date": "2026/11/02", "custom": True},
    ]
    (OUT / "units.json").write_text(json.dumps(units, ensure_ascii=False, indent=1), encoding="utf-8")
    skills = {
        "x001-cube": [
            {"name": "旋風斬", "rate": "30.0%", "trigger": "前方敵人", "cooldown": "6.0秒", "desc": "原地旋轉兩圈，揮劍斬擊前方敵人。\n（自製測試角色）"},
            {"name": "方塊重擊", "rate": "20.0%", "trigger": "前方敵人", "cooldown": "10.0秒", "desc": "高高跳起後重重落地，以衝擊波攻擊敵人。\n（自製測試角色）"},
        ],
        "x002-orb": [
            {"name": "火球連發", "rate": "35.0%", "trigger": "前方敵人", "cooldown": "5.0秒", "desc": "連續發射三顆火球攻擊遠處的敵人。\n（自製測試角色）"},
            {"name": "治癒光環", "rate": "20.0%", "trigger": "自己", "cooldown": "12.0秒", "desc": "展開治癒光環，恢復自己的體力。\n（自製測試角色）"},
        ],
    }
    (OUT / "skills.json").write_text(json.dumps(skills, ensure_ascii=False, indent=1), encoding="utf-8")
    stats = {
        "x001-cube": {"s": "自製測試", "hp": [32000.0, 3200.0, 3200.0], "pa": [5200.0, 520.0, 0.0], "ma": [0.0, 0.0, 0.0], "pd": [3000.0, 300.0, 300.0], "md": [1500.0, 150.0, 150.0],
                      "cr": 15.0, "cd": 150.0, "hit": 0.0, "dg": 10.0, "sh": 0.0, "sdg": 0.0, "ai": 1.6, "mv": 95.0, "rg": 130.0, "sr": 0.0,
                      "sk": [{"r": 30.0, "cd": 6.0, "e": [{"t": "hit", "c": 2.0, "b": "atk", "d": 0.0}]}, {"r": 20.0, "cd": 10.0, "e": [{"t": "hit", "c": 3.5, "b": "atk", "d": 0.0}]}]},
        "x002-orb": {"s": "自製測試", "hp": [24000.0, 2400.0, 2400.0], "pa": [0.0, 0.0, 0.0], "ma": [6400.0, 640.0, 640.0], "pd": [800.0, 80.0, 80.0], "md": [2500.0, 250.0, 250.0],
                     "cr": 5.0, "cd": 100.0, "hit": 0.0, "dg": 0.0, "sh": 0.0, "sdg": 10.0, "ai": 2.2, "mv": 80.0, "rg": 380.0, "sr": 10.0,
                     "sk": [{"r": 35.0, "cd": 5.0, "e": [{"t": "hit", "c": 2.4, "b": "atk", "d": 0.0}]}, {"r": 20.0, "cd": 12.0, "e": []}]},
    }
    (OUT / "stats.json").write_text(json.dumps(stats, ensure_ascii=False, indent=1), encoding="utf-8")
    print("done:", sorted(str(p.relative_to(ROOT)) for p in OUT.rglob("*") if p.is_file()))


if __name__ == "__main__":
    main()
