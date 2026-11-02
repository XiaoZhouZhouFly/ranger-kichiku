  /* ---------- 時間軸 ---------- */
  function expandSegs(segs, n) {
    const out = [];
    for (const s of segs) {
      let a = clampInt(s.start, 0, n - 1), b = clampInt(s.end ?? s.start, 0, n - 1);
      if (b < a) [a, b] = [b, a];
      let base = [];
      const hold = clampInt(s.hold, 0, 600);
      if (hold > 0) base = Array(hold).fill(a);
      else for (let i = a; i <= b; i++) base.push(i);
      if (s.reverse) base.reverse();
      if (s.pingpong && base.length > 2) base = base.concat(base.slice(1, -1).reverse());
      const sp = Math.max(0.05, +s.speed || 1);
      if (!hold && sp !== 1) {
        const cnt = Math.max(1, Math.round(base.length / sp));
        const src = base; base = [];
        for (let i = 0; i < cnt; i++) base.push(src[Math.min(src.length - 1, Math.floor(i * sp))]);
      }
      const reps = clampInt(s.repeat, 1, 50);
      const seq = [];
      for (let r = 0; r < reps; r++) for (const idx of base) seq.push([idx, r]);
      seq.forEach(([idx, r], k) => out.push({ idx, rep: r, seg: s, t: seq.length > 1 ? k / (seq.length - 1) : 0 }));
    }
    return out;
  }
  function rebuildTimeline() {
    const n = anim() ? clipN() : 1;
    S.timeline = expandSegs(S.segs, n);
    $("segTotal").textContent = `共 ${S.timeline.length} 幀・約 ${(S.timeline.length / FPS).toFixed(1)} 秒`;
  }
  function clampInt(v, lo, hi) { v = Math.round(+v); if (!isFinite(v)) v = lo; return Math.max(lo, Math.min(hi, v)); }

  /* ---------- 播放迴圈 ---------- */
  /* 播放音效的時鐘（單人、雙人共用）：播放中依「不歸零的播放位置」提前預約音效；
     畫面被拖動、跳轉或暫停時，取消已預約還沒響的聲音，下次從新位置重新計。 */
  const newClock = () => ({ abs: null, ref: null, st: null });
  function clockAdvance(c, pos, step) {
    if (c.abs != null && c.ref !== pos) { c.abs = null; sfxStopPending(); } // 位置被跳轉過
    if (c.abs == null) { c.abs = pos; c.st = {}; }
    c.abs += step;
    return pos + step;
  }
  function clockSchedule(c, pos, list, len, fps, play) { sfxRun(c.st, list, c.abs, fps, len, play); c.ref = pos; }
  function clockStop(c, cancel = true) { if (c.abs != null) { c.abs = null; if (cancel) sfxStopPending(); } }
  function totalLen() { return S.mode === "remix" ? S.timeline.length : (anim() ? clipN() : 0); }
  function rate() { return S.mode === "remix" ? FPS : (S.part?.anim_rate || 24) * S.speed; }
  function drawCurrent() {
    if (!S.part || !anim() || !S.atlas || S.swapping) return; // 切換角色載入中時先不畫
    const k = Math.floor(S.pos);
    if (S.mode === "remix") {
      const st = remixState(k);
      if (st) render(st.idx, st.cam, st.fx, k);
    } else {
      render(k, origCam(k), {}, k);
    }
    $("frameNo").textContent = `${Math.min(k, Math.max(0, totalLen() - 1))} / ${Math.max(0, totalLen() - 1)}`;
    if (!scrubbing) $("scrub").value = String(k);
  }
  let scrubbing = false;
  /* 暫停時不重畫：只有畫面可能變了（操作、下載完成、視窗大小改變）才畫，
     另外每秒保底畫一次，以防漏掉。播放中照常每格都畫。 */
  let needDraw = true, dirtyUntil = 0, lastDraw = 0;
  function markDirty(ms = 0) { needDraw = true; if (ms) dirtyUntil = Math.max(dirtyUntil, performance.now() + ms); }
  function shouldDraw(playing) {
    const now = performance.now();
    if (playing || needDraw || now < dirtyUntil || now - lastDraw > 1000) { needDraw = false; lastDraw = now; return true; }
    return false;
  }
  ["input", "change", "click", "pointerdown", "pointerup", "keydown", "wheel", "drop"].forEach((ev) => document.addEventListener(ev, () => markDirty(600), { capture: true, passive: true }));
  document.addEventListener("pointermove", (e) => { if (e.buttons) markDirty(300); }, { capture: true, passive: true });
  window.addEventListener("resize", () => markDirty(300));
  document.addEventListener("visibilitychange", () => markDirty());
  function updateScrub() { $("scrub").max = String(Math.max(0, totalLen() - 1)); }
  function loop(ts) {
    requestAnimationFrame(loop);
    if (!S.lastTs) S.lastTs = ts;
    const dt = Math.min(0.1, (ts - S.lastTs) / 1000);
    S.lastTs = ts;
    if (S.app === "duel") { duelTick(dt); return; }
    if (!S.part || S.recording) return;
    if (S.playing) {
      const len = totalLen();
      S.pos = clockAdvance(S.clock, S.pos, dt * rate());
      if (S.pos >= len) {
        if (S.loop || S.mode === "remix") S.pos = S.pos % Math.max(1, len);
        else { S.pos = len - 1; setPlaying(false); }
      }
      if (S.playing) { const sl = singleSfxList(); clockSchedule(S.clock, S.pos, sl.list, sl.len, rate(), singleSfxPlay); }
    } else clockStop(S.clock);
    if (shouldDraw(S.playing)) drawCurrent();
  }
  function setPlaying(p) {
    S.playing = p;
    $("playBtn").textContent = p ? "❚❚" : "▶";
    $("playBtn").setAttribute("aria-label", p ? "暫停" : "播放");
  }
  function setMode(m) {
    S.mode = m; S.pos = 0; clockStop(S.clock); sfxStopPending(); syncUrl();
    $("modeOrig").setAttribute("aria-pressed", String(m === "orig"));
    $("modeRemix").setAttribute("aria-pressed", String(m === "remix"));
    updateScrub(); drawCurrent();
  }

