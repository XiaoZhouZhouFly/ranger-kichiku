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
       buff     加攻剩幾秒；state 目前狀態（給畫面與測試看，見 fightStateOf） */
  function fightFighter(g, side) {
    const fs = g.cfg.fs[side];
    return { side, x: side ? 220 : -220, y: 0, vy: 0, vx: 0, face: side ? -1 : 1, hp: fs.hp, maxHp: fs.hp, dr: fs.dr,
      act: null, stun: 0, stunKind: "", kbv: 0, inv: 0, sv: 0, combo: 0, quiet: 9, free: 9, gauge: FT.GAUGE_MAX, guard: false, guardIdle: 9, guardLock: false,
      cd: [0, 0], atkCd: 0, aim: [null, null, null], buf: [null, null, null], buff: 0, anim: { clip: null, t: 0 }, ko: false, state: "idle" };
  }
  function fightNew(cfg) {
    const g = { cfg, rng: mulberry32((cfg.seed || 1) * 7919 + 7), round: 1, wins: [0, 0], phase: "intro", phaseT: 0, timeLeft: cfg.secs,
      projs: [], teles: [], fx: [], events: [], t: 0, winner: -1, roundWinner: -1, nextId: 1,
      stats: { lastCombo: 0, lastDmg: 0, total: 0, hits: 0 } };
    g.p = [fightFighter(g, 0), fightFighter(g, 1)];
    g.events.push({ type: "round" });
    return g;
  }
  /* 一步的按鍵：mx 左右（-1／0／1）、jump 起跳（按下那一步）、guard 防禦（按住）、atk 近戰普攻（按下那一步）；
     「按住」的按鈕用三格陣列：0、1＝技能，2＝普攻（投射物角色）。skDown／skUp＝按下、放開那一步，
     skAim＝從按下位置往前拖了多少場地單位（只有矩形、拋物線會用），skCancel＝手指在取消圈外 */
  const fightBlankInput = () => ({ mx: 0, jump: false, guard: false, atk: false, skDown: [false, false, false], skUp: [false, false, false], skCancel: [false, false, false], skAim: [null, null, null] });
  const FT_EMPTY = fightBlankInput();
  const fightSlot = (fs, s) => (s === 2 ? fs.atk : fs.sk[s]); // 第 s 格按鈕對應的招式（2＝普攻）
  const FT_AIMED = { rect: true, lob: true, line: true, shot: true }; // 按住才出招的種類（放開時出招）
  const fOnGround = (p) => p.y <= 0.01;
  const fFree = (p) => !p.ko && p.stun <= 0 && !p.act; // 可以出新招
  // 矩形預告時間：依距離（近快遠慢）或跟這招的前搖一樣長
  const fightTeleDelay = (g, k, d) => (g.cfg.teleMode === "sync" ? Math.max(FT.TELE_SYNC_MIN, k.hitAt) : FT.TELE_MIN + (FT.TELE_MAX - FT.TELE_MIN) * (d / k.range));
  // 目前狀態（給畫面顯示與測試用；規則本身看各個計時器）
  const FT_STATE_LABEL = { idle: "待機", walk: "走路", jump: "跳", aim: "瞄準", attack: "攻擊", skill: "技能", guard: "防禦", block: "防禦硬直", hit: "硬直", break: "破防", down: "倒地", ko: "倒下" };
  function fightStateOf(p) {
    if (p.ko) return "ko";
    if (p.stun > 0) return p.stunKind || "hit";
    if (p.act) return p.act.kind === "atk" ? "attack" : "skill";
    if (p.aim.some(Boolean)) return "aim";
    if (p.guard) return "guard";
    if (!fOnGround(p)) return "jump";
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
        g.p = [fightFighter(g, 0), fightFighter(g, 1)]; g.projs = []; g.teles = []; g.events.push({ type: "round" });
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
  function fightUnit(g, p, o, inp) {
    const dt = FT.STEP, f = g.cfg.f[p.side];
    fightTimers(p, inp);
    if (p.ko) { p.x += p.kbv * dt; p.kbv *= 0.9; fightPhysics(g, p); return; }
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

  function fightTimers(p, inp) {
    const dt = FT.STEP;
    p.anim.t += dt;
    p.cd = p.cd.map((c) => Math.max(0, c - dt)); p.atkCd = Math.max(0, p.atkCd - dt);
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

  // 硬直中（被打、防禦硬直、破防、倒地）：被推、播被擊退動作；倒地結束後給起身無敵
  function fightStunned(g, p) {
    const dt = FT.STEP, f = g.cfg.f[p.side];
    p.stun -= dt; p.x += p.kbv * dt; p.kbv *= 0.88;
    p.guard = p.stunKind === "block"; // 防禦硬直時仍然在防禦（連續的攻擊照樣擋）
    if (p.stunKind !== "block") fightAnim(p, f.clips.knockback || idleClip(f));
    if (p.stun <= 0) {
      if (p.stunKind === "down") { p.inv = FT.WAKE_INV; g.fx.push({ kind: "text", text: "起身", x: p.x, y: FT.CH * 1.2, t: 0, life: 0.6 }); }
      p.stun = 0; p.stunKind = "";
    }
    fightPhysics(g, p);
  }

  // 防禦：按住下、在地上、沒在出招、防禦條還有。按住本身會消耗防禦條，扣完就破防；破防後要回到 GAUGE_REARM 才能再防
  function fightGuard(g, p, inp, ground) {
    const dt = FT.STEP;
    if (p.guardLock && p.gauge >= FT.GAUGE_REARM) p.guardLock = false;
    p.guard = !!inp.guard && ground && !p.act && p.gauge > 0 && !p.guardLock;
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
      if (AIM_MODE[k.kind] === "dist" && inp.skAim[s] != null) aim.d = fclamp(aim.d0 + inp.skAim[s], FT.AIM_MIN, k.range);
      aim.cancel = !!inp.skCancel[s];
      if (!inp.skUp[s] && !aim.release) continue;
      p.aim[s] = null;
      if (aim.cancel || !fFree(p) || (s < 2 && !fOnGround(p))) continue;
      fightCast(g, p, s, k, aim.d);
    }
  }
  // 出招（放開按住的招式，或按下就放的招式）：設定動作、冷卻；矩形在這一刻放出預告
  function fightCast(g, p, s, k, d) {
    const f = g.cfg.f[p.side];
    const act = { kind: s === 2 ? "atk" : "sk", s, t: 0, dur: k.dur, hitAt: k.hitAt, done: false, clip: k.clip, aimD: d, id: g.nextId++, air: !fOnGround(p), melee: s === 2 && k.kind === "melee" };
    if (k.kind === "rect") {
      const delay = fightTeleDelay(g, k, d);
      g.teles.push({ own: p.side, x: p.x + p.face * (g.cfg.fs[p.side].bw / 2 + d), w: k.width, t: 0, delay, dmg: k.dmg, sv: k.sv, s, bul: k.bul, id: act.id });
      act.done = true; // 傷害由預告結算
    }
    p.act = act;
    if (s === 2) p.atkCd = k.cd; else p.cd[s] = k.cd;
    fightAnim(p, k.clip || idleClip(f));
    if (s < 2) g.events.push({ type: "cast", side: p.side });
    if (act.melee) { const bw = g.cfg.fs[p.side].bw; g.fx.push({ kind: "reach", own: p.side, x0: p.x + p.face * bw / 2, x1: p.x + p.face * (bw / 2 + k.reach), y: p.y, t: 0, life: FT.ACTIVE + k.hitAt + 0.1 }); }
    if (k.kind === "buff") g.fx.push({ kind: "selfring", own: p.side, x: p.x, t: 0, life: 0.8 });
  }

  // 沒在出招：移動、轉身、跳、開始新招（含輸入緩衝）
  function fightFreeMove(g, p, o, inp, ground) {
    const dt = FT.STEP, fs = g.cfg.fs[p.side];
    const aiming = p.aim.some(Boolean);
    // 按住招式時：預設左右鍵只轉身不走路（設定 holdMove 時照常走路）
    const mx = p.guard ? 0 : inp.mx;
    if (mx) p.face = mx > 0 ? 1 : -1;
    const walk = aiming && !g.cfg.holdMove ? 0 : mx;
    p.vx = walk * fs.walk * (ground ? 1 : FT.AIR_CTRL);
    p.x += p.vx * dt;
    if (inp.jump && ground && !p.guard && !p.aim[0] && !p.aim[1]) p.vy = FT.JUMP_V; // 瞄準技能時不能跳（技能只能在地上放）
    if (p.guard) return;
    // 開始新招：普攻（地上、空中都可以），技能（只能在地上；投射物技能每人場上最多一顆）
    for (const s of [2, 0, 1]) {
      const b = p.buf[s], k = fightSlot(fs, s);
      if (!b || !k || p.act || p.aim[s]) continue;
      if (s === 2 ? p.atkCd > 0 : p.cd[s] > 0 || !ground) continue;
      if (s < 2 && (k.kind === "line" || k.kind === "lob") && g.projs.some((q) => q.own === p.side && q.skill)) continue;
      p.buf[s] = null;
      if (!FT_AIMED[k.kind]) { fightCast(g, p, s, k, 0); continue; } // 近戰普攻、輔助技能：按下就放
      // 按住才出的招：起點＝按下當下對手的距離（之後不會自己跟著跑）；已經放開了（點一下）就直接出
      const gap = Math.max(0, Math.abs(o.x - p.x) - (fs.bw + g.cfg.fs[o.side].bw) / 2);
      const d0 = AIM_MODE[k.kind] === "dist" ? fclamp(gap + g.cfg.fs[o.side].bw / 2, FT.AIM_MIN, k.range) : 0;
      p.aim[s] = { d0, d: d0, cancel: false, release: b.up };
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
  // 兩人不會重疊（用身體寬推開）、不會走出場地
  function fightSeparate(g) {
    const [a, b] = g.p, fa = g.cfg.fs[0], fb = g.cfg.fs[1];
    const minD = (fa.bw + fb.bw) / 2;
    const dx = b.x - a.x;
    if (Math.abs(dx) < minD && Math.abs(a.y - b.y) < FT.CH * 0.7) {
      const push = (minD - Math.abs(dx)) / 2, dir = dx >= 0 ? 1 : -1;
      a.x -= dir * push; b.x += dir * push;
    }
    for (const [p, fs] of [[a, fa], [b, fb]]) p.x = fclamp(p.x, -FT.AW / 2 + fs.bw / 2, FT.AW / 2 - fs.bw / 2);
  }

  /* ---------- 判定 ----------
     受傷框：寬 HURT_W、從腳底往上一個身高，置中在角色 x（跟圖片大小無關）。 */
  const fHurt = (o) => ({ x0: o.x - FT.HURT_W / 2, x1: o.x + FT.HURT_W / 2, y0: o.y, y1: o.y + FT.CH });
  const fOverlapX = (a0, a1, b0, b1) => Math.max(a0, a1) >= Math.min(b0, b1) && Math.min(a0, a1) <= Math.max(b0, b1);
  // 近戰普攻：判定框從身體前緣往前 reach，高度跟著出招者當下的位置（空中普攻也是）
  function fightMeleeCheck(g, p, o, a) {
    const fs = g.cfg.fs[p.side], k = fs.atk, h = fHurt(o);
    const x0 = p.x + p.face * fs.bw / 2, x1 = x0 + p.face * k.reach;
    if (o.ko || !fOverlapX(x0, x1, h.x0, h.x1) || h.y0 > p.y + FT.CH * 0.8 || h.y1 < p.y) return false;
    fightHit(g, p, o, k.dmg, k.sv, false, a.id);
    g.events.push({ type: "swing", side: p.side });
    return true;
  }
  // 射出投射物或使用輔助技能（前搖結束的那一刻）
  function fightRelease(g, p, o, a) {
    const fs = g.cfg.fs[p.side], k = fightSlot(fs, a.s);
    if (k.kind === "buff") {
      p.buff = FT.BUFF_TIME; p.hp = Math.min(p.maxHp, p.hp + FT.HEAL);
      g.fx.push({ kind: "buff", x: p.x, y: FT.CH, t: 0, life: 1.0 }); return;
    }
    const x = p.x + p.face * fs.bw / 2, base = { own: p.side, x, px: x, face: p.face, dmg: k.dmg, sv: k.sv, heavy: a.s < 2, skill: a.s < 2, bul: k.bul, t: 0, id: a.id };
    if (k.kind === "lob") {
      // 拋物線：LOB_TIME 秒後落在拖曳的距離（從身體前緣算）；畫面會在落點畫預告
      const T = FT.LOB_TIME, h0 = FT.CH * 0.6 + p.y, land = x + p.face * a.aimD;
      g.projs.push(Object.assign(base, { kind: "lob", y: h0, py: h0, vx: (land - x) / T, vy: (0.5 * FT.GRAV * T * T - h0) / T, landX: land }));
    } else {
      // 直線（技能與普攻投射物）：朝面向一直飛，飛出場地或打中才消失
      const y = p.y + FT.CH * (a.s === 2 ? 0.35 : 0.28);
      g.projs.push(Object.assign(base, { kind: "line", y, py: y, vx: p.face * (k.speed || 560), vy: 0 }));
    }
  }
  // 投射物：用「上一步到這一步的連線」判斷有沒有碰到受傷框（快的投射物也不會穿過去）
  function fightProjectiles(g) {
    const dt = FT.STEP;
    for (const q of g.projs) {
      q.px = q.x; q.py = q.y; q.t += dt;
      q.x += q.vx * dt;
      if (q.kind === "lob") { q.y += q.vy * dt; q.vy -= FT.GRAV * dt; }
      const o = g.p[1 - q.own], h = fHurt(o), r = q.kind === "lob" ? 26 : 14;
      const yLo = Math.min(q.y, q.py) - r, yHi = Math.max(q.y, q.py) + r;
      if (!o.ko && fOverlapX(q.px, q.x, h.x0 - r, h.x1 + r) && yHi > h.y0 && yLo < h.y1) {
        fightHit(g, g.p[q.own], o, q.dmg, q.sv, q.heavy, q.id); q.dead = true;
        g.fx.push({ kind: "spark", x: q.x, y: q.y, t: 0, life: 0.35 });
        continue;
      }
      if (q.kind === "lob" && q.y <= 0) {
        q.dead = true; g.fx.push({ kind: "boom", x: q.x, y: 0, t: 0, life: 0.45 });
        if (!o.ko && fOverlapX(q.x - FT.LOB_R, q.x + FT.LOB_R, h.x0, h.x1) && o.y < FT.AIR_SAFE) fightHit(g, g.p[q.own], o, q.dmg, q.sv, q.heavy, q.id);
      }
      if (Math.abs(q.x) > FT.AW / 2 + 80) q.dead = true; // 飛出場地
    }
    g.projs = g.projs.filter((q) => !q.dead);
  }
  // 矩形預告：時間到時對手的受傷框還在範圍裡（而且沒跳起來）就命中
  function fightTeles(g) {
    for (const t of g.teles) {
      t.t += FT.STEP;
      if (t.t < t.delay) continue;
      t.dead = true;
      const o = g.p[1 - t.own], h = fHurt(o);
      g.fx.push({ kind: "impact", x: t.x, w: t.w, t: 0, life: 0.45, bul: t.bul, own: t.own });
      if (!o.ko && fOverlapX(t.x - t.w / 2, t.x + t.w / 2, h.x0, h.x1) && o.y < FT.AIR_SAFE) fightHit(g, g.p[t.own], o, t.dmg, t.sv, true, t.id);
    }
    g.teles = g.teles.filter((t) => !t.dead);
  }

  /* 結算一次命中
     無敵 → 沒事；防禦 → 不扣血、扣防禦條、防禦硬直（扣完就破防）；
     否則 → 傷害 ×（1 − 減傷）× 連段遞減，硬直、往後推，累積硬直值（同一招只算一次），滿了就倒地 */
  function fightHit(g, a, o, dmg, sv, heavy, id) {
    if (o.inv > 0 || o.ko) { g.fx.push({ kind: "text", text: "無敵", x: o.x, y: FT.CH * 1.1, t: 0, life: 0.5 }); return; }
    const dir = o.x >= a.x ? 1 : -1, raw = dmg * (a.buff > 0 ? FT.BUFF_MUL : 1);
    o.quiet = 0;
    if (o.guard) {
      o.gauge -= raw * FT.GAUGE_HIT; o.guardIdle = 0;
      g.fx.push({ kind: "num", text: "-" + Math.round(raw * FT.GAUGE_HIT), x: o.x, y: FT.CH * 1.05, t: 0, life: 0.7, guard: true });
      g.events.push({ type: "guard", side: a.side });
      if (o.gauge <= 0) fightBreak(g, o);
      else { o.stun = FT.BLOCK_STUN; o.stunKind = "block"; o.kbv = dir * FT.GUARD_PUSH; }
      return;
    }
    const scale = FT.COMBO_SCALE[Math.min(o.combo, FT.COMBO_SCALE.length - 1)];
    const v = Math.round(raw * (1 - o.dr) * scale);
    o.combo++;
    if (id == null || o.lastSvId !== id) { o.sv += sv; o.lastSvId = id; } // 同一招只累積一次
    o.act = null; o.aim = [null, null, null]; o.guard = false; o.anim = { clip: null, t: 0 };
    if (o.sv >= FT.SV_MAX) {
      o.sv = 0; o.stun = FT.DOWN_TIME; o.stunKind = "down"; o.kbv = dir * FT.PUSH_DOWN;
      g.fx.push({ kind: "text", text: "倒地", x: o.x, y: FT.CH * 1.35, t: 0, life: 0.9 }); g.events.push({ type: "down", side: o.side });
    } else { o.stun = heavy ? FT.STUN_SK : FT.STUN_ATK; o.stunKind = "hit"; o.kbv = dir * (heavy ? FT.PUSH_SK : FT.PUSH_ATK); }
    g.fx.push({ kind: "num", text: String(v) + (scale < 1 ? ` ×${scale}` : ""), x: o.x, y: FT.CH * 1.05, t: 0, life: 0.8, heavy });
    g.fx.push({ kind: "spark", x: o.x - dir * 10, y: FT.CH * 0.55 + o.y, t: 0, life: 0.3 });
    g.events.push({ type: "hit", side: a.side, heavy, dmg: v, scale });
    o.hp -= v;
    if (g.cfg.mode === "dummy" && o.side === 1) {
      o.hp = Math.max(1, o.hp);
      const st = g.stats; st.total += v; st.hits++; st.lastCombo = (st.lastCombo || 0) + v; st.lastDmg = v;
      return;
    }
    if (o.hp <= 0) { o.hp = 0; o.ko = true; o.kbv = dir * FT.PUSH_DOWN; o.stun = 0; fightAnim(o, g.cfg.f[o.side].clips.knockback || idleClip(g.cfg.f[o.side])); fightRoundEnd(g, o.side); }
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
    if (mem.think > 0) { inp.mx = mem.mx || 0; inp.guard = !!mem.guard; if (mem.aimS != null) inp.skAim[mem.aimS] = 0; return inp; }
    mem.think = P.react * (0.7 + rnd() * 0.6);
    mem.guard = false; mem.mx = 0;
    if (mem.aimS != null) { inp.skUp[mem.aimS] = true; mem.aimS = null; return inp; }
    const gap = Math.abs(o.x - p.x) - (fs.bw + ofs.bw) / 2, toward = o.x >= p.x ? 1 : -1;
    const far = gap + ofs.bw / 2;
    // 危險：對手正在出招且靠近、腳下有預告、有投射物飛過來 → 跳開或防禦（防禦條太少就不防）
    const danger = (o.act && gap < (ofs.atk.reach || 100) + 60) ||
      g.teles.some((t) => t.own !== side && Math.abs(t.x - p.x) < t.w / 2 + FT.HURT_W / 2 + 20) ||
      g.projs.some((q) => q.own !== side && Math.abs(q.x - p.x) < 260 && Math.sign(p.x - q.x) === Math.sign(q.vx));
    if (danger && fOnGround(p)) {
      const r = rnd();
      if (r < P.dodge) { inp.jump = true; inp.mx = rnd() < 0.5 ? -toward : 0; mem.mx = inp.mx; return inp; }
      if (r < P.dodge + P.guard && p.gauge > 25) { inp.guard = mem.guard = true; mem.think = 0.35 + rnd() * 0.3; return inp; }
    }
    const press = (s) => { inp.skDown[s] = true; if (FT_AIMED[fightSlot(fs, s).kind]) { mem.aimS = s; mem.think = 0.12 + rnd() * 0.2; } return inp; };
    // 背對對手時先轉身（往對手那邊按一下），下一次思考再出手
    if (p.face !== toward && !p.act) { inp.mx = toward; mem.mx = 0; mem.think = 0.05; return inp; }
    // 技能
    for (const s of [1, 0]) {
      const k = fs.sk[s];
      if (!k || p.cd[s] > 0 || rnd() > P.skill) continue;
      if (k.kind === "buff") { if (p.hp < p.maxHp * 0.7) return press(s); continue; }
      if (k.kind === "line" || far <= k.range) return press(s);
    }
    // 普攻與走位
    const a = fs.atk, reach = a.kind === "melee" ? a.reach : 420, want = a.kind === "melee" ? a.reach * 0.8 : 260;
    if (gap <= reach && p.atkCd <= 0 && rnd() > P.err) { if (a.kind === "melee") inp.atk = true; else return press(2); }
    if (gap > want + 10) inp.mx = toward;
    else if (a.kind !== "melee" && gap < want * 0.5) inp.mx = -toward;
    mem.mx = inp.mx;
    return inp;
  }
