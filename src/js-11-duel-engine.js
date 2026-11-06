  /* ---------- 雙人對打：角色、召喚物、經典對戰引擎 ---------- */
  // 待機姿勢：沒有待機動畫的角色用普攻動畫代替
  const idleClip = (f) => f.clips.idle || f.clips.attack;
  async function loadFighter(r) {
    const meta = await loadUnitMeta(r.id);
    const part = meta.parts.body || meta.parts[Object.keys(meta.parts)[0]];
    const atlas = await blobToImage(await fetchData(meta.base + part.png, "blob"));
    const f = { r, part, atlas, sprites: new Map() };
    const clip = (key) => { const c = CLIPS.find((x) => x.key === key); return c ? c.names.find((n) => part.animations[n]?.frames?.length) || null : null; };
    f.clips = { idle: clip("idle"), move: clip("move"), attack: clip("attack"), skill1: clip("skill1"), skill2: clip("skill2"), knockback: clip("knockback") };
    f.skills = S.skills[r.id] || [];
    f.proj = S.proj[r.id] || {};
    f.bul = await loadBullets(meta);
    f.lb = fBounds(f, idleClip(f));
    // 讓角色以身體中心站位、腳踩在地面上（原始素材的原點不在腳底中央）
    f.ox = -(f.lb.x0 + f.lb.x1) / 2; f.oy = -f.lb.y1;
    f.w = f.lb.x1 - f.lb.x0; f.h = f.lb.y1 - f.lb.y0;
    /* v7.5：待機時身體很扁（例如利姆路的史萊姆型態）不拿待機的高度當身高，不然會被放大成一般人的身高、變成巨大史萊姆。
       每日同步量好的身高（data/fight_reach.json 的 bh：攻擊動作身體高度的中位數，只算不透明像素）優先；沒有就照舊 */
    const rr = S.reach && S.reach[r.id]; if (rr && rr.bh) f.h = rr.bh;
    return f;
  }
  function pickAnim(part, names) { return names.find((n) => part.animations[n]?.frames?.length) || null; }
  function animIdx(dr, anim, ageFrames, loop) {
    const n = dr.part.animations[anim].frame_count;
    const i = Math.floor(ageFrames / FPS * (dr.part.anim_rate || 24) * D.speed);
    return loop ? i % n : Math.min(n - 1, i);
  }
  function animOutFrames(dr, anim) {
    return Math.max(1, Math.round(dr.part.animations[anim].frame_count / ((dr.part.anim_rate || 24) * D.speed) * FPS));
  }

  /* 招式編排 → 逐幀時間軸 */
  function rnd(n) { return hash(n * 7.13 + D.seed * 3.7); }
  function hitFrac(f, anim) {
    const a = f.part.animations[anim];
    if (!a) return 0.5;
    if (anim.endsWith("_all")) {
      const ready = f.part.animations[anim.replace(/_all$/, "_ready")] || f.part.animations[anim.replace(/attack_all$/, "attack_ready")];
      if (ready) return Math.max(0.2, Math.min(0.9, (ready.frame_count + (a.frame_count - ready.frame_count) * 0.3) / a.frame_count));
    }
    return 0.5;
  }
  function framesFor(f, anim, slow) {
    const a = f.part.animations[anim];
    const sf = typeof slow === "number" ? slow : (slow ? 0.5 : 1);
    const rate = (f.part.anim_rate || 24) * D.speed * sf;
    return { rate, dur: Math.max(1, Math.round(a.frame_count / rate * FPS)) };
  }
  /* 重新計算整場對戰（任何設定、角色、招式改變後呼叫）：
     引擎只產生 TIMELINE（見 js-10），算完更新進度條與結果文字，並回到「還沒開始」（停在第一格、蓋黑幕等按播放） */
  function compileDuel() { compileDuelCore(); showTimelineInfo(); duelIdle(); }
  function compileDuelCore() {
    resetTimeline();
    if (isSim()) { compileReal(); return; }
    compileOnce();
    D.resultK = D.ko; D.resultText = D.ko >= 0 ? "K.O." : "";
    const koEv = D.events.find((e) => e.ko);
    D.finalStart = koEv && koEv.start != null ? koEv.start : D.ko - 20;
    D.simLen = D.len;
    buildReplay();
  }
  /* 召喚：一個技能可以召喚好幾隻（sums），或在我方出現對手的複製體（cpy，「將敵人召喚為我方夥伴」）。
     每一方場上的召喚物＋複製體最多 D.sumCap 隻，滿了就不再出現。 */
  const skSums = (sk) => (sk ? sk.sums || (sk.sum ? [sk.sum] : []) : []);
  function skillSpawn(fid, action) {
    if (action !== "skill1" && action !== "skill2") return null;
    const st = S.stats[fid], sk = st && st.sk && st.sk[action === "skill1" ? 0 : 1];
    if (!sk) return null;
    const sums = skSums(sk).filter((sm) => D.sumF && D.sumF[sm.id]);
    const cpy = sk.cpy && +sk.cpy.lv > 0 ? sk.cpy : null;
    return sums.length || cpy ? { sums, cpy } : null;
  }
  function summonInfo(i, action) { const f = D.f[i]; return f ? skillSpawn(f.r.id, action) : null; }
  const sumCap = () => Math.max(1, Math.min(20, Math.round(D.sumCap || 3)));
  async function loadSummons(i) {
    const f = D.f[i], st = f && S.stats[f.r.id];
    if (!st || !st.sk) return;
    D.sumF = D.sumF || {};
    for (const sk of st.sk) for (const sm of skSums(sk)) {
      if (!sm || !sm.id || D.sumF[sm.id]) continue;
      const r = S.index.find((x) => x.id === sm.id) || { id: sm.id, name: sm.id };
      try { D.sumF[sm.id] = await loadFighter(r); } catch {}
    }
  }
  // 已經沒有角色會用到的召喚物，圖片釋放掉
  function pruneSummons() {
    if (!D.sumF) return;
    const keep = new Set();
    for (const f of D.f) { const st = f && S.stats[f.r.id]; for (const sk of (st && st.sk) || []) for (const sm of skSums(sk)) keep.add(sm.id); }
    for (const id of Object.keys(D.sumF)) if (!keep.has(id)) { freeFighter(D.sumF[id]); delete D.sumF[id]; }
  }
  function summonLevel(sm, L) {
    const v = sm.lv ? +sm.lv[1] || 0 : 0;
    if (!sm.lv) return L;
    return Math.max(1, Math.round(sm.lv[0] === "fix" ? v : sm.lv[0] === "mul" ? L * v : L + v));
  }
  // 複製體：對手的資料庫數值，等級固定（不套金手指）
  function copyStats(fid, lv) {
    const st = S.stats[fid] || {}, lim = levelLimits(st.s || "1星");
    const L = Math.max(1, Math.min(lim.max, Math.round(lv)));
    const o = { level: L };
    for (const k of STAT5) o[k] = Math.round(statAt(st[k], L, lim.cap));
    Object.assign(o, { ai: st.ai || 2.5, cr: st.cr || 0, cd: st.cd || 100, dg: st.dg || 0, hit: st.hit || 0, sh: st.sh || 0, sdg: st.sdg || 0, sr: st.sr || 0, rg: st.rg || 100, mv: st.mv || 100, sk: st.sk || [] });
    return o;
  }
  function summonStats(id, lv) {
    const st = S.stats[id] || {}, lim = levelLimits(st.s || "1星");
    const L = Math.max(1, Math.min(lim.max, Math.round(lv)));
    const o = { level: L };
    for (const k of STAT5) o[k] = Math.round(statAt(st[k], L, lim.cap));
    Object.assign(o, { ai: st.ai || 2.5, cr: st.cr || 0, cd: st.cd || 100, hit: st.hit || 0, sh: st.sh || 0, dg: st.dg || 0, sdg: st.sdg || 0, sr: st.sr || 0, rg: st.rg || 100, mv: st.mv || 100 });
    return o;
  }
  // 單位（本人或召喚物，需有 f＝角色）開始一個動作，回傳動作長度（格）
  function unitAnim(s, anim, k, loop) {
    const rate = (s.f.part.anim_rate || 24) * D.speed;
    const dur = Math.max(1, Math.round(s.f.part.animations[anim].frame_count / rate * FPS));
    s.cur = { anim, start: k, rate, loop, dur };
    return dur;
  }
  // 召喚物的動作：回傳這一幀要畫的動畫與幀號
  function sumFrame(s, k) {
    const idle = idleClip(s.f);
    if (!s.cur || (!s.cur.loop && k >= s.cur.start + s.cur.dur)) unitAnim(s, idle, k, true);
    const n = s.f.part.animations[s.cur.anim].frame_count;
    let idx = Math.floor((k - s.cur.start) / FPS * s.cur.rate);
    idx = s.cur.loop ? idx % n : Math.min(n - 1, idx);
    return { anim: s.cur.anim, idx, x: s.x };
  }
  // 真距離／原始數值對戰用。純輔助技能：資料庫裡這招沒有任何傷害倍率（例如只有攻擊力提升、無敵、回血）。
  // 沒有數值資料時無法判斷，當作攻擊技能。
  function isSupport(i, action) {
    if (action !== "skill1" && action !== "skill2") return false;
    const f = D.f[i], st = f && S.stats && S.stats[f.r.id];
    if (!st || !Array.isArray(st.sk)) return false;
    const sk = st.sk[action === "skill1" ? 0 : 1];
    return !!sk && !(sk.e && sk.e.length);
  }
  function compileOnce() {
    const [A, B] = D.f;
    D.len = 30;
    if (!A || !B) return;
    const pos = [-D.dist / 2, D.dist / 2];
    D.posKeys = [[{ k: 0, x: pos[0] }], [{ k: 0, x: pos[1] }]];
    const hp = [100, 100];
    let k = 12, ko = -1;
    // 兩人「正面」之間至少留一點空隙，不會疊在一起
    const minGap = Math.max(80, A.w / 2 + B.w / 2 + 70);
    D.moves.forEach((m, mi) => {
      if (ko >= 0) return;
      const i = m.who === "B" ? 1 : 0, j = 1 - i, f = D.f[i], g = D.f[j];
      const anim = f.clips[m.action];
      if (!anim) return;
      const dir = i === 0 ? 1 : -1;
      if (m.action === "move") {
        const { rate, dur } = framesFor(f, anim, m.slow);
        const total = Math.max(dur * 2, 24);
        const gap = Math.abs(pos[1] - pos[0]);
        const step = Math.max(0, Math.min(110, gap - minGap));
        D.tracks[i].push({ anim, start: k, end: k + total, rate, loop: true });
        D.posKeys[i].push({ k, x: pos[i] });
        pos[i] += dir * step;
        D.posKeys[i].push({ k: k + total, x: pos[i] });
        k += total + 4;
        return;
      }
      const reps = Math.max(1, Math.min(8, Math.round(m.repeat || 1)));
      for (let r = 0; r < reps && ko < 0; r++) {
        const sf = m.slow ? 0.5 : 1;
        const { rate, dur } = framesFor(f, anim, sf);
        D.tracks[i].push({ anim, start: k, end: k + dur, rate });
        let hitAt = k + Math.round(dur * hitFrac(f, anim));
        // 投射物：從角色手上射出，飛到對手身上才算命中
        const cfg = D.projOn ? f.proj[{ attack: "n", skill1: "s1", skill2: "s2" }[m.action]] : null;
        const dr = cfg && f.bul[cfg.p];
        const flight = dr && pickAnim(dr.part, ["normal", "idle", "wait", "shot", "fire", "attack"]);
        if (dr && flight) {
          const finish = pickAnim(dr.part, ["finish", "hit", "end"]);
          const face = i === 0 ? 1 : -1;
          const ready = f.part.animations[anim.replace(/_all$/, "_ready")];
          const total = f.part.animations[anim].frame_count;
          const spawn = k + Math.round(dur * (ready && anim.endsWith("_all") ? ready.frame_count / total : 0.3));
          if ((cfg.m === "LINEAR" || cfg.m === "CURVE") && cfg.v > 0 && cfg.e) {
            const st = { x: pos[i] + face * (f.ox + cfg.x * 0.5), y: f.oy - cfg.y * 0.5 };
            const en = { x: pos[j], y: -g.h * (cfg.m === "CURVE" ? 0.05 : 0.3) };
            const dist = Math.hypot(en.x - st.x, en.y - st.y);
            const fl = Math.max(2, Math.round(dist / (cfg.v * 60) * FPS / D.speed / sf));
            hitAt = spawn + fl;
            D.projs.push({ spawn, fl, st, en, curve: cfg.m === "CURVE", face, dr, flight, finish, a0: cfg.a0, a1: cfg.a1, rot: !!cfg.r, loop: !!cfg.l, dist });
          } else {
            // 近戰或沒有飛行資料：在對手身上播放命中特效
            D.projs.push({ direct: true, spawn: hitAt, en: { x: pos[j], y: -g.h * 0.45 }, face, dr, flight, finish });
          }
        }
        // 召喚技能：召喚物（或對手的複製體）在技能命中時出現在身旁，做一次動作（經典對戰只做畫面）
        const smc = summonInfo(i, m.action);
        if (smc) {
          const list = smc.sums.map((sm) => ({ sf: D.sumF[sm.id], act: "attack" }));
          if (smc.cpy) list.push({ sf: D.f[j], act: D.f[j].clips.skill1 ? "skill1" : D.f[j].clips.skill2 ? "skill2" : "attack", copy: true });
          list.forEach(({ sf, act, copy }, n) => {
            if (!sf) return;
            const alive = D.summons.filter((x) => x.side === i && x.k0 <= hitAt && x.k1 > hitAt).length;
            if (alive >= sumCap()) return; // 場上已滿
            const so = { side: i, f: sf, copy: !!copy, x: pos[i] + dir * (f.w * 0.5 + sf.w * 0.3 + n * 26), k0: hitAt, k1: 0, fr: [] };
            const atkA = sf.clips[act] || sf.clips.attack || sf.clips.idle, idleA = sf.clips.idle || atkA;
            if (!atkA) return;
            const fa = framesFor(sf, atkA, 1);
            for (let t = 0; t < fa.dur; t++) so.fr.push({ anim: atkA, idx: Math.min(sf.part.animations[atkA].frame_count - 1, Math.floor(t / FPS * fa.rate)), x: so.x });
            const fi = framesFor(sf, idleA, 1);
            for (let t = 0; t < 24; t++) so.fr.push({ anim: idleA, idx: Math.floor(t / FPS * fi.rate) % sf.part.animations[idleA].frame_count, x: so.x });
            so.k1 = hitAt + so.fr.length;
            D.summons.push(so);
            if (copy) D.sfxEv.push({ k: hitAt, side: i, kind: "skill" });
            D.sfxEv.push({ k: hitAt + Math.round(fa.dur * hitFrac(sf, atkA)), side: i, kind: copy ? "skillhit" : "attack" });
          });
        }
        if (m.action === "attack") D.sfxEv.push({ k: hitAt, side: i, kind: "attack" });
        else D.sfxEv.push({ k, side: i, kind: "skill" }, { k: hitAt, side: i, kind: "skillhit" });
        const dmg = Math.max(1, Math.round((DMG[m.action] || 8) * (0.75 + rnd(mi * 10 + r) * 0.5) / (reps > 1 ? 1.6 : 1)));
        hp[j] = Math.max(0, hp[j] - dmg);
        D.events.push({ k: hitAt, target: j, attacker: i, dmg, hp: hp.slice(), ko: hp[j] <= 0, start: k });
        let kbEnd = hitAt;
        const kb = g.clips.knockback;
        if (kb) {
          const t = framesFor(g, kb, sf);
          D.tracks[j].push({ anim: kb, start: hitAt, end: hitAt + t.dur, rate: t.rate });
          kbEnd = hitAt + t.dur;
          D.posKeys[j].push({ k: hitAt, x: pos[j] });
          pos[j] += dir * (hp[j] <= 0 ? 90 : 30); // 被打的一方往後退（遠離攻擊者）
          D.posKeys[j].push({ k: hitAt + Math.round(t.dur * 0.6), x: pos[j] });
        }
        if (hp[j] <= 0) ko = hitAt;
        k = r < reps - 1 ? k + Math.round(dur * (reps > 1 ? 0.8 : 1)) : Math.max(k + dur, kbEnd) + 8;
      }
    });
    D.len = k + (ko >= 0 ? 50 : 24);
    D.ko = ko;
    // 鏡頭：涵蓋兩人所有走到的位置
    let X0 = Infinity, X1 = -Infinity;
    D.posKeys.forEach((keys, i) => {
      const hw = D.f[i].w / 2;
      for (const p of keys) { X0 = Math.min(X0, p.x - hw); X1 = Math.max(X1, p.x + hw); }
    });
    for (const so of D.summons) { X0 = Math.min(X0, so.x - so.f.w / 2); X1 = Math.max(X1, so.x + so.f.w / 2); }
    const bodyH = Math.max(A.h, B.h, 60);
    D.cam = { cx: (X0 + X1) / 2, w: (X1 - X0) * 1.15 + 40, h: bodyH * 2.0, bodyH };
  }
  // K.O. 特效：先正常速度打完並顯示 K.O.，接著慢動作重播最後一擊（timeMap 把輸出格對到模擬格）
  function buildReplay() {
    const n = Math.max(1, D.simLen || D.len);
    const map = [];
    for (let t = 0; t < n; t++) map.push(t);
    D.replayFrom = -1;
    if (D.finale && D.ko >= 0) {
      D.replayFrom = map.length;
      const rs = Math.max(0, D.finalStart - 8), re = Math.min(n - 1, D.ko + 30);
      for (let t = rs; t <= re; t += 0.4) map.push(Math.floor(t));
      for (let h = 0; h < 24; h++) map.push(re);
    }
    D.timeMap = map;
    D.len = map.length;
  }
