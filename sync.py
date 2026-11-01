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

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
UNITS = DATA / "units"
RES = DATA / "res"
STATE = DATA / "sync_state.json"
UNIT_LIST = DATA / "units.json"

META_RE = re.compile(r"^animation_meta/(u[^/]+)\.json$")
PNG_RE = re.compile(r"^(u[^/]+)/\1-(body|bul\d?)\.png$")
THUMB_RE = re.compile(r"^(u[^/]+)/\1-thum(-140)?\.png$")


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
    if old == head and any(UNITS.glob("*.json.gz")):
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
        wanted = lambda f: META_RE.match(f) or PNG_RE.match(f) or THUMB_RE.match(f)

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
        # 本地缺的縮圖也補上
        changed_set = set(changed)
        changed += [f for f in all_files if THUMB_RE.match(f) and not (RES / f).exists() and f not in changed_set]

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


FULL_PATTERNS = ["/animation_meta/u*.json", "/u*/*-body.png", "/u*/*-bul*.png", "/u*/*-thum*.png"]


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
def sync_names() -> None:
    names = {r["id"]: r for r in load_json(UNIT_LIST, [])} if UNIT_LIST.exists() else {}
    try:
        with urllib.request.urlopen(INDEX_URL, timeout=60) as resp:
            index = json.loads(resp.read().decode("utf-8"))
        if isinstance(index, list) and len(index) > 100:
            for r in index:
                if isinstance(r, dict) and r.get("id"):
                    names[r["id"]] = {k: r.get(k, "") for k in ("id", "name", "star", "type", "element")}
            log(f"角色名稱表：{len(index)} 筆")
        else:
            log("⚠ 名稱表內容異常，沿用舊的")
    except Exception as e:
        log(f"⚠ 連不到名稱表，沿用舊的：{e}")

    out = []
    for p in sorted(UNITS.glob("*.json.gz")):
        uid = p.name[:-len(".json.gz")]
        r = names.get(uid, {"id": uid, "name": "", "star": "", "type": "", "element": ""})
        out.append({k: r.get(k, "") for k in ("id", "name", "star", "type", "element")})
    write_if_changed(UNIT_LIST, json.dumps(out, ensure_ascii=False, separators=(",", ":")).encode())
    log(f"可用角色：{len(out)} 隻（有中文名稱 {sum(1 for r in out if r['name'])} 隻）")


def main() -> int:
    DATA.mkdir(exist_ok=True)
    state = load_json(STATE, {})
    before = state.get("res_commit")
    state = sync_resources(state)
    sync_names()
    if state.get("res_commit") != before or not STATE.exists():
        state["synced_at"] = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        STATE.write_text(json.dumps(state, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
