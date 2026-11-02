  /* ---------- 真距離／原始數值對戰（D.type = "real" 或 "raw"） ---------- */
  const STAT5 = ["hp", "pa", "ma", "pd", "md"];
  const CHEAT_FIELDS = [
    ["hp", "體力"], ["pa", "物攻"], ["ma", "魔攻"], ["pd", "物防"], ["md", "魔防"],
    ["ai", "攻擊間隔（秒）"], ["cr", "爆擊率 %"], ["cd", "爆擊傷害 %"], ["dg", "普攻閃避 %"], ["hit", "普攻命中 %"],
    ["sdg", "技能閃避 %"], ["sh", "技能命中 %"], ["sr", "技能抗性 %"],
    ["rg", "攻擊距離"], ["mv", "移動速度"],
  ];
  const DEF_K = 18000;
  const cap95 = (v) => Math.min(95, Math.max(0, +v || 0));
  // 普通攻擊：物理、魔法各自依對方防禦打折
  const atkDmg = (a, t) => a.pa * DEF_K / (DEF_K + Math.max(0, t.pd || 0)) + a.ma * DEF_K / (DEF_K + Math.max(0, t.md || 0));
  function mulberry32(a) {
    return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function levelLimits(label) {
    const m = /(\d+)/.exec(label || ""); const star = m ? +m[1] : 0;
    const evolved = /超進化|終極進化|究極進化/.test(label || "");
    let cap = star >= 1 && star <= 5 ? star * 10 + 10 : star >= 6 && star <= 8 ? 60 + (star - 5) * 20 : star === 9 ? 160 : 100;
    if (evolved) cap += 20;
    return { cap, max: cap + (evolved ? 100 : 20) };
  }
  function statAt(arr, level, cap) {
    const [b, g, gm] = arr || [0, 0, 0];
    return b + (Math.min(level, cap) - 1) * g + Math.max(0, level - cap) * gm;
  }
  function defaultRange(i) {
    const f = D.f[i]; if (!f) return 100;
    const st = S.stats[f.r.id];
    return Math.round(st?.rg || f.proj.range || 100);
  }
  function rangeOf(i) { return D.range[i] != null ? D.range[i] : defaultRange(i); }
  function defaultMove(i) {
    const f = D.f[i]; if (!f) return 100;
    const st = S.stats[f.r.id];
    return Math.round(st?.mv || f.proj.speed || 100);
  }
  function moveOf(i) { return D.mvs && D.mvs[i] != null ? D.mvs[i] : defaultMove(i); }
  // 原始數值：等級換算 → 金手指覆蓋
  function rawStats(i) {
    const f = D.f[i], st = S.stats[f.r.id] || {};
    const lim = levelLimits(st.s || f.r.star);
    const lv = Math.max(1, Math.min(lim.max, D.level[i] || lim.max));
    const out = { level: lv, maxLevel: lim.max };
    for (const k of STAT5) out[k] = Math.round(statAt(st[k], lv, lim.cap));
    Object.assign(out, { ai: st.ai || 2.5, cr: st.cr || 0, cd: st.cd || 100, dg: st.dg || 0, hit: st.hit || 0, sh: st.sh || 0, sdg: st.sdg || 0, sr: st.sr || 0, rg: rangeOf(i), mv: moveOf(i) });
    const ov = D.cheat[i] || {};
    for (const [k] of CHEAT_FIELDS) if (ov[k] !== undefined && ov[k] !== "" && isFinite(+ov[k])) out[k] = +ov[k];
    // 技能：發動率、冷卻、各傷害效果的倍率都可以用金手指覆蓋
    const osk = ov.sk || [];
    out.sk = [0, 1].map((s) => {
      const base = (st.sk || [])[s], o = osk[s] || {};
      if (!base) return null;
      const e = base.e.map((x, n) => (o.c && o.c[n] !== undefined && o.c[n] !== "" && isFinite(+o.c[n]) ? { ...x, c: +o.c[n] / 100 } : { ...x }));
      // 輔助技能填了倍率，就當作有單次傷害
      if (!base.e.length && o.c && +o.c[0] > 0) e.push({ t: "hit", c: +o.c[0] / 100, b: "atk", d: 0 });
      return {
        sum: base.sum, sums: base.sums, cpy: base.cpy, ar: base.ar,
        r: o.r !== undefined && o.r !== "" && isFinite(+o.r) ? +o.r : base.r,
        cd: o.cd !== undefined && o.cd !== "" && isFinite(+o.cd) ? +o.cd : base.cd,
        e,
      };
    });
    return out;
  }
  function basicStats(i) {
    const f = D.f[i], st = S.stats[f.r.id] || {};
    return { rg: rangeOf(i), mv: moveOf(i) };
  }
  function realQueues() {
    // 真距離：左右各自的招式清單，「移動接近」改由自動走位取代
    const q = [[], []];
    for (const m of D.moves) if (m.action !== "move") q[m.who === "B" ? 1 : 0].push(m);
    for (const i of [0, 1]) if (!q[i].length) q[i].push({ who: i ? "B" : "A", action: "attack" });
    return q;
  }

  function compileReal() {
    const [A, B] = D.f;
    if (!A || !B) return;
    const rng = mulberry32(D.seed * 7919 + 13);
    const raw = isRaw() && !!(S.stats && Object.keys(S.stats).length);
    const st = [0, 1].map((i) => (raw ? rawStats(i) : basicStats(i)));
    const hpMul = raw ? Math.max(0.01, D.hpMul || 1) : 1;
    const maxHp = raw ? [Math.max(1, st[0].hp * hpMul), Math.max(1, st[1].hp * hpMul)] : [100, 100];
    D.maxHp = maxHp;
    const r0 = st[0].rg, r1 = st[1].rg;
    // 距離補償：只加成短手，短手傷害 ×（1 + k × 距離差 ÷ 長手距離），k = 0.8，最多 1.8 倍
    const COMP_K = 0.8;
    const RL = Math.max(r0, r1), RS = Math.min(r0, r1), bonus = RL > 0 ? 1 + COMP_K * (RL - RS) / RL : 1;
    const comp = r0 === r1 ? [1, 1] : r0 < r1 ? [bonus, 1] : [1, bonus];
    const gap0 = Math.max(r0, r1) + 100;
    const cd0 = gap0 + (A.w + B.w) / 2;
    /* 單位（多打多預備）：本人、召喚物、複製體都是單位，各有陣營、位置、寬度、血量、數值。
       - 每個單位只看離自己最近的敵方單位：進到自己的射程就出手，否則往它走。
       - 普攻打最近（最前面）的那一個；技能以觸發的那一個為中心，左右各一個技能範圍內的敵方單位都會被打到。
       - 只有本人倒下才算 K.O.；召喚物、複製體血扣完就提早消失。擊退只發生在本人身上。 */
    const F = [0, 1].map((i) => ({
      side: i, isMain: true, f: D.f[i], w: D.f[i].w, st: st[i], maxHp: maxHp[i],
      x: i ? cd0 / 2 : -cd0 / 2, hp: maxHp[i], busy: 0, pendingKb: false, kbKo: false, qi: 0, nextAtk: 0,
      skillCd: [0, 0], buff: false, dots: [], cur: null, dead: false,
    }));
    const alive = (u, k) => (u.isMain ? !u.dead : k >= u.k0 && k < u.k1 && u.hp > 0);
    const foes = (side, k) => {
      const out = [], m = F[1 - side];
      if (alive(m, k)) out.push(m);
      for (const x of D.summons) if (x.side !== side && alive(x, k)) out.push(x);
      return out;
    };
    const gapTo = (a, b) => Math.abs(b.x - a.x) - (a.w + b.w) / 2;
    const nearestFoe = (u, k) => { let best = null, bg = Infinity; for (const t of foes(u.side, k)) { const g = gapTo(u, t); if (g < bg) { bg = g; best = t; } } return best; };
    // 技能範圍：以中心目標為準，左右各 ar
    const victimsOf = (side, center, ar, k) => (ar > 0 ? foes(side, k).filter((u) => u === center || Math.abs(u.x - center.x) <= ar) : [center]);
    // 資料庫的技能範圍；沒有範圍資料（舊資料、自製角色）時用出手者的攻擊距離，至少 AR_DEF（資料庫技能範圍的中位數），
    // 避免技能只打到擋在前面的召喚物
    const AR_DEF = 300;
    const skillAr = (fid, sts, action, rg) => {
      const n = action === "skill1" ? 0 : 1;
      const sk = (sts && sts.sk && sts.sk[n]) || (((S.stats[fid] || {}).sk || [])[n]);
      return sk && +sk.ar > 0 ? +sk.ar : Math.max(AR_DEF, +rg || 0);
    };
    // 召喚物的攻擊、血量比例：空白＝自動
    const atkPct = D.sumAtk != null && D.sumAtk !== "" && isFinite(+D.sumAtk) ? Math.max(0, +D.sumAtk) / 100 : null;
    const hpPct = D.sumHp != null && D.sumHp !== "" && isFinite(+D.sumHp) ? Math.max(0, +D.sumHp) / 100 : null;
    const atkOf = (x) => (x.pa || 0) + (x.ma || 0);
    const fullAtk = (fid) => { const fs = S.stats[fid]; return fs ? atkOf(copyStats(fid, levelLimits(fs.s || "").max)) : 0; };
    // 自動：真距離＝召喚物攻擊 ÷ 召喚者（複製體則是對手本人）攻擊，最多 50%；原始數值＝100%（照召喚物自己的數值）
    const autoAtkR = (ss, refAtk) => (raw ? 1 : refAtk > 0 ? Math.min(0.5, atkOf(ss) / refAtk) : 0.5);
    const sumAtkR = (ss, refAtk) => (atkPct != null ? atkPct : autoAtkR(ss, refAtk));
    // 自動：真距離＝召喚者血量的 30%；原始數值＝召喚物自己資料的體力（沒有資料時用召喚者的 30%），並乘上血量倍率
    const sumMaxHp = (ss, i) => {
      if (!raw) return Math.max(1, maxHp[i] * (hpPct != null ? hpPct : 0.3));
      const base = ss.hp > 0 ? ss.hp * hpMul : maxHp[i] * 0.3;
      return Math.max(1, base * (hpPct != null ? hpPct : 1));
    };
    const queues = realQueues();
    const limitK = Math.max(5, D.timeLimit || 60) * FPS;
    const hits = [];
    let endK = -1, timeUp = false;
    // v4.10：普攻用防禦公式（攻擊 × K ÷ (K + 防禦)），技能不看防禦；閃避、技能閃避、技能抗性最多 95%
    const dmgCalc = (a, t, coef, base) => (base === "hp" ? a.hp : a.pa + a.ma) * coef;
    /* 單位共用的動作（本人、召喚物、複製體）
       faceTo：朝目標的方向（+1 往右、-1 往左）；目標在背後時會轉身，不會越走越遠
       walkToward：目標不在射程內就往它走一步，回傳 true＝這一格在走路
       rollSkill：依發動率與冷卻決定要不要放技能（needClip＝沒有技能動畫就不放，複製體用）
       goIdle：切回待機動作 */
    const faceTo = (u, tgt) => (tgt.x > u.x ? 1 : tgt.x < u.x ? -1 : u.side === 0 ? 1 : -1);
    const walkToward = (u, tgt, k) => {
      const gap = gapTo(u, tgt), range = u.st.rg;
      if (gap <= range + 0.5) return false;
      u.x += faceTo(u, tgt) * Math.min(u.st.mv / FPS * D.speed, gap - range);
      const mv = u.f.clips.move;
      if (mv && (!u.cur || u.cur.anim !== mv)) unitAnim(u, mv, k, true);
      return true;
    };
    const rollSkill = (u, k, needClip) => {
      for (const s of [0, 1]) {
        const sk = u.st.sk[s];
        if (sk && (!needClip || u.f.clips[s ? "skill2" : "skill1"]) && k >= u.skillCd[s] && rng() < (sk.r || 0) / 100) { u.skillCd[s] = k + (sk.cd || 0) * FPS; return s ? "skill2" : "skill1"; }
      }
      return "attack";
    };
    const goIdle = (u, k) => { const idle = idleClip(u.f); if (!u.cur || u.cur.anim !== idle) unitAnim(u, idle, k, true); };
    // 擊退只在「體力跌破一半」與「倒下」時發生，會立刻打斷正在出的招
    const checkKb = (j, before) => {
      const t = F[j], half = maxHp[j] / 2;
      if (t.hp <= 0) { t.pendingKb = true; t.kbKo = true; }
      else if (before >= half && t.hp < half) t.pendingKb = true;
    };
    // 原始數值看金手指覆蓋後的技能；真距離看資料庫
    const supportFor = (i, action) => {
      if (action !== "skill1" && action !== "skill2") return false;
      if (!raw) return isSupport(i, action);
      const sk = st[i].sk[action === "skill1" ? 0 : 1];
      return !sk || !sk.e.length;
    };
    const sumHits = [];
    const sideFull = (i, k) => D.summons.filter((x) => x.side === i && x.k0 <= k && x.k1 > k).length >= sumCap();
    // 召喚：L＝召喚者的等級；x0＝召喚者的位置（本人或複製體）
    const spawnSummon = (i, sm, k, L, x0, n = 0) => {
      const sf = D.sumF[sm.id]; if (!sf) return;
      if (sideFull(i, k)) { pushEvent({ k, target: i, attacker: i, dmg: 0, label: "召喚物已滿", fx: "buff", noFx: true }); return; }
      const dir = i === 0 ? 1 : -1;
      const lv = summonLevel(sm, L);
      const sec = sm.dur ? (sm.dur[0] === "mul" ? L * (+sm.dur[1] || 0) : +sm.dur[1] || 10) : 10;
      const ss = summonStats(sm.id, lv);
      const hp0 = sumMaxHp(ss, i);
      D.summons.push({ side: i, isMain: false, f: sf, w: sf.w, x: x0 + dir * (D.f[i].w * 0.5 + sf.w * 0.3 + n * 26), k0: k, k1: k + Math.max(1, Math.round(Math.max(1, sec) * FPS)), st: ss, hp: hp0, maxHp: hp0, dots: [], atkR: sumAtkR(ss, raw ? atkOf(st[i]) : fullAtk(D.f[i].r.id)), nextAtk: k + 8, busy: 0, cur: null, fr: [] });
      pushEvent({ k, target: i, attacker: i, dmg: 0, label: raw ? `召喚！Lv${ss.level}` : "召喚！", fx: "buff", noFx: true });
    };
    // 將敵人召喚為我方夥伴：在我方出現對手的複製體（固定等級、會放技能）
    const spawnCopy = (i, cpy, k, x0) => {
      const src = D.f[1 - i]; if (!src) return;
      if (sideFull(i, k)) { pushEvent({ k, target: i, attacker: i, dmg: 0, label: "召喚物已滿", fx: "buff", noFx: true }); return; }
      const dir = i === 0 ? 1 : -1;
      const ss = copyStats(src.r.id, +cpy.lv || 60);
      const sec = cpy.dur ? +cpy.dur[1] || 10 : 10;
      const hp0 = sumMaxHp(ss, i);
      D.summons.push({ side: i, isMain: false, f: src, w: src.w, copy: true, src: src.r.id, x: x0 + dir * (D.f[i].w * 0.5 + src.w * 0.4), k0: k, k1: k + Math.max(1, Math.round(sec * FPS)), st: ss, hp: hp0, maxHp: hp0, dots: [], atkR: sumAtkR(ss, fullAtk(src.r.id)), skillCd: [0, 0], nextAtk: k + 8, busy: 0, cur: null, fr: [] });
      pushEvent({ k, target: i, attacker: i, dmg: 0, label: raw ? `複製對手！Lv${ss.level}` : "複製對手！", fx: "buff", noFx: true });
    };
    const doSpawns = (i, info, k, L, x0) => {
      if (!info) return;
      info.sums.forEach((sm, n) => spawnSummon(i, sm, k, L, x0, n));
      if (info.cpy) spawnCopy(i, info.cpy, k, x0);
    };
    const pushEvent = (e) => { e.hp = [F[0].hp, F[1].hp]; D.events.push(e); };
    // 扣血：本人會觸發擊退與 K.O.；召喚物血扣完就提早離場
    const hurt = (t, dmg, k, from, label, crit, start, extra) => {
      const before = t.hp;
      t.hp = Math.max(0, t.hp - dmg);
      if (t.isMain) {
        checkKb(t.side, before);
        pushEvent(Object.assign({ k, target: t.side, attacker: from, dmg, label, crit, ko: t.hp <= 0, start }, extra));
      } else {
        pushEvent(Object.assign({ k, target: t.side, attacker: from, dmg, label, crit, sumTarget: true, tx: t.x, noFx: true, start }, extra));
        if (t.hp <= 0) { t.k1 = Math.min(t.k1, k + 1); pushEvent({ k, target: t.side, attacker: from, dmg: 0, label: "擊倒召喚物", fx: "buff", sumTarget: true, tx: t.x, noFx: true }); }
      }
    };
    const missEv = (t, k, from) => pushEvent(t.isMain ? { k, target: t.side, attacker: from, dmg: 0, label: "MISS", miss: true, noFx: true } : { k, target: t.side, attacker: from, dmg: 0, label: "MISS", miss: true, noFx: true, sumTarget: true, tx: t.x });
    // 持續傷害：每秒結算一次（本人、召喚物共用；召喚物這一格被打倒後就不再扣）
    const tickDots = (u, k) => {
      if (!u.dots.length || D.ko >= 0 || !alive(u, k)) return;
      for (const d of u.dots) {
        if (k < d.next || k >= d.until || (!u.isMain && u.hp <= 0)) continue;
        d.next += FPS;
        const v = Math.max(1, d.per);
        hurt(u, v, k, d.from, "-" + Math.round(v).toLocaleString(), u.isMain ? undefined : false, undefined, u.isMain ? { dotTick: true, noFx: true } : { dotTick: true });
      }
    };
    // 對一個目標結算一次攻擊。a＝攻擊方單位；o.base＝真距離的基礎傷害；o.mul＝其他倍率；o.sk＝原始數值的技能資料
    const strike = (a, t, action, k, start, o) => {
      const tst = t.st;
      let dmg = 0, label = "", crit = false;
      if (!raw) {
        dmg = o.base * (0.75 + rng() * 0.5) * o.mul;
        label = `-${Math.round(dmg * 123)}`;
      } else if (action === "attack") {
        if (rng() < Math.max(0, cap95(tst.dg) - a.st.hit) / 100) { missEv(t, k, a.side); return false; }
        crit = rng() < a.st.cr / 100;
        dmg = Math.max(1, atkDmg(a.st, tst) * (crit ? a.st.cd / 100 : 1) * o.mul);
        label = (crit ? "爆擊 " : "") + "-" + Math.round(dmg).toLocaleString();
      } else {
        const sk = o.sk || { e: [] };
        if (rng() < Math.max(0, cap95(tst.sdg) - a.st.sh) / 100) { missEv(t, k, a.side); return false; }
        // 技能抗性：技能傷害（單次與持續）照比例減少
        const mult = o.mul * (1 - cap95(tst.sr) / 100);
        for (const e of sk.e) {
          const v = dmgCalc(a.st, tst, e.c, e.b) * mult;
          if (e.t === "dot") t.dots.push({ per: Math.max(1, v), next: k + FPS, until: k + Math.max(1, e.d) * FPS + 1, from: a.side });
          else dmg += v;
        }
        if (!sk.e.some((e) => e.t !== "dot")) { pushEvent(t.isMain ? { k, target: t.side, attacker: a.side, dmg: 0, label: "持續傷害", fx: "dot", noFx: true } : { k, target: t.side, attacker: a.side, dmg: 0, label: "持續傷害", fx: "dot", noFx: true, sumTarget: true, tx: t.x }); return true; }
        dmg = Math.max(1, dmg);
        label = "-" + Math.round(dmg).toLocaleString();
      }
      hurt(t, dmg, k, a.side, label, crit, start);
      return true; // 沒被閃避（「下一擊 +50%」只在打中時用掉）
    };
    // 一次出手命中時：先召喚／複製，再依普攻（單一目標）或技能（範圍）結算
    const resolve = (a, h, k) => {
      const i = a.side, action = h.action, isSkill = action !== "attack";
      let tgt = h.tgt && alive(h.tgt, k) ? h.tgt : nearestFoe(a, k);
      if (!tgt) return;
      if (a.isMain) {
        const smr = isSkill ? summonInfo(i, action) : null;
        if (smr) doSpawns(i, smr, k, raw ? st[i].level : levelLimits((S.stats[D.f[i].r.id] || {}).s || D.f[i].r.star).max, a.x);
        if (smr && supportFor(i, action)) return; // 純召喚技能：只召喚，不另外強化或回血
        if (isSkill && supportFor(i, action)) {
          // 純輔助技能：不打對手、不會被閃避。一半機率下一擊 +50%，一半機率回復 20% 體力
          if (rng() < 0.5) { a.buff = true; pushEvent({ k, target: i, attacker: i, dmg: 0, label: "下一擊 +50%", fx: "buff", noFx: true }); }
          else { a.hp = Math.min(maxHp[i], a.hp + maxHp[i] * 0.2); pushEvent({ k, target: i, attacker: i, dmg: 0, label: "回復 20%", fx: "heal", noFx: true }); }
          return;
        }
        const buffM = a.buff ? 1.5 : 1;
        const o = raw ? { mul: buffM, sk: isSkill ? st[i].sk[action === "skill1" ? 0 : 1] : null } : { base: DMG[action] || 8, mul: comp[i] / (h.reps > 1 ? 1.6 : 1) * buffM };
        const list = isSkill ? victimsOf(i, tgt, h.ar || 0, k) : [tgt];
        let landed = false;
        for (const t of list) if (strike(a, t, action, k, h.start, o)) landed = true;
        if (landed || !raw) a.buff = false;
        return;
      }
      // 召喚物／複製體
      if (isSkill) {
        doSpawns(i, skillSpawn(a.src, action), k, a.st.level, a.x); // 複製體放技能：用對手的技能資料（召喚、複製、傷害）
        const sk = a.st.sk[action === "skill1" ? 0 : 1];
        if (!sk || !sk.e || !sk.e.length) return; // 沒有傷害的技能
        const o = raw ? { mul: a.atkR, sk } : { base: DMG[action] || 8, mul: a.atkR };
        for (const t of victimsOf(i, tgt, h.ar || 0, k)) strike(a, t, action, k, h.start, o);
        return;
      }
      strike(a, tgt, "attack", k, h.start, raw ? { mul: a.atkR } : { base: DMG.attack || 15, mul: a.atkR });
    };

    /* 本人這一格要做什麼（召喚物見 actSummon；共用的走路、放技能判斷見上面的單位共用動作）
       本人才有的：被擊退會打斷出招、真距離照招式表出招、投射物、攻擊後的硬直 */
    const actMain = (me, k, over) => {
      const i = me.side, f = me.f;
      if (me.pendingKb) {
        me.pendingKb = false;
        // 打斷：還沒放出去的攻擊（近戰還沒打到、投射物還沒射出）全部取消
        for (let n = hits.length - 1; n >= 0; n--) if (hits[n].i === i && hits[n].rel > k) hits.splice(n, 1);
        D.projs = D.projs.filter((p) => !(p.own === i && p.spawn > k));
        D.sfxEv = D.sfxEv.filter((e) => !(e.side === i && e.kind !== "skill" && e.k > k));
        const kb = f.clips.knockback;
        if (kb) {
          const dur = unitAnim(me, kb, k, false), back = i === 0 ? -1 : 1; // 往自己陣營那邊退
          me.busy = k + dur;
          me.slide = { from: me.x, to: me.x + back * (me.kbKo ? 90 : 30), k0: k, k1: k + Math.round(dur * 0.6) };
        }
        return;
      }
      if (k < me.busy) return;
      if (me.dead) return;
      const tgt = over ? null : nearestFoe(me, k);
      if (!tgt) { goIdle(me, k); return; }
      if (walkToward(me, tgt, k)) return;
      const dir = faceTo(me, tgt);
      let action = "attack";
      if (raw) {
        if (k < me.nextAtk) { goIdle(me, k); return; }
        action = rollSkill(me, k, false);
        me.nextAtk = k + Math.max(0.2, me.st.ai) * FPS / D.speed;
      } else {
        const m = queues[i][me.qi % queues[i].length]; me.qi++;
        action = m.action; me.reps = m.repeat || 1;
      }
      const anim = f.clips[action] || f.clips.attack;
      const dur = unitAnim(me, anim, k, false);
      me.busy = k + dur + (raw ? 0 : 4);
      let hitAt = k + Math.round(dur * hitFrac(f, anim)), rel = hitAt;
      const cfg = D.projOn && !supportFor(i, action) ? f.proj[{ attack: "n", skill1: "s1", skill2: "s2" }[action]] : null;
      const drp = cfg && f.bul[cfg.p];
      const flight = drp && pickAnim(drp.part, ["normal", "idle", "wait", "shot", "fire", "attack"]);
      if (drp && flight) {
        const finish = pickAnim(drp.part, ["finish", "hit", "end"]);
        const ready = f.part.animations[anim.replace(/_all$/, "_ready")];
        const spawn = k + Math.round(dur * (ready && anim.endsWith("_all") ? ready.frame_count / f.part.animations[anim].frame_count : 0.3));
        const g = tgt.f;
        if ((cfg.m === "LINEAR" || cfg.m === "CURVE") && cfg.v > 0 && cfg.e) {
          const stp = { x: me.x + dir * (f.ox + cfg.x * 0.5), y: f.oy - cfg.y * 0.5 };
          const en = { x: tgt.x, y: -g.h * (cfg.m === "CURVE" ? 0.05 : 0.3) };
          const dist = Math.hypot(en.x - stp.x, en.y - stp.y);
          const fl = Math.max(2, Math.round(dist / (cfg.v * 60) * FPS / D.speed));
          hitAt = spawn + fl; rel = spawn;
          D.projs.push({ own: i, spawn, fl, st: stp, en, curve: cfg.m === "CURVE", face: dir, dr: drp, flight, finish, a0: cfg.a0, a1: cfg.a1, rot: !!cfg.r, loop: !!cfg.l, dist });
        } else {
          D.projs.push({ own: i, direct: true, spawn: hitAt, en: { x: tgt.x, y: -g.h * 0.45 }, face: dir, dr: drp, flight, finish });
        }
      }
      hits.push({ k: Math.max(k + 1, hitAt), rel: Math.max(k + 1, rel), i, action, start: k, reps: me.reps || 1, tgt, ar: action === "attack" ? 0 : skillAr(f.r.id, raw ? me.st : null, action, me.st.rg) });
      if (action === "attack") D.sfxEv.push({ k: Math.max(k + 1, hitAt), side: i, kind: "attack" });
      else {
        D.sfxEv.push({ k, side: i, kind: "skill" });
        if (!supportFor(i, action)) D.sfxEv.push({ k: Math.max(k + 1, hitAt), side: i, kind: "skillhit" }); // 輔助技能不打人，沒有命中聲
      }
    };
    /* 召喚物、複製體這一格要做什麼：跟本人同樣看最近的敵方單位。
       一般召喚物只會普攻；複製體照對手的發動率與冷卻放技能。沒有擊退、投射物與招式表，時間到或血扣完就離場。 */
    const actSummon = (so, k, over) => {
      if (k < so.k0 || k >= so.k1) return;
      const i = so.side, sf = so.f;
      const tgt = !over && k >= so.busy ? nearestFoe(so, k) : null;
      if (tgt && !walkToward(so, tgt, k)) {
        if (k >= so.nextAtk && sf.clips.attack) {
          const action = so.copy ? rollSkill(so, k, true) : "attack";
          const clip = sf.clips[action] || sf.clips.attack;
          const dur = unitAnim(so, clip, k, false);
          so.busy = k + dur;
          const hk = k + Math.max(1, Math.round(dur * hitFrac(sf, clip)));
          if (hk < so.k1) {
            sumHits.push({ k: hk, s: so, start: k, action, tgt, ar: action === "attack" ? 0 : skillAr(so.src, so.st, action, so.st && so.st.rg) });
            if (action === "attack") D.sfxEv.push({ k: hk, side: i, kind: "attack" });
            else D.sfxEv.push({ k, side: i, kind: "skill" }, { k: hk, side: i, kind: "skillhit" });
          }
          so.nextAtk = k + Math.max(0.3, so.st.ai) * FPS / D.speed;
        } else if (so.cur && so.cur.anim === sf.clips.move) so.cur = null;
      }
      so.fr.push(sumFrame(so, k));
    };
    const maxK = limitK + 400;
    for (let k = 0; k < maxK; k++) {
      // 命中與持續傷害
      for (let n = hits.length - 1; n >= 0; n--) if (hits[n].k === k) { const h = hits.splice(n, 1)[0]; if ((D.ko < 0 || h.k === D.ko) && !F[h.i].dead) resolve(F[h.i], h, k); }
      for (let n = sumHits.length - 1; n >= 0; n--) if (sumHits[n].k === k) { const h = sumHits.splice(n, 1)[0]; if (D.ko < 0 && alive(h.s, k)) resolve(h.s, h, k); }
      for (const u of [F[0], F[1], ...D.summons]) tickDots(u, k);
      // 勝負判定
      if (D.ko < 0 && endK < 0) {
        const dead = [F[0].hp <= 0, F[1].hp <= 0];
        if (dead[0] || dead[1]) {
          D.ko = k; D.resultK = k;
          D.resultText = dead[0] && dead[1] ? "DRAW" : "K.O.";
          D.winner = dead[0] && dead[1] ? -1 : dead[0] ? 1 : 0;
          dead.forEach((x, i) => { if (x) { F[i].dead = true; F[i].pendingKb = true; F[i].kbKo = true; } });
          endK = k + 60;
          const last = [...D.events].reverse().find((e) => e.ko);
          D.finalStart = last && last.start != null ? last.start : k - 20; D.finalTarget = D.winner === 0 ? 1 : 0;
        } else if (k >= limitK) {
          timeUp = true; D.resultK = k; D.resultText = "TIME UP";
          const p0 = F[0].hp / maxHp[0], p1 = F[1].hp / maxHp[1];
          D.winner = Math.abs(p0 - p1) < 1e-9 ? -1 : p0 > p1 ? 0 : 1;
          endK = k + 50;
        }
      }
      if (endK >= 0 && k >= endK) { D.simLen = k; break; }
      const over = D.ko >= 0 || timeUp;
      // 各單位行動：本人先（左、右），再來是召喚物與複製體（順序固定，亂數結果才會一樣）
      for (const i of [0, 1]) actMain(F[i], k, over);
      for (const so of D.summons) actSummon(so, k, over);
      // 記錄這一幀兩人的姿勢與位置
      for (const i of [0, 1]) {
        const me = F[i], f = D.f[i];
        if (me.slide) {
          const s2 = me.slide;
          me.x = k >= s2.k1 ? s2.to : s2.from + (s2.to - s2.from) * ((k - s2.k0) / Math.max(1, s2.k1 - s2.k0));
          if (k >= s2.k1) me.slide = null;
        }
        let anim, idx, start = -1;
        if (me.cur && (me.cur.loop || k < me.cur.start + me.cur.dur)) {
          const n = f.part.animations[me.cur.anim].frame_count;
          idx = Math.floor((k - me.cur.start) / FPS * me.cur.rate);
          idx = me.cur.loop ? idx % n : Math.min(n - 1, idx);
          anim = me.cur.anim; start = me.cur.loop ? -1 : me.cur.start;
        } else if (me.dead && f.clips.knockback) {
          anim = f.clips.knockback; idx = f.part.animations[anim].frame_count - 1;
        } else {
          anim = idleClip(f);
          idx = Math.floor(k / FPS * (f.part.anim_rate || 24)) % f.part.animations[anim].frame_count;
        }
        D.frames[i].push({ anim, idx, x: me.x, start });
      }
      D.simLen = k + 1;
    }
    buildReplay();
    let X0 = Infinity, X1 = -Infinity;
    D.frames.forEach((fr, i) => { const hw = D.f[i].w / 2; for (const s of fr) { X0 = Math.min(X0, s.x - hw); X1 = Math.max(X1, s.x + hw); } });
    for (const so of D.summons) for (const s of so.fr) { X0 = Math.min(X0, s.x - so.f.w / 2); X1 = Math.max(X1, s.x + so.f.w / 2); }
    const bodyH = Math.max(A.h, B.h, 60);
    D.cam = { cx: (X0 + X1) / 2, w: (X1 - X0) * 1.1 + 40, h: bodyH * 2.0, bodyH };
  }

