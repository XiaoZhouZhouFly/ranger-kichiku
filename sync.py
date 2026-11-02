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
            "sprites": {n: {"rect": s["rect"], "rotated": bool(s.get("rotated"))}
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


# 召喚物動畫的固定對應：整個系列都召喚同一隻（不照名稱規則）
SUMMON_SERIES = {"1501": "u1501sk-cony", "1502": "u1501sk-cony", "1241": "u1241sk-brown", "1242": "u1241sk-brown"}


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


def fetch_summons() -> dict:
    """新版資料的技能細節。回傳 {(角色, 技能序): {"sums": [召喚物…], "cpy": 對手複製體, "ar": 技能範圍}}。
    sums：每一隻召喚物（id、等級公式、存在秒數），一個技能可以召喚好幾隻（例如亡者歸來 2 個棺木）。
    cpy：「將範圍內敵人召喚為我方夥伴」＝在我方出現對手的複製體（固定等級、秒數）。"""
    try:
        with urllib.request.urlopen(RANGERS_V2_URL, timeout=300) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:  # noqa: BLE001
        log(f"⚠ 讀不到新版角色資料，召喚物先略過：{e}")
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


def main() -> int:
    DATA.mkdir(exist_ok=True)
    state = load_json(STATE, {})
    before = state.get("res_commit")
    state = sync_resources(state)
    rows = fetch_rangers_data()
    sync_names(rows)
    sync_skills(rows)
    sync_stats(rows, fetch_summons())
    sync_projectiles()
    if state.get("res_commit") != before or not STATE.exists():
        state["synced_at"] = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        STATE.write_text(json.dumps(state, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
