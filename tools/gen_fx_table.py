#!/usr/bin/env python3
"""格鬥場效果設定：tools/fight_effects_decisions.json（決定表匯出）→ src/js-18-fight-data-fx.js（網站讀的 FX_TABLE）。

用法：python tools/gen_fx_table.py      （改完決定表匯出檔後執行，再 python build.py）

決定表裡選「需要新做法」的效果，依下面的 NEW_MAP 對到已經寫好的處理方式（js-18-fight-effects.js 的 FX_BEHAVIOR）；
NEW_MAP 沒有的會維持「待做」（格鬥場暫時不處理，相容性報告會列出來）。
沒填數字的處理方式用 DEFAULT_PARAMS。
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "tools" / "fight_effects_decisions.json"
OUT = ROOT / "src" / "js-18-fight-data-fx.js"

# 「需要新做法」→ 處理方式（依決定表的「想要的新做法」）
NEW_MAP = {
    # 受到的技能／普攻傷害增減（同一種狀態合併，不疊加）
    "BUFF-SKILL_AVOID_CHANCE": "skTaken", "BUFF-SKILL_RESIST": "skTaken",
    "DEBUFF-SKILL_AVOID_CHANCE": "skTaken", "DEBUFF-SKILL_RESIST": "skTaken",
    "BUFF-AVOID_CHANCE": "atkTaken", "BUFF-NORMAL_DEF": "atkTaken", "BUFF-SPECIAL_DEF": "atkTaken",
    "DEBUFF-AVOID_CHANCE": "atkTaken", "DEBUFF-NORMAL_DEF": "atkTaken", "DEBUFF-SPECIAL_DEF": "atkTaken",
    # 判定框上下左右一起變大／變小
    "BUFF-ANTI_AVOID_PROB": "atkBox", "BUFF-CHANGE_SPLASH": "atkBox", "BUFF-ATKRANGE": "atkBox",
    "DEBUFF-ANTI_AVOID_PROB": "atkBox", "DEBUFF-ATKRANGE": "atkBox",
    "BUFF-ANTI_SK_AVOID_PROB": "skBox", "BUFF-SKILLRANGE": "skBox",
    "DEBUFF-ANTI_SK_AVOID_PROB": "skBox", "DEBUFF-SKILLRANGE": "skBox",
    # 冷卻
    "BUFF-SKILL_CHANCE": "skCd", "DEBUFF-SKILL_CHANCE": "skCd",
    "BUFF-ATKSPD": "atkCd", "DEBUFF-ATKSPD": "atkCd",
    "SKILL_RESET": "cdReset",
    # 清除（立刻清掉）與持續清除（一段時間內不能再中）
    "CLEAN_ENEMY": "cleanBuff", "CLEANING_ENEMY": "blockBuff",
    "CLEAN_DOTHEAL": "cleanRegen", "CLEANING_DOTHEAL": "blockRegen",
    "CLEAN_ALLY": "cleanDebuff", "CLEANING_DEBUFF": "blockDebuff",
    "CLEAN_POISON": "cleanDot", "CLEANING_POISON": "blockDot",
    # 吸血、反射
    "BUFF-VAMPIRE": "vamp", "MIRROR_PHY": "mirror", "MIRROR_MAG": "mirror",
    # v5.3 第 2 部分：位移、控制、外觀、詛咒、複製體
    "MOVE_ATTACK": "dash", "THROW_ALLY": "dash",          # 突進（按住拖曳選位置，到了再判定）
    "MOVE_ENEMY1": "pull", "MOVE_ENEMY2": "pull",          # 把對手拉到自己面前
    "CHANGE_ENEMY": "swap",                                # 打中就交換位置
    "TEMPT": "charm", "FEAR": "fear", "POLYMORPH": "poly", "BUBBLE": "bubble", "SCALE": "scale",
    "CURSE_DEBUFF": "curse",                               # 隨機一個負面效果（含暈眩）
    "SUMMON_ENEMY": "copy", "CLEANING_SUMMON": "noCopy",   # 對手複製體／打掉對手召喚物並在一段時間內不會被複製、對手叫不出召喚物
    "SUMMON": "summon",                                    # v5.3.1：召喚物（自動走向對手、用自己的普攻打、會被打）
}
# 處理方式的預設參數：持續秒數上下限、數值倍率（資料 % × k）、數值上下限（%）
DEFAULT_PARAMS = {
    "skTaken": (1, 5, 0.5, 10, 30), "atkTaken": (1, 5, 0.5, 10, 30), "atkBox": (1, 5, 0.5, 10, 30), "skBox": (1, 5, 0.5, 10, 30),
    "skCd": (1, 5, 0.5, 10, 30), "atkCd": (1, 5, 0.5, 10, 30),
    "blockBuff": (1, 5, None, None, None), "blockRegen": (1, 5, None, None, None), "blockDebuff": (1, 5, None, None, None), "blockDot": (1, 5, None, None, None),
    "vamp": (1, 5, None, 25, 25), "mirror": (1, 3, None, 20, 30),
    "charm": (3, 3, None, None, None), "fear": (0.5, 1.5, None, None, None), "poly": (0.5, 1.5, None, None, None), "bubble": (0.5, 1.5, None, None, None),
    "scale": (1, 5, None, 30, 30), "noCopy": (1, 5, None, None, None), "curse": (0.5, 5, None, None, None), "summon": (4, 8, None, None, None),
    "atk": (1, 5, 0.5, 10, 30), "spd": (1, 5, 0.5, 10, 30), "heal": (None, None, None, 10, 15), "regen": (1, 4, None, 20, 20),
    "shield": (1, 3, None, 15, 15), "dot": (1, 4, None, None, None), "stun": (0.5, 1.5, None, None, None), "silence": (1, 3, None, None, None),
}


def main():
    src = json.loads(SRC.read_text(encoding="utf-8"))
    table = {}
    for code, d in sorted(src["decisions"].items()):
        b = d.get("b") or "none"
        if b == "new":
            b = NEW_MAP.get(code, "new")
        dp = DEFAULT_PARAMS.get(b, (None,) * 5)
        pick = lambda key, i: d.get(key) if d.get(key) is not None and d.get("b") != "new" else dp[i]
        row = {"b": b, "to": "enemy" if d.get("to") == "敵" else "self", "name": d.get("name") or code}
        dmin, dmax, k, vmin, vmax = pick("dmin", 0), pick("dmax", 1), pick("k", 2), pick("vmin", 3), pick("vmax", 4)
        if dmin is not None or dmax is not None:
            row["dur"] = [dmin if dmin is not None else 0, dmax if dmax is not None else (dmin or 0)]
        if k is not None:
            row["k"] = k
        if vmin is not None or vmax is not None:
            row["val"] = [vmin if vmin is not None else vmax, vmax if vmax is not None else vmin]
        row["lv"] = d.get("lv") or "auto"
        if d.get("idea"):
            row["idea"] = d["idea"].strip()
        if d.get("memo"):
            row["memo"] = d["memo"].strip()
        table[code] = row
    body = "{\n" + ",\n".join(f"    {json.dumps(c)}: {json.dumps(r, ensure_ascii=False)}" for c, r in table.items()) + ",\n  }"
    lv = json.dumps(src.get("maxlevel") or {}, ensure_ascii=False)
    OUT.write_text(
        "  /* ---------- 格鬥場：效果設定（自動產生，不要手改） ----------\n"
        "     來源：tools/fight_effects_decisions.json（格鬥場效果決定表的匯出），產生：python tools/gen_fx_table.py\n"
        "     FX_TABLE：效果代碼 → { b 處理方式, to 對象（enemy／self）, name, dur [秒數下限, 上限], k 數值倍率, val [數值下限, 上限]（%）, lv 時間乘等級 }\n"
        "     FX_MAXLEVEL：「星數|進化型態」→ 最大等級（資料寫「每級幾秒」的效果要乘上它） */\n"
        f"  const FX_TABLE = {body};\n"
        f"  const FX_MAXLEVEL = {lv};\n",
        encoding="utf-8")
    print(f"{OUT.relative_to(ROOT)}：{len(table)} 種效果")


if __name__ == "__main__":
    main()
