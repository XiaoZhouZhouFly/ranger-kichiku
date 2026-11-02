  /* ---------- 繪製 ---------- */
  function hash(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

  function render(frameIdx, cam, fx, tick) {
    const W = cv.width, H = cv.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    const bg = BG[S.bg];
    if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H); } else ctx.clearRect(0, 0, W, H);
    if (!S.part) return;
    const frames = anim().frames;
    const frame = frames[Math.max(0, Math.min(frames.length - 1, frameIdx))];
    ctx.translate(W / 2 + cam.dx + S.panX, H / 2 + cam.dy + S.panY);
    if (cam.rot) ctx.rotate(cam.rot * Math.PI / 180);
    ctx.scale(cam.zoom * (cam.mirror ? -1 : 1), cam.zoom);
    ctx.translate(-cam.fx, -cam.fy);
    for (const t of itemsOf(frame)) {
      const cp = S.comps[t.name] || defComp();
      if (!cp.show) continue;
      const img = hueSprite(t.name, (cp.hue || 0) + (fx.hue || 0));
      if (!img) continue;
      ctx.save();
      ctx.globalAlpha = Math.min(1, t.alpha);
      ctx.transform(t.A, t.D, t.B, t.E, t.C, t.F);
      const spin = (cp.spin || 0) * tick;
      const jit = cp.jitter || 0;
      if (cp.scale !== 1 || spin || jit) {
        const jx = jit ? (hash(tick * 3.1 + t.w) - 0.5) * 2 * jit : 0;
        const jy = jit ? (hash(tick * 5.7 + t.h) - 0.5) * 2 * jit : 0;
        ctx.translate(t.w / 2 + jx, t.h / 2 + jy);
        if (spin) ctx.rotate(spin * Math.PI / 180);
        ctx.scale(cp.scale, cp.scale);
        ctx.translate(-t.w / 2, -t.h / 2);
      }
      ctx.drawImage(img, 0, 0);
      ctx.restore();
    }
    drawSingleProj(frameIdx);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (fx.invert && bg) {
      ctx.globalCompositeOperation = "difference";
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "source-over";
    }
  }

  function origCam(frameIdx) {
    const f = S.follow ? centerAt(frameIdx) : { x: S.bounds.cx, y: S.bounds.cy };
    return { fx: f.x, fy: f.y, zoom: fitScale() * S.camZoom, rot: 0, mirror: false, dx: 0, dy: 0 };
  }
  const lerp = (a, b, t) => a + (b - a) * t;
  // 「角色（固定鏡頭）」：取這段用到的幀的角色平均位置，鏡頭不跟著零件晃動
  const fixedCache = new WeakMap();
  function fixedCenter(s) {
    const n = clipN();
    const key = `${S.unit?.id}|${S.animName}|${s.start}|${s.end}|${s.hold}`;
    const hit = fixedCache.get(s);
    if (hit && hit.key === key) return hit.c;
    let a = clampInt(s.start, 0, n - 1), b = clampInt(s.hold > 0 ? s.start : s.end, 0, n - 1);
    if (b < a) [a, b] = [b, a];
    let sx = 0, sy = 0, cnt = 0;
    for (let i = a; i <= b; i++) { const c = centerAt(i); sx += c.x; sy += c.y; cnt++; }
    const c = cnt ? { x: sx / cnt, y: sy / cnt } : { x: S.bounds.cx, y: S.bounds.cy };
    fixedCache.set(s, { key, c });
    return c;
  }
  function remixState(k) {
    const e = S.timeline[Math.max(0, Math.min(S.timeline.length - 1, k))];
    if (!e) return null;
    const s = e.seg, t = e.t;
    const f = s.focus === "body" ? centerAt(e.idx) : s.focus === "bodyFixed" ? fixedCenter(s) : { x: S.bounds.cx, y: S.bounds.cy };
    const sh = +s.shake || 0;
    return {
      idx: e.idx,
      cam: {
        fx: f.x, fy: f.y,
        zoom: fitScale() * S.camZoom * lerp(+s.zoom0 || 1, +s.zoom1 || 1, t),
        rot: lerp(+s.rot0 || 0, +s.rot1 || 0, t),
        mirror: s.mirror === "on" || (s.mirror === "alt" && e.rep % 2 === 1),
        dx: sh ? (hash(k * 1.3) - 0.5) * 2 * sh : 0,
        dy: sh ? (hash(k * 2.9 + 7) - 0.5) * 2 * sh : 0,
      },
      fx: { hue: lerp(+s.hue0 || 0, +s.hue1 || 0, t), invert: !!s.invert },
    };
  }

