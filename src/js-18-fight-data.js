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
    DASH_T: 0.25, BUBBLE_H: 90,                       // 突進花的時間、泡泡浮起的高度
    DASH_K: 2, DASH_DEF: 300, DASH_MAX: 700,          // 突進距離＝效果自帶的數值（points）× 2；沒有數值用 300；最遠 700
    PUSH_H: 0.5,                                      // 推擠：只有一方在空中時完全不推（跳得過對手）；兩人都在空中時，高度差超過身高 × 0.5 就不推
    // 出招
    ACTIVE: 4 / 60,                                   // 近戰普攻的有效判定持續時間（4 格）
    BUFFER: 0.15,                                     // 輸入緩衝：出招中、冷卻中提早按下，0.15 秒內會自動接上
    AIM_MIN: 60,                                      // 矩形、拋物線的最近距離（從身體前緣算）
    TELE_MIN: 0.3, TELE_MAX: 0.8, TELE_SYNC_MIN: 0.2, // 矩形預告：依距離＝近～遠；跟前搖同步時最短 0.2 秒
    AIR_SAFE: 40,                                     // 離地超過這個高度，矩形與拋物線爆炸就打不到
    LOB_TIME: 0.8, LOB_R: 60,                         // 拋物線基準飛行時間（資料速度 LOB_V0 時）、落地爆炸半徑
    // 原始資料 → 場地（射程、速度是遊戲單位；換算係數集中在這裡）
    MELEE_RG: 200,                                    // 普攻沒有飛行過程時：射程小於這個＝近戰，以上＝瞬間直線
    RG_REACH: 0.6, REACH_MIN: 70, REACH_MAX: 150,     // 近戰距離＝射程 × 0.6（70～150）
    DLINE_MIN: 150, DLINE_MAX: 560,                   // 瞬間直線距離＝射程 × 0.6（150～560，場地開場相距 440）
    RG_CAST: 1.4, CAST_MIN: 220, CAST_MAX: 700,       // 指定位置打擊的最遠施放距離＝射程 × 1.4
    RG_LOB: 1.2, LOB_MIN: 260, LOB_MAX: 620,          // 拋物線最遠距離＝射程 × 1.2
    AR_WIDTH: 0.5, WIDTH_MIN: 90, WIDTH_MAX: 260, WIDTH_DEF: 160, // 指定位置打擊的寬度＝作用範圍 × 0.5
    SPEED_K: 20, SPEED_MIN: 300, SPEED_MAX: 1000, SPEED_DEF: 600, // 直線投射物速度＝資料速度 × 20（資料中位數 30 → 600）
    LOB_V0: 20, LOB_TMIN: 0.55, LOB_TMAX: 1.1,        // 拋物線飛行時間＝0.8 × 20 ÷ 資料速度（資料中位數 20 → 0.8 秒）
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
  const AIM_MODE = { rect: "dist", lob: "dist", dash: "dist", line: "dir", shot: "dir", melee: "tap", dline: "tap", self: "tap", buff: "tap" };
  const SK_KIND_LABEL = { dash: "突進", rect: "指定位置打擊（矩形預告）", line: "直線投射物", lob: "拋物線", self: "自身", buff: "輔助（暫時用加攻＋回血代替）" };
  const ATK_KIND_LABEL = { melee: "近戰", dline: "瞬間直線", shot: "直線投射物", lob: "拋物線" };

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
    ["u1028e-sally", "普攻瞬間直線（射程 800）"],
    ["u014e-cony", "普攻拋物線＋技能減速"],
    ["u021u-brown", "技能 2 擊暈"],
    ["u006e-clark", "效果：暈眩"],
    ["u1003e-jessica", "效果：擊退（倒地）"],
    ["u003e-bella", "效果：護盾（原無敵）"],
    ["u1008h-brown", "效果：攻擊降低、穿透護盾＋擊退"],
    ["u023u-sindy", "效果：沉默、攻擊與移速增加"],
    ["u010e-clara", "效果：持續傷害"],
    ["u010u-clara", "效果：技能抗性降低（受到技能傷害增加）"],
    ["u1001h-brown", "效果：反射傷害、普攻傷害減少"],
    ["u014u-cony", "效果：吸血、技能範圍增加"],
    ["u1084h-alice", "效果：技能冷卻縮短、冷卻重置"],
    ["u1216e-towa", "效果：突進＋暈眩"],
    ["u1278e-er", "效果：長距離突進（600）"],
    ["u003u-bella", "效果：交換位置"],
    ["u1013e-brown", "效果：拉近對手"],
    ["u1116h-claris", "效果：魅惑（左右反轉）、沉默"],
    ["u1617h-ka", "效果：恐懼"],
    ["u099u-alice", "效果：變形"],
    ["u1418e-moon", "效果：泡泡"],
    ["u1065e-cony", "效果：變大＋擊退"],
    ["u1145h-brown", "效果：詛咒（隨機負面效果）"],
    ["u1004e-sally", "效果：召喚對手複製體"],
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

  /* 角色 → 格鬥場數值（只讀標準化資料 N，見 js-18-fight-norm.js）
     回傳 { hp, dr（減傷）, bw（身體寬，用在推擠）, walk, atk, sk: [技能1, 技能2], N }
     每招：{ kind, form, clip, dur（動作長度）, hitAt（前搖）, dmg, cd, sv, … }，依種類另有：
       melee reach｜dline range｜shot、line speed｜lob range、lobT（飛行時間）｜rect range（最遠施放距離）、width（判定寬度）
     前搖：資料裡有準備動作（*_ready）就依它算，沒有就取動作長度的 50%（見 hitFrac）。 */
  const fSpeed = (cfg) => (cfg && cfg.v > 0 ? fclamp(cfg.v * FT.SPEED_K, FT.SPEED_MIN, FT.SPEED_MAX) : FT.SPEED_DEF);
  const fLobT = (cfg) => (cfg && cfg.v > 0 ? fclamp(FT.LOB_TIME * FT.LOB_V0 / cfg.v, FT.LOB_TMIN, FT.LOB_TMAX) : FT.LOB_TIME);
  // 突進距離：用突進效果自帶的數值（原作的衝刺距離，跟射程無關）
  function fightDashRange(k) {
    const e = k.fx.find((x) => FIGHT_FX[x.c] && FIGHT_FX[x.c].form === "dash");
    return Math.min(FT.DASH_MAX, (e && e.val > 0 ? e.val : FT.DASH_DEF) * FT.DASH_K);
  }
  function fightStats(f) {
    const N = normUnit(f.r, animNames(f.part)), pre = FIGHT_PRESET[f.r.id] || {}, rk = fightRanks(), F = N.f;
    const rg = F.rg.v, ai = F.ai.v || 1.2;
    const dur = (clip, lo, hi) => fclamp(clip && f.part.animations[clip] ? f.part.animations[clip].frame_count / (f.part.anim_rate || 24) : lo, lo, hi);
    // 普攻
    const a = N.atk, atkClip = a.clip, ad = dur(atkClip, 0.3, 0.6);
    const atk = Object.assign({ form: a.form, kind: FORM_KIND.atk[a.form], clip: atkClip, dur: ad, cd: Math.max(ad, fclamp(ai * 0.45, 0.35, 0.8)),
      hitAt: ad * (atkClip ? hitFrac(f, atkClip) : 0.5), sv: FT.SV_ATK, bul: a.form === "line" || a.form === "lob" ? a.cfg : null,
      reach: fclamp(rg * FT.RG_REACH, FT.REACH_MIN, FT.REACH_MAX), range: a.form === "lob" ? fclamp(rg * FT.RG_LOB, FT.LOB_MIN, FT.LOB_MAX) : fclamp(rg * FT.RG_REACH, FT.DLINE_MIN, FT.DLINE_MAX),
      speed: fSpeed(a.cfg), lobT: fLobT(a.cfg) }, pre.atk || {});
    if (pre.atk) atk.kind = pre.atk.kind;
    if (atk.dmg == null) atk.dmg = Math.round(fclamp(70 * atk.cd / 0.55, 40, 80));
    atk.cd = Math.max(atk.cd, atk.dur);
    // 技能
    const sk = N.sk.map((k, s) => {
      if (!k.exists || !k.clip) return null;
      const d = dur(k.clip, 0.4, 1.0), p = (pre.sk || [])[s];
      const o = { s, form: k.form, kind: FORM_KIND.sk[k.form], clip: k.clip, clipSub: k.clipSub, dur: d, hitAt: d * hitFrac(f, k.clip), dmg: s ? 200 : 120, sv: s ? FT.SV_SK2 : FT.SV_SK1,
        cd: s ? fclamp(k.cd.v || 12, 8, 15) : fclamp(k.cd.v || 6, 4, 10),
        name: (f.skills && f.skills[s] && f.skills[s].name) || `技能${s + 1}`, bul: k.cfg && k.cfg.p && f.bul[k.cfg.p] ? k.cfg : null,
        range: k.form === "lob" ? fclamp(rg * FT.RG_LOB, FT.LOB_MIN, FT.LOB_MAX) : k.form === "dash" ? fightDashRange(k) : fclamp(rg * FT.RG_CAST, FT.CAST_MIN, FT.CAST_MAX),
        width: k.effectRange.v ? fclamp(k.effectRange.v * FT.AR_WIDTH, FT.WIDTH_MIN, FT.WIDTH_MAX) : FT.WIDTH_DEF,
        speed: fSpeed(k.cfg), lobT: fLobT(k.cfg) };
      // 效果（只放效果模組支援的；同一種代碼只留一筆）：打對手的跟著投射物／預告走，自己的在出招時套用
      const seen = new Set(), sup = k.fx.filter((e) => FIGHT_FX[e.c] && e.c !== "DMG" && !seen.has(e.c) && seen.add(e.c)).map((e) => ({ c: e.c, dur: e.dur, val: e.val, durLv: e.durLv || 0, lvMax: N.lvMax || 0 }));
      o.enemyFx = sup.filter((e) => FIGHT_FX[e.c].to === "enemy"); o.selfFx = sup.filter((e) => FIGHT_FX[e.c].to === "self");
      if (!k.damaging && !p) o.dmg = 0; // 沒有傷害的技能（只有減益、暈眩等）不扣血
      if (p) Object.assign(o, { range: 400, width: 160, speed: 560, lobT: FT.LOB_TIME, enemyFx: [], selfFx: [] }, p);
      return o;
    });
    // 體力、減傷（暫時沿用排名換算；階段 3（數值平衡）改總預算制）。沒有體力資料時用中位數（N 已標成推測）
    const hpPct = F.hp.st === "ok" ? rk.hp(F.hp.v) : 0.5;
    return {
      hp: pre.hp || Math.round(FT.HP_MIN + (FT.HP_MAX - FT.HP_MIN) * hpPct),
      dr: pre.dr != null ? pre.dr : +(FT.DR_MAX * rk.def(F.pd.v, F.md.v)).toFixed(3),
      bw: fclamp(f.w / f.h * FT.CH, 56, 120), walk: pre.walk || fclamp(110 + F.mv.v * 1.5, 170, 340), atk, sk, N,
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
      `普攻 ${ATK_KIND_LABEL[a.kind]}${a.kind === "melee" ? " " + Math.round(a.reach) + " 遠" : a.kind === "dline" || a.kind === "lob" ? " " + Math.round(a.range) + " 遠" : ""}・${a.dmg}（${fr(a, a.kind === "melee")}）`];
    fs.sk.forEach((k, s) => {
      if (!k) { parts.push(`技能${s + 1} 沒有`); return; }
      const extra = k.kind === "dash" ? `，距離 ${Math.round(k.range)}（左右都可以）` : k.kind === "rect" ? `，射程 ${Math.round(k.range)}、寬 ${Math.round(k.width)}` : k.kind === "lob" ? `，射程 ${Math.round(k.range)}` : "";
      parts.push(`技能${s + 1} ${SK_KIND_LABEL[k.kind]}${k.kind === "buff" || k.kind === "self" ? "" : "・" + (k.dmg || "無傷害")}${extra}・冷卻 ${k.cd.toFixed(1)} 秒（${fr(k, false)}）`);
    });
    return parts.join("｜") + "　※ 前搖／有效／後搖\n" + normSummary(fs.N);
  }
