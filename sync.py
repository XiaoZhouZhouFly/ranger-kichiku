#!/usr/bin/env python3
"""把 LINE Rangers 動畫資料同步進這個 repo 的 data/ 資料夾（由 GitHub Actions 每天執行）。

來源（上游）：
  mti0224/rangerbook_res   animation_meta/*.json 與各角色的圖集 PNG、縮圖
  mti0224/rangerbook       res/Ranger_index.json（角色中文名稱）

產出：
  data/units/<id>.json.gz     精簡後再 gzip 的動畫資料（網頁讀取時解壓）
  data/res/<id>/*.png         圖集與縮圖
  data/units.json             可用角色清單（id、名稱、星數、類型、屬性）
  data/sync_state.json        上次同步到的上游版本與時間
  data/skill_fx.json          技能的完整效果清單（格鬥場用；單人、雙人不讀）
  data/fight_reach.json       格鬥場：每隻角色普攻、技能動作實際伸到多遠（v7.4，需要 Pillow）

原則：
  * 只新增或更新，從不刪除。上游刪檔、改成私人或消失時，已同步的資料全部保留。
  * 上游連不上就跳過，不會把現有資料清空。
  * 只抓上游有變動的檔案；第一次執行才會完整下載。
"""
from __future__ import annotations

import datetime as dt
import gzip
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

RES_REPO = "https://github.com/mti0224/rangerbook_res.git"
INDEX_URL = "https://raw.githubusercontent.com/mti0224/rangerbook/main/res/Ranger_index.json"
RANGERS_DATA_URL = "https://raw.githubusercontent.com/mti0224/rangerbook/main/res/Rangers_data.json"
RANGERS_V2_URL = "https://raw.githubusercontent.com/mti0224/rangerbook/main/res/v2/rangers.json"
PROJECTILE_URL = "https://raw.githubusercontent.com/mti0224/rangerbook/main/res/projectile_data.json"

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
UNITS = DATA / "units"
RES = DATA / "res"
STATE = DATA / "sync_state.json"
UNIT_LIST = DATA / "units.json"
SKILLS = DATA / "skills.json"
PROJECTILES = DATA / "projectiles.json"
STATS = DATA / "stats.json"
SKILL_FX = DATA / "skill_fx.json"

META_RE = re.compile(r"^animation_meta/(u[^/]+)\.json$")
PNG_RE = re.compile(r"^(u[^/]+)/\1-(body|bul\d?)\.png$")
THUMB_RE = re.compile(r"^(u[^/]+)/\1-thum(-140)?\.png$")
ICON_RE = re.compile(r"^skill_icon/[^/]+\.png$")


def log(msg: str) -> None:
    print(msg, flush=True)


def git(*args: str, cwd: Path | None = None, check: bool = True) -> str:
    res = subprocess.run(["git", *args], cwd=cwd, text=True, capture_output=True)
    if check and res.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} 失敗：{res.stderr.strip()[:500]}")
    return res.stdout


def load_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def write_if_changed(path: Path, data: bytes) -> bool:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.read_bytes() == data:
        return False
    path.write_bytes(data)
    return True


# ---------- 動畫資料精簡 ----------
def _round(x):
    if isinstance(x, float):
        r = round(x, 3)
        return int(r) if r == int(r) else r
    if isinstance(x, list):
        return [_round(v) for v in x]
    if isinstance(x, dict):
        return {k: _round(v) for k, v in x.items()}
    return x


def clean_path(p: str) -> str:
    return re.sub(r"^res_from_emulator/", "", str(p or "").lstrip("/"))


_SIZE_IN_NAME = re.compile(r"_(\d+)x(\d+)(?:_\d+)?\.png$")


def fix_rect(name: str, r):
    """v7.5：少數上游角色（莉莎、莎莉 417/418…）的 rect 寫成 [x, 0, y, 0]（寬高是 0），寬高要從檔名「_寬x高.png」補回來。"""
    if not r or len(r) < 4 or (r[2] and r[3]):
        return r
    m = _SIZE_IN_NAME.search(name or "")
    return [r[0], r[2], int(m.group(1)), int(m.group(2))] if m else r


def fix_meta_rects(meta: dict) -> dict:
    for part in (meta.get("parts") or {}).values():
        for n, s in (part.get("sprites") or {}).items():
            if s.get("rect"):
                s["rect"] = fix_rect(n, s["rect"])
    return meta


def compact_meta(meta: dict) -> tuple[dict, list[str]]:
    """只留網頁播放需要的欄位，並回傳這份資料用到的 PNG（上游路徑）。"""
    out = {"unit_id": meta.get("unit_id"), "parts": {}}
    pngs = []
    for key, part in (meta.get("parts") or {}).items():
        png = clean_path(part.get("png"))
        if not png:
            continue
        pngs.append(png)
        anims = {}
        for name, a in (part.get("animations") or {}).items():
            if name == "_all" or not a.get("frames"):
                continue
            anims[name] = {"frame_count": a.get("frame_count", len(a["frames"])), "frames": a["frames"]}
        out["parts"][key] = _round({
            "anim_rate": part.get("anim_rate", 24),
            "png": "res/" + png,
            "images": [{"name": i["name"], "m": i["m"]} for i in part.get("images", [])],
            "sprites": {n: {"rect": fix_rect(n, s["rect"]), "rotated": bool(s.get("rotated"))}
                        for n, s in (part.get("sprites") or {}).items()},
            "animations": anims,
        })
    return out, pngs


def gz(data: bytes) -> bytes:
    # mtime=0：內容沒變時壓出來的檔案也一模一樣，才不會每天產生無意義的更新
    return gzip.compress(data, compresslevel=9, mtime=0)


# ---------- 同步動畫素材 ----------
def sync_resources(state: dict) -> dict:
    try:
        head = git("ls-remote", RES_REPO, "HEAD").split()[0]
    except Exception as e:
        log(f"⚠ 連不到上游素材庫，這次跳過（現有資料不受影響）：{e}")
        return state
    old = state.get("res_commit")
    if old == head and any(UNITS.glob("*.json.gz")) and any((RES / "skill_icon").glob("*.png")):
        log(f"素材庫沒有更新（{head[:7]}）")
        return state

    tmp = Path(tempfile.mkdtemp(prefix="upstream_"))
    try:
        log("取得上游檔案清單…")
        up = tmp / "up"
        # 只下載檔案清單（不含檔案內容）；有舊版本時保留歷史，才能比對哪些檔案變了
        args = ["clone", "--quiet", "--filter=blob:none", "--no-checkout"] + ([] if old else ["--depth", "1"])
        git(*args, RES_REPO, str(up))
        git("config", "gc.auto", "0", cwd=up)
        git("config", "maintenance.auto", "false", cwd=up)
        all_files = git("ls-tree", "-r", "--name-only", head, cwd=up).splitlines()
        all_set = set(all_files)
        wanted = lambda f: META_RE.match(f) or PNG_RE.match(f) or THUMB_RE.match(f) or ICON_RE.match(f)

        changed = None
        if old:
            try:
                diff = git("diff", "--name-only", "--diff-filter=AMR", old, head, cwd=up)
                changed = [f for f in diff.splitlines() if wanted(f)]
                log(f"上游從 {old[:7]} 更新到 {head[:7]}，有 {len(changed)} 個相關檔案變動")
            except Exception:
                changed = None
        full = changed is None or len(changed) > 3000
        if full:
            changed = [f for f in all_files if wanted(f)]
            log(f"完整同步：{len(changed)} 個檔案（第一次會比較久）")
        # 本地缺的縮圖與技能圖標也補上
        changed_set = set(changed)
        changed += [f for f in all_files if (THUMB_RE.match(f) or ICON_RE.match(f))
                    and not (RES / f).exists() and f not in changed_set]

        patterns = FULL_PATTERNS if full else ["/" + f for f in sorted(set(changed))]
        sparse(up, "set", patterns, head)

        new_units = 0
        need_png = set()
        metas = [f for f in changed if META_RE.match(f)]
        for n, f in enumerate(metas, 1):
            uid = META_RE.match(f).group(1)
            try:
                meta = json.loads((up / f).read_text(encoding="utf-8"))
                compact, pngs = compact_meta(meta)
            except Exception as e:
                log(f"  略過 {uid}：資料無法解析（{e}）")
                continue
            if compact["parts"]:
                dest = UNITS / f"{uid}.json.gz"
                existed = dest.exists()
                if write_if_changed(dest, gz(json.dumps(compact, separators=(",", ":")).encode())) and not existed:
                    new_units += 1
                need_png.update(pngs)
            (up / f).unlink(missing_ok=True)  # 處理完就刪掉暫存，省磁碟空間
            if n % 500 == 0:
                log(f"  已處理動畫資料 {n}/{len(metas)}")

        # 動畫資料用到、但這次沒下載、本地也還沒有的圖集
        missing = [p for p in need_png if p in all_set and not (RES / p).exists() and not (up / p).exists()]
        if missing:
            sparse(up, "add", ["/" + p for p in missing], head)

        copied = 0
        for f in set(changed) | need_png:
            if f.endswith(".png") and (up / f).exists():
                if write_if_changed(RES / f, (up / f).read_bytes()):
                    copied += 1
        log(f"新增角色 {new_units} 隻，新增或更新圖片 {copied} 張")
        state["res_commit"] = head
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return state


FULL_PATTERNS = ["/animation_meta/u*.json", "/u*/*-body.png", "/u*/*-bul*.png", "/u*/*-thum*.png",
                 "/skill_icon/*.png"]


def sparse(up: Path, mode: str, patterns: list[str], commit: str) -> None:
    """用 sparse checkout 一次批次下載需要的檔案。"""
    res = subprocess.run(["git", "sparse-checkout", mode, "--no-cone", "--stdin"], cwd=up, text=True,
                         input="\n".join(patterns) + "\n", capture_output=True)
    if res.returncode != 0:
        raise RuntimeError(f"sparse-checkout 失敗：{res.stderr.strip()[:500]}")
    if mode == "set":
        git("checkout", "--quiet", commit, cwd=up)
    log(f"  已下載 {len(patterns) if patterns is not FULL_PATTERNS else '全部'} 項")


# ---------- 角色名稱 ----------
FIELDS = ("id", "name", "star", "type", "element", "date")


def fetch_rangers_data():
    """角色資料表（技能、登場時間）。連不到就回傳 None，沿用舊資料。"""
    try:
        with urllib.request.urlopen(RANGERS_DATA_URL, timeout=120) as resp:
            rows = json.loads(resp.read().decode("utf-8"))
        if isinstance(rows, list) and len(rows) > 100:
            return rows
        log("⚠ 角色資料表內容異常，沿用舊的")
    except Exception as e:
        log(f"⚠ 連不到角色資料表，沿用舊的：{e}")
    return None


def sync_names(rows) -> None:
    names = {r["id"]: r for r in load_json(UNIT_LIST, [])} if UNIT_LIST.exists() else {}
    try:
        with urllib.request.urlopen(INDEX_URL, timeout=60) as resp:
            index = json.loads(resp.read().decode("utf-8"))
        if isinstance(index, list) and len(index) > 100:
            for r in index:
                if isinstance(r, dict) and r.get("id"):
                    old = names.get(r["id"], {})
                    names[r["id"]] = {**old, **{k: r.get(k, "") for k in ("id", "name", "star", "type", "element")}}
            log(f"角色名稱表：{len(index)} 筆")
        else:
            log("⚠ 名稱表內容異常，沿用舊的")
    except Exception as e:
        log(f"⚠ 連不到名稱表，沿用舊的：{e}")
    for r in rows or []:
        uid = r.get("ranger_id")
        if uid and r.get("登場時間"):
            names.setdefault(uid, {"id": uid})["date"] = str(r["登場時間"]).strip()

    out = []
    for p in sorted(UNITS.glob("*.json.gz")):
        uid = p.name[:-len(".json.gz")]
        r = names.get(uid, {})
        out.append({k: (uid if k == "id" else r.get(k, "")) for k in FIELDS})
    write_if_changed(UNIT_LIST, json.dumps(out, ensure_ascii=False, separators=(",", ":")).encode())
    log(f"可用角色：{len(out)} 隻（有中文名稱 {sum(1 for r in out if r['name'])} 隻）")


def sync_skills(rows) -> None:
    """從角色資料表整理出每隻角色的技能名稱、圖標與說明。"""
    if not rows:
        return
    skills = load_json(SKILLS, {})
    text = lambda v: str(v or "").replace("\\n", "\n").strip()
    for r in rows:
        uid = r.get("ranger_id")
        if not uid:
            continue
        lst = []
        for slot in ("技能1", "技能2"):
            sk = r.get(slot)
            if not isinstance(sk, dict) or not sk.get("技能名稱"):
                lst.append(None)
                continue
            lst.append({
                "name": text(sk.get("技能名稱")),
                "icon": text(sk.get("icon")),
                "rate": text(sk.get("發動機率")),
                "trigger": text(sk.get("觸發基準")),
                "cooldown": text(sk.get("技能冷卻時間")),
                "desc": text(sk.get("技能敘述")),
            })
        if any(lst):
            skills[uid] = lst
    write_if_changed(SKILLS, json.dumps(skills, ensure_ascii=False, separators=(",", ":")).encode())
    log(f"技能資料：{len(skills)} 隻角色")


def _motion(cfg: dict) -> str:
    explicit = str((cfg.get("motion") or {}).get("type") or "").upper()
    if explicit in ("LINEAR", "CURVE", "RETURN", "BEAM", "DIRECT", "NONE"):
        return explicit
    t = str(cfg.get("attackType") or "").upper()
    if t in ("ENERGY", "WEAPON", "DOUBLE"):
        return "LINEAR"
    if t in ("ENERGYC", "WEAPONC", "DOUBLEC"):
        return "CURVE"
    if t in ("PUNCH", "KICK", "SWING", "STAB"):
        return "DIRECT"
    return "NONE"


def sync_projectiles() -> None:
    """投射物資料：發射位置、飛行方式、速度、角度（雙人對打用）。"""
    try:
        with urllib.request.urlopen(PROJECTILE_URL, timeout=180) as resp:
            units = json.loads(resp.read().decode("utf-8")).get("units") or {}
        if len(units) < 100:
            log("⚠ 投射物資料內容異常，沿用舊的")
            return
    except Exception as e:
        log(f"⚠ 連不到投射物資料，沿用舊的：{e}")
        return
    out = load_json(PROJECTILES, {})
    num = lambda v, d=0: v if isinstance(v, (int, float)) else d
    for uid, u in units.items():
        entry = {}
        for key, short in (("normal", "n"), ("skill1", "s1"), ("skill2", "s2")):
            cfg = u.get(key) or {}
            m = _motion(cfg)
            if m == "NONE" or not cfg.get("animationPart"):
                continue
            st, ang, mo = cfg.get("start") or {}, cfg.get("angle") or {}, cfg.get("motion") or {}
            entry[short] = {
                "p": cfg.get("animationPart"), "m": m,
                "x": num(st.get("x")), "y": num(st.get("y")),
                "a0": num(ang.get("start")), "a1": num(ang.get("end"), num(ang.get("start"))),
                "v": num(cfg.get("moveSpeed")), "e": 1 if mo.get("enabled", True) else 0,
                "r": 1 if mo.get("rotation") == "ANGLE_LERP" else 0,
                "l": 1 if mo.get("loopNormal") else 0,
            }
            if key == "normal":
                entry["range"] = num(cfg.get("attackRange"))
        mv = num((u.get("movement") or {}).get("movingSpeed"))
        if mv:
            entry["speed"] = mv
        if entry:
            out[uid] = entry
    write_if_changed(PROJECTILES, json.dumps(out, ensure_ascii=False, separators=(",", ":")).encode())
    log(f"投射物資料：{len(out)} 隻角色")


def _num(v, default=0.0):
    """從「45.0%」「普通(2.5秒/下)」「快(130點/秒)」這類字串取出數字。"""
    if isinstance(v, (int, float)):
        return float(v)
    m = re.search(r"-?\d+(?:\.\d+)?", str(v or ""))
    return float(m.group()) if m else default


# 手動對應表（sync_overrides.json）：資料命名規則對不上的地方，改這個檔就好，不用改程式
OVERRIDES = load_json(ROOT / "sync_overrides.json", None)
if OVERRIDES is None:
    print("⚠️ 找不到 sync_overrides.json，召喚物系列對應會用不到（女僕兔兔、阿努比斯熊大系列會改用自己的召喚動畫）", flush=True)
    OVERRIDES = {}
# 召喚物動畫的固定對應：整個系列都召喚同一隻（不照名稱規則）
SUMMON_SERIES = {k: v for k, v in OVERRIDES.get("summon_series", {}).items() if not k.startswith("_")}


def summon_anim_id(uid: str) -> str:
    """召喚物動畫的 id：系列固定對應 → 自己的（u123usk-）→ 同系列基本型（u123sk-）。都找不到就回傳自己的。"""
    m = re.match(r"u(\d+)([a-z]?)-(.+)$", uid)
    if not m:
        return ""
    num, evo, name = m.groups()
    own = f"u{num}{'' if evo in ('', 'e') else evo}sk-{name}"
    cands = [SUMMON_SERIES.get(num), own, f"u{num}sk-{name}"]
    for c in cands:
        if c and ((UNITS / f"{c}.json.gz").exists() or (UNITS / f"{c}.json").exists()):
            return c
    return SUMMON_SERIES.get(num) or own


def _sec(du: dict, default=10.0):
    if du.get("seconds") is not None:
        return ["fix", du.get("seconds")]
    if du.get("kind") == "levelFormula":
        return ["mul", du.get("amount")]
    return None


def fetch_v2():
    """新版角色資料（英文欄位、效果代碼完整）。連不到回傳 None。"""
    try:
        with urllib.request.urlopen(RANGERS_V2_URL, timeout=300) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if len(data.get("rangers") or []) > 100:
            return data
        log("⚠ 新版角色資料內容異常，略過")
    except Exception as e:  # noqa: BLE001
        log(f"⚠ 讀不到新版角色資料，略過：{e}")
    return None


def _compact(d):
    """去掉值是 null 的鍵（保留其他所有欄位，包含不認識的）。"""
    return {k: v for k, v in d.items() if v is not None} if isinstance(d, dict) else d


def sync_skill_fx(data) -> None:
    """格鬥場用：每個技能的完整效果清單，原樣保留上游的效果代碼與欄位（不認識的也保留），
    讓網頁端自己決定支援哪些。這一步失敗只會跳過這個檔，不影響其他資料。
    格式：{角色: [技能1, 技能2], "_grade": {角色: [星數, 進化型態]}}，技能＝null 或 {"cd": 冷卻, "rate": 發動率, "trig": 觸發方式,
          "fx": [{"c": 效果代碼（去掉 SKILLEFF_）, "m": 數值物件, "d": 持續物件, "r": 範圍, 其他上游欄位…}]}"""
    if not data:
        return
    try:
        out = load_json(SKILL_FX, {})
        grade = out.get("_grade") if isinstance(out.get("_grade"), dict) else {}
        for r in data.get("rangers") or []:
            uid = r.get("rangerCode") or ""
            if not re.match(r"u(\d+)([a-z]?)-(.+)$", uid):
                continue
            skills = []
            for sk in (r.get("skillSet") or [])[:2]:
                if not isinstance(sk, dict):
                    skills.append(None)
                    continue
                fx = []
                for e in sk.get("effects") or []:
                    if not isinstance(e, dict):
                        continue
                    item = {"c": str(e.get("effectCode") or "").replace("SKILLEFF_", "")}
                    for k, v in e.items():
                        if k == "effectCode" or v is None:
                            continue
                        key = {"magnitude": "m", "duration": "d", "rangePoints": "r"}.get(k, k)
                        item[key] = _compact(v)
                    fx.append(item)
                skills.append(_compact({"cd": sk.get("cooldownSeconds"), "rate": sk.get("activationRate"),
                                        "trig": (sk.get("trigger") or {}).get("type"), "fx": fx}))
            while len(skills) < 2:
                skills.append(None)
            out[uid] = skills
            # 星數＋進化型態：效果的時間寫成「每級幾秒」時，要乘上這個組合的最大等級（網頁端對照表）
            if r.get("starGrade") is not None:
                grade[uid] = [r.get("starGrade"), r.get("evolution") or "NORMAL"]
        out["_grade"] = grade
        write_if_changed(SKILL_FX, json.dumps(out, ensure_ascii=False, separators=(",", ":")).encode())
        log(f"技能效果：{len(out) - 1} 隻角色")
    except Exception as e:  # noqa: BLE001
        log(f"⚠ 技能效果整理失敗，這次略過（其他資料不受影響）：{e}")


def fetch_summons(data=None) -> dict:
    """新版資料的技能細節。回傳 {(角色, 技能序): {"sums": [召喚物…], "cpy": 對手複製體, "ar": 技能範圍}}。
    sums：每一隻召喚物（id、等級公式、存在秒數），一個技能可以召喚好幾隻（例如亡者歸來 2 個棺木）。
    cpy：「將範圍內敵人召喚為我方夥伴」＝在我方出現對手的複製體（固定等級、秒數）。"""
    if data is None:
        data = fetch_v2()
    if not data:
        log("⚠ 沒有新版角色資料，召喚物先略過")
        return {}
    out = {}
    for r in data.get("rangers") or []:
        uid = r.get("rangerCode") or ""
        if not re.match(r"u(\d+)([a-z]?)-(.+)$", uid):
            continue
        for si, sk in enumerate(r.get("skillSet") or []):
            # 技能範圍（ar）：以觸發的敵人為中心、左右各 ar。優先看傷害類效果的範圍，沒有就取所有效果裡最大的
            effs = sk.get("effects") or []
            dmg_r = [_num(e.get("rangePoints")) for e in effs if re.search(r"DMG|DOT", str(e.get("effectCode") or "")) and _num(e.get("rangePoints")) > 0]
            all_r = [_num(e.get("rangePoints")) for e in effs if _num(e.get("rangePoints")) > 0]
            if dmg_r or all_r:
                out.setdefault((uid, si), {})["ar"] = max(dmg_r or all_r)
            for e in effs:
                code = e.get("effectCode")
                mg, du = e.get("magnitude") or {}, e.get("duration") or {}
                if code == "SKILLEFF_SUMMON":
                    lv = None
                    if mg.get("kind") == "gradeValue":
                        lv = ["fix", mg.get("value")]
                    elif mg.get("kind") == "levelFormula":
                        lv = ["mul" if mg.get("operator") == "MULTIPLY" else "add", mg.get("amount")]
                    out.setdefault((uid, si), {}).setdefault("sums", []).append({"id": summon_anim_id(uid), "lv": lv, "dur": _sec(du)})
                elif code == "SKILLEFF_SUMMON_ENEMY" and mg.get("kind") == "summonLevel":
                    out.setdefault((uid, si), {})["cpy"] = {"lv": mg.get("level"), "dur": _sec(du) or ["fix", 10]}
    return out


def sync_stats(rows, summons=None) -> None:
    """真實力對戰用的原始數值：等級成長、爆擊閃避、攻速移速、技能倍率。"""
    if not rows:
        return
    out = load_json(STATS, {})
    growth = {
        "hp": ("體力", "hpIncreaseAmount", "hpIncreaseAmountMax"),
        "pa": ("物理攻擊力", "attackIncreaseAmount", "attackIncreaseAmountMax"),
        "ma": ("魔法攻擊力", "specialAttackDelta", "specialAttackDeltaMax"),
        "pd": ("物理防禦力", "generalDefenceDelta", "generalDefenceDeltaMax"),
        "md": ("魔法防禦力", "specialDefenceDelta", "specialDefenceDeltaMax"),
    }
    for r in rows:
        uid = r.get("ranger_id")
        if not uid:
            continue
        st = {"s": str(r.get("Ranger星數") or "")}
        for key, (base, g, gm) in growth.items():
            b, n = _num(r.get(base)), _num(r.get(g))
            st[key] = [b, n, _num(r.get(gm), n) if r.get(gm) is not None else n]
        st.update({
            "cr": _num(r.get("爆擊機率")), "cd": _num(r.get("爆擊傷害"), 100),
            "hit": _num(r.get("命中率")), "dg": _num(r.get("閃避機率")),
            "sh": _num(r.get("技能命中率")), "sdg": _num(r.get("技能閃避機率")),
            "ai": _num(r.get("攻擊速度"), 2.5), "mv": _num(r.get("移動速度"), 100),
            "rg": _num(r.get("攻擊範圍"), 100), "sr": _num(r.get("技能抗性")),
        })
        skills = []
        for slot in ("技能1", "技能2"):
            sk = r.get(slot)
            if not isinstance(sk, dict) or not sk.get("技能名稱"):
                skills.append(None)
                continue
            effects = []
            for e in sk.get("技能組") or []:
                kind = str(e.get("效果") or "")
                coef = str(e.get("係數") or "")
                # 傷害：名稱有「傷害」且有倍率；或係數是「攻擊力 × N%」（擊退、擊暈等也會打傷害）
                is_dmg = ("傷害" in kind and "*" in coef) or coef.startswith("攻擊力*")
                if not is_dmg or "恢復" in kind:
                    continue
                effects.append({
                    "t": "dot" if ("持續" in kind and "傷害" in kind) else "hit",
                    "c": _num(coef.split("*", 1)[1]) / 100,
                    "b": "hp" if coef.startswith("體力") else "atk",
                    "d": _num(e.get("有效時間")),
                })
            entry = {"r": _num(sk.get("發動機率")), "cd": _num(sk.get("技能冷卻時間")), "e": effects}
            si = len(skills)
            info = (summons or {}).get((uid, si)) or {}
            sums = info.get("sums") or []
            if sums and any("召喚" in str(e.get("效果") or "") for e in sk.get("技能組") or []):
                sec = next((_num(e.get("有效時間")) for e in sk.get("技能組") or [] if "召喚" in str(e.get("效果") or "")), 10)
                for sm in sums:
                    if not sm.get("dur"):
                        sm["dur"] = ["fix", sec or 10]
                entry["sum"] = sums[0]  # 舊版網頁相容
                if len(sums) > 1:
                    entry["sums"] = sums
            if info.get("cpy"):
                entry["cpy"] = info["cpy"]
            if info.get("ar"):
                entry["ar"] = info["ar"]
            skills.append(entry)
        st["sk"] = skills
        out[uid] = st
    write_if_changed(STATS, json.dumps(out, ensure_ascii=False, separators=(",", ":")).encode())
    log(f"原始數值：{len(out)} 隻角色")


# ---------- 格鬥場：攻擊實際伸到多遠（v7.4） ----------
# 每隻角色的普攻、技能 1、技能 2 動作，從身體中心往前「看得到的部分」最遠伸到哪裡（場地單位，身高＝170）。
# 只算不透明的像素（半透明的光暈、淡淡的特效不算），而且只算跟身體連在一起的部件（飛出去的金幣、粒子不算）。
# 網站格鬥場用它決定判定距離（js-18-fight-data.js fightStats）；沒有這個檔或沒有這隻角色時，網站會在開打時自己量（較粗略）。
# 需要 Pillow；沒有就跳過（網站照樣能用）。結果依動畫檔內容的雜湊快取，只有角色資料變了才重算。
FIGHT_REACH = DATA / "fight_reach.json"
REACH_VER = 3  # v7.5：加上身體衝刺（d）與投射物大小（p）
REACH_CLIPS = {
    "a": ["attack_all", "attack", "attack_a", "attack_b"],
    "s1": ["s_attack_all", "s_action_attack_all", "s_attack", "s_attack_a", "s_attack_b", "s_action_attack_2", "s_action_attack_3"],
    "s2": ["s2_attack_all", "s2_attack", "s2_attack_a", "s2_attack_b", "skill"],
}
IDLE_CLIPS = ["idle", "wait", "attack_all", "attack", "attack_a", "attack_b"]


def _items(part, frame):
    for it in frame or []:
        try:
            d = part["images"][it[1]]
        except (IndexError, TypeError):
            continue
        om, col = it[2], it[3] if len(it) > 3 else [255, 255, 255, 255]
        a = (col[3] if isinstance(col, list) and len(col) > 3 else 255) / 255
        sp = part["sprites"].get(d["name"])
        if a < 0.3 or not sp or not sp.get("rect") or not sp["rect"][2]:
            continue
        m00, m01, m10, m11, m02, m12 = om
        i00, i01, i10, i11, i02, i12 = d["m"]
        yield d["name"], sp, (m00 * i00 + m01 * i10, m00 * i01 + m01 * i11, m00 * i02 + m01 * i12 + m02,
                              m10 * i00 + m11 * i10, m10 * i01 + m11 * i11, m10 * i02 + m11 * i12 + m12)


def _box(T, x0, y0, x1, y1):
    A, B, C, D, E, F = T
    pts = [(A * x + B * y + C, D * x + E * y + F) for x, y in ((x0, y0), (x1, y0), (x0, y1), (x1, y1))]
    return [min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts)]


def _cluster(part, fr, tol=12):
    """一格的身體主體：從最大的部件開始，外框相距 tol 以內的才併進來（跟網站 js-13 fCluster 一樣）。沒有部件＝None。"""
    bx = [_box(T, 0, 0, sp["rect"][2], sp["rect"][3]) for _, sp, T in _items(part, fr)]
    if not bx:
        return None
    bx.sort(key=lambda b: -(b[2] - b[0]) * (b[3] - b[1]))
    c, rest, grew = list(bx[0]), bx[1:], True
    while grew:
        grew, keep = False, []
        for b in rest:
            if b[0] <= c[2] + tol and b[2] >= c[0] - tol and b[1] <= c[3] + tol and b[3] >= c[1] - tol:
                c = [min(c[0], b[0]), min(c[1], b[1]), max(c[2], b[2]), max(c[3], b[3])]
                grew = True
            else:
                keep.append(b)
        rest = keep
    return c


def _opaque_cluster(part, fr, atlas, cache, tol=12):
    """跟 _cluster 一樣，但只算不透明像素（光暈、透明邊不算）。"""
    bx = []
    for name, sp, T in _items(part, fr):
        bb = _opaque(atlas, sp, cache, name)
        if bb:
            bx.append(_box(T, *bb))
    if not bx:
        return None
    bx.sort(key=lambda b: -(b[2] - b[0]) * (b[3] - b[1]))
    c, rest, grew = list(bx[0]), bx[1:], True
    while grew:
        grew, keep = False, []
        for b in rest:
            if b[0] <= c[2] + tol and b[2] >= c[0] - tol and b[1] <= c[3] + tol and b[3] >= c[1] - tol:
                c = [min(c[0], b[0]), min(c[1], b[1]), max(c[2], b[2]), max(c[3], b[3])]
                grew = True
            else:
                keep.append(b)
        rest = keep
    return c


def _body_bounds(part, anim, tol=12):
    """跟網站 js-13 fBounds 一樣：每格的身體主體（_cluster）聯集。"""
    out = None
    for fr in part["animations"][anim]["frames"]:
        c = _cluster(part, fr, tol)
        if c:
            out = c if out is None else [min(out[0], c[0]), min(out[1], c[1]), max(out[2], c[2]), max(out[3], c[3])]
    return out


def _opaque(atlas, sp, cache, name):
    """部件圖裡不透明（alpha ≥ 128）的範圍，部件自己的座標。"""
    if name in cache:
        return cache[name]
    x, y, w, h = sp["rect"]
    try:
        im = atlas.crop((x, y, x + h, y + w)).rotate(90, expand=True) if sp.get("rotated") else atlas.crop((x, y, x + w, y + h))
        bb = im.getchannel("A").point(lambda v: 255 if v >= 128 else 0).getbbox()
    except Exception:
        bb = (0, 0, w, h)
    cache[name] = bb
    return bb


def _reach(part, anim, atlas, cache, cx, y0, y1, bw):
    """回傳 (伸多遠, 身體衝多遠)，都從原位的身體中心算、原始座標。
    v7.5 身體衝刺：某一格的身體主體中心往前離開原位超過一個身高（例如始皇帝、樞木朱雀衝過去踢），就改從衝出去的身體往前量。"""
    h = y1 - y0
    tol, best, dash = h * 0.15, 0.0, 0.0
    for fr in part["animations"][anim]["frames"]:
        c = _cluster(part, fr)
        mc = (c[0] + c[2]) / 2 if c else cx
        # 衝出去的要「像身體」：高度 0.6～1.6 個身高、寬度不超過 3 倍（避免把召喚出來的大型生物、大特效當成身體）；
        # 衝超過 8 個身高的不算（那是瞬移到畫面外、不是攻擊）
        like = c and h * 0.6 <= c[3] - c[1] <= h * 1.6 and c[2] - c[0] <= bw * 3
        moved = bool(like) and h * 1.0 < mc - cx <= h * 8
        if moved:
            dash = max(dash, mc - cx)
        iv = []
        for name, sp, T in _items(part, fr):
            bb = _opaque(atlas, sp, cache, name)
            if not bb:
                continue
            b = _box(T, *bb)
            if b[3] < y0 - h * 0.5 or b[1] > y1 + h * 0.2:
                continue
            iv.append((b[0], b[2]))
        iv.sort()
        cur = mc if moved else cx
        for a, b in iv:
            if a <= cur + tol:
                cur = max(cur, b)
        best = max(best, cur - cx)
    return best, dash


def _proj_box(part, atlas, k):
    """會飛的投射物圖（normal 動畫）不透明部分的範圍 [左, 右, 下, 上]（以投射物位置為 0、往前／往上為正，場地單位）。"""
    anims = part.get("animations") or {}
    n = next((x for x in ["normal", "idle", "wait", "shot", "fire", "attack"] if x in anims and anims[x].get("frames")), None)
    if not n:
        return None
    cache, b0 = {}, None
    for fr in anims[n]["frames"]:
        for name, sp, T in _items(part, fr):
            bb = _opaque(atlas, sp, cache, name)
            if not bb:
                continue
            b = _box(T, *bb)
            b0 = b if b0 is None else [min(b0[0], b[0]), min(b0[1], b[1]), max(b0[2], b[2]), max(b0[3], b[3])]
    return None if b0 is None else [round(b0[0] * k), round(b0[2] * k), round(-b0[3] * k), round(-b0[1] * k)]


EFFECT_CLIPS = ["finish", "hit", "end", "normal", "idle"]


def _effect_extent(part, atlas, k):
    """技能特效圖（投射物部件 bul2／bul3）不透明部分的左右範圍（以特效圖原點為 0，場地單位，用角色本體的縮放）。"""
    anims = part.get("animations") or {}
    n = next((x for x in EFFECT_CLIPS if x in anims and anims[x].get("frames")), None)
    if not n:
        return None
    cache, x0, x1 = {}, None, None
    for fr in anims[n]["frames"]:
        for name, sp, T in _items(part, fr):
            bb = _opaque(atlas, sp, cache, name)
            if not bb:
                continue
            b = _box(T, *bb)
            x0 = b[0] if x0 is None else min(x0, b[0])
            x1 = b[2] if x1 is None else max(x1, b[2])
    return None if x0 is None else [round(x0 * k), round(x1 * k)]


def fight_reach_of(meta, png_path, proj=None):
    """一隻角色 → {"a": 普攻, "s": [技能 1, 技能 2], "e": [技能 1 特效範圍, 技能 2 特效範圍], "d": [普攻, 技能 1, 技能 2 身體衝多遠], "p": [普攻, 技能 1, 技能 2 投射物大小]}
    d：身體衝刺距離（沒有衝＝0）。p：會飛的投射物（n／s1／s2）圖的範圍 [左, 右, 下, 上]，不會飛或沒有圖＝null。
    a、s：動作從身體中心往前伸到多遠（場地單位；沒有那個動作＝null）。
    e：不會飛的技能投射物（projectiles.json 的 s1／s2，v＝0 或 e＝0）的特效圖範圍 [左, 右]；沒有特效圖＝null（效果畫在角色動作裡）。"""
    from PIL import Image
    part = (meta.get("parts") or {}).get("body")
    if not part:
        return None
    anims = part.get("animations") or {}
    has = lambda n: n in anims and anims[n].get("frames")
    idle = next((n for n in IDLE_CLIPS if has(n)), None)
    if not idle:
        return None
    lb = _body_bounds(part, idle)
    if not lb or lb[3] - lb[1] <= 0:
        return None
    atlas = Image.open(png_path).convert("RGBA")
    bh = lb[3] - lb[1]
    # v7.5：待機時身體很扁（寬 > 高 × 1.3，例如利姆路的史萊姆型態）→ 身高改用攻擊動作的身體高度（比較高的話）；網站 js-11 同一套
    flat_h = None
    if lb[2] - lb[0] > bh * 1.3:
        an = next((x for x in REACH_CLIPS["a"] if has(x)), None)
        hs = sorted(c[3] - c[1] for fr in (anims[an]["frames"] if an else []) for c in [_opaque_cluster(part, fr, atlas, {})] if c)
        if hs and hs[len(hs) // 2] > bh:
            bh = flat_h = hs[len(hs) // 2]  # 攻擊動作身體高度的中位數（只算不透明像素）
    k, cx, cache = 170 / bh, (lb[0] + lb[2]) / 2, {}
    dash = {}
    def one(key):
        n = next((x for x in REACH_CLIPS[key] if has(x)), None)
        if not n:
            dash[key] = 0
            return None
        r, d = _reach(part, n, atlas, cache, cx, lb[1], lb[3], lb[2] - lb[0])
        dash[key] = round(d * k)
        return round(r * k)
    eff = []
    for key in ("s1", "s2"):
        cfg = (proj or {}).get(key)
        moving = cfg and (cfg.get("v") or 0) > 0 and cfg.get("e")
        bp = (meta.get("parts") or {}).get(cfg.get("p")) if cfg and not moving else None
        r = None
        if bp and bp.get("png"):
            bpng = Path(png_path).parent.parent.parent / bp["png"]
            try:
                r = _effect_extent(bp, Image.open(bpng).convert("RGBA"), k) if bpng.exists() else None
            except Exception:
                r = None
        eff.append(r)
    pbox = []
    for key in ("n", "s1", "s2"):
        cfg = (proj or {}).get(key)
        moving = cfg and (cfg.get("v") or 0) > 0 and cfg.get("e")
        bp = (meta.get("parts") or {}).get(cfg.get("p")) if moving else None
        r = None
        if bp and bp.get("png"):
            bpng = Path(png_path).parent.parent.parent / bp["png"]
            try:
                r = _proj_box(bp, Image.open(bpng).convert("RGBA"), k) if bpng.exists() else None
            except Exception:
                r = None
        pbox.append(r)
    a, s1, s2 = one("a"), one("s1"), one("s2")
    out = {"a": a, "s": [s1, s2], "e": eff, "d": [dash["a"], dash["s1"], dash["s2"]], "p": pbox}
    if flat_h:
        out["bh"] = round(flat_h, 1)  # 身高（原始座標）：待機太扁時改用的身高，網站畫角色時用（js-11）
    return out


def sync_fight_reach() -> None:
    try:
        import PIL  # noqa: F401
    except ImportError:
        log("格鬥場判定距離：沒有 Pillow，跳過")
        return
    import hashlib
    old = load_json(FIGHT_REACH, {})
    if old.get("_v") != REACH_VER:
        old = {"_v": REACH_VER}
    out, done = {"_v": REACH_VER}, 0
    projs = load_json(PROJECTILES, {})
    for f in sorted(UNITS.glob("*.json.gz")):
        uid = f.name[:-len(".json.gz")]
        raw = f.read_bytes()
        pj = projs.get(uid) or {}
        hs = hashlib.sha1(raw + json.dumps([pj.get("n"), pj.get("s1"), pj.get("s2")], sort_keys=True).encode()).hexdigest()[:10]
        if uid in old and old[uid].get("h") == hs:
            out[uid] = old[uid]
            continue
        try:
            meta = fix_meta_rects(json.loads(gzip.decompress(raw)))
            part = (meta.get("parts") or {}).get("body")
            png = DATA / part["png"] if part else None
            r = fight_reach_of(meta, png, pj) if png and png.exists() else None
        except Exception as e:  # 一隻壞掉不影響其他
            log(f"  {uid} 判定距離失敗：{e}")
            r = None
        if r:
            r["h"] = hs
            out[uid] = r
            done += 1
    if write_if_changed(FIGHT_REACH, json.dumps(out, ensure_ascii=False, separators=(",", ":")).encode("utf-8")):
        log(f"格鬥場判定距離：更新 {done} 隻，共 {len(out) - 1} 隻")


def main() -> int:
    DATA.mkdir(exist_ok=True)
    state = load_json(STATE, {})
    before = state.get("res_commit")
    state = sync_resources(state)
    rows = fetch_rangers_data()
    sync_names(rows)
    sync_skills(rows)
    v2 = fetch_v2()
    sync_stats(rows, fetch_summons(v2))
    sync_skill_fx(v2)
    sync_projectiles()
    sync_fight_reach()
    if state.get("res_commit") != before or not STATE.exists():
        state["synced_at"] = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        STATE.write_text(json.dumps(state, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
