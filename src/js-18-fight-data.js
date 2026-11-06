  /* ---------- 格鬥場（v5.0 測試版）：固定數值、角色資料換算 ----------
     調平衡只要改這個檔：FT（全體共用的規則數值）、FIGHT_PRESET（自製角色手寫數值）、fightStats（官方角色換算）。
     規則本身在 js-18-fight-engine.js，畫面與觸控在 js-19。時間單位一律是秒，畫面上的「格」＝ 1/60 秒。
     座標：x 往右為正、場地中央為 0；y 往上為正、地面為 0；長度單位是「場地單位」（角色身高 CH＝170）。 */
  const FT = {
    // 基本
    STEP: 1 / 60, AW: 2000, CH: 170,                 // 每步秒數、場地寬（v7.0：760 → 2000，畫面用移動鏡頭）、角色身高
    RUN_MUL: 1.8, RUN_ANIM: 1.6, SHOT_MAX: 900, WALL_MAX: 800, // v7.0：衝刺速度、衝刺時跑步動畫加快、直線投射物最多飛多遠、擊飛撞牆最多推多遠
    HURT_W: 60,                                       // 受傷框寬度（跟圖片大小無關，所有角色一樣，置中在腳底）
    HP_MIN: 850, HP_MAX: 1200, DR_MAX: 0.2,           // 體力、減傷的範圍（官方角色依資料排名換算）
    // 移動
    GRAV: 1700, JUMP_V: 800, AIR_CTRL: 0.85,          // 重力、起跳速度（約 188 高、滯空約 0.94 秒）、空中左右移動的比例
    DASH_T: 0.25, BUBBLE_H: 90,                       // 突進花的時間、泡泡浮起的高度
    DASH_K: 2, DASH_DEF: 300, DASH_MAX: 700,          // 突進距離＝效果自帶的數值（points）× 2；沒有數值用 300；最遠 700
    SUM_HP: 0.15, SUM_DMG: 0.4, SUM_MAX: 3,           // 召喚物：體力＝施放者最大體力 × 0.15、傷害＝施放者普攻 × 0.4、每方場上最多 3 隻（v7.3：所有角色一樣，技能的 sumMax 不再使用）
    SUM_WALK: 0.8, SUM_CD: 1.5, SUM_H: 0.8,           // 召喚物：移動速度 × 0.8、普攻冷卻 × 1.5、受傷框高度＝身高 × 0.8
    PUSH_H: 0.5,                                      // 推擠：只有一方在空中時完全不推（跳得過對手）；兩人都在空中時，高度差超過身高 × 0.5 就不推
    // 出招
    ACTIVE: 4 / 60,                                   // 近戰普攻的有效判定持續時間（4 格）
    BUFFER: 0.15,                                     // 輸入緩衝：出招中、冷卻中提早按下，0.15 秒內會自動接上
    AIM_MIN: 60,                                      // 矩形、拋物線的最近距離（從身體前緣算）
    TELE_MIN: 0.3, TELE_MAX: 0.8, TELE_SYNC_MIN: 0.2, // 矩形預告：依距離＝近～遠；跟前搖同步時最短 0.2 秒
    AIR_SAFE: 40,                                     // 離地超過這個高度，矩形與拋物線爆炸就打不到
    LOB_TIME: 0.8, LOB_R: 60, LOB_GRAV_MUL: 2,                         // 拋物線基準飛行時間（資料速度 LOB_V0 時）、落地爆炸半徑、拋物線的重力倍數（v7.4：×2＝拋得高，不跳也能從底下穿過）
    // 原始資料 → 場地（射程、速度是遊戲單位；換算係數集中在這裡）
    MELEE_RG: 200,                                    // 普攻沒有飛行過程時：射程小於這個＝近戰，以上＝瞬間直線
    VIS_MELEE_MAX: 400, VIS_DLINE_MAX: 560, VIS_LUNGE_MAX: 1100, PBOX_FRONT: 120, FRONT_FAR: 400, // v7.5：身體衝刺型的上限；投射物碰撞只取圖的最前面 PBOX_FRONT
    FX_W_MAX: 400, FRONT_OVER: 30, FRONT_MIN: 100, // v7.4：技能動作要比普攻動作多伸出 FRONT_OVER、離身體前緣至少 FRONT_MIN 才算「身前範圍」（否則是施法動作，維持定點）
                                       // v7.4：技能特效圖太寬時等比縮小到這個寬度（判定跟著）
    SK_VS_ATK: 1.2, SK_WIDTH_K: 0.45, SK_WIDTH_MAX: 360, // v7.4：技能範圍至少是普攻判定的 1.2 倍；矩形寬＝技能伸到距離 × 0.45（最寬 360）           // v7.4：判定跟著畫面——攻擊動作實際伸到多遠（從身體中心算）的上限：近戰、瞬間直線
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
    SV_ATK: 25, SV_SK1: 40, SV_SK2: 60, SV_MAX: 100, SV_ARMOR_MUL: 2,  // 硬直累積值：每下加多少、滿多少倒地
    SV_DECAY_WAIT: 0.5, SV_DECAY: 30,                 // 多久沒挨打開始下降、每秒降多少
    DOWN_TIME: 0.6, WAKE_INV: 1.0,                    // 倒地躺多久、起身無敵多久
    // 防禦
    GAUGE_MAX: 100, GAUGE_HOLD: 20, GAUGE_HIT: 0.35, AIR_GUARD_MUL: 2,  // 防禦條：滿格、按住每秒扣、擋下扣原本傷害的幾成
    GAUGE_WAIT: 0.5, GAUGE_REGEN: 25,                 // 放開後多久開始回、每秒回多少
    GAUGE_REARM: 30,                                  // 破防後防禦條要回到這麼多才能再防（不然一直按著會連續破防）
    BLOCK_STUN: 0.15, GUARD_PUSH: 140, BREAK_STUN: 1.0, // 擋下時的防禦硬直、滑行初速、破防硬直
    // 其他
    BUFF_TIME: 5, BUFF_MUL: 1.3, HEAL: 120,           // 輔助技能：加攻擊秒數與倍率、回血
    DUMMY_REFILL: 2,                                  // 木樁多久沒挨打就回滿血
  };
  const fclamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const toFrames = (sec) => Math.round(sec * 60);

  /* 招式的操作方式：side＝按住顯示範圍、左右拖選方向、放開出招（身前範圍，v7.4），dist＝按住拖曳決定位置（矩形、拋物線），dir＝只決定方向、點一下就放（直線、普攻投射物），
     tap＝按下就放（近戰普攻、輔助技能） */
  const AIM_MODE = { front: "side", rect: "dist", lob: "dist", dash: "dist", line: "dir", shot: "dir", melee: "tap", dline: "tap", self: "tap", buff: "tap" };
  const SK_KIND_LABEL = { front: "身前範圍", dash: "突進", rect: "指定位置打擊（矩形預告）", line: "直線投射物", lob: "拋物線", self: "自身", buff: "輔助（暫時用加攻＋回血代替）" };
  const ATK_KIND_LABEL = { melee: "近戰", dline: "瞬間直線", shot: "直線投射物", lob: "拋物線" };

  /* 自製角色的手寫數值（官方角色由 fightStats 從資料換算）；沒寫的欄位用換算值 */
  const FIGHT_PRESET = {
    "x001-cube": { hp: 1150, dr: 0.15, walk: 270, atk: { kind: "melee", reach: 110, dmg: 60, cd: 0.45 },
      sk: [{ kind: "rect", range: 240, width: 170, cd: 5 }, { kind: "rect", range: 620, width: 200, cd: 10 }] },
    "x002-orb": { hp: 880, dr: 0.02, walk: 200, atk: { kind: "shot", dmg: 50, cd: 0.55 },
      sk: [{ kind: "line", speed: 600, cd: 6 }, { kind: "lob", range: 480, cd: 10 }] },
  };
  /* 變形後的外觀＝同編號、名字中間多 sk 的角色（跟召喚物同一套命名，例如 u376u-cony → u376sk-cony）。
     命名對不上、但同系列旁邊編號有的，在這裡補（跟 sync_overrides.json 的召喚物系列對應同一個道理） */
  const POLY_FORM_OVERRIDE = { "u1285e-sally": "u1286sk-sally", "u1285h-sally": "u1286sk-sally", "u1380h-mk": "u1381sk-mk", "u1380u-mk": "u1381sk-mk" };
  function fightPolyFormId(id) {
    if (POLY_FORM_OVERRIDE[id]) return POLY_FORM_OVERRIDE[id];
    const m = /^u(\d+)([a-z]?)-(.+)$/.exec(id); if (!m) return null;
    const [, num, evo, name] = m, has = (x) => S.index.some((r) => r.id === x);
    return [`u${num}${evo === "" || evo === "e" ? "" : evo}sk-${name}`, `u${num}sk-${name}`].find(has) || null;
  }
  // 召喚技能叫出來的召喚物 id（stats.json 的 sum／sums，跟雙人對戰同一份資料）
  const fightSummonIds = (id, s) => { const sk = S.stats[id] && S.stats[id].sk && S.stats[id].sk[s]; return sk ? (sk.sums || (sk.sum ? [sk.sum] : [])).map((x) => x.id) : []; };

  // 測試用角色：涵蓋長短手、各種投射物與輔助技能
  const FIGHT_ROSTER = [
    ["x001-cube", "自製・近戰＋兩招矩形（近、遠）"],
    ["x002-orb", "自製・遠程＋直線投射物＋拋物線"],
    ["x102-funingna", "自製惡搞・超模：召喚三隻＋泡泡定點"],
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
    ["u1009e-sally", "效果：召喚（v5.3.1）"],
    ["u376u-cony", "效果：變形成棉花糖兔兔（v5.3.1）"],
    ["u003u-bella", "效果：交換位置"],
    ["u1013e-brown", "效果：拉近對手"],
    ["u1021e-pink", "效果：擊飛撞牆＋暈眩，自己跟上去（v5.4）"],
    ["u1116h-claris", "效果：魅惑（左右反轉）、沉默"],
    ["u1617h-ka", "效果：恐懼"],
    ["u099u-alice", "效果：變形"],
    ["u1418e-moon", "效果：泡泡"],
    ["u1065e-cony", "效果：變大＋擊退"],
    ["u1145h-brown", "效果：詛咒（隨機負面效果）"],
    ["u1004e-sally", "效果：召喚對手複製體"],
  ];

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
  /* ---------- 階段 3（數值平衡）：總預算制＋傷害公式（v5.4） ----------
     參考值是 v5.4 時全部 2268 隻官方角色的中位數，寫死（新角色不會讓舊角色數值跑掉）；要重算改這裡並升版本。 */
  const BAL = {
    REF: { off: 7682, tank: 12.14, defHp: 0.042, mv: 92, rg: 220 },   // 攻擊力／攻擊間隔、體力÷攻擊力、防禦÷體力（第 90 百分位）、移速、射程
    W: { off: 0.30, dur: 0.25, mob: 0.15, rng: 0.15, ctl: 0.15 },     // 五種能力的權重
    CAP: [0.5, 1.5],          // 每種能力最多差平均 ±50%（保留「刀尖舔血」型）
    TILT: 0.4,                // 體力÷攻擊力 偏離中位數多少，轉成攻／守的傾斜程度
    CTL_PER: 0.15,            // 每個控制效果（暈眩、擊倒、泡泡…）佔的預算
    EHP: 900,                 // 平均角色的有效體力（體力 ÷ (1 − 減傷)）
    WALK: 230,                // 平均移動速度
    ATK_BASE: 47,             // 平均普攻傷害（攻擊週期 0.55 秒）→ 一般角色約 20～25 下倒
    SK_BASE: [155, 155],      // 平均技能傷害（冷卻 7 秒、出招 0.8 秒；技能 1、2 同一個基數，差別來自冷卻、形式與官方倍率比例）→ 約體力 10～20%
    SK_CLAMP: [60, 320],
    FORM: { front: 1.0, melee: 0.85, dline: 0.9, line: 1.0, shot: 1.0, dash: 1.1, lob: 1.1, target: 1.15, rect: 1.15 },
    CTL_DMG: 0.8,             // 帶控制效果的技能傷害打八折
    DR_TAX: 0.5,              // 減傷的「稅」：每 1% 減傷再扣 0.5% 有效體力（減傷 20% → 有效體力少 10%）
    NO_SK: 0.25,              // 少一個技能，普攻傷害 +25%
  };
  const bclamp = (x) => fclamp(x, BAL.CAP[0], BAL.CAP[1]);
  // 角色的五種能力（平均＝1）→ { off 攻擊倍率, dur 耐久倍率, walk, dr, ctl }
  function fightBudget(F, sk, rgEff) {
    const R = BAL.REF, off = (F.pa.v + F.ma.v) / Math.max(0.5, F.ai.v || 1.2);
    const t = off > 0 && F.hp.st === "ok" ? fclamp(Math.log(F.hp.v / off / R.tank), -1.2, 1.2) : 0;
    const ctl = sk.reduce((n, k) => n + (k ? k.enemyFx.filter((e) => FX_CONTROL.has(FIGHT_FX[e.c].b)).length : 0), 0);
    const q = { off: Math.exp(-BAL.TILT * t), dur: Math.exp(BAL.TILT * t), mob: bclamp(Math.pow((F.mv.v || R.mv) / R.mv, 0.7)),
      rng: bclamp(Math.pow((rgEff || F.rg.v || R.rg) / R.rg, 0.5)), ctl: 1 + BAL.CTL_PER * ctl };
    const sum = Object.keys(BAL.W).reduce((a, k) => a + BAL.W[k] * q[k], 0);   // 能力總和超過 1 → 攻、守一起打折
    const hp = F.hp.st === "ok" ? F.hp.v : 0;
    return { off: bclamp(q.off / sum), dur: bclamp(q.dur / sum), walk: BAL.WALK * q.mob, ctl, q, sum,
      dr: hp > 0 ? +(FT.DR_MAX * fclamp((F.pd.v + F.md.v) / hp / R.defHp, 0, 1)).toFixed(3) : 0 };
  }
  function fightAtkDmg(atk, B, nSk) {
    return Math.round(BAL.ATK_BASE * Math.pow(atk.cd / 0.55, 0.6) * (BAL.FORM[atk.kind] || 1) * B.off * (1 + BAL.NO_SK * (2 - nSk)));
  }
  // 技能傷害；ratio＝官方倍率算出的「技能 1／2 比例」（壓縮過）
  function fightSkDmg(o, B, ratio) {
    // 判定越小傷害越高：矩形看寬度；身前範圍看往前多遠（v7.4）
    const wF = o.kind === "rect" ? fclamp(Math.pow(160 / o.width, 0.25), 0.8, 1.2) : o.kind === "front" ? fclamp(Math.pow(250 / (o.ahead || 250), 0.25), 0.85, 1.2) : 1;
    const cF = o.enemyFx.some((e) => FX_CONTROL.has(FIGHT_FX[e.c].b)) ? BAL.CTL_DMG : 1;
    const x = BAL.SK_BASE[o.s] * Math.pow(o.cd / 7, 0.4) * Math.pow(o.dur / 0.8, 0.3) * (BAL.FORM[o.kind] || 1) * wF * cF * ratio * B.off;
    return Math.round(fclamp(x, BAL.SK_CLAMP[0], BAL.SK_CLAMP[1]));
  }
  /* 攻擊動作實際伸到多遠（從身體中心，場地單位）。優先用每日同步算好的 data/fight_reach.json（只算不透明的像素，較準）；
     沒有這隻（自製角色、還沒同步）就現場量（js-13 fReach，用部件外框，較粗略）。which：「a」普攻、0／1 技能。 */
  function fightVisReach(f, which, clip) {
    const r = S.reach && S.reach[f.r.id], v = r ? (which === "a" ? r.a : r.s && r.s[which]) : null;
    if (v != null) return v;
    return clip ? fReach(f, clip) * FT.CH / f.h : 0;
  }
  // v7.5 身體衝刺：攻擊動作裡身體衝出去多遠（0＝沒衝；i：0 普攻、1 技能 1、2 技能 2）。只有每日同步量的資料有（自製角色＝0）
  function fightVisDash(f, i) { const r = S.reach && S.reach[f.r.id]; return (r && r.d && r.d[i]) || 0; }
  /* v7.5 投射物碰撞框：投射物圖不透明部分 [左, 右, 下, 上]（以投射物位置為 0、往前／往上為正）。
     只取最前面 PBOX_FRONT（拖在後面的尾巴不算）；上下至少 ±14（跟舊的點判定一樣大）。沒有資料＝null（照舊用點判定） */
  function fightProjBox(f, i) {
    const r = S.reach && S.reach[f.r.id], b = r && r.p && r.p[i]; if (!b) return null;
    return [Math.round(Math.max(b[0], b[1] - FT.PBOX_FRONT)), b[1], Math.max(-FT.CH * 0.4, Math.min(b[2], -14)), Math.min(FT.CH * 1.2, Math.max(b[3], 14))];
  }
  /* v7.5 本人變成投射物：攻擊動作有 ≥ 25% 的格子身體完全看不到（例如黑帝斯：本人隱形、飛出去的「人」是投射物圖），
     投射物飛行中就不畫本人（純畫面，不影響判定），避免場上同時有兩個人 */
  function fightHideFrac(f, clip) {
    const fr = (clip && f.part.animations[clip] && f.part.animations[clip].frames) || []; if (!fr.length) return 0;
    return fr.filter((x) => !fItems(f, x).some((t) => t.alpha >= 0.3)).length / fr.length;
  }
  /* v7.5.1 投射物出發位置：原始資料的 x、y（projectiles.json，跟角色圖同一套原始座標、y 往上）換成
     [離身體中心往前多遠, 離地多高]（場地單位）。投射物圖就畫在這個位置，跟原作一樣（之前一律從身體前緣、固定高度發射，
     圖片的位置會跑掉：例如庫拉麗絲的投射物畫在地底下）。高度限制在 10～0.9 身高（太高的斜射投射物打不到人） */
  function fightSpawn(f, cfg) {
    if (!cfg || cfg.x == null) return null;
    const kk = FT.CH / f.h;
    // 原始的 x、y 要乘 0.5 才是角色圖的座標（雙人對打 js-11 也是這個比例，畫面跟原作一致）
    return [Math.round(fclamp((cfg.x * 0.5 + f.ox) * kk, -200, 400)), Math.round(fclamp((f.lb.y1 + (cfg.y || 0) * 0.5) * kk, 10, FT.CH * 0.9))];
  }
  // 技能特效圖的左右範圍（以落點為 0、往右為正，場地單位）：優先用同步算好的；沒有就用部件外框現場算（較粗略）
  function fightEffectExtent(f, s, bulCfg) {
    const r = S.reach && S.reach[f.r.id];
    if (r && r.e) return r.e[s] || null;
    const dr = bulCfg && f.bul[bulCfg.p]; if (!dr) return null;
    const anim = pickAnim(dr.part, ["finish", "hit", "end", "normal", "idle"]); if (!anim) return null;
    let x0 = Infinity, x1 = -Infinity;
    for (const fr of dr.part.animations[anim].frames || []) for (const t of fItems(dr, fr)) { const b = fItemBox(t); x0 = Math.min(x0, b[0]); x1 = Math.max(x1, b[2]); }
    return isFinite(x0) ? [x0 * FT.CH / f.h, x1 * FT.CH / f.h] : null;
  }
  function fightStats(f) {
    // 手寫數值：程式裡的 FIGHT_PRESET（方塊騎士、圓圓法師），或資料檔 stats.json 的 "fight"（v7.2 起，自製角色用；只蓋過有寫的欄位）
    const preD = !FIGHT_PRESET[f.r.id] && S.stats[f.r.id] && S.stats[f.r.id].fight ? S.stats[f.r.id].fight : null;
    const N = normUnit(f.r, animNames(f.part)), pre = FIGHT_PRESET[f.r.id] || preD || {}, F = N.f;
    const rg = F.rg.v, ai = F.ai.v || 1.2;
    const dur = (clip, lo, hi) => fclamp(clip && f.part.animations[clip] ? f.part.animations[clip].frame_count / (f.part.anim_rate || 24) : lo, lo, hi);
    // 普攻
    const a = N.atk, atkClip = a.clip, ad = dur(atkClip, 0.3, 0.6);
    const atk = Object.assign({ form: a.form, kind: FORM_KIND.atk[a.form], clip: atkClip, dur: ad, cd: Math.max(ad, fclamp(ai * 0.45, 0.35, 0.8)),
      hitAt: ad * (atkClip ? hitFrac(f, atkClip) : 0.5), sv: FT.SV_ATK, bul: a.form === "line" || a.form === "lob" ? a.cfg : null,
      reach: fclamp(rg * FT.RG_REACH, FT.REACH_MIN, FT.REACH_MAX), range: a.form === "lob" ? fclamp(rg * FT.RG_LOB, FT.LOB_MIN, FT.LOB_MAX) : fclamp(rg * FT.RG_REACH, FT.DLINE_MIN, FT.DLINE_MAX),
      speed: fSpeed(a.cfg), lobT: fLobT(a.cfg) }, pre.atk || {});
    if (pre.atk && pre.atk.kind) atk.kind = pre.atk.kind;
    /* v7.5.1：普攻投射物飛行中完全看不到（原作是直接在對手身上爆開，例如華美巫女兔兔、名人氣球藝術家兔兔）
       → 不當成會飛的子彈：照射程改成近戰／瞬間直線，打中時在對手身上播命中動畫（hitBul） */
    const RR = S.reach && S.reach[f.r.id];
    if (RR && RR.inv && RR.inv[0] && atk.kind === "shot" && !(pre.atk && pre.atk.kind)) { atk.kind = rg < FT.MELEE_RG ? "melee" : "dline"; atk.hitBul = atk.bul; atk.bul = null; }
    /* v7.4：判定跟著畫面。近戰＝攻擊動作實際伸到的距離（減掉半個身體，因為判定從身體前緣算）；
       瞬間直線＝畫面比原本的判定長才放長（不縮短）。手寫數值有寫 reach／range 就照手寫。 */
    if (atkClip && !(pre.atk && (pre.atk.reach != null || pre.atk.range != null))) {
      const bw = fclamp(f.w / f.h * FT.CH, 56, 120), vis = fightVisReach(f, "a", atkClip); // 場地單位，從中心算
      const lunge = fightVisDash(f, 0) > 0; // v7.5：身體衝過去打（始皇帝、樞木朱雀…）上限放寬
      if (atk.kind === "melee") atk.reach = Math.max(FT.REACH_MIN, Math.round(fclamp(vis, 0, lunge ? FT.VIS_LUNGE_MAX : FT.VIS_MELEE_MAX) - bw / 2));
      else if (atk.kind === "dline") atk.range = Math.round(Math.max(atk.range, fclamp(vis, 0, lunge ? FT.VIS_LUNGE_MAX : FT.VIS_DLINE_MAX) - bw / 2));
    }
    if (atk.kind === "shot" && !(pre.atk && pre.atk.pbox)) atk.pbox = fightProjBox(f, 0); // v7.5：投射物碰撞框跟著圖
    if ((atk.kind === "shot" || atk.kind === "lob") && !(pre.atk && pre.atk.hideBody != null)) atk.hideBody = fightHideFrac(f, atkClip) >= 0.25;
    if ((atk.kind === "shot" || atk.kind === "lob" || atk.hitBul) && !(pre.atk && pre.atk.spawn)) atk.spawn = fightSpawn(f, atk.bul || atk.hitBul);
    atk.cd = Math.max(atk.cd, atk.dur);
    // 普攻的判定前緣（從身體前緣算）：技能範圍至少要比它遠（v7.4）
    const bwF = fclamp(f.w / f.h * FT.CH, 56, 120), atkFront = atk.kind === "melee" ? atk.reach : atk.kind === "dline" || atk.kind === "lob" ? atk.range : 0;
    // 技能
    const sk = N.sk.map((k, s) => {
      if (!k.exists || !k.clip) return null;
      const d = dur(k.clip, 0.4, 1.0), p = (pre.sk || [])[s];
      const o = { s, form: k.form, kind: FORM_KIND.sk[k.form], clip: k.clip, clipSub: k.clipSub, dur: d, hitAt: d * hitFrac(f, k.clip), dmg: s ? 200 : 120, sv: s ? FT.SV_SK2 : FT.SV_SK1,
        cd: s ? fclamp(k.cd.v || 12, 8, 15) : fclamp(k.cd.v || 6, 4, 10),
        name: (f.skills && f.skills[s] && f.skills[s].name) || `技能${s + 1}`, icon: (f.skills && f.skills[s] && f.skills[s].icon) || null, bul: k.cfg && k.cfg.p && f.bul[k.cfg.p] ? k.cfg : null,
        range: k.form === "lob" ? fclamp(rg * FT.RG_LOB, FT.LOB_MIN, FT.LOB_MAX) : k.form === "dash" ? fightDashRange(k) : fclamp(rg * FT.RG_CAST, FT.CAST_MIN, FT.CAST_MAX),
        width: k.effectRange.v ? fclamp(k.effectRange.v * FT.AR_WIDTH, FT.WIDTH_MIN, FT.WIDTH_MAX) : FT.WIDTH_DEF,
        speed: fSpeed(k.cfg), lobT: fLobT(k.cfg) };
      // 效果（只放效果模組支援的；同一種代碼只留一筆）：打對手的跟著投射物／預告走，自己的在出招時套用
      const seen = new Set(), sup = k.fx.filter((e) => FIGHT_FX[e.c] && e.c !== "DMG" && !seen.has(e.c) && seen.add(e.c)).map((e) => ({ c: e.c, dur: e.dur, val: e.val, durLv: e.durLv || 0, lvMax: N.lvMax || 0, s }));
      // onHit（召喚）：有目標的技能改成打中才生效；自身型沒有目標，照舊出招時生效
      const hitFx = (e) => FIGHT_FX[e.c].to === "enemy" || (FIGHT_FX[e.c].onHit && k.form !== "self" && k.form !== "buff");
      o.enemyFx = sup.filter(hitFx); o.selfFx = sup.filter((e) => !hitFx(e));
      o.damaging = k.damaging; o.mul = (k.fx.find((e) => e.c === "DMG" && e.val > 0) || {}).val || 0;
      /* v7.4：技能範圍也跟著畫面。技能動作實際伸到多遠（量不到或太小時，至少是普攻判定的 1.2 倍），
         矩形：最遠施放距離與寬度跟著放大；拋物線：最遠距離跟著放大。手寫數值有寫的欄位照手寫。 */
      if (!FIGHT_PRESET[f.r.id]) {
        const vs = k.clipSub ? fightVisReach(f, "a", k.clip) : fightVisReach(f, s, k.clip);
        const base = Math.max(vs - bwF / 2, atkFront * FT.SK_VS_ATK);
        if (o.kind === "dash") o.ahead = Math.round(fclamp(vs - bwF / 2, o.width / 2, FT.CAST_MAX)); // 突進落地後往前打多遠（照技能動畫）
        const has = (key) => p && p[key] != null;
        // v7.5.1：技能投射物飛行中完全看不到 → 改成指定位置打擊（判定照命中動畫的範圍，下面的特效圖規則處理）
        if (RR && RR.inv && RR.inv[s + 1] && o.kind === "line" && !has("kind")) o.kind = "rect";
        if (o.kind === "rect") {
          if (!has("range")) o.range = Math.round(fclamp(Math.max(o.range, base), FT.CAST_MIN, FT.CAST_MAX));
          if (!has("width")) o.width = Math.round(fclamp(Math.max(o.width, base * FT.SK_WIDTH_K), FT.WIDTH_MIN, FT.SK_WIDTH_MAX));
        } else if (o.kind === "lob" && !has("range")) o.range = Math.round(fclamp(Math.max(o.range, base), FT.LOB_MIN, FT.LOB_MAX));
        /* v7.4：指定位置打擊分兩類（每日同步先量好，見 sync.py fight_reach）——
           有特效圖（投射物部件）：判定＝特效圖不透明部分實際蓋到的範圍（off＝範圍中心離落點多遠，往面向為正；太寬就等比縮小到 FX_W_MAX）；
           沒有特效圖（效果畫在角色自己的技能動作裡）：改成「身前範圍」，從身體前緣打到動作實際伸到的地方，不拖曳。 */
        if (o.kind === "rect" && !has("width") && !has("kind")) {
          const ex = fightEffectExtent(f, s, o.bul);
          /* v7.5：有特效圖，但技能動作本身就一路伸到很遠（例如巫女桔梗的技能 2：靈蛇從身上一路飛出去，特效圖只是最後的命中）
             → 畫面上整條路都在攻擊，改成身前範圍（打到動作伸到的地方），特效圖照樣當命中特效 */
          if (ex && !o.enemyFx.some((e) => ["pull", "swap", "summon", "copy"].includes(FIGHT_FX[e.c].b)) && vs - bwF / 2 >= FT.FRONT_FAR) { o.kind = "front"; o.ahead = Math.round(fclamp(vs - bwF / 2, 60, fightVisDash(f, s + 1) > 0 ? FT.VIS_LUNGE_MAX : FT.CAST_MAX)); o.range = o.ahead; o.width = o.ahead; }
          else if (ex) { const w = Math.max(1, ex[1] - ex[0]), sc = w > FT.FX_W_MAX ? FT.FX_W_MAX / w : 1; o.width = Math.max(FT.WIDTH_MIN, Math.round(w * sc)); o.off = Math.round((ex[0] + ex[1]) / 2 * sc); o.fxs = sc; }
          // 拉近、換位、召喚、複製這類「要打到遠處對手才有用」的技能維持定點（改成身前範圍就失去意義）
          // 施法動作（技能動作沒有比普攻伸得更遠、或幾乎沒伸出去：效果其實出現在對手身上，例如原地揮杖、瞬移到對手身邊）也維持定點
          else if (!o.bul && !o.enemyFx.some((e) => ["pull", "swap", "summon", "copy"].includes(FIGHT_FX[e.c].b))
            && vs >= Math.min(fightVisReach(f, "a", atk.clip), FT.VIS_MELEE_MAX) + FT.FRONT_OVER && vs - bwF / 2 >= FT.FRONT_MIN) { o.kind = "front"; o.ahead = Math.round(fclamp(vs - bwF / 2, 60, fightVisDash(f, s + 1) > 0 ? FT.VIS_LUNGE_MAX : FT.CAST_MAX)); o.range = o.ahead; o.width = o.ahead; }
        }
      }
      if (o.kind === "line" && !k.clipSub) o.pbox = fightProjBox(f, s + 1); // v7.5：投射物碰撞框跟著圖
      if (o.kind === "line" || o.kind === "lob") { o.hideBody = fightHideFrac(f, k.clip) >= 0.25; o.spawn = fightSpawn(f, o.bul); }
      if (p) Object.assign(o, preD ? {} : { range: 400, width: 160, speed: 560, lobT: FT.LOB_TIME, enemyFx: [], selfFx: [] }, p);
      return o;
    });
    // 總預算制：攻、守、機動、射程、控制五種能力分一份預算
    // v7.4：射程分數改用實際判定距離（近戰、瞬間直線；換回原作射程的尺度＝÷ RG_REACH），手變長的角色傷害／體力自動打折
    const rgEff = !FIGHT_PRESET[f.r.id] && !preD && (atk.kind === "melee" || atk.kind === "dline") ? Math.max(F.rg.v || 0, atkFront / FT.RG_REACH) : null;
    const B = fightBudget(F, sk, rgEff), nSk = sk.filter(Boolean).length;
    if (atk.dmg == null) atk.dmg = fightAtkDmg(atk, B, nSk);
    const m = sk.map((o) => (o && o.mul) || 0), r = m[0] && m[1] ? fclamp(Math.pow(m[1] / m[0], 0.3), 0.5, 2) : 1;
    sk.forEach((o, s) => {
      if (!o || (pre.sk && pre.sk[s] && pre.sk[s].dmg != null)) return;
      o.dmg = o.damaging === false ? 0 : fightSkDmg(o, B, s ? Math.sqrt(r) : 1 / Math.sqrt(r));
    });
    const dr = pre.dr != null ? pre.dr : B.dr;
    return {
      hp: pre.hp || Math.round(BAL.EHP * B.dur * (1 - dr) * (1 - BAL.DR_TAX * dr)), dr,
      bw: fclamp(f.w / f.h * FT.CH, 56, 120), walk: pre.walk || Math.round(fclamp(B.walk, 150, 345)), atk, sk, N, // walk 取整數：不同瀏覽器的 Math.pow 可能差一點點，線上對戰要兩邊完全一樣
      B: FIGHT_PRESET[f.r.id] || preD ? null : B, // 自製角色是手寫數值，不顯示預算
      op: !!pre.op,                                // 超模角色（故意不平衡，選角畫面標示）
      sum: pre.sum ? { hp: +pre.sum.hp || FT.SUM_HP, dmg: +pre.sum.dmg || FT.SUM_DMG } : null, // 召喚物體力、傷害倍率（沒寫用預設）
    };
  }
  // 招式的「前搖／有效／後搖」（格）。有效：近戰＝持續判定、投射物＝射出那一格、矩形＝預告結束那一格
  function fightFrames(k, melee) {
    const active = melee ? FT.ACTIVE : FT.STEP;
    return { startup: toFrames(k.hitAt), active: toFrames(active), recovery: Math.max(0, toFrames(k.dur - k.hitAt - active)) };
  }
  // 選角卡上的重點（圖示一行）；其他放進「詳細」（fightSummary）
  function fightBrief(fs) {
    const sk = fs.sk.map((k, s) => (k ? `✦${s + 1} ${k.dmg || (k.kind === "self" || k.kind === "buff" ? "自身" : "無傷害")}・${Math.round(k.cd)} 秒` : null)).filter(Boolean);
    return [...(fs.op ? ["⚠ 超模"] : []), `❤ ${fs.hp}`, `🛡 ${Math.round(fs.dr * 100)}%`, `👟 ${Math.round(fs.walk)}`, `⚔ ${fs.atk.dmg}`, ...sk]; // 每一項各自不斷行
  }
  // 選角畫面用的說明
  function fightSummary(fs) {
    const a = fs.atk, fr = (k, m) => { const x = fightFrames(k, m); return `${x.startup}／${x.active}／${x.recovery} 格`; };
    const B = fs.B, pc = (x) => `${x >= 1 ? "+" : ""}${Math.round((x - 1) * 100)}%`;
    const parts = [`體力 ${fs.hp}、減傷 ${Math.round(fs.dr * 100)}%、移動 ${Math.round(fs.walk)}${B ? `（攻擊 ${pc(B.off)}、耐久 ${pc(B.dur)}${B.ctl ? `、控制 ${B.ctl} 個` : ""}）` : ""}`,
      `普攻 ${ATK_KIND_LABEL[a.kind]}${a.kind === "melee" ? " " + Math.round(a.reach) + " 遠" : a.kind === "dline" || a.kind === "lob" ? " " + Math.round(a.range) + " 遠" : ""}・${a.dmg}（${fr(a, a.kind === "melee")}）`];
    fs.sk.forEach((k, s) => {
      if (!k) { parts.push(`技能${s + 1} 沒有`); return; }
      const extra = k.kind === "front" ? `，往前 ${Math.round(k.ahead)}` : k.kind === "dash" ? `，距離 ${Math.round(k.range)}（左右都可以）` : k.kind === "rect" ? `，射程 ${Math.round(k.range)}、寬 ${Math.round(k.width)}` : k.kind === "lob" ? `，射程 ${Math.round(k.range)}` : "";
      parts.push(`技能${s + 1} ${SK_KIND_LABEL[k.kind]}${k.kind === "buff" || k.kind === "self" ? "" : "・" + (k.dmg || "無傷害")}${extra}・冷卻 ${k.cd.toFixed(1)} 秒（${fr(k, false)}）`);
    });
    if (fs.op) parts.unshift("⚠ 超模角色：數值故意超出平衡預算");
    return parts.join("｜") + "　※ 前搖／有效／後搖\n" + normSummary(fs.N);
  }
