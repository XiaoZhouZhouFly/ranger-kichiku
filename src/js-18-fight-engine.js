  /* ---------- 格鬥場（v5.0 測試版）：規則引擎 ----------
     一對一、側面、玩家自己操作。fightStep 每一步（1/60 秒）只吃「雙方這一步的按鍵」與固定亂數，
     同樣的按鍵就會得到同樣的結果（之後錄影、線上對戰都靠這點）。跟雙人對戰的 compileReal 完全分開。
     數值在 js-18-fight-data.js，畫面與觸控在 js-19。 */

  /* ---------- 狀態 ----------
     cfg：{ f: [角色, 角色], fs: [數值, 數值], rounds, secs（0＝不限時）, mode: "dummy"|"cpu"|"pvp", seed,
            holdMove（按住招式時左右鍵也能走路）, teleMode（矩形預告："dist" 依距離／"sync" 跟前搖） }
     每位選手 p：
       位置 x、y、vy、vx、face（1 往右）；hp／maxHp；dr（減傷）
       act      正在做的招式 { kind: "atk"|"sk", s（0、1＝技能，2＝普攻）, t, dur, hitAt, id, air, … }
       stun／stunKind  剩幾秒不能操作、原因："hit" 被打、"block" 防禦硬直、"break" 破防、"down" 倒地
       kbv      被推的速度；inv 無敵剩幾秒（起身無敵）
       sv       硬直累積值（滿 SV_MAX 倒地）；combo 這一串被打第幾下（傷害遞減用）；quiet 多久沒挨打；free 恢復操作多久了
       gauge    防禦條；guard 這一步是否在防禦；guardIdle 多久沒防禦（回防禦條用）；guardLock 破防後還不能防
       cd[2]／atkCd 冷卻；aim[3] 按住中的招式 { d0, d, cancel }；buf[3] 輸入緩衝 { t, up }
       buff     「輔助（代替）」技能的加攻剩幾秒；st 技能效果造成的狀態（見 js-18-fight-effects.js）
       state    目前狀態（給畫面與測試看，見 fightStateOf） */
  function fightFighter(g, side) {
    const fs = g.cfg.fs[side];
    return { side, x: side ? 220 : -220, y: 0, vy: 0, vx: 0, face: side ? -1 : 1, hp: fs.hp, maxHp: fs.hp, dr: fs.dr,
      act: null, stun: 0, stunKind: "", kbv: 0, inv: 0, sv: 0, combo: 0, quiet: 9, free: 9, gauge: FT.GAUGE_MAX, guard: false, guardIdle: 9, guardLock: false,
      cd: [0, 0], atkCd: 0, aim: [null, null, null], buf: [null, null, null], buff: 0, st: {}, anim: { clip: null, t: 0 }, ko: false, state: "idle" };
  }
  function fightNew(cfg) {
    const g = { cfg, rng: mulberry32((cfg.seed || 1) * 7919 + 7), round: 1, wins: [0, 0], phase: "intro", phaseT: 0, timeLeft: cfg.secs,
      projs: [], teles: [], clones: [], summons: [], fx: [], events: [], t: 0, winner: -1, roundWinner: -1, nextId: 1,
      stats: { lastCombo: 0, lastDmg: 0, total: 0, hits: 0 } };
    g.p = [fightFighter(g, 0), fightFighter(g, 1)];
    g.events.push({ type: "round" });
    return g;
  }
  /* 一步的按鍵：mx 左右（-1／0／1）、jump 起跳（按下那一步）、guard 防禦（按住）、atk 近戰普攻（按下那一步）；
     「按住」的按鈕用三格陣列：0、1＝技能，2＝普攻（投射物角色）。skDown／skUp＝按下、放開那一步，
     skAim＝從按下位置往前拖了多少場地單位（只有矩形、拋物線會用），skCancel＝手指在取消圈外 */
  const fightBlankInput = () => ({ mx: 0, run: false, jump: false, guard: false, atk: false, skDown: [false, false, false], skUp: [false, false, false], skCancel: [false, false, false], skAim: [null, null, null] });
  const FT_EMPTY = fightBlankInput();
  const fightSlot = (fs, s) => (s === 2 ? fs.atk : fs.sk[s]); // 第 s 格按鈕對應的招式（2＝普攻）
  const FT_AIMED = { front: true, rect: true, lob: true, line: true, shot: true, dash: true }; // 按住才出招的種類（放開時出招）
  const fightFs = (g, p) => p.fs || g.cfg.fs[p.side]; // 選手（或複製體）的數值
  // 強制滑動（拉近、交換位置、突進）：T 秒內從目前位置滑到 to；onEnd 在到達時呼叫
  function fightSlide(p, to, T, onEnd) { p.slide = { x0: p.x, x1: fclamp(to, -FT.AW / 2 + 30, FT.AW / 2 - 30), t: 0, T, onEnd }; }
  const fOnGround = (p) => p.y <= 0.01;
  const fFree = (p) => !p.ko && p.stun <= 0 && !p.act; // 可以出新招
  // 矩形預告時間：依距離（近快遠慢）或跟這招的前搖一樣長
  const fightTeleDelay = (g, k, d) => (g.cfg.teleMode === "sync" ? Math.max(FT.TELE_SYNC_MIN, k.hitAt) : FT.TELE_MIN + (FT.TELE_MAX - FT.TELE_MIN) * (d / k.range));
  // 目前狀態（給畫面顯示與測試用；規則本身看各個計時器）
  const FT_STATE_LABEL = { idle: "待機", walk: "走路", run: "衝刺", jump: "跳", aim: "瞄準", attack: "攻擊", skill: "技能", guard: "防禦", block: "防禦硬直", hit: "硬直", break: "破防", down: "倒地", stunfx: "暈眩", bubble: "泡泡", ko: "倒下" };
  function fightStateOf(p) {
    if (p.ko) return "ko";
    if (p.stun > 0) return p.stunKind || "hit";
    if (p.act) return p.act.kind === "atk" ? "attack" : "skill";
    if (p.aim.some(Boolean)) return "aim";
    if (p.guard) return "guard";
    if (!fOnGround(p)) return "jump";
    if (p.running) return "run";
    return Math.abs(p.vx) > 1 ? "walk" : "idle";
  }

  /* ---------- 每一步 ---------- */
  function fightStep(g, inputs) {
    const dt = FT.STEP; g.t += dt; g.events = [];
    fightPhase(g);
    const live = g.phase === "fight";
    if (live && g.cfg.secs > 0 && g.cfg.mode !== "dummy") {
      g.timeLeft = Math.max(0, g.timeLeft - dt);
      if (g.timeLeft <= 0) fightRoundEnd(g, -2);
    }
    for (const i of [0, 1]) fightUnit(g, g.p[i], g.p[1 - i], live && g.phase === "fight" ? inputs[i] || FT_EMPTY : FT_EMPTY);
    fightSeparate(g);
    fightProjectiles(g);
    fightTeles(g);
    fightClones(g);
    fightSummons(g);
    for (const p of g.p) p.state = fightStateOf(p);
    for (const e of g.fx) e.t += dt;
    g.fx = g.fx.filter((e) => e.t < (e.life || 0.6));
    // 木樁：一陣子沒挨打就回滿血，而且不會倒
    if (g.cfg.mode === "dummy") {
      const d = g.p[1];
      if (d.quiet >= FT.DUMMY_REFILL && d.hp < d.maxHp) { d.hp = d.maxHp; g.stats.lastCombo = 0; }
    }
  }
  // 回合流程：intro（第幾回合）→ count（3 2 1）→ fight → end（K.O.／時間到）→ 下一回合或 over
  function fightPhase(g) {
    const dt = FT.STEP; g.phaseT += dt;
    if (g.phase === "intro" && g.phaseT >= 0.8) { g.phase = "count"; g.phaseT = 0; g.events.push({ type: "beep" }); }
    else if (g.phase === "count") {
      const n = Math.floor(g.phaseT);
      if (n !== Math.floor(g.phaseT - dt) && n < 3) g.events.push({ type: "beep" });
      if (g.phaseT >= 3) { g.phase = "fight"; g.phaseT = 0; g.events.push({ type: "go" }); }
    } else if (g.phase === "end" && g.phaseT >= 2.2) {
      const need = Math.ceil(g.cfg.rounds / 2);
      if (g.wins[0] >= need || g.wins[1] >= need || g.round >= g.cfg.rounds) {
        g.phase = "over"; g.winner = g.wins[0] === g.wins[1] ? -1 : g.wins[0] > g.wins[1] ? 0 : 1;
      } else {
        g.round++; g.phase = "intro"; g.phaseT = 0; g.timeLeft = g.cfg.secs;
        g.p = [fightFighter(g, 0), fightFighter(g, 1)]; g.projs = []; g.teles = []; g.clones = []; g.summons = []; g.events.push({ type: "round" });
      }
    }
  }
  function fightRoundEnd(g, loser) {
    if (g.phase !== "fight") return;
    let w;
    if (loser >= 0) w = 1 - loser;
    else { const a = g.p[0].hp / g.p[0].maxHp, b = g.p[1].hp / g.p[1].maxHp; w = Math.abs(a - b) < 1e-6 ? -1 : a > b ? 0 : 1; } // 時間到：比剩餘血量比例
    g.roundWinner = w; g.endKind = loser >= 0 ? "ko" : "time";
    if (w >= 0) g.wins[w]++;
    g.phase = "end"; g.phaseT = 0;
    g.events.push({ type: loser >= 0 ? "ko" : "timeup" });
  }

  function fightAnim(p, clip) { if (p.anim.clip !== clip) p.anim = { clip, t: 0 }; }

  /* 一位選手的一步：計時器 → 倒下／硬直 → 防禦 → 出招中 → 按住中的招式 → 移動與出新招 → 物理 */
  // 招式是不是在前搖中被打斷了（出招物件已經不是目前的招式，而且還沒到前搖結束）
  const fightCutAct = (g, a, p) => !!(a && a.kind === "sk" && p && p.act !== a && a.t < a.hitAt - 1e-9);
  function fightUnit(g, p, o, inp) {
    const dt = FT.STEP, f = g.cfg.f[p.side];
    // 技能在前搖被控制打斷：頭上跳「中斷」
    if (p.lastAct && fightCutAct(g, p.lastAct, p)) g.fx.push({ kind: "text", text: "中斷", x: p.x, y: FT.CH * 1.3, t: 0, life: 0.7, color: "#9aa3c8" });
    p.lastAct = p.act;
    fightTimers(p, inp);
    fxTick(g, p);
    fightSlideStep(g, p);
    if (p.ko) { p.x += p.kbv * dt; p.kbv *= 0.9; fightPhysics(g, p); return; }
    if (p.stun > 0 || p.act) p.running = false; // 被打、出招就停止衝刺
    if (p.stun > 0) { fightStunned(g, p); return; }
    p.x += p.kbv * dt; p.kbv *= 0.8; // 擋下攻擊後的小滑行
    const ground = fOnGround(p);
    fightGuard(g, p, inp, ground);
    if (p.stun > 0) return; // 這一步破防了
    if (p.act) fightActing(g, p, o);
    fightAims(g, p, o, inp);
    if (!p.act) fightFreeMove(g, p, o, inp, ground);
    if (!p.act) fightAnim(p, !ground ? f.clips.move || idleClip(f) : Math.abs(p.vx) > 1 ? f.clips.move || idleClip(f) : idleClip(f));
    fightPhysics(g, p);
  }

  function fightSlideStep(g, p) {
    const m = p.slide; if (!m) return;
    m.t += FT.STEP; const r = Math.min(1, m.t / m.T);
    p.x = m.x0 + (m.x1 - m.x0) * r;
    if (r >= 1) { p.slide = null; if (m.onEnd) m.onEnd(); }
  }

  function fightTimers(p, inp) {
    const dt = FT.STEP;
    p.anim.t += dt * (p.running ? FT.RUN_ANIM : 1); // 衝刺：跑步動畫加快
    p.cd = p.cd.map((c) => Math.max(0, c - dt * fxCdRate(p))); p.atkCd = Math.max(0, p.atkCd - dt);
    p.inv = Math.max(0, p.inv - dt); p.buff = Math.max(0, p.buff - dt);
    p.quiet += dt;
    // 硬直累積值：一陣子沒挨打就開始下降
    if (p.quiet >= FT.SV_DECAY_WAIT) p.sv = Math.max(0, p.sv - FT.SV_DECAY * dt);
    // 連段：恢復操作後 COMBO_RESET 秒內又被打中仍算同一串；超過就重來（傷害遞減歸零）
    p.free = p.stun > 0 ? 0 : p.free + dt;
    if (p.free >= FT.COMBO_RESET) p.combo = 0;
    // 輸入緩衝：按下的那一步記起來，BUFFER 秒內能出招就自動接上；放開也記下來（點一下＝按下＋放開）
    for (const s of [0, 1, 2]) {
      const b = p.buf[s];
      if (b) { b.t -= dt; if (b.t <= 0) p.buf[s] = null; }
      const down = s === 2 ? inp.skDown[2] || inp.atk : inp.skDown[s];
      if (down && !p.aim[s]) p.buf[s] = { t: FT.BUFFER, up: false };
      if (inp.skUp[s] && p.buf[s]) p.buf[s].up = true;
    }
  }

  // 硬直中（被打、防禦硬直、破防、倒地、暈眩）：被推、播被擊退動作；倒地結束後給起身無敵
  function fightStunned(g, p) {
    const dt = FT.STEP, f = g.cfg.f[p.side];
    p.stun -= dt; p.x += p.kbv * dt; p.kbv *= 0.88;
    if (p.stunKind === "bubble") { p.y += (FT.BUBBLE_H - p.y) * 0.12; p.vy = 0; } // 泡泡：慢慢浮起來，結束後落下
    p.guard = p.stunKind === "block"; // 防禦硬直時仍然在防禦（連續的攻擊照樣擋）
    if (p.stunKind !== "block") fightAnim(p, f.clips.knockback || idleClip(f));
    if (p.stun <= 0) {
      if (p.stunKind === "down") { p.inv = FT.WAKE_INV; g.fx.push({ kind: "text", text: "起身", x: p.x, y: FT.CH * 1.2, t: 0, life: 0.6 }); }
      p.stun = 0; p.stunKind = "";
    }
    if (p.stunKind !== "bubble") fightPhysics(g, p);
  }

  /* 防禦：按住、沒在出招、防禦條還有。v6.3 起空中也能防（解決被遠程風箏）：
     空中防禦扣防禦條 ×AIR_GUARD_MUL、被打不會被推、不會有防禦硬直（照樣往前飄）；空中防禦過，這一跳落地前都不能出招（airGuarded）。 */
  // 按住本身會消耗防禦條，扣完就破防；破防後要回到 GAUGE_REARM 才能再防
  function fightGuard(g, p, inp, ground) {
    const dt = FT.STEP;
    if (p.guardLock && p.gauge >= FT.GAUGE_REARM) p.guardLock = false;
    p.guard = !!inp.guard && !(inp.run && inp.mx) && !p.act && p.gauge > 0 && !p.guardLock && !fxCantAct(p); // 恐懼、變形時不能防；衝刺中不能防（v7.0）
    if (ground) p.airGuarded = false; else if (p.guard) p.airGuarded = true;
    if (p.guard) {
      p.guardIdle = 0;
      p.gauge -= FT.GAUGE_HOLD * dt;
      if (p.gauge <= 0) fightBreak(g, p);
    } else {
      p.guardIdle += dt;
      if (p.guardIdle >= FT.GAUGE_WAIT && p.quiet >= FT.GAUGE_WAIT) p.gauge = Math.min(FT.GAUGE_MAX, p.gauge + FT.GAUGE_REGEN * dt);
    }
  }
  function fightBreak(g, p) {
    p.gauge = 0; p.guard = false; p.guardLock = true; p.stun = FT.BREAK_STUN; p.stunKind = "break"; p.kbv = -p.face * 160;
    p.aim = [null, null, null]; p.act = null;
    g.fx.push({ kind: "break", x: p.x, y: FT.CH * 0.55, t: 0, life: 0.7 }); g.events.push({ type: "break", side: p.side });
  }

  // 出招中：到前搖結束才判定；近戰普攻的判定持續 ACTIVE 秒（打中一次就停）
  function fightActing(g, p, o) {
    const a = p.act; a.t += FT.STEP;
    // 給自己的效果：前搖結束才生效（v6.0.2；被控制打斷就沒有）
    if (a.kind === "sk" && !a.selfDone && a.t >= a.hitAt) { a.selfDone = true; fxCastSelf(g, p, fightSlot(fightFs(g, p), a.s)); }
    if (a.t >= a.hitAt && !a.done) {
      if (a.melee) { if (fightMeleeCheck(g, p, o, a) || a.t >= a.hitAt + FT.ACTIVE) a.done = true; }
      else { a.done = true; fightRelease(g, p, o, a); }
    }
    if (a.t >= a.dur) p.act = null;
  }

  // 按住中的招式：矩形、拋物線可以拖曳調整距離；放開出招（拖到外圈＝取消）
  function fightAims(g, p, o, inp) {
    const fs = g.cfg.fs[p.side];
    for (const s of [0, 1, 2]) {
      const aim = p.aim[s], k = fightSlot(fs, s);
      if (!aim) continue;
      // 突進：落點用場地上的實際位移（左右都能拖，無視朝向；skAim 是「往前拖多少」，乘回面向＝往右拖多少）
      // 身前範圍（v7.4）：左右拖選方向（拖超過 20 才換邊；aim.d＝場地上的方向 ±1）
      if (k.kind === "front" && inp.skAim[s] != null) { const dx = inp.skAim[s] * p.face; if (Math.abs(dx) > 20) aim.d = dx > 0 ? 1 : -1; }
      else if (k.kind === "dash" && inp.skAim[s] != null) { const R = k.range * fxBoxMul(p, true); aim.d = fclamp(aim.d0 + inp.skAim[s] * p.face, -R, R); }
      // 矩形、拋物線（v7.4）：左右都能拖，無視面向。D＝場地上離身體前緣的有號距離（起點＝面向那邊、對手的距離）；
      //   |D| 小於 AIM_MIN 時維持原本那邊的最短距離；放開時轉向 aim.side 再出招
      else if (AIM_MODE[k.kind] === "dist" && inp.skAim[s] != null) {
        if (Math.abs(inp.skAim[s]) < 1) { aim.side = null; aim.d = aim.d0; } // 沒拖：跟以前一樣（朝放開時的面向，按住中用左右鍵轉身也照舊）
        else {
          const R = k.range * fxBoxMul(p, s < 2), D = fclamp(p.face * aim.d0 + inp.skAim[s] * p.face, -R, R);
          if (Math.abs(D) >= FT.AIM_MIN) { aim.side = D > 0 ? 1 : -1; aim.d = Math.abs(D); } else aim.d = FT.AIM_MIN;
        }
      }
      // 直線、普攻投射物（v7.4）：左右拖選方向（拖超過 20 才換邊）
      else if (AIM_MODE[k.kind] === "dir" && inp.skAim[s] != null) { const dx = inp.skAim[s] * p.face; if (Math.abs(dx) > 20) aim.side = dx > 0 ? 1 : -1; }
      aim.cancel = !!inp.skCancel[s];
      if (!inp.skUp[s] && !aim.release) continue;
      p.aim[s] = null;
      if (aim.cancel || !fFree(p) || (s < 2 && !fOnGround(p))) continue;
      fightCast(g, p, s, k, aim.d, aim.side);
    }
  }
  // 出招（放開按住的招式，或按下就放的招式）：設定動作、冷卻；矩形在這一刻放出預告
  function fightCast(g, p, s, k, d, side) {
    const f = g.cfg.f[p.side];
    if (k.kind === "front" && (d === 1 || d === -1)) p.face = d; // 身前範圍：轉向選的那一邊再出招
    else if (side === 1 || side === -1) p.face = side; // 矩形、拋物線、直線（v7.4）：轉向選的那一邊再出招
    const act = { kind: s === 2 ? "atk" : "sk", s, t: 0, dur: k.dur, hitAt: k.hitAt, done: false, clip: k.clip, aimD: d, id: g.nextId++, air: !fOnGround(p), melee: s === 2 && k.kind === "melee" };
    if (k.kind === "rect") {
      const delay = fightTeleDelay(g, k, d);
      const box = fxBoxMul(p, true); // 技能判定框大小（範圍增減效果）
      g.teles.push({ own: p.side, x: p.x + p.face * (g.cfg.fs[p.side].bw / 2 + d + (k.off || 0) * box), w: k.width * box, face: p.face, off: (k.off || 0) * box, fxs: (k.fxs || 1) * box, air: FT.AIR_SAFE * box, t: 0, delay, dmg: k.dmg, sv: k.sv, s, bul: k.bul, id: act.id, fx: k.enemyFx, act });
      act.done = true; // 傷害由預告結算（施放者在前搖被控制打斷時，預告會消失：見 fightTeles）
    }
    p.act = act;
    if (s === 2) p.atkCd = Math.max(0.15, k.cd * fxAtkCdMul(p)); else p.cd[s] = k.cd; // 攻速增減只影響普攻冷卻
    fightAnim(p, k.clip || idleClip(f));
    if (s < 2) g.events.push({ type: "cast", side: p.side }); // 給自己的效果在前搖結束時才套用（fightActing）
    if (k.kind === "dash") p.armor = true; // 突進：從出招到衝完都不會被打斷
    if (k.kind === "dline") { const bw = g.cfg.fs[p.side].bw; g.fx.push({ kind: "dlineTele", own: p.side, x0: p.x + p.face * bw / 2, x1: p.x + p.face * (bw / 2 + k.range), y: p.y + FT.CH * 0.4, t: 0, life: k.hitAt }); }
    if (act.melee) { const bw = g.cfg.fs[p.side].bw; g.fx.push({ kind: "reach", own: p.side, x0: p.x + p.face * bw / 2, x1: p.x + p.face * (bw / 2 + k.reach), y: p.y, t: 0, life: FT.ACTIVE + k.hitAt + 0.1 }); }
    if (k.kind === "buff" || k.kind === "self") g.fx.push({ kind: "selfring", own: p.side, x: p.x, t: 0, life: 0.8 });
  }

  // 沒在出招：移動、轉身、跳、開始新招（含輸入緩衝）
  function fightFreeMove(g, p, o, inp, ground) {
    const dt = FT.STEP, fs = g.cfg.fs[p.side];
    const aiming = p.aim.some(Boolean);
    // 按住招式時：預設左右鍵只轉身不走路（設定 holdMove 時照常走路）
    // 魅惑：左右反轉；恐懼：被迫往遠離施放者的方向走
    let mx = p.guard && ground ? 0 : inp.mx * (p.st.charm ? -1 : 1); // 空中防禦時還是可以往前飄
    if (p.st.fear) mx = p.x >= p.st.fear.from ? 1 : -1;
    if (mx && !p.guard) p.face = mx > 0 ? 1 : -1;
    const walk = aiming && !g.cfg.holdMove ? 0 : mx;
    // 衝刺（v7.0）：連點兩下方向鍵（inp.run），在地上、沒在瞄準時速度 ×RUN_MUL；起跑時腳邊揚起塵土
    // 衝刺：瞄準技能時照樣衝（v7.0 調整）；衝刺中起跳，空中維持衝刺速度直到落地（airRun）
    if (ground) p.airRun = false;
    const run = !!(inp.run && walk && (ground || p.airRun) && !p.st.fear && !p.st.charm);
    if (!ground) { /* 空中不揚塵 */ } else if (run && !p.running) g.fx.push({ kind: "dust", x: p.x, dir: walk, t: 0, life: 0.5, big: true });
    else if (run && Math.floor(p.anim.t * 8) !== Math.floor((p.anim.t - dt * FT.RUN_ANIM) * 8)) g.fx.push({ kind: "dust", x: p.x - walk * 20, dir: walk, t: 0, life: 0.35 });
    p.running = run;
    p.vx = walk * fs.walk * fxSpdMul(p) * (run ? FT.RUN_MUL : ground ? 1 : FT.AIR_CTRL); // 衝刺跳：空中不打折
    p.x += p.vx * dt;
    if (inp.jump && ground && !p.guard && !p.aim[0] && !p.aim[1] && !fxCantAct(p)) { p.vy = FT.JUMP_V; if (run) p.airRun = true; } // 瞄準技能時不能跳（技能只能在地上放）；衝刺中起跳＝衝刺跳
    if (p.guard || fxCantAct(p) || p.airGuarded) return; // 恐懼、變形：只能移動；空中防禦過：落地前不能出招
    // 開始新招：普攻（地上、空中都可以），技能（只能在地上；投射物技能每人場上最多一顆）
    for (const s of [2, 0, 1]) {
      const b = p.buf[s], k = fightSlot(fs, s);
      if (!b || !k || p.act || p.aim[s]) continue;
      if (s === 2 ? p.atkCd > 0 : p.cd[s] > 0 || !ground || p.st.silence) continue; // 沉默：不能用技能
      if (s < 2 && (k.kind === "line" || k.kind === "lob") && g.projs.some((q) => q.own === p.side && q.skill)) continue;
      p.buf[s] = null;
      if (!FT_AIMED[k.kind]) { fightCast(g, p, s, k, 0); continue; } // 近戰普攻、輔助技能：按下就放
      // 按住才出的招：起點＝按下當下對手的距離（之後不會自己跟著跑）；已經放開了（點一下）就直接出
      const gap = Math.max(0, Math.abs(o.x - p.x) - (fs.bw + g.cfg.fs[o.side].bw) / 2);
      // v7.4：矩形起點扣掉 off（特效範圍中心離落點多遠），讓範圍中心對準對手
      let d0 = AIM_MODE[k.kind] === "dist" ? fclamp(gap + g.cfg.fs[o.side].bw / 2 - (k.kind === "rect" ? (k.off || 0) * fxBoxMul(p, true) : 0), FT.AIM_MIN, k.range * fxBoxMul(p, s < 2)) : 0;
      if (k.kind === "dash") d0 = fclamp(o.x - p.x, -k.range, k.range); // 突進：起點＝對手的位置（場地上的位移，可以在背後）
      if (k.kind === "front") d0 = p.face; // 身前範圍：起點＝目前面向
      p.aim[s] = { d0, d: d0, side: null, cancel: false, release: b.up };
    }
  }

  // 物理：重力、落地；空中普攻還沒結束就落地＝中斷
  function fightPhysics(g, p) {
    const dt = FT.STEP;
    if (p.y > 0 || p.vy > 0) {
      p.y += p.vy * dt; p.vy -= FT.GRAV * dt;
      if (p.y <= 0) {
        p.y = 0; p.vy = 0;
        if (p.act && p.act.air) { p.act = null; g.fx.push({ kind: "text", text: "落地", x: p.x, y: FT.CH * 1.1, t: 0, life: 0.4 }); }
      }
    }
  }
  /* 兩人不會重疊（用身體寬推開）、不會走出場地。
     只有一方在空中時完全不推（跳得過對手）；兩人都在地上時一定推；兩人都在空中時高度差超過 PUSH_H 個身高就不推。
     越過去不會自動轉身。 */
  function fightSeparate(g) {
    const [a, b] = g.p, fa = g.cfg.fs[0], fb = g.cfg.fs[1];
    const ga = fOnGround(a), gb = fOnGround(b);
    // 突進途中直接穿過對手（不推擠）；衝完停在對手身上時由突進那邊自己退開（見 FIGHT_RELEASE.dash）
    const dashing = (a.slide && a.armor) || (b.slide && b.armor);
    const push = dashing ? false : ga && gb ? true : ga !== gb ? false : Math.abs(a.y - b.y) < FT.CH * FT.PUSH_H;
    const minD = (fa.bw + fb.bw) / 2;
    const dx = b.x - a.x;
    if (Math.abs(dx) < minD && push) {
      const push = (minD - Math.abs(dx)) / 2, dir = dx >= 0 ? 1 : -1;
      a.x -= dir * push; b.x += dir * push;
    }
    for (const [p, fs] of [[a, fa], [b, fb]]) p.x = fclamp(p.x, -FT.AW / 2 + fs.bw / 2, FT.AW / 2 - fs.bw / 2);
  }

  /* ---------- 判定 ----------
     受傷框：寬 HURT_W、從腳底往上一個身高，置中在角色 x（跟圖片大小無關）。 */
  const fHurtMul = (o) => 1 + (o.st && o.st.big ? o.st.big.v : 0); // 縮放：受傷判定框跟著變大
  const fHurt = (o) => { const m = fHurtMul(o); return { x0: o.x - FT.HURT_W * m / 2, x1: o.x + FT.HURT_W * m / 2, y0: o.y, y1: o.y + FT.CH * m }; };
  const fOverlapX = (a0, a1, b0, b1) => Math.max(a0, a1) >= Math.min(b0, b1) && Math.min(a0, a1) <= Math.max(b0, b1);
  // 近戰普攻：判定框從身體前緣往前 reach，高度跟著出招者當下的位置（空中普攻也是）
  function fightMeleeCheck(g, p, o, a) {
    const fs = g.cfg.fs[p.side], k = fs.atk, h = fHurt(o), m = fxBoxMul(p, false); // 普攻判定框大小
    const x0 = p.x + p.face * fs.bw / 2, x1 = x0 + p.face * k.reach * m;
    if (fightHitSummons(g, p.side, x0, x1, p.y, p.y + FT.CH * 0.8 * m, k.dmg)) return true; // 召喚物擋在前面就打到召喚物
    if (o.ko || !fOverlapX(x0, x1, h.x0, h.x1) || h.y0 > p.y + FT.CH * 0.8 * m || h.y1 < p.y - FT.CH * 0.1 * (m - 1)) return false;
    fightHit(g, p, o, k.dmg, k.sv, false, a.id, null);
    g.events.push({ type: "swing", side: p.side });
    return true;
  }
  // 射出投射物或使用輔助技能（前搖結束的那一刻）
  /* 前搖結束的那一刻：依招式種類交給對應的處理函式（近戰、矩形不在這裡：近戰在 fightActing 判定，矩形由預告結算）。
     沒有處理函式的種類不會被當成別的招式，只記錄「不支援」（標準化層應該已經換成支援的形式，這裡是最後一道保險）。 */
  const FIGHT_RELEASE = {
    buff(g, p, o, a, k) {
      p.buff = FT.BUFF_TIME; p.hp = Math.min(p.maxHp, p.hp + FT.HEAL);
      g.fx.push({ kind: "buff", x: p.x, y: FT.CH, t: 0, life: 1.0 });
    },
    // 拋物線：k.lobT 秒後落在拖曳的距離（從身體前緣算）；畫面會在落點畫預告
    lob(g, p, o, a, k) {
      const b = fightProjBase(g, p, a, k), T = k.lobT || FT.LOB_TIME, h0 = FT.CH * 0.6 + p.y, land = b.x + p.face * a.aimD;
      const gm = FT.LOB_GRAV_MUL; // v7.4：同樣飛行時間、重力 ×2＝弧線更高（跟直線做出區別：不跳也能從底下穿過，只有快落地時打得到）
      g.projs.push(Object.assign(b, { kind: "lob", hideOwner: !!k.hideBody, y: h0, py: h0, gm, vx: (land - b.x) / T, vy: (0.5 * FT.GRAV * gm * T * T - h0) / T, landX: land }));
    },
    // 直線（技能與普攻投射物）：朝面向一直飛，飛出場地或打中才消失
    line(g, p, o, a, k) {
      const b = fightProjBase(g, p, a, k), y = p.y + FT.CH * (a.s === 2 ? 0.35 : 0.28);
      g.projs.push(Object.assign(b, { kind: "line", y, py: y, vx: p.face * (k.speed || FT.SPEED_DEF), vy: 0, x0: b.x, pb: k.pbox || null, face: p.face, hideOwner: !!k.hideBody })); // x0：起點（最多飛 SHOT_MAX）；pb：碰撞框（v7.5）
    },
    // 瞬間直線（遠程直接命中的普攻）：不產生飛行物，這一刻檢查身體前緣往前 range 內、同一高度有沒有對手
    dline(g, p, o, a, k) {
      const fs = fightFs(g, p), m = fxBoxMul(p, a.s < 2), x0 = p.x + p.face * fs.bw / 2, x1 = x0 + p.face * k.range * m, h = fHurt(o);
      g.fx.push({ kind: "dline", own: p.side, x0, x1, y: p.y + FT.CH * 0.4, t: 0, life: 0.25 });
      fightHitSummons(g, p.side, x0, x1, p.y, p.y + FT.CH * 0.8 * m, k.dmg);
      if (!o.ko && fOverlapX(x0, x1, h.x0, h.x1) && h.y0 <= p.y + FT.CH * 0.8 * m && h.y1 >= p.y) fightHit(g, p, o, k.dmg, k.sv, a.s < 2, a.id, k.enemyFx);
    },
    // 突進：衝到拖曳的位置（0.25 秒），到了再判定落點附近（寬 k.width）有沒有對手
    // a.aimD 是場地上的位移（正＝往右）：先轉向衝的方向；突進途中不會被打斷（p.armor，見 fightHit）
    dash(g, p, o, a, k) {
      const fs = fightFs(g, p), to = p.x + a.aimD;
      if (Math.abs(a.aimD) > 1) p.face = a.aimD > 0 ? 1 : -1;
      a.dur = Math.max(a.dur, a.t + FT.DASH_T + 0.15);
      p.armor = true;
      fightSlide(p, to, FT.DASH_T, () => {
        p.armor = false;
        // 落地範圍（v7.4）：有量到技能動畫往前打多遠（k.ahead）就打「身體前緣往後一點 ～ 往前 ahead」，否則照舊以前緣為中心、寬 width
        const h = fHurt(o), m = fxBoxMul(p, true), cx = p.x + p.face * fs.bw / 2;
        const [lo, hi] = k.ahead ? [cx - p.face * 30, cx + p.face * k.ahead * m].sort((a, b) => a - b) : [cx - k.width * m / 2, cx + k.width * m / 2];
        g.fx.push({ kind: "impact", x: (lo + hi) / 2, w: hi - lo, t: 0, life: 0.35, own: p.side });
        fightHitSummons(g, p.side, lo, hi, 0, FT.CH, k.dmg);
        if (!o.ko && fOverlapX(lo, hi, h.x0, h.x1) && o.y < FT.AIR_SAFE * 2) fightHit(g, p, o, k.dmg, k.sv, true, a.id, k.enemyFx, k.bul);
        fightDashExit(g, p, o);
      });
    },
  };
  FIGHT_RELEASE.shot = FIGHT_RELEASE.line;
  // 身前範圍（v7.4）：效果畫在角色自己的技能動作裡的技能——前搖結束時，從身體前緣到 ahead 之內的對手都打到（不飛、不預告）
  FIGHT_RELEASE.front = (g, p, o, a, k) => {
    const fs = fightFs(g, p), m = fxBoxMul(p, true), x0 = p.x + p.face * fs.bw / 2, x1 = x0 + p.face * (k.ahead || k.range) * m, h = fHurt(o);
    const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
    g.fx.push({ kind: "impact", x: (lo + hi) / 2, w: hi - lo, t: 0, life: 0.3, own: p.side });
    fightHitSummons(g, p.side, lo, hi, 0, FT.CH, k.dmg);
    if (!o.ko && fOverlapX(lo, hi, h.x0, h.x1) && o.y < FT.CH * 0.8) fightHit(g, p, o, k.dmg, k.sv, true, a.id, k.enemyFx, k.bul);
  };
  FIGHT_RELEASE.self = () => {}; // 自身：效果在前搖結束時套用（fightActing → fxCastSelf）
  const fightProjBase = (g, p, a, k) => { const x = p.x + p.face * fightFs(g, p).bw / 2; return { own: p.side, x, px: x, face: p.face, dmg: k.dmg, sv: k.sv, heavy: a.s < 2, skill: a.s < 2, bul: k.bul, t: 0, id: a.id, fx: k.enemyFx, box: fxBoxMul(p, a.s < 2) }; };
  // 突進衝完停在對手身上：只把突進的人往前進方向推出去（撞牆就改退到另一邊），不推對手
  function fightDashExit(g, p, o) {
    const minD = (fightFs(g, p).bw + g.cfg.fs[o.side].bw) / 2, lim = FT.AW / 2 - fightFs(g, p).bw / 2;
    if (Math.abs(p.x - o.x) >= minD || !fOnGround(o)) return;
    let x = o.x + p.face * minD;
    if (Math.abs(x) > lim) x = o.x - p.face * minD;
    p.x = fclamp(x, -lim, lim);
  }
  function fightRelease(g, p, o, a) {
    const k = fightSlot(fightFs(g, p), a.s), fn = FIGHT_RELEASE[k.kind];
    if (fn) fn(g, p, o, a, k);
    else { g.events.push({ type: "unsupported", side: p.side, kind: k.kind }); g.fx.push({ kind: "text", text: "不支援", x: p.x, y: FT.CH * 1.2, t: 0, life: 0.6 }); }
  }
  // 投射物：用「上一步到這一步的連線」判斷有沒有碰到受傷框（快的投射物也不會穿過去）
  function fightProjectiles(g) {
    const dt = FT.STEP;
    for (const q of g.projs) {
      q.px = q.x; q.py = q.y; q.t += dt;
      q.x += q.vx * dt;
      if (q.kind === "lob") { q.y += q.vy * dt; q.vy -= FT.GRAV * (q.gm || 1) * dt; }
      const o = g.p[1 - q.own], h = fHurt(o), r = (q.kind === "lob" ? 26 : 14) * (q.box || 1);
      // 掃過的範圍（上一步到這一步）：一般是中心點 ± r；有碰撞框（v7.5，跟著投射物圖）就用碰撞框
      const m = q.box || 1, pb = q.pb, fc = q.face || Math.sign(q.vx) || 1;
      const bx0 = pb ? (fc > 0 ? pb[0] : -pb[1]) * m : -r, bx1 = pb ? (fc > 0 ? pb[1] : -pb[0]) * m : r;
      const sx0 = Math.min(q.px, q.x) + bx0, sx1 = Math.max(q.px, q.x) + bx1;
      const yLo = Math.min(q.y, q.py) + (pb ? pb[2] * m : -r), yHi = Math.max(q.y, q.py) + (pb ? pb[3] * m : r);
      // 對方的召喚物會擋下投射物（先打到召喚物）
      if (fightHitSummons(g, q.own, sx0, sx1, yLo, yHi, q.dmg, true)) { q.dead = true; g.fx.push({ kind: "spark", x: q.x, y: q.y, t: 0, life: 0.35 }); continue; }
      if (!o.ko && fOverlapX(sx0, sx1, h.x0, h.x1) && yHi > h.y0 && yLo < h.y1) {
        fightHit(g, q.src || g.p[q.own], o, q.dmg, q.sv, q.heavy, q.id, q.fx, q.bul); q.dead = true;
        g.fx.push({ kind: "spark", x: q.x, y: q.y, t: 0, life: 0.35 });
        continue;
      }
      if (q.kind === "lob" && q.y <= 0) {
        q.dead = true; g.fx.push({ kind: "boom", x: q.x, y: 0, t: 0, life: 0.45 });
        if (!o.ko && fOverlapX(q.x - FT.LOB_R * (q.box || 1), q.x + FT.LOB_R * (q.box || 1), h.x0, h.x1) && o.y < FT.AIR_SAFE * (q.box || 1)) fightHit(g, q.src || g.p[q.own], o, q.dmg, q.sv, q.heavy, q.id, q.fx, q.bul);
      }
      if (Math.abs(q.x) > FT.AW / 2 + 80) q.dead = true; // 飛出場地
      if (q.kind === "line" && q.x0 != null && Math.abs(q.x - q.x0) > FT.SHOT_MAX) { q.dead = true; g.fx.push({ kind: "spark", x: q.x, y: q.y, t: 0, life: 0.25 }); } // v7.0：直線投射物最多飛 SHOT_MAX
    }
    g.projs = g.projs.filter((q) => !q.dead);
  }
  // 矩形預告：時間到時對手的受傷框還在範圍裡（而且沒跳起來）就命中
  function fightTeles(g) {
    for (const t of g.teles) {
      t.t += FT.STEP;
      if (t.t < t.delay) continue;
      t.dead = true;
      if (fightCutAct(g, t.act, g.p[t.own])) { g.fx.push({ kind: "text", text: "中斷", x: t.x, y: FT.CH * 0.8, t: 0, life: 0.6, color: "#9aa3c8" }); continue; }
      const o = g.p[1 - t.own], h = fHurt(o);
      g.fx.push({ kind: "impact", x: t.x, w: t.w, t: 0, life: 0.45, bul: t.bul, own: t.own, face: t.face, off: t.off, fxs: t.fxs });
      fightHitSummons(g, t.own, t.x - t.w / 2, t.x + t.w / 2, 0, t.air || FT.AIR_SAFE, t.dmg);
      if (!o.ko && fOverlapX(t.x - t.w / 2, t.x + t.w / 2, h.x0, h.x1) && o.y < (t.air || FT.AIR_SAFE)) fightHit(g, t.src || g.p[t.own], o, t.dmg, t.sv, true, t.id, t.fx, t.bul);
    }
    g.teles = g.teles.filter((t) => !t.dead);
  }

  /* 結算一次命中（fx＝這招打對手的效果，見 js-18-fight-effects.js）
     無敵 → 沒事；防禦 → 不扣血、扣防禦條、防禦硬直（扣完就破防），效果也被擋下；
     否則 → 傷害 ×（輔助加攻）×（攻擊增減）×（1 − 減傷）× 連段遞減，硬直、往後推，累積硬直值（同一招只算一次），
            滿了或有擊退效果就倒地；持續傷害的招式命中時只先扣一部分。最後套用效果。
     沒有傷害的招式（只有暈眩、減益等）：不扣血、不硬直，只套用效果。 */
  function fightHit(g, a, o, dmg, sv, heavy, id, fx, bul) {
    fx = fx || [];
    if (o.inv > 0 || o.ko) { g.fx.push({ kind: "text", text: "無敵", x: o.x, y: FT.CH * 1.1, t: 0, life: 0.5 }); return; }
    // 傷害倍率：輔助加攻 ×（攻擊增減，只影響普攻）×（對手受到的技能／普攻傷害增減）
    const dir = o.x >= a.x ? 1 : -1, full = dmg * (a.buff > 0 ? FT.BUFF_MUL : 1) * (heavy ? 1 : fxAtkMul(a)) * Math.max(0, fxTakenMul(o, heavy));
    o.quiet = 0;
    if (o.guard) {
      const air = o.y > 0, cost = full * FT.GAUGE_HIT * (air ? FT.AIR_GUARD_MUL : 1); // 空中防禦扣兩倍
      o.gauge -= cost; o.guardIdle = 0;
      g.fx.push({ kind: "num", text: full > 0 ? "-" + Math.round(cost) : "擋下", x: o.x, y: FT.CH * 1.05 + o.y, t: 0, life: 0.7, guard: true });
      g.events.push({ type: "guard", side: a.side });
      if (o.gauge <= 0) fightBreak(g, o);
      else if (!air) { o.stun = FT.BLOCK_STUN; o.stunKind = "block"; o.kbv = dir * FT.GUARD_PUSH; } // 空中：不推、不硬直
      return;
    }
    // 突進途中（霸體）：照樣扣血，但不硬直、不被推、不倒地，控制類效果也不會生效
    if (o.armor) {
      const v = full > 0 ? fightDamage(g, a, o, full * (1 - o.dr), { heavy }) : 0;
      if (v) g.events.push({ type: "hit", side: a.side, heavy, dmg: v, scale: 1 });
      fxOnHit(g, a, o, (fx || []).filter((e) => !FX_CONTROL.has(FIGHT_FX[e.c].b)), { dmg: v, full, dir, bul });
      return;
    }
    /* 技能前搖的輕霸體（v6.0.2）：被普通攻擊打中照樣扣血、累積硬直值，但不中斷、不被推；
       帶控制效果（暈眩、擊倒…）或硬直值累積滿了才會打斷（走下面一般的命中） */
    /* v6.0.3：霸體期間硬直值累積 ×SV_ARMOR_MUL（等於上限減半），累積滿了就倒地（技能被打斷） */
    const ctl = fx.some((e) => FX_CONTROL.has(FIGHT_FX[e.c].b) || FIGHT_FX[e.c].knockdown);
    if (o.act && o.act.kind === "sk" && o.act.t < o.act.hitAt && !ctl) {
      const newSv = full > 0 && (id == null || o.lastSvId !== id);
      if (newSv && o.sv + sv * FT.SV_ARMOR_MUL >= FT.SV_MAX) { o.sv += sv * FT.SV_ARMOR_MUL; o.lastSvId = id; } // 滿了：走下面一般命中 → 倒地
      else {
      let v = 0;
      if (full > 0) {
        if (newSv) { o.sv += sv * FT.SV_ARMOR_MUL; o.lastSvId = id; }
        const raw = fx.some((e) => e.c === "DOT") ? full * FX_NUM.DOT_FIRST : full;
        v = fightDamage(g, a, o, raw * (1 - o.dr), { pierce: fx.some((e) => FIGHT_FX[e.c].pierce), heavy });
        g.events.push({ type: "hit", side: a.side, heavy, dmg: v, scale: 1 });
        g.fx.push({ kind: "text", text: "霸體", x: o.x, y: FT.CH * 1.3, t: 0, life: 0.5, color: "#ffd84a" });
      } else g.events.push({ type: "fxhit", side: a.side });
      fxOnHit(g, a, o, fx, { dmg: v, full, dir, bul });
      return;
      }
    }
    let v = 0;
    if (full > 0) {
      const raw = fx.some((e) => e.c === "DOT") ? full * FX_NUM.DOT_FIRST : full;
      const scale = FT.COMBO_SCALE[Math.min(o.combo, FT.COMBO_SCALE.length - 1)];
      o.combo++;
      if (id == null || o.lastSvId !== id) { o.sv += sv; o.lastSvId = id; } // 同一招只累積一次
      o.act = null; o.aim = [null, null, null]; o.guard = false; o.anim = { clip: null, t: 0 };
      if (o.sv >= FT.SV_MAX || fx.some((e) => FIGHT_FX[e.c].knockdown)) fightDown(g, o, dir);
      else { o.stun = heavy ? FT.STUN_SK : FT.STUN_ATK; o.stunKind = "hit"; o.kbv = dir * (heavy ? FT.PUSH_SK : FT.PUSH_ATK); }
      g.fx.push({ kind: "spark", x: o.x - dir * 10, y: FT.CH * 0.55 + o.y, t: 0, life: 0.3 });
      v = fightDamage(g, a, o, raw * (1 - o.dr) * scale, { pierce: fx.some((e) => FIGHT_FX[e.c].pierce), heavy, scale });
      g.events.push({ type: "hit", side: a.side, heavy, dmg: v, scale });
    } else g.events.push({ type: "fxhit", side: a.side });
    fxOnHit(g, a, o, fx, { dmg: v, full, dir, bul });
  }
  // 倒地：推遠、躺 DOWN_TIME 秒，起身後無敵（見 fightStunned）
  function fightDown(g, o, dir) {
    o.sv = 0; o.stun = FT.DOWN_TIME; o.stunKind = "down"; o.kbv = dir * FT.PUSH_DOWN; o.act = null; o.aim = [null, null, null];
    g.fx.push({ kind: "text", text: "倒地", x: o.x, y: FT.CH * 1.35, t: 0, life: 0.9 }); g.events.push({ type: "down", side: o.side });
  }
  /* 扣血（命中、持續傷害、反射共用）：護盾先吸收（pierce＝穿透護盾），木樁不會倒，扣到 0 就 K.O.。
     之後：對手有「反射」→ 一部分傷害反彈給出手者（反彈的傷害不會再反彈）；出手者有「吸血」→ 一部分回成血。回傳實際扣的血。 */
  function fightDamage(g, a, o, amount, opt) {
    let v = amount;
    const sh = o.st.shield;
    if (sh && opt.pierce) g.fx.push({ kind: "text", text: "穿透！", x: o.x, y: FT.CH * 1.4, t: 0, life: 0.7, color: "#ff8a3d" });
    else if (sh) {
      const ab = Math.min(sh.v, v); sh.v -= ab; v -= ab;
      if (ab > 0) g.fx.push({ kind: "num", text: "盾 -" + Math.round(ab), x: o.x, y: FT.CH * 1.2, t: 0, life: 0.7, guard: true });
      if (sh.v <= 0.5) { delete o.st.shield; g.fx.push({ kind: "text", text: "護盾破了", x: o.x, y: FT.CH * 1.4, t: 0, life: 0.7 }); }
    }
    v = Math.round(v);
    if (v <= 0) return 0;
    o.quiet = 0; // 持續傷害也算挨打（木樁不會在中途回滿血）
    g.fx.push({ kind: "num", text: String(v) + (opt.scale < 1 ? ` ×${opt.scale}` : ""), x: o.x, y: FT.CH * (opt.dot ? 0.9 : 1.05), t: 0, life: 0.8, heavy: opt.heavy, dot: opt.dot });
    o.hp -= v;
    if (g.cfg.mode === "dummy" && o.side === 1) {
      o.hp = Math.max(1, o.hp);
      const st = g.stats; st.total += v; st.hits += opt.dot ? 0 : 1; st.lastCombo = (st.lastCombo || 0) + v; st.lastDmg = v;
      fightDamageAfter(g, a, o, v, opt);
      return v;
    }
    fightDamageAfter(g, a, o, v, opt);
    if (o.hp <= 0) { o.hp = 0; o.ko = true; o.kbv = (o.x >= a.x ? 1 : -1) * FT.PUSH_DOWN; o.stun = 0; o.st = {}; fightAnim(o, g.cfg.f[o.side].clips.knockback || idleClip(g.cfg.f[o.side])); fightRoundEnd(g, o.side); }
    return v;
  }
  function fightDamageAfter(g, a, o, v, opt) {
    if (opt.reflect || !a || a === o || a.clone || a.summon) return; // 複製體、召喚物不吸血、不吃反射
    if (o.st.mirror && !opt.dot && !a.ko) fightDamage(g, o, a, v * o.st.mirror.v, { reflect: true });
    if (a.st.vamp && !a.ko) { const h = Math.round(v * a.st.vamp.v); if (h > 0) { a.hp = Math.min(a.maxHp, a.hp + h); g.fx.push({ kind: "num", text: "+" + h, x: a.x, y: FT.CH * 1.05, t: 0, life: 0.6, heal: true }); } }
  }

  /* ---------- 複製體（召喚對手複製體） ----------
     在施放者前面叫出對手的複製體：不會被打、不會移動、面向對手，依序放普攻、技能 1、技能 2（有的才放），放完就消失。
     複製體用對手的數值與動作，但算施放者那一方（打的是對手）。 */
  function fightCloneSpawn(g, src) {
    const o = g.p[1 - src.side];
    if (o.st.noCopy) { g.fx.push({ kind: "text", text: "複製失敗", x: src.x, y: FT.CH * 1.25, t: 0, life: 0.8 }); return; }
    const fs = g.cfg.fs[o.side], seq = [2, 0, 1].filter((s) => { const k = fightSlot(fs, s); return k && k.kind !== "buff" && k.kind !== "self" && k.kind !== "dash"; });
    const x = fclamp(src.x + src.face * (fightFs(g, src).bw / 2 + fs.bw / 2 + 10), -FT.AW / 2 + fs.bw / 2, FT.AW / 2 - fs.bw / 2);
    g.clones.push({ clone: true, side: src.side, from: o.side, fs, x, y: 0, face: o.x >= x ? 1 : -1, st: {}, buff: 0, dr: 0, seq, act: null, anim: { clip: null, t: 0 } });
    g.fx.push({ kind: "text", text: "複製體", x, y: FT.CH * 1.25, t: 0, life: 0.8, color: "#c9a7ff" });
  }
  function fightClones(g) {
    for (const c of g.clones) {
      const o = g.p[1 - c.side];
      c.face = o.x >= c.x ? 1 : -1; c.anim.t += FT.STEP;
      if (!c.act) {
        const s = c.seq.shift();
        if (s == null) { c.dead = true; continue; }
        const k = fightSlot(c.fs, s), gap = Math.max(0, Math.abs(o.x - c.x) - c.fs.bw / 2);
        c.act = { s, k, t: 0, hitAt: k.hitAt, dur: k.dur, aimD: fclamp(gap, FT.AIM_MIN, k.range || gap), id: g.nextId++, done: false, clip: k.clip };
      }
      const a = c.act; a.t += FT.STEP;
      if (!a.done && a.t >= a.hitAt) { a.done = true; fightAutoAttack(g, c, o, a); }
      if (a.t >= a.dur) c.act = null;
    }
    g.clones = g.clones.filter((c) => !c.dead);
  }

  /* 複製體、召喚物共用：前搖結束時放出一招（近戰、定點、其他依 FIGHT_RELEASE），算在 c.side 那一方 */
  function fightAutoAttack(g, c, o, a) {
    const k = a.k;
    if (k.kind === "melee") {
      const h = fHurt(o), x0 = c.x + c.face * c.fs.bw / 2, x1 = x0 + c.face * k.reach;
      if (fightHitSummons(g, c.side, x0, x1, 0, FT.CH * 0.8, k.dmg)) return;
      if (!o.ko && fOverlapX(x0, x1, h.x0, h.x1) && o.y < FT.CH * 0.8) fightHit(g, c, o, k.dmg, k.sv, false, a.id, null);
    } else if (k.kind === "rect") {
      g.teles.push({ own: c.side, src: c, x: o.x, w: k.width, t: 0, delay: fightTeleDelay(g, k, Math.min(a.aimD, k.range)), dmg: k.dmg, sv: k.sv, s: a.s, bul: k.bul, id: a.id, fx: k.enemyFx });
    } else if (FIGHT_RELEASE[k.kind]) {
      const before = g.projs.length;
      FIGHT_RELEASE[k.kind](g, c, o, a, k);
      for (const q of g.projs.slice(before)) { q.src = c; q.drawF = c.f || g.cfg.f[c.from]; } // 投射物記住是誰射的（命中用它的數值、畫它的圖）
    }
  }

  /* ---------- 召喚物（v5.3.1） ----------
     用召喚物自己的動畫與普攻：自動走向對手，進到攻擊距離就普攻（不放技能）。
     體力＝施放者最大體力 × SUM_HP、傷害＝施放者普攻 × SUM_DMG；會被對手的攻擊打到，也會擋下對手的投射物；
     不跟角色推擠。持續時間到或被打倒就消失。每方場上最多 SUM_MAX 隻（v7.3：所有角色一樣）。 */
  const fightSummonFs = new Map(); // 召喚物的格鬥數值（同一隻只算一次）
  function fightSummonSpawn(g, src, s, T) {
    const o = g.p[1 - src.side], ex = g.cfg.extra && g.cfg.extra[src.side];
    if (src.clone) return;
    if (o.st.noCopy) { g.fx.push({ kind: "text", text: "召喚被封鎖", x: src.x, y: FT.CH * 1.25, t: 0, life: 0.8 }); return; }
    const ids = fightSummonIds(g.cfg.f[src.side].r.id, s).filter((id) => ex && ex.sum[id]);
    if (!ids.length) { g.fx.push({ kind: "text", text: "召喚物讀取失敗", x: src.x, y: FT.CH * 1.25, t: 0, life: 0.8 }); return; }
    const cfs = fightFs(g, src), casterAtk = cfs.atk.dmg, cap = FT.SUM_MAX, sm = cfs.sum || { hp: FT.SUM_HP, dmg: FT.SUM_DMG };
    ids.forEach((id, n) => {
      if (g.summons.filter((m) => m.side === src.side).length >= cap) { g.fx.push({ kind: "text", text: "召喚物已滿", x: src.x, y: FT.CH * 1.25, t: 0, life: 0.8 }); return; }
      const f = ex.sum[id];
      if (!fightSummonFs.has(id)) fightSummonFs.set(id, fightStats(f));
      const base = fightSummonFs.get(id), fs = Object.assign({}, base, { atk: Object.assign({}, base.atk, { dmg: Math.round(casterAtk * sm.dmg), enemyFx: [] }) });
      const hp = Math.round(src.maxHp * sm.hp), x = fclamp(src.x + src.face * (fightFs(g, src).bw / 2 + fs.bw / 2 + 10 + n * 40), -FT.AW / 2 + fs.bw / 2, FT.AW / 2 - fs.bw / 2);
      g.summons.push({ summon: true, side: src.side, id, f, fs, x, y: 0, face: src.face, hp, maxHp: hp, life: 0, T, atkCd: 0, act: null, st: {}, buff: 0, dr: 0, anim: { clip: null, t: 0 }, moving: false });
    });
    g.fx.push({ kind: "text", text: "召喚！", x: src.x, y: FT.CH * 1.3, t: 0, life: 0.8, color: "#7dff9a" });
  }
  const fSumHurt = (m) => ({ x0: m.x - m.fs.bw / 2, x1: m.x + m.fs.bw / 2, y0: 0, y1: FT.CH * FT.SUM_H });
  /* 打到 side 對面的召喚物：範圍 [x0,x1]×[y0,y1] 碰到的都扣 dmg（first＝只打第一隻，投射物用）。回傳打到幾隻 */
  function fightHitSummons(g, side, x0, x1, y0, y1, dmg, first) {
    let n = 0;
    for (const m of g.summons) {
      if (m.side === side || m.hp <= 0) continue;
      const h = fSumHurt(m);
      if (!fOverlapX(x0, x1, h.x0, h.x1) || y1 < h.y0 || y0 > h.y1) continue;
      const v = Math.round(dmg); m.hp -= v; n++;
      g.fx.push({ kind: "num", text: String(v), x: m.x, y: FT.CH * 0.9, t: 0, life: 0.7 });
      if (m.hp <= 0) g.fx.push({ kind: "text", text: "擊倒召喚物", x: m.x, y: FT.CH * 1.1, t: 0, life: 0.9, color: "#ff8a3d" });
      if (first) break;
    }
    return n;
  }
  function fightSummons(g) {
    for (const m of g.summons) {
      m.life += FT.STEP; m.anim.t += FT.STEP; m.atkCd = Math.max(0, m.atkCd - FT.STEP);
      if (m.hp <= 0 || m.life >= m.T) { m.dead = true; continue; }
      const o = g.p[1 - m.side];
      if (o.ko || g.phase !== "fight") continue;
      if (m.act) {
        const a = m.act; a.t += FT.STEP;
        if (!a.done && a.t >= a.hitAt) { a.done = true; fightAutoAttack(g, m, o, a); }
        if (a.t >= a.dur) m.act = null;
        continue;
      }
      m.face = o.x >= m.x ? 1 : -1;
      // 距離用對手的受傷框（寬 HURT_W）算，跟命中判定一致（用身體寬會停在打不到的地方）
      const k = m.fs.atk, gap = Math.max(0, Math.abs(o.x - m.x) - m.fs.bw / 2 - fHurt(o).x1 + o.x);
      const reach = k.kind === "melee" ? k.reach : k.kind === "shot" ? 360 : k.range || 300;
      if (gap > reach * 0.9) { m.x += m.face * m.fs.walk * FT.SUM_WALK * FT.STEP; m.moving = true; continue; }
      m.moving = false;
      if (m.atkCd <= 0) { m.act = { s: 2, k, t: 0, hitAt: k.hitAt, dur: k.dur, aimD: gap + FT.HURT_W / 2, id: g.nextId++, done: false, clip: k.clip }; m.atkCd = k.cd * FT.SUM_CD; }
    }
    g.summons = g.summons.filter((m) => !m.dead);
  }

  /* ---------- 電腦對手 ----------
     跟玩家用同一套按鍵：每隔「反應時間」想一次要做什麼，中間維持上一次的決定。
     木樁：standing＝站著不動、guard＝一直防禦（測防禦條與破防）。 */
  const FIGHT_AI = {
    easy: { react: 0.45, guard: 0.15, dodge: 0.1, skill: 0.25, err: 0.3 },
    normal: { react: 0.28, guard: 0.35, dodge: 0.3, skill: 0.5, err: 0.15 },
    hard: { react: 0.14, guard: 0.6, dodge: 0.55, skill: 0.8, err: 0.05 },
  };
  function fightAi(g, side, level, mem) {
    const inp = fightBlankInput();
    const p = g.p[side], o = g.p[1 - side], fs = g.cfg.fs[side], ofs = g.cfg.fs[1 - side];
    if (level === "standing") return inp;
    if (level === "guard") { inp.guard = true; return inp; }
    const P = FIGHT_AI[level] || FIGHT_AI.normal, rnd = g.rng;
    // 按住招式中：不拖（瞄準按下當下的位置），下一次思考時放開
    mem.think = (mem.think || 0) - FT.STEP;
    if (mem.think > 0) { inp.mx = mem.mx || 0; inp.run = !!mem.run; inp.guard = !!mem.guard; if (mem.aimS != null) inp.skAim[mem.aimS] = 0; return inp; }
    mem.think = P.react * (0.7 + rnd() * 0.6);
    mem.guard = false; mem.mx = 0; mem.run = false;
    if (mem.aimS != null) { inp.skUp[mem.aimS] = true; mem.aimS = null; return inp; }
    const gap = Math.abs(o.x - p.x) - (fs.bw + ofs.bw) / 2, toward = o.x >= p.x ? 1 : -1;
    const far = gap + ofs.bw / 2;
    // 危險：對手正在出招且靠近、腳下有預告、有投射物飛過來 → 跳開或防禦（防禦條太少就不防）
    const danger = (o.act && gap < (ofs.atk.reach || 100) + 60) ||
      g.teles.some((t) => t.own !== side && Math.abs(t.x - p.x) < t.w / 2 + FT.HURT_W / 2 + 20) ||
      g.projs.some((q) => q.own !== side && Math.abs(q.x - p.x) < 260 && Math.sign(p.x - q.x) === Math.sign(q.vx));
    // v6.3：空中遇到危險 → 空中防禦，同時繼續往對手飄（近戰靠近遠程用）
    if (danger && !fOnGround(p) && p.gauge > 40 && rnd() < P.guard) { inp.guard = mem.guard = true; inp.mx = mem.mx = fs.atk.kind === "melee" ? toward : 0; mem.think = 0.2; return inp; }
    if (danger && fOnGround(p)) {
      const r = rnd();
      // 跳開：近戰往對手跳（配合空中防禦靠近），其他隨機往後或原地
      if (r < P.dodge) { inp.jump = true; inp.mx = fs.atk.kind === "melee" ? toward : rnd() < 0.5 ? -toward : 0; mem.mx = inp.mx; return inp; }
      if (r < P.dodge + P.guard && p.gauge > 25) { inp.guard = mem.guard = true; mem.think = 0.35 + rnd() * 0.3; return inp; }
    }
    const press = (s) => { inp.skDown[s] = true; if (FT_AIMED[fightSlot(fs, s).kind]) { mem.aimS = s; mem.think = 0.12 + rnd() * 0.2; } return inp; };
    // 背對對手時先轉身（往對手那邊按一下），下一次思考再出手
    if (p.face !== toward && !p.act) { inp.mx = toward; mem.mx = 0; mem.think = 0.05; return inp; }
    // 技能
    for (const s of [1, 0]) {
      const k = fs.sk[s];
      if (!k || p.cd[s] > 0 || p.st.silence || rnd() > P.skill) continue;
      if (k.kind === "buff" || k.kind === "self") { if (p.hp < p.maxHp * 0.7 || rnd() < 0.3) return press(s); continue; }
      if (k.kind === "line" || far <= k.range) return press(s);
    }
    // 普攻與走位
    // 出手距離：近戰＝reach、瞬間直線／拋物線＝range、直線投射物＝420；理想站位取出手距離的 0.8（直線投射物 260）
    const a = fs.atk, tap = AIM_MODE[a.kind] === "tap";
    const reach = a.kind === "melee" ? a.reach : a.kind === "shot" ? 420 : a.range, want = a.kind === "shot" ? 260 : reach * 0.8;
    if (gap <= reach && p.atkCd <= 0 && rnd() > P.err) { if (tap) inp.atk = true; else return press(2); }
    if (gap > want + 10) { inp.mx = toward; inp.run = gap > want + 260; } // v7.0：離很遠就衝刺過去
    else if (a.kind !== "melee" && gap < want * 0.5) inp.mx = -toward;
    mem.mx = inp.mx; mem.run = inp.run;
    return inp;
  }

  /* ---------- 同步檢查用的雜湊（v6）：線上對戰兩邊要算出一樣的值 ----------
     fightHashNums：把數字的 64 位元原始值逐一混進 FNV-1a（連最後一位小數不同都會不一樣） */
  const FH_BUF = new DataView(new ArrayBuffer(8));
  function fightHashNums(h, nums) {
    for (const v of nums) {
      FH_BUF.setFloat64(0, typeof v === "number" ? v : v ? 1 : 0);
      for (let i = 0; i < 8; i++) { h ^= FH_BUF.getUint8(i); h = Math.imul(h, 16777619) >>> 0; }
    }
    return h >>> 0;
  }
  function fightHashStr(h, str) { for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
  // 一格的遊戲狀態（不含畫面特效）
  function fightStateHash(g, h = 2166136261) {
    for (const p of g.p) {
      h = fightHashNums(h, [p.x, p.y, p.vx || 0, p.vy || 0, p.hp, p.gauge, p.sv, p.face, p.stun || 0, p.inv || 0, p.atkCd, p.cd[0], p.cd[1], p.act ? p.act.t : -1]);
      h = fightHashStr(h, (p.state || "") + "|" + Object.keys(p.st).sort().join(","));
      for (const k of Object.keys(p.st).sort()) h = fightHashNums(h, [p.st[k].t, p.st[k].v || 0]);
    }
    for (const q of g.projs) h = fightHashNums(h, [q.x, q.y || 0, q.own]);
    for (const t of g.teles) h = fightHashNums(h, [t.x, t.w, t.t, t.own]);
    for (const m of g.summons) h = fightHashNums(h, [m.x, m.hp, m.side]);
    for (const c of g.clones) h = fightHashNums(h, [c.x, c.hp || 0, c.side]);
    return fightHashNums(h, [g.t, g.round, g.wins[0], g.wins[1]]);
  }
  // 換算後的角色數值（開打前兩邊比對，確定拿到同一份資料、算出同樣的數字）
  function fightStatsHash(fs) {
    const pick = (k) => k && [k.kind, k.dmg, k.cd, k.dur, k.hitAt, k.range, k.width, k.speed, k.lobT, k.reach, k.sv, JSON.stringify(k.enemyFx || []), JSON.stringify(k.selfFx || [])];
    return fightHashStr(2166136261, JSON.stringify([fs.hp, fs.dr, fs.walk, fs.bw, pick(fs.atk), pick(fs.sk[0]), pick(fs.sk[1])]));
  }

