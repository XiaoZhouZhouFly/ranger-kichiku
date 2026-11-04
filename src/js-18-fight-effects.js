  /* ---------- 格鬥場：技能效果模組（Effect Registry） ----------
     每種效果代碼（skill_fx.json 的 c）一筆：作用對象 to（"enemy" 命中對手時套用／"self" 出招時套用在自己身上）、
     套用方式 apply(g, 出手者, 目標, 效果, 這一下的情況)，以及畫面用的狀態名稱。
     這裡有的代碼＝格鬥場已支援（標準化層與相容性報告都看這張表）；要加新效果，在這裡加一筆就好，不用改戰鬥主程式。
     效果的數字一律換算到格鬥場的範圍（原作的持續時間常常 8～10 秒，太長），換算規則在 FX_NUM。

     角色身上的狀態 p.st：{ 狀態名: { t: 剩幾秒, v: 數值, … } }
     重複中招：同一種狀態重新計時、數值取比較大的（不疊加），見 fxSet。 */

  // 數字換算：持續秒數上下限、百分比類效果的倍率與上下限
  const FX_NUM = {
    STUN_T: [0.5, 1.5],          // 暈眩
    SILENCE_T: [1, 3],           // 沉默
    MOD_T: [1, 5],               // 攻擊、移速增減
    SHIELD_T: [1, 3],            // 護盾（取代無敵）
    DOT_T: [1, 4],               // 持續傷害、持續回血
    PCT_K: 0.5, PCT: [0.1, 0.3], // 百分比類：資料 % × 0.5，限制在 10%～30%（例如減速 40% → 20%）
    DOT_FIRST: 0.4,              // 持續傷害：命中先扣這招傷害的 40%，其餘 60% 分次扣
    TICK: 0.5,                   // 持續傷害、持續回血每 0.5 秒一次
    HEAL: 0.12,                  // 回血：最大體力的 12%
    DOTHEAL: 0.2,                // 持續回血：總共最大體力的 20%
    SHIELD: 0.15,                // 護盾：最大體力的 15%
  };
  const fxDur = (e, range) => fclamp(e.dur > 0 ? e.dur : range[1], range[0], range[1]);
  const fxPct = (e) => fclamp((e.val > 0 ? e.val : 40) / 100 * FX_NUM.PCT_K, FX_NUM.PCT[0], FX_NUM.PCT[1]);
  // 設定一個狀態：重新計時、數值取大
  function fxSet(p, name, t, v, extra) {
    const old = p.st[name];
    p.st[name] = Object.assign({ t: Math.max(t, old ? old.t : 0), v: Math.max(v || 0, old ? old.v || 0 : 0) }, extra || {});
  }
  const fxText = (g, p, text, color) => g.fx.push({ kind: "text", text, x: p.x, y: FT.CH * 1.25, t: 0, life: 0.8, color });

  const FIGHT_FX = {
    // 傷害本身由命中結算處理（這裡只標示已支援）
    DMG: { to: "enemy" },
    // 持續傷害：命中時 fightHit 只先扣 DOT_FIRST，其餘在這裡分次扣
    DOT: { to: "enemy", status: "dot", apply(g, a, o, e, hit) {
      const T = fxDur(e, FX_NUM.DOT_T), total = hit.full * (1 - FX_NUM.DOT_FIRST) * (1 - o.dr);
      fxSet(o, "dot", T, total / (T / FX_NUM.TICK), { tick: FX_NUM.TICK, from: a.side });
    } },
    // 暈眩：跟受擊硬直不同的控制狀態，期間完全不能動（已經倒地就不再暈）
    STUN: { to: "enemy", apply(g, a, o, e) {
      if (o.stunKind === "down" || o.ko) return;
      o.stun = Math.max(o.stun, fxDur(e, FX_NUM.STUN_T)); o.stunKind = "stunfx"; o.act = null; o.aim = [null, null, null];
      fxText(g, o, "暈眩", "#ffd84a");
    } },
    // 擊退：直接倒地（命中結算裡判斷，這裡處理沒有傷害的情況）
    KNOCKBACK: { to: "enemy", knockdown: true, apply(g, a, o, e, hit) { if (!hit.dmg) fightDown(g, o, hit.dir); } },
    // 沉默：不能用技能（可以移動、防禦、普攻）
    SILENCE: { to: "enemy", status: "silence", apply(g, a, o, e) { fxSet(o, "silence", fxDur(e, FX_NUM.SILENCE_T), 1); o.aim[0] = o.aim[1] = null; fxText(g, o, "沉默", "#c9a7ff"); } },
    "DEBUFF-ATK": { to: "enemy", status: "atkDown", apply(g, a, o, e) { fxSet(o, "atkDown", fxDur(e, FX_NUM.MOD_T), fxPct(e)); fxText(g, o, "攻↓", "#9fd0ff"); } },
    "DEBUFF-SPEED": { to: "enemy", status: "spdDown", apply(g, a, o, e) { fxSet(o, "spdDown", fxDur(e, FX_NUM.MOD_T), fxPct(e)); fxText(g, o, "速↓", "#9fd0ff"); } },
    // 解除無敵（兩種代碼當同一種）：有傷害的技能＝傷害穿透護盾（命中結算看 pierce）；沒傷害＝直接打掉護盾
    CLEAN_UNBEAT: { to: "enemy", pierce: true, apply(g, a, o, e, hit) { if (!hit.dmg && o.st.shield) { delete o.st.shield; fxText(g, o, "破盾！", "#ff8a3d"); } } },
    // 自己身上
    HEAL: { to: "self", apply(g, p) { const v = Math.round(p.maxHp * FX_NUM.HEAL); p.hp = Math.min(p.maxHp, p.hp + v); g.fx.push({ kind: "num", text: "+" + v, x: p.x, y: FT.CH * 1.05, t: 0, life: 0.8, heal: true }); } },
    DOTHEAL: { to: "self", status: "regen", apply(g, p, o, e) { const T = fxDur(e, FX_NUM.DOT_T); fxSet(p, "regen", T, p.maxHp * FX_NUM.DOTHEAL / (T / FX_NUM.TICK), { tick: FX_NUM.TICK }); } },
    // 無敵 → 護盾：先吸收傷害，被打破或時間到就消失
    UNBEAT: { to: "self", status: "shield", apply(g, p, o, e) { fxSet(p, "shield", fxDur(e, FX_NUM.SHIELD_T), p.maxHp * FX_NUM.SHIELD); fxText(g, p, "護盾", "#7dd3ff"); } },
    "BUFF-ATK": { to: "self", status: "atkUp", apply(g, p, o, e) { fxSet(p, "atkUp", fxDur(e, FX_NUM.MOD_T), fxPct(e)); fxText(g, p, "攻↑", "#ffb14a"); } },
    "BUFF-SPEED": { to: "self", status: "spdUp", apply(g, p, o, e) { fxSet(p, "spdUp", fxDur(e, FX_NUM.MOD_T), fxPct(e)); fxText(g, p, "速↑", "#7dff9a"); } },
  };
  FIGHT_FX.CLEANING_UNBEAT = FIGHT_FX.CLEAN_UNBEAT;
  // 狀態在畫面上的名稱（頭上的小標籤）
  const FX_STATUS_TAG = { dot: ["毒", "#b46bff"], silence: ["沉默", "#c9a7ff"], atkDown: ["攻↓", "#9fd0ff"], spdDown: ["速↓", "#9fd0ff"], regen: ["回", "#7dff9a"],
    shield: ["盾", "#7dd3ff"], atkUp: ["攻↑", "#ffb14a"], spdUp: ["速↑", "#7dff9a"] };

  // 攻擊、移速的倍率（狀態加總）
  const fxAtkMul = (p) => (1 + (p.st.atkUp ? p.st.atkUp.v : 0)) * (1 - (p.st.atkDown ? p.st.atkDown.v : 0));
  const fxSpdMul = (p) => (1 + (p.st.spdUp ? p.st.spdUp.v : 0)) * (1 - (p.st.spdDown ? p.st.spdDown.v : 0));

  // 每一步：狀態倒數、持續傷害／回血到點就結算
  function fxTick(g, p) {
    for (const name of Object.keys(p.st)) {
      const s = p.st[name];
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
  // 出招時套用在自己身上的效果
  function fxCastSelf(g, p, k) { for (const e of k.selfFx || []) FIGHT_FX[e.c].apply(g, p, null, e); }
  // 命中對手時套用的效果（hit＝{ dmg: 這一下實際扣的血, full: 這招原本的傷害, dir }）
  function fxOnHit(g, a, o, list, hit) { for (const e of list || []) { const d = FIGHT_FX[e.c]; if (d && d.apply) d.apply(g, a, o, e, hit); } }
