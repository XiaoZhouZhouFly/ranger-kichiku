  /* ---------- 格鬥場：技能效果模組（Effect Registry） ----------
     兩層：
       FX_TABLE（js-18-fight-data-fx.js，由決定表產生）：每個效果代碼用哪一種「處理方式」b、作用對象、數字範圍。
       FX_BEHAVIOR（這個檔）：每一種處理方式怎麼做。
     FIGHT_FX＝兩者組起來：決定表選了、而且這裡有實作的代碼才算「已支援」（標準化層、相容性報告都看它）。
     要讓某個效果換做法：改決定表（或 tools/fight_effects_decisions.json）→ python tools/gen_fx_table.py → python build.py。
     要新增一種做法：在 FX_BEHAVIOR 加一筆，並在 tools/gen_fx_table.py 的 NEW_MAP 指給對應的代碼。

     角色身上的狀態 p.st：{ 狀態名: { t: 剩幾秒, v: 數值, … } }
     重複中招：同一種狀態重新計時、數值取比較大的（不疊加），見 fxSet。增益與減益的分類見 FX_POS／FX_NEG（清除效果用）。 */

  const FX_NUM = { DOT_FIRST: 0.4, DOT_TOTAL: 1.3, TICK: 0.5, HEAL_DATA: [50, 150], WALL_T: 0.3 };
  /* DOT_FIRST：持續傷害命中先扣這招傷害的 40%；DOT_TOTAL：持續傷害的總傷害＝單擊的 1.3 倍（要等它扣完的補償）
     WALL_T：擊飛撞牆的滑行秒數（施放者跟上去也是這個時間）；TICK：持續傷害、持續回血每 0.5 秒一次；HEAL_DATA：回血的原作數值在這個範圍內依比例對到決定表的上下限 */

  // 持續秒數：資料寫「每級幾秒」時乘上這隻角色的最大等級（決定表選「不乘」就不乘），再套上下限
  function fxDur(e, P) {
    const [lo, hi] = P.dur || [1, 5];
    let t = e.dur > 0 ? e.dur : hi;
    if (e.durLv > 0 && P.lv !== "never") t = e.lvMax ? e.durLv * e.lvMax : hi;
    return fclamp(t, lo, hi);
  }
  // 百分比類：資料 % × k，限制在決定表的上下限（回傳 0～1）
  const fxPct = (e, P) => fclamp((e.val > 0 ? e.val : 40) / 100 * (P.k == null ? 0.5 : P.k), (P.val ? P.val[0] : 10) / 100, (P.val ? P.val[1] : 30) / 100);
  // 固定比例類（回血、護盾、吸血、反射）：資料數值在 HEAL_DATA 範圍內依比例對到上下限；沒有數值就取中間
  function fxRatio(e, P) {
    const [lo, hi] = P.val || [10, 10], [a, b] = FX_NUM.HEAL_DATA;
    const r = e.val > 0 ? fclamp((e.val - a) / (b - a), 0, 1) : 0.5;
    return (lo + (hi - lo) * r) / 100;
  }
  const fxDebuffCode = (c) => c.startsWith("DEBUFF-");

  // 增益、減益（清除效果用）；持續清除＝一段時間內不能再中
  const FX_POS = new Set(["atkUp", "spdUp", "skDef", "atkDef", "atkBoxUp", "skBoxUp", "cdFast", "atkSpdUp", "vamp", "mirror", "regen", "noDebuff", "noDot"]);
  const FX_NEG = new Set(["atkDown", "spdDown", "skVul", "atkVul", "atkBoxDown", "skBoxDown", "cdSlow", "atkSpdDown", "silence", "dot", "noBuff", "noRegen"]);
  // 設定一個狀態（被持續清除擋下時回傳 false）
  function fxSet(p, name, t, v, extra) {
    if (FX_NEG.has(name) && p.st.noDebuff) return false;
    if (name === "dot" && p.st.noDot) return false;
    if (FX_POS.has(name) && p.st.noBuff) return false;
    if (name === "regen" && p.st.noRegen) return false;
    const old = p.st[name];
    p.st[name] = Object.assign({ t: Math.max(t, old ? old.t : 0), v: Math.max(v || 0, old ? old.v || 0 : 0) }, extra || {});
    return true;
  }
  const fxText = (g, p, text, color) => g.fx.push({ kind: "text", text, x: p.x, y: FT.CH * 1.25, t: 0, life: 0.8, color });
  const fxClear = (p, names) => { let n = 0; for (const k of Object.keys(p.st)) if (names.has ? names.has(k) : names.includes(k)) { delete p.st[k]; n++; } return n; };

  // 「增益一個、減益一個」的狀態（依代碼字首 DEBUFF- 決定套哪一個）
  const fxMod = (up, down, upTag, downTag, color) => ({
    apply(g, src, t, e, P) {
      const neg = fxDebuffCode(e.c), name = neg ? down : up;
      if (fxSet(t, name, fxDur(e, P), fxPct(e, P))) fxText(g, t, neg ? downTag : upTag, color);
    },
  });

  /* 處理方式：apply(g, 出手者, 被套用的人, 效果, 決定表參數, 這一下的情況)
     「被套用的人」：對象是敵＝被打中的對手；是己＝出手者自己。hit＝{ dmg 實際扣的血, full 這招原本的傷害, dir, s 技能序 } */
  const FX_BEHAVIOR = {
    dmg: {},                                           // 傷害本身由命中結算處理
    // 持續傷害：命中先扣 DOT_FIRST，其餘在時間內分次扣，總傷害＝單擊的 DOT_TOTAL 倍
    dot: { apply(g, src, t, e, P, hit) {
      const T = fxDur(e, P), total = hit.full * (FX_NUM.DOT_TOTAL - FX_NUM.DOT_FIRST) * (1 - t.dr);
      if (fxSet(t, "dot", T, total / (T / FX_NUM.TICK), { tick: FX_NUM.TICK, from: src.side })) fxText(g, t, "中毒", "#b46bff");
    } },
    stun: { apply(g, src, t, e, P) {
      if (t.stunKind === "down" || t.ko) return;
      t.stun = Math.max(t.stun, fxDur(e, P)); t.stunKind = "stunfx"; t.act = null; t.aim = [null, null, null];
      fxText(g, t, "暈眩", "#ffd84a");
    } },
    down: { knockdown: true, apply(g, src, t, e, P, hit) { if (!hit.dmg) fightDown(g, t, hit.dir); } },
    silence: { apply(g, src, t, e, P) { if (fxSet(t, "silence", fxDur(e, P), 1)) { t.aim[0] = t.aim[1] = null; fxText(g, t, "沉默", "#c9a7ff"); } } },
    // 攻擊增減：只影響普攻（避免技能乘起來一招斃命）
    atk: fxMod("atkUp", "atkDown", "攻↑", "攻↓", "#ffb14a"),
    spd: fxMod("spdUp", "spdDown", "速↑", "速↓", "#7dff9a"),
    // 受到的技能／普攻傷害：增益＝減少，減益＝增加
    skTaken: fxMod("skDef", "skVul", "技傷↓", "技傷↑", "#9fd0ff"),
    atkTaken: fxMod("atkDef", "atkVul", "普傷↓", "普傷↑", "#9fd0ff"),
    // 判定框上下左右一起變大／變小
    atkBox: fxMod("atkBoxUp", "atkBoxDown", "普攻範圍↑", "普攻範圍↓", "#ffd84a"),
    skBox: fxMod("skBoxUp", "skBoxDown", "技能範圍↑", "技能範圍↓", "#ffd84a"),
    // 技能冷卻：持續期間轉快／轉慢，套用當下也立刻減少／增加同比例的剩餘冷卻
    skCd: { apply(g, src, t, e, P) {
      const neg = fxDebuffCode(e.c), v = fxPct(e, P);
      if (!fxSet(t, neg ? "cdSlow" : "cdFast", fxDur(e, P), v)) return;
      t.cd = t.cd.map((c) => c * (neg ? 1 + v : 1 - v));
      fxText(g, t, neg ? "冷卻↑" : "冷卻↓", "#7dd3ff");
    } },
    atkCd: fxMod("atkSpdUp", "atkSpdDown", "攻速↑", "攻速↓", "#ffb14a"),
    cdReset: { apply(g, src, t, e, P, hit) { const o = hit && hit.s != null ? 1 - hit.s : -1; if (o >= 0 && t.cd[o] > 0) { t.cd[o] = 0; fxText(g, t, "冷卻重置", "#7dd3ff"); } } },
    // 清除：立刻清掉；持續清除：清掉並在一段時間內不能再中
    cleanBuff: { apply(g, src, t) { if (fxClear(t, FX_POS)) fxText(g, t, "增益被清除", "#ff8a3d"); } },
    blockBuff: { apply(g, src, t, e, P) { fxClear(t, FX_POS); fxSet(t, "noBuff", fxDur(e, P), 1); fxText(g, t, "封印增益", "#ff8a3d"); } },
    cleanRegen: { apply(g, src, t) { if (fxClear(t, ["regen"])) fxText(g, t, "回血被清除", "#ff8a3d"); } },
    blockRegen: { apply(g, src, t, e, P) { fxClear(t, ["regen"]); fxSet(t, "noRegen", fxDur(e, P), 1); } },
    cleanDebuff: { apply(g, src, t) { if (fxClear(t, FX_NEG)) fxText(g, t, "淨化", "#7dff9a"); } },
    blockDebuff: { apply(g, src, t, e, P) { fxClear(t, FX_NEG); fxSet(t, "noDebuff", fxDur(e, P), 1); fxText(g, t, "減益無效", "#7dff9a"); } },
    cleanDot: { apply(g, src, t) { if (fxClear(t, ["dot"])) fxText(g, t, "解毒", "#7dff9a"); } },
    blockDot: { apply(g, src, t, e, P) { fxClear(t, ["dot"]); fxSet(t, "noDot", fxDur(e, P), 1); } },
    // 吸血：造成傷害的一部分回成血；反射：受到的傷害一部分反彈（見 fightDamage）
    vamp: { apply(g, src, t, e, P) { if (fxSet(t, "vamp", fxDur(e, P), fxRatio(e, P))) fxText(g, t, "吸血", "#ff6b8a"); } },
    mirror: { apply(g, src, t, e, P) { if (fxSet(t, "mirror", fxDur(e, P), fxRatio(e, P))) fxText(g, t, "反射", "#7dd3ff"); } },
    // 回血、持續回血、護盾（取代無敵）
    heal: { apply(g, src, t, e, P) { const v = Math.round(t.maxHp * fxRatio(e, P)); t.hp = Math.min(t.maxHp, t.hp + v); g.fx.push({ kind: "num", text: "+" + v, x: t.x, y: FT.CH * 1.05, t: 0, life: 0.8, heal: true }); } },
    regen: { apply(g, src, t, e, P) { const T = fxDur(e, P); fxSet(t, "regen", T, t.maxHp * fxRatio(e, P) / (T / FX_NUM.TICK), { tick: FX_NUM.TICK }); } },
    shield: { apply(g, src, t, e, P) { const v = t.maxHp * fxRatio(e, P); fxSet(t, "shield", fxDur(e, P), v, { max: v }); fxText(g, t, "護盾", "#7dd3ff"); } },
    // 解除無敵：有傷害的技能穿透護盾（命中結算看 pierce）；沒傷害的技能打掉護盾
    pierce: { pierce: true, apply(g, src, t, e, P, hit) { if (!hit.dmg && t.st.shield) { delete t.st.shield; fxText(g, t, "破盾！", "#ff8a3d"); } } },
  };

  /* 第 2 部分：位移、控制、外觀、詛咒、複製體 */
  // 被控制時不能做的事：fear（被迫後退、不能攻擊）、poly（只能移動）；charm 只是左右反轉
  const fxCantAct = (p) => !!(p.st.fear || p.st.poly);
  // 詛咒會抽的負面效果（借用這些代碼在決定表的設定；含暈眩）
  const FX_CURSE = ["STUN", "SILENCE", "DEBUFF-ATK", "DEBUFF-SPEED", "DEBUFF-SKILL_RESIST", "DEBUFF-NORMAL_DEF", "DEBUFF-ATKRANGE", "DEBUFF-SKILLRANGE", "DEBUFF-SKILL_CHANCE", "DEBUFF-ATKSPD"];
  Object.assign(FX_BEHAVIOR, {
    // 突進：招式本身的動作（js-18-fight-engine 的 FIGHT_RELEASE.dash），這裡不用做事
    dash: { form: "dash" },
    // 把對手拉到自己面前（0.2 秒滑過去）
    pull: { apply(g, src, t) {
      if (t.ko || !src.fs && !g.cfg.fs[src.side]) return;
      const to = src.x + src.face * ((fightFs(g, src).bw + g.cfg.fs[t.side].bw) / 2 + 10);
      fightSlide(t, to, 0.2); fxText(g, t, "拉近", "#ff8a3d");
    } },
    // 擊飛撞牆（v5.4）：對手往後滑到牆邊、撞牆暈眩；施放者同時衝到對手面前（霸體，不會被打斷）
    wall: { apply(g, src, t, e, P) {
      if (t.ko) return;
      const dir = Math.sign(t.x - src.x) || src.face, wx = dir * (FT.AW / 2 - 30), T = FX_NUM.WALL_T, stun = (P.dur && P.dur[0]) || 1;
      if (t.stunKind !== "down") { t.stun = Math.max(t.stun, T + stun); t.stunKind = "stunfx"; t.act = null; t.aim = [null, null, null]; }
      fightSlide(t, wx, T, () => fxText(g, t, "撞牆暈眩", "#ffd84a"));
      fxText(g, t, "擊飛", "#ff8a3d");
      if (!g.p.includes(src) || src.ko) return; // 複製體、召喚物不跟上
      src.armor = true;
      fightSlide(src, wx - dir * ((fightFs(g, src).bw + g.cfg.fs[t.side].bw) / 2 + 10), T, () => { src.armor = false; });
    } },
    // 打中就交換位置
    swap: { apply(g, src, t) { if (t.ko || src.clone) return; const x = src.x; fightSlide(src, t.x, 0.25); fightSlide(t, x, 0.25); fxText(g, t, "換位", "#ff8a3d"); } },
    // 魅惑：左右操作反轉
    charm: { apply(g, src, t, e, P) { if (fxSet(t, "charm", fxDur(e, P), 1)) fxText(g, t, "魅惑", "#ff6bd5"); } },
    // 恐懼：被迫往後退，不能技能、普攻、防禦、跳
    fear: { apply(g, src, t, e, P) { if (fxSet(t, "fear", fxDur(e, P), 1, { from: src.x })) { t.act = null; t.aim = [null, null, null]; fxText(g, t, "恐懼", "#b46bff"); } } },
    // 變形：只能移動；外觀換成施放者這招的投射物圖案（見畫面）
    poly: { apply(g, src, t, e, P, hit) {
      if (fxSet(t, "poly", fxDur(e, P), 1, { own: src.side, bul: hit.bul || null })) { t.act = null; t.aim = [null, null, null]; fxText(g, t, "變形", "#ffd84a"); }
    } },
    // 泡泡：被困住浮在空中，完全不能動（跟暈眩一樣是控制狀態）
    bubble: { apply(g, src, t, e, P) {
      if (t.stunKind === "down" || t.ko) return;
      t.stun = Math.max(t.stun, fxDur(e, P)); t.stunKind = "bubble"; t.act = null; t.aim = [null, null, null]; t.vy = 0;
      fxText(g, t, "泡泡", "#7dd3ff");
    } },
    // 縮放：對手變大，受傷判定框跟著變大
    scale: { apply(g, src, t, e, P) { if (fxSet(t, "big", fxDur(e, P), fxRatio(e, P))) fxText(g, t, "變大", "#ffd84a"); } },
    // 詛咒：從負面效果裡隨機抽一個（用對戰的固定亂數，重播結果一樣）
    curse: { apply(g, src, t, e, P, hit) {
      const pool = FX_CURSE.filter((c) => FIGHT_FX[c]), c = pool[Math.floor(g.rng() * pool.length)];
      if (!c) return;
      fxText(g, t, "詛咒", "#b46bff");
      fxRun(g, src, t, { c, dur: e.dur, durLv: e.durLv, lvMax: e.lvMax, val: null }, hit);
    } },
    // 複製體：技能打中對手時（v6.4 起；沒打中、被擋下就沒有），在自己前面叫出對手的複製體（見 fightCloneSpawn）；
    // 對手有「防複製」就失敗；複製體、召喚物打中不會再叫（避免越叫越多）
    copy: { apply(g, src) { if (g.p.includes(src)) fightCloneSpawn(g, src); } },
    // 清除召喚物：打掉對手場上的召喚物，持續期間對手叫不出召喚物、也叫不出我的複製體
    noCopy: { apply(g, src, t, e, P) {
      let n = 0; for (const m of g.summons) if (m.side !== t.side && m.hp > 0) { m.hp = 0; n++; }
      if (n) fxText(g, t, "清除召喚物", "#7dff9a");
      if (fxSet(t, "noCopy", fxDur(e, P), 1)) fxText(g, t, "防召喚", "#7dff9a");
    } },
    // 召喚（v5.3.1）：叫出這個技能的召喚物（見 fightSummonSpawn）
    // 召喚（v6.4）：技能打中對手才召喚（onHit：跟著命中走，被防禦擋下就沒有）；自身型的技能沒有目標，維持出招時召喚
    summon: { onHit: true, apply(g, src, t, e, P, hit) { if (!src.clone) fightSummonSpawn(g, src, hit.s ?? e.s, fxDur(e, P)); } },
  });
  // 會打斷動作的控制類（突進途中不生效）
  const FX_CONTROL = new Set(["stun", "down", "bubble", "fear", "poly", "pull", "swap", "wall"]);
  FX_POS.add("noCopy"); ["charm", "fear", "poly", "big"].forEach((n) => FX_NEG.add(n));

  // 決定表 × 處理方式 → 已支援的效果（none、new、還沒實作的處理方式都不算）
  const FIGHT_FX = {};
  for (const [code, row] of Object.entries(FX_TABLE)) {
    const B = FX_BEHAVIOR[row.b];
    if (!B) continue;
    FIGHT_FX[code] = { to: row.to, b: row.b, P: row, knockdown: !!B.knockdown, pierce: !!B.pierce, form: B.form || null, onHit: !!B.onHit, apply: B.apply };
  }

  // 狀態在畫面上的名稱（頭上的小標籤）
  const FX_STATUS_TAG = { dot: ["毒", "#b46bff"], silence: ["沉默", "#c9a7ff"], atkDown: ["攻↓", "#9fd0ff"], spdDown: ["速↓", "#9fd0ff"], regen: ["回", "#7dff9a"],
    shield: ["盾", "#7dd3ff"], atkUp: ["攻↑", "#ffb14a"], spdUp: ["速↑", "#7dff9a"], skDef: ["技防", "#7dd3ff"], skVul: ["技弱", "#ff8a3d"],
    atkDef: ["普防", "#7dd3ff"], atkVul: ["普弱", "#ff8a3d"], atkBoxUp: ["普框↑", "#ffd84a"], atkBoxDown: ["普框↓", "#9fd0ff"], skBoxUp: ["技框↑", "#ffd84a"],
    skBoxDown: ["技框↓", "#9fd0ff"], cdFast: ["冷卻快", "#7dd3ff"], cdSlow: ["冷卻慢", "#ff8a3d"], atkSpdUp: ["攻速↑", "#ffb14a"], atkSpdDown: ["攻速↓", "#9fd0ff"],
    vamp: ["吸血", "#ff6b8a"], mirror: ["反射", "#7dd3ff"], noBuff: ["封增", "#ff8a3d"], noRegen: ["封回", "#ff8a3d"], noDebuff: ["淨", "#7dff9a"], noDot: ["抗毒", "#7dff9a"],
    charm: ["魅惑", "#ff6bd5"], fear: ["恐懼", "#b46bff"], poly: ["變形", "#ffd84a"], big: ["變大", "#ffd84a"], noCopy: ["防召喚", "#7dff9a"] };

  // 狀態換算成倍率（加總：增益 + 、減益 −）
  const fxV = (p, name) => (p.st[name] ? p.st[name].v : 0);
  const fxAtkMul = (p) => (1 + fxV(p, "atkUp")) * (1 - fxV(p, "atkDown"));             // 普攻傷害
  const fxSpdMul = (p) => (1 + fxV(p, "spdUp")) * (1 - fxV(p, "spdDown"));             // 移動速度
  const fxTakenMul = (p, skill) => (skill ? 1 - fxV(p, "skDef") + fxV(p, "skVul") : 1 - fxV(p, "atkDef") + fxV(p, "atkVul")); // 受到的傷害
  const fxBoxMul = (p, skill) => (skill ? 1 + fxV(p, "skBoxUp") - fxV(p, "skBoxDown") : 1 + fxV(p, "atkBoxUp") - fxV(p, "atkBoxDown")); // 判定框大小
  const fxCdRate = (p) => 1 + fxV(p, "cdFast") - fxV(p, "cdSlow");                       // 技能冷卻轉的速度
  const fxAtkCdMul = (p) => 1 - fxV(p, "atkSpdUp") + fxV(p, "atkSpdDown");              // 普攻冷卻長度

  // 每一步：狀態倒數、持續傷害／回血到點就結算
  function fxTick(g, p) {
    for (const name of Object.keys(p.st)) {
      const s = p.st[name];
      if (!s) continue; // 前面的持續傷害可能已經把這個狀態打掉（例：泡泡被打破）
      s.t -= FT.STEP;
      if (s.tick) {
        s.acc = (s.acc || 0) + FT.STEP;
        if (s.acc >= s.tick - 1e-9) {
          s.acc -= s.tick;
          if (name === "dot" && !p.ko) fightDamage(g, g.p[s.from], p, s.v, { dot: true });
          if (name === "regen" && !p.ko) { const v = Math.round(s.v); p.hp = Math.min(p.maxHp, p.hp + v); g.fx.push({ kind: "num", text: "+" + v, x: p.x, y: FT.CH * 1.05, t: 0, life: 0.6, heal: true }); }
        }
      }
      if (s.t <= 0) delete p.st[name];
    }
  }
  const fxRun = (g, src, t, e, hit) => { const d = FIGHT_FX[e.c]; if (d && d.apply) d.apply(g, src, t, e, d.P, hit || {}); };
  // 出招時套用在自己身上的效果
  function fxCastSelf(g, p, k) { for (const e of k.selfFx || []) fxRun(g, p, p, e, { s: k.s }); }
  // 命中對手時套用的效果
  function fxOnHit(g, a, o, list, hit) { for (const e of list || []) fxRun(g, a, o, e, hit); }
