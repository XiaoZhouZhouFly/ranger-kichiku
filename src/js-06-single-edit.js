  /* ---------- 元件 ---------- */
  function defComp() { return { show: true, scale: 1, spin: 0, hue: 0, jitter: 0 }; }
  function buildComps() {
    const used = new Map();
    for (const fr of anim().frames) for (const t of itemsOf(fr)) used.set(t.name, (used.get(t.name) || 0) + 1);
    const keep = S.comps; S.comps = {};
    for (const n of used.keys()) S.comps[n] = keep[n] || defComp();
    const box = $("comps"); box.textContent = "";
    const names = [...used.keys()].sort((a, b) => used.get(b) - used.get(a));
    for (const name of names) box.appendChild(compCard(name));
  }
  function compCard(name) {
    const cp = S.comps[name];
    const card = document.createElement("div"); card.className = "comp" + (cp.show ? "" : " off");
    const head = document.createElement("div"); head.className = "head";
    const c = document.createElement("canvas"); c.width = 96; c.height = 96;
    const sp = spriteOf(name);
    if (sp) { const g = c.getContext("2d"); const s = Math.min(88 / sp.width, 88 / sp.height); g.drawImage(sp, (96 - sp.width * s) / 2, (96 - sp.height * s) / 2, sp.width * s, sp.height * s); }
    const info = document.createElement("div");
    const nm = document.createElement("div"); nm.className = "cname"; nm.textContent = name.replace(/^.*-(body|bul\d?)_/, "");
    const lab = document.createElement("label"); lab.className = "check";
    const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = cp.show;
    cb.onchange = () => { cp.show = cb.checked; card.classList.toggle("off", !cp.show); compsChanged(); };
    lab.append(cb, document.createTextNode(" 顯示"));
    info.append(nm, lab);
    head.append(c, info);
    card.appendChild(head);
    const mk = (label, key, min, max, step, fmt) => {
      const l = document.createElement("label"); l.className = "slider";
      const r = document.createElement("input"); r.type = "range"; r.min = min; r.max = max; r.step = step; r.value = cp[key];
      const o = document.createElement("output"); o.textContent = fmt(cp[key]);
      r.oninput = () => { cp[key] = +r.value; o.textContent = fmt(cp[key]); compsChanged(); };
      l.append(document.createTextNode(label), r, o);
      return l;
    };
    card.append(
      mk("縮放", "scale", 0.1, 4, 0.05, (v) => v.toFixed(2)),
      mk("自轉", "spin", -45, 45, 1, (v) => v + "°"),
      mk("色相", "hue", 0, 345, 15, (v) => v + "°"),
      mk("亂抖", "jitter", 0, 40, 1, (v) => String(v)),
    );
    return card;
  }

  /* ---------- 剪輯片段 ---------- */
  function defSeg(n, extra) {
    return Object.assign({ start: 0, end: n - 1, speed: 1, repeat: 1, hold: 0, reverse: false, pingpong: false, mirror: "none",
      rot0: 0, rot1: 0, zoom0: 1, zoom1: 1, focus: "center", shake: 0, invert: false, hue0: 0, hue1: 0 }, extra || {});
  }
  function presetPlain(n) { return [defSeg(n)]; }
  function presetSpam(n) {
    const a = Math.round(n * 0.4), b = Math.min(n - 1, a + 5);
    return [defSeg(n, { end: a - 1 }), defSeg(n, { start: a, end: b, repeat: 6, mirror: "alt", zoom0: 1.5, zoom1: 1.5, focus: "body" }), defSeg(n, { start: a, end: n - 1 })];
  }
  function presetDemo1(n) {
    const segs = presetDemo2(n);
    segs[0] = Object.assign(segs[0], { focus: "bodyFixed" });
    segs[8] = Object.assign(segs[8], { mirror: "none" }); // 後段連打不再左右來回翻轉
    const L = segs.length;
    segs[L - 3] = Object.assign(segs[L - 3], { focus: "bodyFixed" });
    segs[L - 2] = Object.assign(segs[L - 2], { focus: "bodyFixed" });
    segs[L - 1] = Object.assign(segs[L - 1], { focus: "bodyFixed", rot0: 0, rot1: 0 });
    return segs;
  }
  function presetDemo2(n) {
    const p = (x) => Math.max(0, Math.min(n - 1, Math.round(n * x)));
    const a = p(0.33), a2 = Math.min(n - 1, a + 5), hit = Math.min(n - 1, a + 4), b = p(0.4), c = p(0.67), d = p(0.84);
    return [
      defSeg(n, { start: 0, end: Math.max(0, a - 1), zoom0: 1.5, zoom1: 1.5, focus: "body" }),
      defSeg(n, { start: a, end: a2, repeat: 4, zoom0: 1.6, zoom1: 1.6, focus: "body" }),
      defSeg(n, { start: a, end: a2, repeat: 4, speed: 2, mirror: "alt", zoom0: 1.6, zoom1: 1.6, focus: "body" }),
      defSeg(n, { start: hit, end: hit, hold: 3, invert: true, zoom0: 2.4, zoom1: 2.2, focus: "body", shake: 30 }),
      defSeg(n, { start: hit, end: hit, hold: 6, zoom0: 2.2, zoom1: 1, focus: "body", shake: 18 }),
      defSeg(n, { start: b, end: c, speed: 1.5, rot0: 0, rot1: 720 }),
      defSeg(n, { start: b, end: c, speed: 3, reverse: true, hue0: 180, hue1: 180 }),
      defSeg(n, { start: b, end: c, speed: 0.5, hue0: 0, hue1: 360 }),
      defSeg(n, { start: p(0.52), end: Math.min(n - 1, p(0.52) + 4), repeat: 6, mirror: "alt", shake: 12 }),
      defSeg(n, { start: c, end: d, pingpong: true, repeat: 2, speed: 2 }),
      defSeg(n, { start: d, end: n - 1, zoom0: 1.5, zoom1: 1.5, focus: "body" }),
      defSeg(n, { start: Math.max(0, n - 4), end: n - 1, repeat: 3, zoom0: 1, zoom1: 2.5, focus: "body" }),
      defSeg(n, { start: n - 1, end: n - 1, hold: 12, zoom0: 2.5, zoom1: 2.5, rot0: 0, rot1: 15, focus: "body" }),
    ];
  }
  function presetRandom(n) {
    const R = Math.random, pick = (arr) => arr[Math.floor(R() * arr.length)];
    const out = [];
    for (let i = 0; i < 9; i++) {
      const len = 2 + Math.floor(R() * 8), st = Math.floor(R() * Math.max(1, n - len));
      const s = defSeg(n, { start: st, end: Math.min(n - 1, st + len) });
      const kind = pick(["spam", "spin", "rev", "slow", "hit", "zoom", "color"]);
      if (kind === "spam") Object.assign(s, { repeat: 3 + Math.floor(R() * 5), mirror: pick(["alt", "none"]), focus: "body", zoom0: 1.6, zoom1: 1.6 });
      if (kind === "spin") Object.assign(s, { rot0: 0, rot1: pick([360, -360, 720]), speed: 1.5 });
      if (kind === "rev") Object.assign(s, { reverse: true, speed: 2, pingpong: R() < 0.5 });
      if (kind === "slow") Object.assign(s, { speed: 0.35, zoom0: 1, zoom1: 2, focus: "body" });
      if (kind === "hit") Object.assign(s, { end: st, hold: 5, invert: true, shake: 28, zoom0: 2.4, zoom1: 2.4, focus: "body" });
      if (kind === "zoom") Object.assign(s, { zoom0: 0.6, zoom1: 2.6, focus: "body", repeat: 2 });
      if (kind === "color") Object.assign(s, { hue0: 0, hue1: 360, shake: 8, repeat: 2 });
      out.push(s);
    }
    return out;
  }
  function saveSegs() {
    syncUrl();
    if (S.unit && S.animName) store.set("segs:" + S.unit.id + ":" + S.partKey + ":" + S.animName, S.segs);
  }
  /* ---------- 上一步／下一步（單人：惡搞片段與零件調整） ----------
     每次變動後 0.4 秒記一筆快照（拖滑桿只記一筆）；換角色、部位或動作時重新開始。 */
  const H = { list: [], at: -1, timer: 0, restoring: false };
  const histSnap = () => JSON.stringify({ segs: S.segs, comps: S.comps });
  function histUi() { $("undoBtn").disabled = H.at <= 0; $("redoBtn").disabled = H.at >= H.list.length - 1; }
  function histReset() { clearTimeout(H.timer); H.timer = 0; H.list = [histSnap()]; H.at = 0; histUi(); }
  function histCommit() {
    clearTimeout(H.timer); H.timer = 0;
    const snap = histSnap();
    if (snap === H.list[H.at]) return;
    H.list = H.list.slice(0, H.at + 1); H.list.push(snap);
    if (H.list.length > 100) H.list.shift();
    H.at = H.list.length - 1; histUi();
  }
  function histMark() { if (H.restoring || !H.list.length) return; clearTimeout(H.timer); H.timer = setTimeout(histCommit, 400); }
  function histGo(step) {
    if (H.timer) histCommit(); // 還沒記下的變動先記，才不會漏掉
    const to = H.at + step;
    if (to < 0 || to >= H.list.length) return;
    H.at = to;
    const st = JSON.parse(H.list[to]);
    H.restoring = true;
    try { S.segs = st.segs; S.comps = st.comps || {}; buildComps(); segsChanged(); drawCurrent(); markDirty(); }
    finally { H.restoring = false; }
    histUi();
  }
  function compsChanged() { drawCurrent(); histMark(); }
  function segsChanged(rebuild = true) {
    histMark();
    rebuildTimeline(); saveSegs();
    if (S.mode === "remix") { updateScrub(); if (S.pos >= totalLen()) S.pos = 0; drawCurrent(); }
    if (rebuild) renderSegs();
  }
  function segSummary(s) {
    const bits = [s.hold > 0 ? `幀 ${s.start} 停格${s.hold}` : `幀 ${s.start}–${s.end}`];
    if (+s.speed !== 1) bits.push(`${s.speed}×速`);
    if (s.repeat > 1) bits.push(`連打${s.repeat}`);
    if (s.reverse) bits.push("倒放");
    if (s.pingpong) bits.push("來回");
    if (s.mirror === "on") bits.push("翻轉");
    if (s.mirror === "alt") bits.push("交替翻轉");
    if (+s.rot0 || +s.rot1) bits.push("旋轉");
    if (+s.zoom0 !== 1 || +s.zoom1 !== 1) bits.push("縮放");
    if (+s.shake) bits.push("震動");
    if (s.invert) bits.push("負片");
    if (+s.hue0 || +s.hue1) bits.push("變色");
    return bits.join("・");
  }
  function renderSegs() {
    const box = $("segs"); box.textContent = "";
    const n = anim() ? clipN() : 1;
    S.segs.forEach((s, i) => {
      const el = document.createElement("div"); el.className = "seg";
      const head = document.createElement("div"); head.className = "seg-head";
      const title = document.createElement("div"); title.className = "seg-title";
      title.innerHTML = `片段 ${i + 1}<span></span>`;
      const sum = title.querySelector("span"); sum.textContent = segSummary(s);
      head.appendChild(title);
      const act = (label, fn, aria) => { const b = document.createElement("button"); b.className = "btn small"; b.textContent = label; b.setAttribute("aria-label", aria); b.onclick = fn; head.appendChild(b); };
      act("▶", () => { const off = S.segs.slice(0, i).reduce((acc, x) => acc + segLength(x, n), 0); setMode("remix"); S.pos = off; setPlaying(true); }, "從這段開始預覽");
      act("↑", () => { if (i > 0) { [S.segs[i - 1], S.segs[i]] = [S.segs[i], S.segs[i - 1]]; segsChanged(); } }, "上移");
      act("↓", () => { if (i < S.segs.length - 1) { [S.segs[i + 1], S.segs[i]] = [S.segs[i], S.segs[i + 1]]; segsChanged(); } }, "下移");
      act("複製", () => { S.segs.splice(i + 1, 0, JSON.parse(JSON.stringify(s))); segsChanged(); }, "複製片段");
      act("刪除", () => { S.segs.splice(i, 1); if (!S.segs.length) S.segs = presetPlain(n); segsChanged(); }, "刪除片段");
      el.appendChild(head);

      const grid = document.createElement("div"); grid.className = "grid";
      const num = (label, key, min, max, step) => {
        const f = document.createElement("label"); f.className = "field"; f.textContent = label;
        const inp = document.createElement("input"); inp.type = "number"; inp.min = min; inp.max = max; inp.step = step; inp.value = s[key];
        inp.id = `seg${i}_${key}`;
        inp.onchange = () => { s[key] = +inp.value; sum.textContent = segSummary(s); segsChanged(false); };
        f.appendChild(inp); grid.appendChild(f);
      };
      const sel = (label, key, opts, parent) => {
        const f = document.createElement("label"); f.className = "field"; f.textContent = label;
        const se = document.createElement("select"); se.id = `seg${i}_${key}`;
        for (const [v, t] of opts) { const o = document.createElement("option"); o.value = v; o.textContent = t; se.appendChild(o); }
        se.value = s[key];
        se.onchange = () => { s[key] = se.value; sum.textContent = segSummary(s); segsChanged(false); };
        f.appendChild(se); (parent || grid).appendChild(f);
      };
      num("起始幀", "start", 0, n - 1, 1);
      num("結束幀", "end", 0, n - 1, 1);
      num("速度", "speed", 0.05, 8, 0.05);
      num("連打次數", "repeat", 1, 50, 1);
      num("停格幀數", "hold", 0, 300, 1);
      sel("翻轉", "mirror", [["none", "不翻"], ["on", "翻轉"], ["alt", "每次交替"]]);
      el.appendChild(grid);

      const flags = document.createElement("div"); flags.className = "flags";
      const ck = (label, key) => {
        const l = document.createElement("label"); l.className = "check";
        const c = document.createElement("input"); c.type = "checkbox"; c.checked = !!s[key]; c.id = `seg${i}_${key}`;
        c.onchange = () => { s[key] = c.checked; sum.textContent = segSummary(s); segsChanged(false); };
        l.append(c, document.createTextNode(" " + label)); flags.appendChild(l);
      };
      ck("倒放", "reverse"); ck("正放接倒放", "pingpong"); ck("負片閃光", "invert");
      el.appendChild(flags);

      const more = document.createElement("details"); more.className = "more";
      const smy = document.createElement("summary"); smy.textContent = "鏡頭與特效"; more.appendChild(smy);
      const g2 = document.createElement("div"); g2.className = "grid"; g2.style.marginTop = "8px";
      const num2 = (label, key, min, max, step) => {
        const f = document.createElement("label"); f.className = "field"; f.textContent = label;
        const inp = document.createElement("input"); inp.type = "number"; inp.min = min; inp.max = max; inp.step = step; inp.value = s[key];
        inp.id = `seg${i}_${key}`;
        inp.onchange = () => { s[key] = +inp.value; sum.textContent = segSummary(s); segsChanged(false); };
        f.appendChild(inp); g2.appendChild(f);
      };
      num2("縮放 起", "zoom0", 0.2, 8, 0.1); num2("縮放 迄", "zoom1", 0.2, 8, 0.1);
      num2("旋轉 起°", "rot0", -3600, 3600, 15); num2("旋轉 迄°", "rot1", -3600, 3600, 15);
      num2("震動", "shake", 0, 120, 1);
      num2("色相 起°", "hue0", -720, 720, 15); num2("色相 迄°", "hue1", -720, 720, 15);
      sel("鏡頭對準", "focus", [["center", "整個畫面"], ["bodyFixed", "角色（固定）"], ["body", "角色（跟隨）"]], g2);
      more.appendChild(g2);
      el.appendChild(more);
      box.appendChild(el);
    });
  }
  function segLength(s, n) { return expandSegs([s], n).length; }

