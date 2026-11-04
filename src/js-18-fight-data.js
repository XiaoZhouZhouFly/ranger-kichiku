  /* ---------- 格鬥場（v5.0 測試版）：固定數值、角色資料換算 ----------
     調平衡只要改這個檔：FT（全體共用的規則數值）、FIGHT_PRESET（自製角色手寫數值）、fightStats（官方角色換算）。
     規則本身在 js-18-fight-engine.js，畫面與觸控在 js-19。時間單位一律是秒，畫面上的「格」＝ 1/60 秒。
     座標：x 往右為正、場地中央為 0；y 往上為正、地面為 0；長度單位是「場地單位」（角色身高 CH＝170）。 */
  const FT = {
    // 基本
    STEP: 1 / 60, AW: 760, CH: 170,                  // 每步秒數、場地寬、角色身高
    HURT_W: 60,                                       // 受傷框寬度（跟圖片大小無關，所有角色一樣，置中在腳底）
    HP_MIN: 850, HP_MAX: 1200, DR_MAX: 0.2,           // 體力、減傷的範圍（官方角色依資料排名換算）
    // 移動
    GRAV: 1700, JUMP_V: 800, AIR_CTRL: 0.85,          // 重力、起跳速度（約 188 高、滯空約 0.94 秒）、空中左右移動的比例
    // 出招
    ACTIVE: 4 / 60,                                   // 近戰普攻的有效判定持續時間（4 格）
    BUFFER: 0.15,                                     // 輸入緩衝：出招中、冷卻中提早按下，0.15 秒內會自動接上
    AIM_MIN: 60,                                      // 矩形、拋物線的最近距離（從身體前緣算）
    TELE_MIN: 0.3, TELE_MAX: 0.8, TELE_SYNC_MIN: 0.2, // 矩形預告：依距離＝近～遠；跟前搖同步時最短 0.2 秒
    AIR_SAFE: 40,                                     // 離地超過這個高度，矩形與拋物線爆炸就打不到
    LOB_TIME: 0.8, LOB_R: 60,                         // 拋物線飛行時間、落地爆炸半徑
    // 被打中
    STUN_ATK: 0.3, STUN_SK: 0.5,                      // 硬直秒數（普攻／技能）
    PUSH_ATK: 160, PUSH_SK: 420, PUSH_DOWN: 820,      // 往後推的初速（普攻／技能／倒地）
    COMBO_RESET: 0.5,                                 // 恢復操作後多久沒挨打，連段就算結束
    COMBO_SCALE: [1, 0.9, 0.8, 0.7, 0.6],             // 連段傷害遞減：第 1、2、3、4、5 下以後
    SV_ATK: 25, SV_SK1: 40, SV_SK2: 60, SV_MAX: 100,  // 硬直累積值：每下加多少、滿多少倒地
    SV_DECAY_WAIT: 0.5, SV_DECAY: 30,                 // 多久沒挨打開始下降、每秒降多少
    DOWN_TIME: 0.6, WAKE_INV: 1.0,                    // 倒地躺多久、起身無敵多久
    // 防禦
    GAUGE_MAX: 100, GAUGE_HOLD: 20, GAUGE_HIT: 0.35,  // 防禦條：滿格、按住每秒扣、擋下扣原本傷害的幾成
    GAUGE_WAIT: 0.5, GAUGE_REGEN: 25,                 // 放開後多久開始回、每秒回多少
    GAUGE_REARM: 30,                                  // 破防後防禦條要回到這麼多才能再防（不然一直按著會連續破防）
    BLOCK_STUN: 0.15, GUARD_PUSH: 140, BREAK_STUN: 1.0, // 擋下時的防禦硬直、滑行初速、破防硬直
    // 其他
    BUFF_TIME: 5, BUFF_MUL: 1.3, HEAL: 120,           // 輔助技能：加攻擊秒數與倍率、回血
    DUMMY_REFILL: 2,                                  // 木樁多久沒挨打就回滿血
  };
  const fclamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const toFrames = (sec) => Math.round(sec * 60);

  /* 招式的操作方式：dist＝按住拖曳決定位置（矩形、拋物線），dir＝只決定方向、點一下就放（直線、普攻投射物），
     tap＝按下就放（近戰普攻、輔助技能） */
  const AIM_MODE = { rect: "dist", lob: "dist", line: "dir", shot: "dir", melee: "tap", buff: "tap" };
  const SK_KIND_LABEL = { rect: "矩形瞄準", line: "直線投射物", lob: "拋物線", buff: "輔助（加攻＋回血）" };

  /* 自製角色的手寫數值（官方角色由 fightStats 從資料換算）；沒寫的欄位用換算值 */
  const FIGHT_PRESET = {
    "x001-cube": { hp: 1150, dr: 0.15, walk: 270, atk: { kind: "melee", reach: 110, dmg: 60, cd: 0.45 },
      sk: [{ kind: "rect", range: 240, width: 170, cd: 5 }, { kind: "rect", range: 620, width: 200, cd: 10 }] },
    "x002-orb": { hp: 880, dr: 0.02, walk: 200, atk: { kind: "shot", dmg: 50, cd: 0.55 },
      sk: [{ kind: "line", speed: 600, cd: 6 }, { kind: "lob", range: 480, cd: 10 }] },
  };
  // 測試用角色：涵蓋長短手、各種投射物與輔助技能
  const FIGHT_ROSTER = [
    ["x001-cube", "自製・近戰＋兩招矩形（近、遠）"],
    ["x002-orb", "自製・遠程＋直線投射物＋拋物線"],
    ["u1001u-brown", "近戰短手＋矩形技能"],
    ["u434u-edward", "長手＋普攻投射物＋矩形技能"],
    ["u1164h-moon", "中距離＋直線投射物技能（冰球）"],
    ["u1015h-sally", "拋物線＋直線投射物技能"],
    ["u013e-moon", "近戰＋輔助技能"],
  ];

  /* 體力、減傷依「在全部角色裡的排名」換算（折衷：有差異但不極端）。排名表第一次用到時算一次。 */
  let fightRankCache = null;
  function fightRanks() {
    if (fightRankCache && fightRankCache.src === S.stats) return fightRankCache;
    const base = (v) => (Array.isArray(v) ? +v[0] : +v) || 0;
    const hp = [], def = [];
    for (const id in S.stats) {
      const st = S.stats[id]; if (!st) continue;
      const h = base(st.hp); if (h > 1) { hp.push(h); def.push(base(st.pd) + base(st.md)); }
    }
    hp.sort((a, b) => a - b); def.sort((a, b) => a - b);
    // 這個值在排序陣列裡的百分位（0～1）
    const pct = (arr, v) => { if (!arr.length) return 0.5; let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; } return lo / arr.length; };
    fightRankCache = { src: S.stats, hp: (v) => pct(hp, base(v)), def: (pd, md) => pct(def, base(pd) + base(md)) };
    return fightRankCache;
  }

  /* 角色 → 格鬥場數值
     回傳 { hp, dr（減傷）, bw（身體寬，用在推擠）, walk, atk, sk: [技能1, 技能2] }
     每招：{ kind, clip, dur（動作長度）, hitAt（前搖＝出招到判定的時間）, dmg, cd, range, … }
     前搖：資料裡有準備動作（*_ready）就依它算，沒有就取動作長度的 50%（見 hitFrac）。 */
  function fightStats(f) {
    const id = f.r.id, st = S.stats[id] || {}, pj = f.proj || {}, pre = FIGHT_PRESET[id] || {}, rk = fightRanks();
    const rg = +st.rg || 150, mv = +st.mv || 90, ai = +st.ai || 1.2;
    const fly = (c) => (c && (c.m === "LINEAR" || c.m === "CURVE") && c.v > 0 && c.e ? c.m : null);
    const dur = (clip, lo, hi) => fclamp(clip && f.part.animations[clip] ? f.part.animations[clip].frame_count / (f.part.anim_rate || 24) : lo, lo, hi);
    const atkClip = f.clips.attack;
    const ad = dur(atkClip, 0.3, 0.6);
    const nFly = fly(pj.n);
    const atk = Object.assign({ clip: atkClip, dur: ad, cd: Math.max(ad, fclamp(ai * 0.45, 0.35, 0.8)), hitAt: ad * (atkClip ? hitFrac(f, atkClip) : 0.5),
      kind: nFly ? "shot" : "melee", reach: fclamp(rg * 0.6, 70, 150), speed: 700, bul: nFly ? pj.n : null, sv: FT.SV_ATK }, pre.atk || {});
    if (atk.dmg == null) atk.dmg = Math.round(fclamp(70 * atk.cd / 0.55, 40, 80));
    atk.cd = Math.max(atk.cd, atk.dur);
    const sk = [0, 1].map((s) => {
      const base = (st.sk || [])[s], clip = f.clips[s ? "skill2" : "skill1"], p = (pre.sk || [])[s];
      if (!clip || (!base && !p)) return null;
      const cfg = pj[s ? "s2" : "s1"], fk = fly(cfg);
      const d = dur(clip, 0.4, 1.0);
      const o = { clip, dur: d, hitAt: d * hitFrac(f, clip), dmg: s ? 200 : 120, sv: s ? FT.SV_SK2 : FT.SV_SK1,
        cd: s ? fclamp(+(base && base.cd) || 12, 8, 15) : fclamp(+(base && base.cd) || 6, 4, 10),
        name: (f.skills && f.skills[s] && f.skills[s].name) || `技能${s + 1}`, bul: cfg && cfg.p && f.bul[cfg.p] ? cfg : null };
      if (p) return Object.assign(o, { range: 400, width: 160, speed: 560 }, p);
      if (!(base.e && base.e.length)) return Object.assign(o, { kind: "buff" });
      if (fk === "LINEAR") return Object.assign(o, { kind: "line", speed: 560 });
      if (fk === "CURVE") return Object.assign(o, { kind: "lob", range: fclamp(rg * 1.2, 260, 620) });
      return Object.assign(o, { kind: "rect", range: fclamp(rg * 1.4, 220, 700), width: fclamp((+base.ar || 200) * 0.5, 90, 260) });
    });
    return {
      hp: pre.hp || Math.round(FT.HP_MIN + (FT.HP_MAX - FT.HP_MIN) * rk.hp(st.hp)),
      dr: pre.dr != null ? pre.dr : +(FT.DR_MAX * rk.def(st.pd, st.md)).toFixed(3),
      bw: fclamp(f.w / f.h * FT.CH, 56, 120), walk: pre.walk || fclamp(110 + mv * 1.5, 170, 340), atk, sk,
    };
  }
  // 招式的「前搖／有效／後搖」（格）。有效：近戰＝持續判定、投射物＝射出那一格、矩形＝預告結束那一格
  function fightFrames(k, melee) {
    const active = melee ? FT.ACTIVE : FT.STEP;
    return { startup: toFrames(k.hitAt), active: toFrames(active), recovery: Math.max(0, toFrames(k.dur - k.hitAt - active)) };
  }
  // 選角畫面用的說明
  function fightSummary(fs) {
    const a = fs.atk, fr = (k, m) => { const x = fightFrames(k, m); return `${x.startup}／${x.active}／${x.recovery} 格`; };
    const parts = [`體力 ${fs.hp}、減傷 ${Math.round(fs.dr * 100)}%、移動 ${Math.round(fs.walk)}`,
      (a.kind === "melee" ? `普攻 近戰 ${Math.round(a.reach)} 遠・${a.dmg}` : `普攻 直線投射物・${a.dmg}`) + `（${fr(a, a.kind === "melee")}）`];
    fs.sk.forEach((k, s) => {
      if (!k) { parts.push(`技能${s + 1} 沒有`); return; }
      const extra = k.kind === "rect" ? `，射程 ${Math.round(k.range)}、寬 ${Math.round(k.width)}` : k.kind === "lob" ? `，射程 ${Math.round(k.range)}` : "";
      parts.push(`技能${s + 1} ${SK_KIND_LABEL[k.kind]}${k.kind === "buff" ? "" : "・" + k.dmg}${extra}・冷卻 ${k.cd.toFixed(1)} 秒（${fr(k, false)}）`);
    });
    return parts.join("｜") + "　※ 前搖／有效／後搖";
  }
