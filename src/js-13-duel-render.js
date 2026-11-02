  /* ---------- 雙人對打：畫面（只讀 TIMELINE，畫出第 k 格） ---------- */
  // 畫布文字的字型：網頁本身的字型（第一次用到時讀一次）；display＝標題用的 Bungee
  let bodyFontCache = "";
  const bodyFont = () => bodyFontCache || (bodyFontCache = getComputedStyle(document.body).fontFamily);
  const canvasFont = (weight, px, display) => `${weight} ${px}px ${display ? '"Bungee", ' : ""}${bodyFont()}`;
  function fSprite(f, name) {
    if (f.sprites.has(name)) return f.sprites.get(name);
    const sp = f.part.sprites[name];
    if (!sp || !sp.rect || !sp.rect[2] || !sp.rect[3]) { f.sprites.set(name, null); return null; }
    const [sx, sy, w, h] = sp.rect;
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d");
    if (sp.rotated) { g.translate(w / 2, h / 2); g.rotate(-Math.PI / 2); g.drawImage(f.atlas, sx, sy, h, w, -h / 2, -w / 2, h, w); }
    else g.drawImage(f.atlas, sx, sy, w, h, 0, 0, w, h);
    f.sprites.set(name, c);
    return c;
  }
  function fItems(f, frame) {
    const out = [];
    for (const it of frame || []) {
      const def = f.part.images[it[1]], om = it[2], col = it[3];
      if (!def || !Array.isArray(om) || !Array.isArray(def.m)) continue;
      const alpha = (Array.isArray(col) && col.length > 3 ? col[3] : 255) / 255;
      if (alpha <= 0) continue;
      const sp = f.part.sprites[def.name];
      if (!sp || !sp.rect || !sp.rect[2]) continue;
      const [m00, m01, m10, m11, m02, m12] = om, [i00, i01, i10, i11, i02, i12] = def.m;
      out.push({ name: def.name, alpha, w: sp.rect[2], h: sp.rect[3],
        A: m00 * i00 + m01 * i10, B: m00 * i01 + m01 * i11, C: m00 * i02 + m01 * i12 + m02,
        D: m10 * i00 + m11 * i10, E: m10 * i01 + m11 * i11, F: m10 * i02 + m11 * i12 + m12 });
    }
    return out;
  }
  function fBounds(f, anim) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const fr of (f.part.animations[anim]?.frames || [])) for (const t of fItems(f, fr)) {
      if (t.alpha < 0.3) continue;
      for (const [px, py] of [[0, 0], [t.w, 0], [0, t.h], [t.w, t.h]]) {
        const x = t.A * px + t.B * py + t.C, y = t.D * px + t.E * py + t.F;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
    }
    if (!isFinite(x0)) return { x0: -40, x1: 40, y0: -100, y1: 0 };
    return { x0, x1, y0, y1 };
  }
  function drawFighter(f, anim, idx, x, faceLeft, flash, mul = 1) {
    const a = f.part.animations[anim];
    if (!a) return;
    const frame = a.frames[Math.max(0, Math.min(a.frames.length - 1, idx))];
    dctx.save();
    dctx.translate(x, 0);
    if (faceLeft) dctx.scale(-1, 1);
    dctx.translate(f.ox, f.oy);
    for (const t of fItems(f, frame)) {
      const img = fSprite(f, t.name);
      if (!img) continue;
      dctx.save();
      dctx.globalAlpha = Math.min(1, t.alpha) * mul;
      dctx.transform(t.A, t.D, t.B, t.E, t.C, t.F);
      dctx.drawImage(img, 0, 0);
      if (flash) { dctx.globalCompositeOperation = "lighter"; dctx.globalAlpha = Math.min(1, t.alpha) * 0.7; dctx.drawImage(img, 0, 0); }
      dctx.restore();
    }
    dctx.restore();
  }

  function drawPartAt(dr, anim, idx, x, y, faceLeft, rotDeg) { drawPartCtx(dctx, dr, anim, idx, x, y, faceLeft, rotDeg); }
  function drawPartCtx(c, dr, anim, idx, x, y, faceLeft, rotDeg) {
    const a = dr.part.animations[anim];
    if (!a) return;
    const frame = a.frames[Math.max(0, Math.min(a.frames.length - 1, idx))];
    c.save();
    c.translate(x, y);
    if (faceLeft) c.scale(-1, 1);
    if (rotDeg) c.rotate(rotDeg * Math.PI / 180);
    for (const t of fItems(dr, frame)) {
      const img = fSprite(dr, t.name);
      if (!img) continue;
      c.save();
      c.globalAlpha = Math.min(1, t.alpha);
      c.transform(t.A, t.D, t.B, t.E, t.C, t.F);
      c.drawImage(img, 0, 0);
      c.restore();
    }
    c.restore();
  }
  function posAt(i, k) {
    if (isSim()) { const fr = D.frames[i]; return fr.length ? fr[Math.max(0, Math.min(fr.length - 1, k))].x : 0; }
    const keys = D.posKeys[i];
    let x = keys[0].x;
    for (let n = 1; n < keys.length; n++) {
      const a = keys[n - 1], b = keys[n];
      if (k <= a.k) break;
      if (k >= b.k) { x = b.x; continue; }
      x = a.x + (b.x - a.x) * ((k - a.k) / Math.max(1, b.k - a.k)); break;
    }
    return x;
  }
  function stateAt(i, k) {
    if (isSim()) { const fr = D.frames[i]; const s2 = fr[Math.max(0, Math.min(fr.length - 1, k))]; if (s2) return { anim: s2.anim, idx: s2.idx, active: s2.start >= 0, start: s2.start }; }
    const f = D.f[i];
    let tr = null;
    for (const t of D.tracks[i]) if (k >= t.start && k < t.end && (!tr || t.start >= tr.start)) tr = t;
    if (tr) {
      const n = f.part.animations[tr.anim].frame_count;
      let idx = Math.floor((k - tr.start) / FPS * tr.rate);
      idx = tr.loop ? idx % n : Math.min(n - 1, idx);
      return { anim: tr.anim, idx, active: true, start: tr.start };
    }
    const lastKo = D.ko >= 0 && k >= D.ko && D.events.some((e) => e.ko && e.target === i);
    if (lastKo && f.clips.knockback) {
      const n = f.part.animations[f.clips.knockback].frame_count;
      return { anim: f.clips.knockback, idx: n - 1, active: false, start: 0 };
    }
    const idle = idleClip(f);
    const n = f.part.animations[idle].frame_count;
    return { anim: idle, idx: Math.floor(k / FPS * (f.part.anim_rate || 24)) % n, active: false, start: -1 };
  }
  function renderDuel(k) {
    const kOut = k;
    if (D.timeMap && D.timeMap.length) k = D.timeMap[Math.max(0, Math.min(D.timeMap.length - 1, k))];
    const W = dcv.width, H = dcv.height, c = dctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1; c.globalCompositeOperation = "source-over";
    c.fillStyle = BG[S.bg] || "#ffffff"; c.fillRect(0, 0, W, H);
    if (D.bgImg) {
      const im = D.bgImg, s2 = Math.max(W / im.width, H / im.height);
      c.drawImage(im, (W - im.width * s2) / 2, (H - im.height * s2) / 2, im.width * s2, im.height * s2);
    }
    if (!D.f[0] || !D.f[1] || !D.cam) return;
    // 最後一擊特寫的進度
    const fin = D.finale ? finaleState(kOut) : null;
    let sx = 0, sy = 0, flashT = [false, false], inv = false;
    for (const e of D.events) {
      if (e.noFx) continue;
      const d = k - e.k;
      if (d >= 0 && d < 4) flashT[e.target] = true;
      if (D.shake && d >= 0 && d < 8) { const amp = (e.ko ? 26 : 12) * (1 - d / 8); sx += (hash(k * 1.7) - 0.5) * 2 * amp; sy += (hash(k * 3.1 + 5) - 0.5) * 2 * amp; }
      if (D.invert && d >= 0 && d < 2) inv = true;
    }
    const top = D.bars ? 64 : 16;
    const groundY = D.bgImg ? H * (1 - D.ground / 100) : H - 24;
    let sc = Math.min(W * 0.94 / D.cam.w, (groundY - top - 4) / D.cam.h);
    let cx = D.cam.cx;
    c.translate(W / 2 + sx, groundY + sy);
    c.scale(sc, sc);
    c.translate(-cx, 0);
    // 地面陰影線
    if (!D.bgImg) {
      c.strokeStyle = "rgba(27,32,56,0.12)"; c.lineWidth = 2 / sc;
      c.beginPath(); c.moveTo(D.cam.cx - D.cam.w * 2, 2); c.lineTo(D.cam.cx + D.cam.w * 2, 2); c.stroke();
    }
    const st = [stateAt(0, k), stateAt(1, k)];
    const order = st[0].start > st[1].start ? [1, 0] : [0, 1];
    for (const i of order) drawFighter(D.f[i], st[i].anim, st[i].idx, posAt(i, k), i === 1, flashT[i]);
    // 召喚物：出場時淡入加一圈光環，離場時淡出
    for (const so of D.summons || []) {
      const rel = k - so.k0, last = so.fr.length - 1;
      if (rel < 0 || last < 0) continue;
      const fade = rel > last ? 1 - (rel - last) / 10 : rel < 6 ? (rel + 1) / 6 : 1;
      if (fade <= 0) continue;
      const fr = so.fr[Math.min(last, rel)];
      drawFighter(so.f, fr.anim, fr.idx, fr.x, so.side === 1, false, fade);
      if (rel < 14) {
        const rr = 26 + rel * 9;
        c.save(); c.globalAlpha = 1 - rel / 14; c.strokeStyle = so.side ? "#2f7cff" : "#ff3d7f"; c.lineWidth = 6 / sc;
        c.beginPath(); c.ellipse(so.fr[0].x, 0, rr, rr * 0.28, 0, 0, Math.PI * 2); c.stroke(); c.restore();
      }
    }
    for (const p of D.projs) {
      const age = k - p.spawn;
      if (age < 0) continue;
      if (p.direct) {
        const n1 = animOutFrames(p.dr, p.flight);
        if (age < n1) drawPartAt(p.dr, p.flight, animIdx(p.dr, p.flight, age, false), p.en.x, p.en.y, p.face < 0, 0);
        else if (p.finish && age - n1 < animOutFrames(p.dr, p.finish)) drawPartAt(p.dr, p.finish, animIdx(p.dr, p.finish, age - n1, false), p.en.x, p.en.y, p.face < 0, 0);
        continue;
      }
      if (age < p.fl) {
        const t = age / p.fl;
        let x = p.st.x + (p.en.x - p.st.x) * t, y = p.st.y + (p.en.y - p.st.y) * t;
        if (p.curve) {
          // 遊戲原生的拋物線：貝茲曲線，控制點在中點往前上方 0.4 倍距離
          const h = p.dist * 0.4, u = 1 - t;
          const c2x = (p.st.x + p.en.x) / 2 + p.face * h, c2y = (p.st.y + p.en.y) / 2 - h;
          x = u * u * u * p.st.x + 3 * u * u * t * p.st.x + 3 * u * t * t * c2x + t * t * t * p.en.x;
          y = u * u * u * p.st.y + 3 * u * u * t * p.st.y + 3 * u * t * t * c2y + t * t * t * p.en.y;
        }
        const rot = p.rot ? p.a0 + (p.a1 - p.a0) * t : 0;
        drawPartAt(p.dr, p.flight, animIdx(p.dr, p.flight, age, p.loop), x, y, p.face < 0, rot);
      } else if (p.finish) {
        const fa = age - p.fl;
        if (fa < animOutFrames(p.dr, p.finish)) drawPartAt(p.dr, p.finish, animIdx(p.dr, p.finish, fa, false), p.en.x, p.en.y, p.face < 0, 0);
      }
    }
    if (D.numbers) {
      for (const e of D.events) {
        const d = k - e.k;
        if (d < 0 || d >= 26) continue;
        const x = e.tx != null ? e.tx : posAt(e.target, k), y = (e.sumTarget ? -D.cam.bodyH * 0.8 : -D.cam.bodyH * 1.05) - d * 2.2;
        c.save(); c.translate(x, y); c.scale(1 / sc, 1 / sc);
        c.globalAlpha = d < 18 ? 1 : 1 - (d - 18) / 8;
        const big = e.ko || e.crit;
        c.font = canvasFont(900, big ? 40 : e.dotTick ? 22 : 30);
        c.textAlign = "center"; c.lineWidth = 6; c.strokeStyle = "#1b2038";
        c.fillStyle = e.fx === "heal" ? "#3cd070" : e.fx === "buff" ? "#ffc814" : e.miss ? "#c9cede" : e.dotTick || e.fx === "dot" ? "#c79bff" : big ? "#ffc814" : "#ffffff";
        const txt = e.label || `-${Math.round(e.dmg * 123)}`;
        c.strokeText(txt, 0, 0); c.fillText(txt, 0, 0);
        c.restore();
      }
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
    if (fin) drawFinale(c, W, H, k, fin);
    if (D.bars) {
      let hp = D.maxHp.slice();
      for (const e of D.events) if (e.k <= k) hp = e.hp;
      const bw = W * 0.4, bh = 16, pad = 18;
      [0, 1].forEach((i) => {
        const x = i === 0 ? pad : W - pad - bw;
        c.fillStyle = "#1b2038"; c.fillRect(x - 3, 30 - 3, bw + 6, bh + 6);
        c.fillStyle = "#3a405e"; c.fillRect(x, 30, bw, bh);
        const ratio = Math.max(0, hp[i] / (D.maxHp[i] || 100));
        const w = bw * ratio;
        c.fillStyle = ratio > 0.3 ? (i === 0 ? "#ff3d7f" : "#2f7cff") : "#ffc814";
        if (i === 0) c.fillRect(x, 30, w, bh); else c.fillRect(x + bw - w, 30, w, bh);
        c.font = canvasFont(700, 15);
        c.textAlign = i === 0 ? "left" : "right";
        if (D.bgImg || BG[S.bg] === "#000000") { c.lineWidth = 4; c.strokeStyle = "#1b2038"; c.strokeText(D.f[i].r.name, i === 0 ? x : x + bw, 22); c.fillStyle = "#ffffff"; }
        else c.fillStyle = "#1b2038";
        c.fillText(D.f[i].r.name, i === 0 ? x : x + bw, 22);
        if (isRaw()) {
          c.font = canvasFont(700, 12);
          const t2 = `${Math.round(hp[i]).toLocaleString()} / ${Math.round(D.maxHp[i]).toLocaleString()}`;
          c.lineWidth = 3; c.strokeStyle = "#1b2038"; c.strokeText(t2, i === 0 ? x : x + bw, 60); c.fillStyle = "#ffffff"; c.fillText(t2, i === 0 ? x : x + bw, 60);
        }
      });
      c.font = canvasFont(900, 22);
      c.textAlign = "center"; c.fillStyle = "#ffc814"; c.strokeStyle = "#1b2038"; c.lineWidth = 4;
      c.strokeText("VS", W / 2, 46); c.fillText("VS", W / 2, 46);
    }
    if (D.resultK >= 0 && k >= D.resultK + 6) {
      const d = k - D.resultK - 6, s = Math.min(1, d / 8);
      c.save(); c.translate(W / 2, H * 0.42); c.scale(0.6 + s * 0.4, 0.6 + s * 0.4);
      c.font = canvasFont(900, Math.round(H * 0.16), true);
      c.textAlign = "center"; c.textBaseline = "middle"; c.lineWidth = 10; c.strokeStyle = "#1b2038"; c.fillStyle = "#ffc814";
      c.strokeText(D.resultText, 0, 0); c.fillText(D.resultText, 0, 0);
      if (D.resultText === "TIME UP") {
        c.font = canvasFont(900, Math.round(H * 0.06)); c.lineWidth = 6;
        const wt = D.winner === -1 ? "平手" : `${D.f[D.winner].r.name} 獲勝`;
        c.strokeText(wt, 0, H * 0.12); c.fillStyle = "#ffffff"; c.fillText(wt, 0, H * 0.12);
      }
      c.restore();
    }
    if (fin) drawReplayLabel(c, W, H, kOut, fin);
    if (inv && BG[S.bg]) { c.globalCompositeOperation = "difference"; c.fillStyle = "#ffffff"; c.fillRect(0, 0, W, H); c.globalCompositeOperation = "source-over"; }
  }
  // 進度條長度與結果文字（引擎算完後由 compileDuel 呼叫）
  function timelineSummary() {
    const head = `共 ${D.len} 幀・約 ${(D.len / FPS).toFixed(1)} 秒`;
    if (!isSim()) return head + (D.ko >= 0 ? "・" + (D.events.find((e) => e.ko).target === 0 ? "右方" : "左方") + "獲勝" : "");
    const who = D.winner === 0 ? "左方" : D.winner === 1 ? "右方" : "";
    return head + "・" + (D.resultText === "TIME UP" ? `時間到，${who ? who + "獲勝" : "平手"}` : D.winner === -1 ? "平手" : who + "獲勝");
  }
  function showTimelineInfo() { $("dscrub").max = String(Math.max(0, D.len - 1)); $("duelTotal").textContent = timelineSummary(); }
  function finaleState(kOut) {
    if (!(D.replayFrom >= 0) || kOut < D.replayFrom) return null;
    const t = Math.min(1, (kOut - D.replayFrom) / 10);
    return { gray: t * t * (3 - 2 * t) };
  }
  function drawFinale(c, W, H, k, fin) {
    const g = fin.gray; if (!(g > 0)) return;
    c.save();
    // 完全黑白 + 稍微壓暗
    c.globalCompositeOperation = "saturation"; c.globalAlpha = g; c.fillStyle = "#808080"; c.fillRect(0, 0, W, H);
    c.globalCompositeOperation = "multiply"; c.globalAlpha = 0.22 * g; c.fillStyle = "#3a3f55"; c.fillRect(0, 0, W, H);
    // 四周暗角
    c.globalCompositeOperation = "source-over"; c.globalAlpha = 1;
    const vg = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.28, W / 2, H / 2, Math.hypot(W, H) * 0.6);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, `rgba(0,0,0,${0.6 * g})`);
    c.fillStyle = vg; c.fillRect(0, 0, W, H);
    // 細掃描線，有重播畫面的感覺
    c.globalAlpha = 0.07 * g; c.fillStyle = "#000000";
    for (let y = 0; y < H; y += 4) c.fillRect(0, y, W, 1);
    c.restore();
  }
  function drawReplayLabel(c, W, H, kOut, fin) {
    const a = Math.min(1, fin.gray * 1.5); if (!(a > 0)) return;
    const sz = Math.round(Math.min(W, H) * 0.075), x = 24, y = 30 + 16 + 22 + sz * 0.6;
    c.save(); c.globalAlpha = a;
    if (Math.floor(kOut / 15) % 2 === 0) { c.fillStyle = "#ff3040"; c.beginPath(); c.arc(x + sz * 0.3, y, sz * 0.26, 0, Math.PI * 2); c.fill(); }
    c.font = canvasFont(900, sz, true);
    c.textAlign = "left"; c.textBaseline = "middle";
    c.lineWidth = Math.max(4, sz * 0.14); c.strokeStyle = "#1b2038"; c.fillStyle = "#ffffff";
    c.strokeText("REPLAY", x + sz * 0.75, y); c.fillText("REPLAY", x + sz * 0.75, y);
    c.restore();
  }
  // 倒數畫面：黑幕從 50% 慢慢變透明，中間大大的 3、2、1（錄影含倒數時也用這個）
  function drawCountdown(c, W, H, f) {
    const t = Math.max(0, f) / FPS; if (t >= 3) return;
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = "source-over";
    c.globalAlpha = 1; c.fillStyle = `rgba(0,0,0,${(0.5 * (1 - t / 3)).toFixed(3)})`; c.fillRect(0, 0, W, H);
    const n = 3 - Math.floor(t), ph = t % 1, pop = 1 - Math.pow(1 - Math.min(1, ph * 4), 3);
    const sz = Math.round(Math.min(W, H) * 0.34 * (1.35 - 0.35 * pop));
    c.globalAlpha = ph < 0.8 ? 1 : Math.max(0, (1 - ph) / 0.2);
    c.font = canvasFont(900, sz, true);
    c.textAlign = "center"; c.textBaseline = "middle";
    c.lineWidth = Math.max(6, sz * 0.09); c.lineJoin = "round"; c.strokeStyle = "#1b2038"; c.fillStyle = "#ffffff";
    c.strokeText(String(n), W / 2, H / 2); c.fillText(String(n), W / 2, H / 2);
    c.restore();
  }
