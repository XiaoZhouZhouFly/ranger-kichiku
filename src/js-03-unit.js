  /* ---------- 角色與部件 ---------- */
  async function selectUnit(r, opts = {}) {
    showOverlay(`載入 ${r.name} …`);
    try {
      const meta = await loadUnitMeta(r.id);
      const bul = await loadBullets(meta);
      const oldBul = S.bul;
      S.swapping = true; // 換角色途中先不畫，避免新舊資料混在一起
      S.unit = r; S.meta = meta; S.bul = bul;
      if (oldBul !== bul) freeBul(oldBul);
      $("unitName").textContent = r.name;
      $("unitTag").textContent = [r.id, r.star, r.type, r.element].filter(Boolean).join("・");
      store.set("unit", r.id);
      buildParts();
      renderSkills();
      const pk = opts.part && meta.parts[opts.part] ? opts.part : (meta.parts.body ? "body" : Object.keys(meta.parts)[0]);
      await selectPart(pk, opts.clip || "skill1");
      document.querySelectorAll(".r-card").forEach((el) => el.classList.toggle("active", el.title.includes(`（${r.id}）`)));
      hideOverlay();
    } catch (e) {
      showOverlay(`讀取 ${r.name} 失敗：${e.message || e}`, true);
    } finally { S.swapping = false; markDirty(); }
  }
  // 技能圖標：官方＝檔名（放在 data/res/skill_icon/）；自製角色可以寫路徑（含「/」，相對於 custom/，例如 res/x003-dragon/x003-dragon-icon1.png）
  const skillIconUrl = (icon) => (!icon ? "" : icon.includes("/") ? CUSTOM + icon : `${LOCAL}res/skill_icon/${icon}`);
  function unitSkills() { return (S.unit && S.skills[S.unit.id]) || []; }
  function renderSkills() {
    const box = $("skills"); box.textContent = "";
    const list = unitSkills();
    list.forEach((sk, i) => {
      if (!sk) return;
      const key = i === 0 ? "skill1" : "skill2";
      const card = document.createElement("button");
      card.className = "skill"; card.dataset.clip = key; card.type = "button";
      card.setAttribute("aria-pressed", "false");
      const ico = document.createElement("div"); ico.className = "ico"; ico.textContent = sk.name.slice(0, 1);
      if (sk.icon) {
        const img = new Image(); img.alt = "";
        img.onload = () => { ico.textContent = ""; ico.appendChild(img); };
        img.src = skillIconUrl(sk.icon);
      }
      const body = document.createElement("div"); body.className = "sk-body";
      const nm = document.createElement("div"); nm.className = "sk-name";
      const slot = document.createElement("span"); slot.className = "sk-slot"; slot.textContent = i === 0 ? "技能1" : "技能2";
      nm.append(slot, document.createTextNode(sk.name));
      const meta = document.createElement("div"); meta.className = "sk-meta";
      [["發動", sk.rate], ["冷卻", sk.cooldown], ["目標", sk.trigger]].forEach(([k, v]) => {
        if (!v) return; const sp = document.createElement("span"); sp.textContent = `${k} ${v}`; meta.appendChild(sp);
      });
      const desc = document.createElement("div"); desc.className = "sk-desc"; desc.textContent = sk.desc; desc.hidden = true;
      const more = document.createElement("span"); more.className = "sk-more"; more.textContent = sk.desc ? "看技能說明" : "";
      more.addEventListener("click", (e) => { e.stopPropagation(); desc.hidden = !desc.hidden; more.textContent = desc.hidden ? "看技能說明" : "收起說明"; });
      body.append(nm, meta, more, desc);
      card.append(ico, body);
      card.onclick = async () => {
        if (S.partKey !== "body" && S.meta.parts.body) await selectPart("body", key);
        const a = resolveClip(key);
        if (a) { selectAnim(a); setPlaying(true); }
      };
      box.appendChild(card);
    });
    markSkill();
  }
  function markSkill() {
    const cur = currentClipKey();
    document.querySelectorAll("#skills .skill").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.clip === cur && S.partKey === "body")));
  }
  function buildParts() {
    const box = $("parts"); box.textContent = "";
    for (const k of Object.keys(S.meta.parts)) {
      const b = chip(PART_LABEL[k] || k, k === S.partKey);
      b.dataset.part = k;
      b.onclick = () => selectPart(k, currentClipKey() || "idle");
      box.appendChild(b);
    }
  }
  function chip(label, pressed) {
    const b = document.createElement("button");
    b.className = "chip"; b.textContent = label; b.setAttribute("aria-pressed", String(!!pressed));
    return b;
  }
  async function selectPart(key, clipKey) {
    const part = S.meta.parts[key];
    $("parts").querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.part === key)));
    const atlas = await blobToImage(await fetchData((S.meta.base || LOCAL) + part.png, "blob"));
    const oldAtlas = S.atlas;
    S.partKey = key; S.part = part; S.atlas = atlas;
    freeCanvases(S.sprites); freeCanvases(S.hueCache);
    if (oldAtlas !== atlas) freeImage(oldAtlas);
    buildClips();
    const anim = resolveClip(clipKey) || firstAnim();
    selectAnim(anim);
  }
  function resolveClip(key) {
    const c = CLIPS.find((x) => x.key === key);
    if (!c) return null;
    return c.names.find((n) => S.part.animations[n]?.frames?.length) || null;
  }
  function firstAnim() {
    for (const c of CLIPS) { const a = resolveClip(c.key); if (a) return a; }
    return Object.keys(S.part.animations).find((n) => S.part.animations[n]?.frames?.length);
  }
  function currentClipKey() {
    if (!S.part) return null;
    const c = CLIPS.find((x) => x.names.includes(S.animName));
    return c ? c.key : null;
  }
  function buildClips() {
    const box = $("clips"); box.textContent = "";
    for (const c of CLIPS) {
      const a = resolveClip(c.key);
      const b = chip(c.label, false);
      b.dataset.anim = a || "";
      if (a) { const n = document.createElement("span"); n.className = "n"; n.textContent = S.part.animations[a].frame_count; b.appendChild(n); }
      const sk = c.key === "skill1" ? unitSkills()[0] : c.key === "skill2" ? unitSkills()[1] : null;
      if (sk && sk.icon && a) {
        const im = new Image(); im.className = "chip-ico"; im.alt = ""; im.src = skillIconUrl(sk.icon);
        im.onerror = () => im.remove(); b.prepend(im);
        b.title = sk.name;
      }
      b.disabled = !a;
      b.onclick = () => a && selectAnim(a);
      box.appendChild(b);
    }
    const sel = $("remixAnim"); sel.textContent = "";
    const og1 = document.createElement("optgroup"); og1.label = "常用動作";
    for (const c of CLIPS) {
      const a = resolveClip(c.key);
      if (!a) continue;
      const o = document.createElement("option"); o.value = a;
      const skn = c.key === "skill1" ? unitSkills()[0] : c.key === "skill2" ? unitSkills()[1] : null;
      o.textContent = `${c.label}${skn ? "・" + skn.name : ""}（${S.part.animations[a].frame_count} 幀）`;
      og1.appendChild(o);
    }
    sel.appendChild(og1);
    const og2 = document.createElement("optgroup"); og2.label = "原始片段";
    for (const n of Object.keys(S.part.animations)) {
      if (!S.part.animations[n]?.frames?.length || n === "_all" || [...og1.children].some((x) => x.value === n)) continue;
      const o = document.createElement("option"); o.value = n;
      o.textContent = `${n}（${S.part.animations[n].frame_count} 幀）`;
      og2.appendChild(o);
    }
    sel.appendChild(og2);
    const raw = $("rawClips"); raw.textContent = "";
    for (const n of Object.keys(S.part.animations)) {
      if (!S.part.animations[n]?.frames?.length) continue;
      const b = chip(n === "_all" ? "全部（完整時間軸）" : n, false);
      b.dataset.anim = n;
      b.onclick = () => selectAnim(n);
      raw.appendChild(b);
    }
  }
  function selectAnim(name) {
    S.animName = name; syncUrl();
    document.querySelectorAll("#clips .chip, #rawClips .chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.anim === name)));
    const sel = $("remixAnim");
    if ([...sel.options].some((o) => o.value === name)) sel.value = name;
    markSkill();
    const frames = anim().frames;
    computeBounds(frames);
    S.centers = frames.map(bodyCenter);
    planSingleProj();
    S.pos = 0; S.panX = 0; S.panY = 0;
    if (S.mode !== "orig") setMode("orig"); // 換角色或動作時先看原版；惡搞分頁的選單會再切回惡搞
    buildComps();
    const saved = store.get("segs:" + S.unit.id + ":" + S.partKey + ":" + name, null);
    S.segs = saved && saved.length ? saved : presetDemo1(clipN());
    renderSegs();
    rebuildTimeline();
    updateScrub();
    drawCurrent();
    histReset();
  }
  const anim = () => S.part.animations[S.animName];
  // 播放長度：有投射物時延長到投射物飛完、命中特效播完（角色停在最後一幀）
  const clipN = () => S.clipN || (anim() ? anim().frames.length : 1);
  function partBounds(frames, alphaMin) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const fr of frames) for (const t of itemsOf(fr)) {
      if (t.alpha < alphaMin) continue;
      for (const [px, py] of [[0, 0], [t.w, 0], [0, t.h], [t.w, t.h]]) {
        const x = t.A * px + t.B * py + t.C, y = t.D * px + t.E * py + t.F;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
    }
    return isFinite(x0) ? { x0, x1, y0, y1 } : { x0: -40, x1: 40, y0: -100, y1: 0 };
  }
  function planSingleProj() {
    const n = anim().frames.length;
    S.projPlan = null; S.clipN = n;
    if (!S.projOn || S.partKey !== "body" || !S.unit) return;
    const short = { attack: "n", skill1: "s1", skill2: "s2" }[currentClipKey()];
    const info = S.proj[S.unit.id] || {};
    const cfg = short && info[short];
    const dr = cfg && S.bul && S.bul[cfg.p];
    const flight = dr && pickAnim(dr.part, ["normal", "idle", "wait", "shot", "fire", "attack"]);
    if (!flight) return;
    const finish = pickAnim(dr.part, ["finish", "hit", "end"]);
    const rate = S.part.anim_rate || 24, bulRate = dr.part.anim_rate || 24;
    const toBody = (fr) => Math.max(1, Math.round(fr / bulRate * rate));
    const ready = S.part.animations[S.animName.replace(/_all$/, "_ready")];
    const spawn = S.animName.endsWith("_all") && ready ? ready.frame_count : 0;
    const idleName = ["idle", "wait"].find((x) => S.part.animations[x]) || S.animName;
    const lb = partBounds(S.part.animations[idleName].frames, 0.3);
    const h = lb.y1 - lb.y0, ground = lb.y1;
    const target = { x: (lb.x0 + lb.x1) / 2 + Math.max(120, info.range || 300), ground, h };
    let plan;
    if ((cfg.m === "LINEAR" || cfg.m === "CURVE") && cfg.v > 0 && cfg.e) {
      const st = { x: cfg.x * 0.5, y: -cfg.y * 0.5 };
      const en = { x: target.x, y: ground - h * (cfg.m === "CURVE" ? 0.05 : 0.3) };
      const dist = Math.hypot(en.x - st.x, en.y - st.y);
      plan = { spawn, fl: Math.max(2, Math.round(dist / (cfg.v * 60) * rate)), st, en, curve: cfg.m === "CURVE", dr, flight, finish, rot: !!cfg.r, a0: cfg.a0, a1: cfg.a1, loop: !!cfg.l, dist };
    } else {
      plan = { direct: true, spawn, fl: toBody(dr.part.animations[flight].frame_count), en: { x: target.x, y: ground - h * 0.45 }, dr, flight, finish };
    }
    plan.target = target; plan.rate = rate; plan.bulRate = bulRate;
    plan.finLen = finish ? toBody(dr.part.animations[finish].frame_count) : 0;
    S.clipN = Math.max(n, plan.spawn + plan.fl + plan.finLen + 4);
    S.projPlan = plan;
    const b = S.bounds;
    b.x1 = Math.max(b.x1, target.x + 70);
    const top = Math.min(plan.st ? plan.st.y : 0, plan.en.y) - (plan.curve ? plan.dist * 0.3 : 0) - 30;
    b.y0 = Math.min(b.y0, top); b.y1 = Math.max(b.y1, ground + 10);
    b.cx = (b.x0 + b.x1) / 2; b.cy = (b.y0 + b.y1) / 2;
  }
  function drawSingleProj(k) {
    const p = S.projPlan;
    if (!p) return;
    const c = ctx, tg = p.target;
    // 假想的目標位置
    c.save();
    c.fillStyle = "rgba(27,32,56,0.10)";
    c.beginPath(); c.ellipse(tg.x, tg.ground, 34, 7, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "rgba(255,61,127,0.55)"; c.lineWidth = 2; c.setLineDash([6, 6]);
    c.beginPath(); c.moveTo(tg.x, tg.ground); c.lineTo(tg.x, tg.ground - tg.h * 0.9); c.stroke();
    c.restore();
    const age = k - p.spawn;
    if (age < 0) return;
    const bi = (a, anim, loop) => { const nn = p.dr.part.animations[anim].frame_count; const i = Math.floor(a / p.rate * p.bulRate); return loop ? i % nn : Math.min(nn - 1, i); };
    if (age < p.fl) {
      if (p.direct) { drawPartCtx(c, p.dr, p.flight, bi(age, p.flight, false), p.en.x, p.en.y, false, 0); return; }
      const t = age / p.fl;
      let x = p.st.x + (p.en.x - p.st.x) * t, y = p.st.y + (p.en.y - p.st.y) * t;
      if (p.curve) {
        const hh = p.dist * 0.4, u = 1 - t;
        const c2x = (p.st.x + p.en.x) / 2 + hh, c2y = (p.st.y + p.en.y) / 2 - hh;
        x = u * u * u * p.st.x + 3 * u * u * t * p.st.x + 3 * u * t * t * c2x + t * t * t * p.en.x;
        y = u * u * u * p.st.y + 3 * u * u * t * p.st.y + 3 * u * t * t * c2y + t * t * t * p.en.y;
      }
      drawPartCtx(c, p.dr, p.flight, bi(age, p.flight, p.loop), x, y, false, p.rot ? p.a0 + (p.a1 - p.a0) * t : 0);
    } else if (p.finish && age - p.fl < p.finLen) {
      drawPartCtx(c, p.dr, p.finish, bi(age - p.fl, p.finish, false), p.en.x, p.en.y, false, 0);
    }
  }

  /* ---------- 幾何 ---------- */
  function spriteOf(name) {
    if (S.sprites.has(name)) return S.sprites.get(name);
    const sp = S.part.sprites[name];
    if (!sp || !sp.rect || !sp.rect[2] || !sp.rect[3]) { S.sprites.set(name, null); return null; }
    const [sx, sy, w, h] = sp.rect;
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d");
    if (sp.rotated) { g.translate(w / 2, h / 2); g.rotate(-Math.PI / 2); g.drawImage(S.atlas, sx, sy, h, w, -h / 2, -w / 2, h, w); }
    else g.drawImage(S.atlas, sx, sy, w, h, 0, 0, w, h);
    S.sprites.set(name, c);
    return c;
  }
  function hueSprite(name, hue) {
    const base = spriteOf(name);
    if (!base) return null;
    hue = ((Math.round(hue / 15) * 15) % 360 + 360) % 360;
    if (!hue) return base;
    const key = name + "|" + hue;
    if (S.hueCache.has(key)) return S.hueCache.get(key);
    const c = document.createElement("canvas"); c.width = base.width; c.height = base.height;
    const g = c.getContext("2d"); g.drawImage(base, 0, 0);
    try {
      const d = g.getImageData(0, 0, c.width, c.height), px = d.data;
      const a = hue * Math.PI / 180, co = Math.cos(a), si = Math.sin(a);
      const m = [
        0.213 + co * 0.787 - si * 0.213, 0.715 - co * 0.715 - si * 0.715, 0.072 - co * 0.072 + si * 0.928,
        0.213 - co * 0.213 + si * 0.143, 0.715 + co * 0.285 + si * 0.140, 0.072 - co * 0.072 - si * 0.283,
        0.213 - co * 0.213 - si * 0.787, 0.715 - co * 0.715 + si * 0.715, 0.072 + co * 0.928 + si * 0.072,
      ];
      for (let i = 0; i < px.length; i += 4) {
        const r = px[i], gg = px[i + 1], b = px[i + 2];
        px[i] = m[0] * r + m[1] * gg + m[2] * b;
        px[i + 1] = m[3] * r + m[4] * gg + m[5] * b;
        px[i + 2] = m[6] * r + m[7] * gg + m[8] * b;
      }
      g.putImageData(d, 0, 0);
    } catch {}
    S.hueCache.set(key, c);
    return c;
  }
  function itemsOf(frame) {
    const out = [];
    for (const it of frame || []) {
      const res = it[1], om = it[2], col = it[3];
      const def = S.part.images[res];
      if (!def || !Array.isArray(om) || !Array.isArray(def.m)) continue;
      const alpha = (Array.isArray(col) && col.length > 3 ? col[3] : 255) / 255;
      if (alpha <= 0) continue;
      const sp = S.part.sprites[def.name];
      if (!sp || !sp.rect || !sp.rect[2]) continue;
      const [m00, m01, m10, m11, m02, m12] = om;
      const [i00, i01, i10, i11, i02, i12] = def.m;
      out.push({
        name: def.name, alpha, w: sp.rect[2], h: sp.rect[3],
        A: m00 * i00 + m01 * i10, B: m00 * i01 + m01 * i11, C: m00 * i02 + m01 * i12 + m02,
        D: m10 * i00 + m11 * i10, E: m10 * i01 + m11 * i11, F: m10 * i02 + m11 * i12 + m12,
      });
    }
    return out;
  }
  function computeBounds(frames) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const fr of frames) for (const t of itemsOf(fr)) {
      if (t.alpha < 0.12) continue;
      for (const [px, py] of [[0, 0], [t.w, 0], [0, t.h], [t.w, t.h]]) {
        const x = t.A * px + t.B * py + t.C, y = t.D * px + t.E * py + t.F;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    if (!isFinite(x0)) { x0 = -50; y0 = -100; x1 = 50; y1 = 10; }
    S.bounds = { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  }
  function bodyCenter(frame) {
    const xs = [], ys = [];
    for (const t of itemsOf(frame)) {
      if (t.alpha < 0.3) continue;
      xs.push(t.A * t.w / 2 + t.B * t.h / 2 + t.C);
      ys.push(t.D * t.w / 2 + t.E * t.h / 2 + t.F);
    }
    if (!xs.length) return null;
    xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
    return { x: xs[xs.length >> 1], y: ys[ys.length >> 1] };
  }
  function centerAt(i) {
    i = Math.max(0, Math.min(S.centers.length - 1, i));
    const c = S.centers[i];
    if (c) return c;
    for (let d = 1; d < S.centers.length; d++) { const a = S.centers[i - d] || S.centers[i + d]; if (a) return a; }
    return { x: S.bounds.cx, y: S.bounds.cy };
  }
  function fitScale() {
    const b = S.bounds;
    return Math.min(cv.width * 0.88 / Math.max(1, b.x1 - b.x0), cv.height * 0.88 / Math.max(1, b.y1 - b.y0));
  }

