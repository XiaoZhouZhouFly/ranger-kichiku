  /* ---------- 格鬥場（v5.0 測試版）：選角、畫面、觸控、回合 ----------
     畫布寬 720、高度隨手機比例（直拿）。一人：上面血條、中間場地、下面按鈕。
     兩人：上下各半畫同一場（上半轉 180 度給對面的人看），中央共用血條；每人在自己那半邊操作。 */
  const fcv = $("fcv"), fctx = fcv.getContext("2d");
  // 畫布寬固定 720，高度跟著手機螢幕比例（16:9～21:9），整個螢幕都用上
  const FW = 720;
  let FH = 1280;
  const FG = {
    g: null, f: [null, null], fs: [null, null], acc: 0, cache: new Map(), ai: [{}, {}], running: false,
    set: Object.assign({ mode: "dummy", level: "normal", dummy: "standing", c0: "x001-cube", c1: "x002-orb", rounds: 3, secs: 60, showRange: true, showBox: true, holdMove: false, teleMode: "dist" }, store.get("fight", {})),
    ctl: [null, null], keys: new Set(),
    // 測試用：網址加 ?fightbot=normal 讓左方也由電腦操作（看電腦互打）
    bots: [["easy", "normal", "hard"].includes(new URLSearchParams(location.search).get("fightbot")) ? new URLSearchParams(location.search).get("fightbot") : null, null],
  };
  const fightSave = () => store.set("fight", FG.set);

  /* 版面：一人／兩人；兩人時每個人用「自己的座標」（下半部），上半部那位畫的時候整個轉 180 度 */
  function fightLayout() {
    if (FG.set.mode === "pvp") { const m = FH / 2, ch = 274; return { pvp: true, view: { y: m + 36, h: FH - ch - m - 36, ground: 52 }, ctrl: { y: FH - ch, h: ch }, hud: { y: m - 36, h: 72 } }; }
    const ch = 410; return { pvp: false, view: { y: 150, h: FH - ch - 150, ground: 110 }, ctrl: { y: FH - ch, h: ch }, hud: { y: 0, h: 150 } };
  }
  const fScale = FW / FT.AW;
  /* 按鈕位置（自己的座標；兩人模式的上半部整個轉 180 度）
     左手：一整條左右移動（左半邊＝◀、右半邊＝▶，left／right 是兩半的中心與大小）
     右手：普攻（最大）、技能 1、技能 2、跳（右上角）、防（右下角）；r＝圓形按鈕半徑 */
  function fightButtons(L) {
    const c = L.ctrl, k = Math.min(1, c.h / 410 + 0.2), y = (f) => c.y + c.h * f;
    const barH = Math.min(150, c.h * 0.42), barY = y(0.58);
    return {
      left: { x: 95, y: barY, w: 165, h: barH, r: barH / 2 },
      right: { x: 265, y: barY, w: 165, h: barH, r: barH / 2 },
      atk: { x: 560, y: y(0.46), r: 70 * Math.min(1, c.h / 410 + 0.15) },
      sk0: { x: 445, y: y(0.66), r: 54 * k },
      sk1: { x: 460, y: y(0.22), r: 54 * k },
      up: { x: 662, y: Math.max(y(0.16), c.y + 40 * k + 6), r: 40 * k },          // 貼齊上緣，不會超出按鈕區
      down: { x: 676, y: Math.min(y(0.8), c.y + c.h - 40 * k - 6), r: 40 * k },   // 右下角，不超出下緣
    };
  }
  const MOVE_SPLIT = 350; // 左邊這條線以左是移動區

  /* ---------- 選角畫面 ---------- */
  function fightCharOptions(sel, want) {
    sel.textContent = "";
    const have = (id) => S.index.some((r) => r.id === id);
    for (const [id, note] of FIGHT_ROSTER) {
      if (!have(id)) continue;
      const r = S.index.find((x) => x.id === id), o = document.createElement("option");
      o.value = id; o.textContent = `${r.name}（${note}）`; sel.appendChild(o);
    }
    if (want && !FIGHT_ROSTER.some(([id]) => id === want) && have(want)) {
      const r = S.index.find((x) => x.id === want), o = document.createElement("option");
      o.value = want; o.textContent = `${r.name}（${want}）`; sel.appendChild(o);
    }
    sel.value = want && [...sel.options].some((o) => o.value === want) ? want : sel.options[0] ? sel.options[0].value : "";
  }
  async function fightLoad(id) {
    if (FG.cache.has(id)) return FG.cache.get(id);
    const r = S.index.find((x) => x.id === id);
    if (!r) throw new Error("找不到角色 " + id);
    const f = await loadFighter(r);
    FG.cache.set(id, f);
    return f;
  }
  async function fightInfo(i) {
    const id = $(`fChar${i}`).value, box = $(`fInfo${i}`);
    box.textContent = "讀取中…";
    try { const f = await fightLoad(id); box.textContent = fightSummary(fightStats(f)); }
    catch (e) { box.textContent = "讀取失敗：" + (e.message || e); }
  }
  function fightSetupUi() {
    const st = FG.set;
    document.querySelectorAll("#fMode .chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.fmode === st.mode)));
    document.querySelectorAll("#fLevel .chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.flevel === st.level)));
    document.querySelectorAll("#fDummy .chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.fdummy === st.dummy)));
    document.querySelectorAll("#fHoldMove .chip").forEach((c) => c.setAttribute("aria-pressed", String((c.dataset.fhold === "move") === !!st.holdMove)));
    document.querySelectorAll("#fTeleMode .chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.ftele === (st.teleMode === "sync" ? "sync" : "dist"))));
    $("fCpuBox").hidden = st.mode !== "cpu"; $("fDummyBox").hidden = st.mode !== "dummy";
    $("fRoundBox").hidden = st.mode === "dummy";
    $("fRight").textContent = st.mode === "pvp" ? "右方（玩家 2）" : st.mode === "cpu" ? "右方（電腦）" : "右方（木樁）";
    $("fRounds").value = String(st.rounds); $("fSecs").value = String(st.secs); $("fShowRange").checked = st.showRange !== false; $("fShowBox").checked = st.showBox !== false;
  }
  async function initFight() {
    if (FG.inited) return; FG.inited = true;
    await Promise.all([ensureStats(), ensureSkillFx()]);
    fightCharOptions($("fChar0"), FG.set.c0); fightCharOptions($("fChar1"), FG.set.c1);
    fightSetupUi(); fightInfo(0); fightInfo(1);
  }
  document.querySelectorAll("#fMode .chip").forEach((c) => (c.onclick = () => { FG.set.mode = c.dataset.fmode; fightSave(); fightSetupUi(); }));
  document.querySelectorAll("#fLevel .chip").forEach((c) => (c.onclick = () => { FG.set.level = c.dataset.flevel; fightSave(); fightSetupUi(); }));
  document.querySelectorAll("#fDummy .chip").forEach((c) => (c.onclick = () => { FG.set.dummy = c.dataset.fdummy; fightSave(); fightSetupUi(); }));
  document.querySelectorAll("#fHoldMove .chip").forEach((c) => (c.onclick = () => { FG.set.holdMove = c.dataset.fhold === "move"; fightSave(); fightSetupUi(); }));
  document.querySelectorAll("#fTeleMode .chip").forEach((c) => (c.onclick = () => { FG.set.teleMode = c.dataset.ftele; fightSave(); fightSetupUi(); }));
  for (const i of [0, 1]) $(`fChar${i}`).onchange = () => { FG.set["c" + i] = $(`fChar${i}`).value; fightSave(); fightInfo(i); };
  $("fShowRange").onchange = () => { FG.set.showRange = $("fShowRange").checked; fightSave(); };
  $("fShowBox").onchange = () => { FG.set.showBox = $("fShowBox").checked; fightSave(); };
  $("fRounds").onchange = () => { FG.set.rounds = Math.max(1, Math.min(9, +$("fRounds").value || 3)); fightSave(); };
  $("fSecs").onchange = () => { FG.set.secs = Math.max(20, Math.min(300, Math.round(+$("fSecs").value || 60))); $("fSecs").value = FG.set.secs; fightSave(); };
  $("fOtherGo").onclick = () => {
    const q = $("fOther").value.trim(); if (!q) return;
    const r = S.index.find((x) => x.id === q) || S.index.find((x) => x.name === q) || S.index.find((x) => (x.name || "").includes(q));
    if (!r) { $("fOtherMsg").textContent = `找不到「${q}」`; return; }
    const side = +$("fOtherSide").value;
    FG.set["c" + side] = r.id; fightSave(); fightCharOptions($(`fChar${side}`), r.id); fightInfo(side);
    $("fOtherMsg").textContent = `已放到${side ? "右方" : "左方"}：${r.name}`;
  };

  /* ---------- 開始／結束 ---------- */
  async function fightStart() {
    $("fStart").disabled = true; $("fStartMsg").textContent = "載入角色中…";
    try {
      const f = await Promise.all([fightLoad(FG.set.c0), fightLoad(FG.set.c1)]);
      FG.f = f; FG.fs = f.map(fightStats);
      const mode = FG.set.mode;
      FG.g = fightNew({ f, fs: FG.fs, rounds: mode === "dummy" ? 1 : FG.set.rounds, secs: mode === "dummy" ? 0 : FG.set.secs, mode, seed: newSeed(100000),
        holdMove: !!FG.set.holdMove, teleMode: FG.set.teleMode === "sync" ? "sync" : "dist" });
      FG.ai = [{}, {}]; FG.acc = 0; FG.ctl = [fightCtl(), fightCtl()];
      $("fStage").hidden = false; $("fOver").hidden = true; $("fStage").classList.toggle("pvp", mode === "pvp");
      $("fExit").textContent = mode === "pvp" ? "✕" : "✕ 離開";
      document.body.classList.add("fight-on");
      FG.running = true; sfxUnlock(); fightResize();
      $("fStartMsg").textContent = "";
    } catch (e) { $("fStartMsg").textContent = "載入失敗：" + (e.message || e); }
    $("fStart").disabled = false;
  }
  function fightStop() {
    FG.running = false; $("fStage").hidden = true; document.body.classList.remove("fight-on");
  }
  $("fStart").onclick = fightStart;
  $("fExit").onclick = fightStop;
  $("fBack").onclick = fightStop;
  $("fAgain").onclick = () => { fightStart(); };
  function fightResize() {
    const vw = window.innerWidth, vh = window.innerHeight;
    FH = Math.round(fclamp(FW * vh / Math.max(1, vw), 1280, 1560));
    if (fcv.height !== FH) fcv.height = FH;
    const w = Math.min(vw, vh * FW / FH);
    fcv.style.width = w + "px"; fcv.style.height = (w * FH / FW) + "px";
  }
  window.addEventListener("resize", () => { if (FG.running) fightResize(); });

  /* ---------- 觸控 ----------
     每一根手指記住它屬於哪位玩家、按的是什麼（搖桿／普攻／技能）。座標一律換成「該玩家自己的座標」：
     上半部那位（兩人模式的玩家 2）把畫布轉 180 度來看。 */
  // 每位玩家的觸控狀態：pads＝方向鍵（手指 → 哪一顆），btn＝按住中的普攻／技能（手指位置），以及這一步要送出的「按下／放開」
  const fightCtl = () => ({ pads: new Map(), btn: {}, jump: false, atk: false, skDown: [false, false, false], skUp: [false, false, false], skCancelAt: [false, false, false] });
  const SLOT_OF = { sk0: 0, sk1: 1, atk: 2 };
  const RIGHT_KEYS = ["atk", "sk0", "sk1", "up", "down"]; // 右手的按鈕（up＝跳、down＝防）
  // 普攻是「按住才出」的種類（直線投射物、拋物線）：普攻鈕改走按住／放開的流程
  const atkIsShot = (who) => !!(FG.fs[who] && FT_AIMED[FG.fs[who].atk.kind]);
  function fightLocal(ev) {
    const r = fcv.getBoundingClientRect();
    let x = (ev.clientX - r.left) / r.width * FW, y = (ev.clientY - r.top) / r.height * FH;
    const L = fightLayout();
    let who = 0;
    if (L.pvp && y < FH / 2) { who = 1; x = FW - x; y = FH - y; }
    return { who, x, y };
  }
  // 移動區：以兩顆按鈕中間為界，左邊＝◀、右邊＝▶（手指滑過中線就換方向）
  function padAt(B, x) { return x < (B.left.x + B.right.x) / 2 ? "left" : "right"; }
  const fTouches = new Map();
  fcv.addEventListener("pointerdown", (ev) => {
    if (!FG.g) return;
    ev.preventDefault(); sfxUnlock();
    try { fcv.setPointerCapture(ev.pointerId); } catch {}
    const { who, x, y } = fightLocal(ev), L = fightLayout(), B = fightButtons(L), c = FG.ctl[who];
    if (!c || (FG.set.mode !== "pvp" && who !== 0)) return;
    if (y < L.ctrl.y - 60) return;
    if (x < MOVE_SPLIT) {
      c.pads.set(ev.pointerId, padAt(B, x));
      fTouches.set(ev.pointerId, { who, kind: "pad", move: true }); return;
    }
    let best = null, bd = 1e9;
    for (const k of RIGHT_KEYS) { const b = B[k], d = Math.hypot(x - b.x, y - b.y); if (d < b.r * 1.35 && d < bd) { best = k; bd = d; } }
    if (!best) return;
    // 跳：按下那一下；防：按住期間（跟移動一樣記在 pads）
    if (best === "up") { c.jump = true; c.pads.set(ev.pointerId, "up"); fTouches.set(ev.pointerId, { who, kind: "pad" }); return; }
    if (best === "down") { c.pads.set(ev.pointerId, "down"); fTouches.set(ev.pointerId, { who, kind: "pad" }); return; }
    c.btn[best] = { id: ev.pointerId, x0: x, y0: y, x, y };
    if (best === "atk" && !atkIsShot(who)) c.atk = true; else c.skDown[SLOT_OF[best]] = true;
    fTouches.set(ev.pointerId, { who, kind: best });
  });
  fcv.addEventListener("pointermove", (ev) => {
    const t = fTouches.get(ev.pointerId); if (!t) return;
    ev.preventDefault();
    const { x, y } = fightLocal(ev), c = FG.ctl[t.who];
    if (t.kind === "pad") {
      if (t.move) c.pads.set(ev.pointerId, padAt(fightButtons(fightLayout()), x)); // 移動區可以滑來滑去換方向；跳、防不跟著手指
      return;
    }
    const o = c.btn[t.kind]; if (o) { o.x = x; o.y = y; }
  });
  /* 取消區：手指離開按鈕外圈（半徑 × 2.3）再放開＝取消。突進要左右拖很遠，只看上下（左右拖多遠都不取消） */
  const CANCEL_R = 2.3;
  function fightCancelAt(who, key, b, B) {
    if (!b) return false;
    const k = FG.fs[who] && fightSlot(FG.fs[who], SLOT_OF[key]);
    if (k && k.kind === "dash") return Math.abs(b.y - B.y) > B.r * CANCEL_R;
    return Math.hypot(b.x - B.x, b.y - B.y) > B.r * CANCEL_R;
  }
  const fUp = (ev) => {
    const t = fTouches.get(ev.pointerId); if (!t) return;
    fTouches.delete(ev.pointerId);
    const c = FG.ctl[t.who]; if (!c) return;
    if (t.kind === "pad") { c.pads.delete(ev.pointerId); return; }
    const s = SLOT_OF[t.kind], b = c.btn[t.kind], B = fightButtons(fightLayout())[t.kind];
    if (s < 2 || atkIsShot(t.who)) { c.skCancelAt[s] = fightCancelAt(t.who, t.kind, b, B); c.skUp[s] = true; }
    delete c.btn[t.kind];
  };
  fcv.addEventListener("pointerup", fUp); fcv.addEventListener("pointercancel", fUp);
  // 鍵盤（電腦上測試用）：左方 A D 移動、W 跳、S 防禦、J 普攻、K L 技能；兩人模式右方用方向鍵、1 2 3
  const FKEYS = [{ l: "a", r: "d", u: "w", d: "s", atk: "j", s0: "k", s1: "l" }, { l: "arrowleft", r: "arrowright", u: "arrowup", d: "arrowdown", atk: "1", s0: "2", s1: "3" }];
  window.addEventListener("keydown", (e) => {
    if (!FG.running || e.repeat) return;
    const k = e.key.toLowerCase(); FG.keys.add(k);
    FKEYS.forEach((m, i) => { const c = FG.ctl[i]; if (!c) return; if (k === m.atk) { if (atkIsShot(i)) c.skDown[2] = true; else c.atk = true; } if (k === m.s0) c.skDown[0] = true; if (k === m.s1) c.skDown[1] = true; if (k === m.u) c.jump = true; });
  });
  window.addEventListener("keyup", (e) => {
    if (!FG.running) return;
    const k = e.key.toLowerCase(); FG.keys.delete(k);
    FKEYS.forEach((m, i) => { const c = FG.ctl[i]; if (!c) return; if (k === m.s0) c.skUp[0] = true; if (k === m.s1) c.skUp[1] = true; if (k === m.atk && atkIsShot(i)) c.skUp[2] = true; });
  });

  // 觸控狀態 → 這一步的按鍵（引擎格式）
  function fightInput(i) {
    const c = FG.ctl[i], g = FG.g, inp = fightBlankInput();
    if (!c) return inp;
    /* 兩人模式上半部的人：觸控座標已經換成他自己的座標（fightLocal），而他看到的畫面也是轉正的，
       所以他的「左」就是場地的左，不用再反轉 */
    const held = new Set(c.pads.values());
    let lx = held.has("right") ? 1 : held.has("left") ? -1 : 0;
    if (held.has("down")) inp.guard = true;
    const m = FKEYS[i], K = FG.keys;
    if (K.has(m.l)) lx = -1; if (K.has(m.r)) lx = 1; if (K.has(m.d)) inp.guard = true;
    inp.mx = lx;
    inp.jump = c.jump; inp.atk = c.atk; inp.skDown = c.skDown.slice(); inp.skUp = c.skUp.slice(); inp.skCancel = c.skCancelAt.slice();
    const face = g ? g.p[i].face : 1, B = fightButtons(fightLayout());
    for (const [key, s] of Object.entries(SLOT_OF)) {
      const b = c.btn[key]; if (!b || (s === 2 && !atkIsShot(i))) continue;
      inp.skAim[s] = ((b.x - b.x0) / fScale) * 1.6 * face; // 往自己看到的「前方」拖＝打更遠
      inp.skCancel[s] = fightCancelAt(i, key, b, B[key]);
    }
    c.jump = false; c.atk = false; c.skDown = [false, false, false]; c.skUp = [false, false, false]; c.skCancelAt = [false, false, false];
    return inp;
  }

  /* ---------- 每一格 ---------- */
  function fightTick(dt) {
    if (!FG.running || !FG.g) return;
    const g = FG.g;
    FG.acc = Math.min(FG.acc + dt, 0.25);
    while (FG.acc >= FT.STEP) {
      const mode = FG.set.mode;
      const inputs = [FG.bots[0] ? fightAi(g, 0, FG.bots[0], FG.ai[0]) : fightInput(0),
        mode === "pvp" ? fightInput(1) : fightAi(g, 1, mode === "dummy" ? FG.set.dummy : FG.set.level, FG.ai[1])];
      fightStep(g, inputs);
      for (const e of g.events) fightSound(e);
      FG.acc -= FT.STEP;
    }
    if (g.phase === "over" && $("fOver").hidden) {
      $("fOver").hidden = false;
      $("fOverText").textContent = g.winner === -1 ? "平手" : `${g.winner ? "右方" : "左方"}・${FG.f[g.winner].r.name} 獲勝（${g.wins[0]}：${g.wins[1]}）`;
    }
    fightDraw();
  }
  function fightSound(e) {
    const cfg = (s) => SFX.cfg.duel[s] || {};
    if (e.type === "beep") sfxPlay("cdBeep"); else if (e.type === "go") sfxPlay("cdGo");
    else if (e.type === "ko") sfxPlay("ko"); else if (e.type === "timeup") sfxPlay("cdGo");
    else if (e.type === "hit") sfxPlay(cfg(e.side)[e.heavy ? "hit" : "atk"], `duel${e.side}-${e.heavy ? "hit" : "atk"}`);
    else if (e.type === "cast") sfxPlay(cfg(e.side).skill, `duel${e.side}-skill`);
    else if (e.type === "guard") sfxPlay("punch", null, { rate: 1.6 });
    else if (e.type === "break") sfxPlay("thunder");
  }

  /* ---------- 繪製 ---------- */
  function fightDraw() {
    const c = fctx, g = FG.g, L = fightLayout();
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1;
    c.fillStyle = "#14182b"; c.fillRect(0, 0, FW, FH);
    if (L.pvp) {
      fightDrawPlayer(c, g, L, 0);
      c.save(); c.translate(FW, FH); c.rotate(Math.PI); fightDrawPlayer(c, g, L, 1); c.restore();
      fightHudBar(c, g, L.hud.y, L.hud.h, true);
    } else {
      fightDrawPlayer(c, g, L, 0);
      fightHudBar(c, g, 18, 110, false);
      if (g.cfg.mode === "dummy") {
        const st = g.stats;
        c.fillStyle = "#cfd6ff"; c.font = canvasFont(700, 24); c.textAlign = "left"; c.textBaseline = "top";
        c.fillText(`木樁・這一串 ${st.lastCombo || 0}　最後一下 ${st.lastDmg || 0}　總共 ${st.total}（${st.hits} 下）`, 20, L.view.y + 10);
      }
    }
  }
  // 一位玩家看到的畫面（自己的座標：場地＋按鈕）
  function fightDrawPlayer(c, g, L, who) {
    const v = L.view, gy = v.y + v.h - v.ground;
    c.save();
    c.beginPath(); c.rect(0, v.y, FW, v.h); c.clip();
    const sky = c.createLinearGradient(0, v.y, 0, gy); sky.addColorStop(0, "#2a3363"); sky.addColorStop(1, "#5b6aa8");
    c.fillStyle = sky; c.fillRect(0, v.y, FW, v.h);
    c.fillStyle = "#3d3a52"; c.fillRect(0, gy, FW, v.ground);
    c.fillStyle = "#8f8bb0"; c.fillRect(0, gy, FW, 4);
    const X = (x) => FW / 2 + x * fScale, Y = (y) => gy - y * fScale;
    // 矩形預告（雙方都看得到）
    for (const t of g.teles) {
      const pr = Math.min(1, t.t / t.delay), x0 = X(t.x - t.w / 2), w = t.w * fScale, h = FT.CH * 0.95 * fScale;
      c.fillStyle = `rgba(255,60,60,${0.12 + 0.25 * pr})`; c.fillRect(x0, gy - h, w, h);
      c.fillStyle = "rgba(255,60,60,0.45)"; c.fillRect(x0, gy - h * pr, w, h * pr);
      c.strokeStyle = Math.floor(t.t * 12) % 2 ? "#ff4050" : "#ffd0d0"; c.lineWidth = 3; c.strokeRect(x0, gy - h, w, h);
      fightLabel(c, Math.max(0, t.delay - t.t).toFixed(2) + " 秒", x0 + w / 2, gy - h - 16, 22, "#ffd0d0");
    }
    // 拖曳瞄準：綠色＝這招能打到的全部範圍，白色＝目前拖到的位置（自己的一定畫；勾選「顯示判定範圍」時也畫對手的）
    for (const i of [0, 1]) if (i === who || FG.set.showRange) fightDrawAims(c, g, i, X, Y, gy);
    // 角色
    for (const cl of g.clones) fightDrawClone(c, g, cl, X, Y);
    for (const i of [0, 1]) fightDrawFighter(c, g, i, X, Y);
    // 拋物線落點（飛行中；畫在角色前面才不會被擋住）
    for (const q of g.projs) if (q.kind === "lob") {
      c.save(); c.strokeStyle = "#ff8a3d"; c.fillStyle = "rgba(255,138,61,0.28)"; c.lineWidth = 4; c.setLineDash([8, 6]);
      c.beginPath(); c.ellipse(X(q.landX), gy - 2, FT.LOB_R * fScale, 14, 0, 0, Math.PI * 2); c.fill(); c.stroke(); c.restore();
    }
    // 碰撞箱（受傷判定）：角色＝黃色框（寬 HURT_W、高一個身高），投射物＝黃色圓（命中半徑）；頭上＝目前狀態
    if (FG.set.showBox) {
      c.save(); c.strokeStyle = "#ffd84a"; c.lineWidth = 2; c.setLineDash([6, 4]);
      const hw = FT.HURT_W / 2;
      for (const i of [0, 1]) {
        const p = g.p[i];
        c.strokeRect(X(p.x - hw), Y(p.y + FT.CH), FT.HURT_W * fScale, FT.CH * fScale);
        c.beginPath(); c.moveTo(X(p.x + p.face * hw), Y(p.y + FT.CH * 0.5)); c.lineTo(X(p.x + p.face * (hw + 18)), Y(p.y + FT.CH * 0.5)); c.stroke(); // 面向
        fightLabel(c, FT_STATE_LABEL[p.state] || p.state, X(p.x), Y(p.y + FT.CH * 1.32), 22, "#ffd84a");
      }
      for (const q of g.projs) { c.beginPath(); c.arc(X(q.x), Y(q.y), (q.kind === "lob" ? 26 : 14) * fScale, 0, Math.PI * 2); c.stroke(); }
      c.restore();
    }
    // 投射物
    for (const q of g.projs) {
      const f = g.cfg.f[q.own], dr = q.bul && f.bul[q.bul.p], k = fScale * FT.CH / f.h;
      if (dr) {
        const anim = pickAnim(dr.part, ["normal", "idle", "wait", "shot", "fire", "attack"]);
        if (anim) {
          const n = dr.part.animations[anim].frame_count, idx = Math.floor(q.t * (dr.part.anim_rate || 24)) % Math.max(1, n);
          const rot = q.kind === "lob" && q.bul.r ? Math.atan2(-q.vy, Math.abs(q.vx)) * 180 / Math.PI * -1 : 0;
          c.save(); c.translate(X(q.x), Y(q.y)); c.scale(k, k); drawPartCtx(c, dr, anim, idx, 0, 0, q.face < 0, rot); c.restore();
          continue;
        }
      }
      c.fillStyle = q.own ? "#59a7ff" : "#ff6b6b";
      c.beginPath(); c.arc(X(q.x), Y(q.y), q.kind === "lob" ? 16 : 12, 0, Math.PI * 2); c.fill();
      c.strokeStyle = "#fff"; c.lineWidth = 3; c.stroke();
    }
    // 特效
    for (const e of g.fx) fightDrawFx(c, g, e, X, Y, gy);
    // 回合訊息
    fightBanner(c, g, v.y + v.h * 0.38);
    c.restore();
    fightDrawControls(c, g, L, who);
  }
  /* 按住中的招式預覽（依 AIM_MODE）
     dist（矩形、拋物線）：綠色＝能拖到的全部範圍、白色虛線＝目前位置；矩形旁邊寫預告秒數
     dir（直線、普攻投射物）：綠色＝從身體前緣一路到場地邊的路徑（跟著面向翻轉） */
  function fightDrawAims(c, g, i, X, Y, gy) {
    const me = g.p[i], fs = g.cfg.fs[i], front = me.x + me.face * fs.bw / 2, H = FT.CH * 0.95 * fScale;
    const green = (x0, x1, y0, y1) => { c.fillStyle = "rgba(60,220,110,0.18)"; c.strokeStyle = "rgba(60,220,110,0.85)"; c.lineWidth = 2; const a = Math.min(x0, x1), b = Math.max(x0, x1); c.fillRect(a, y0, b - a, y1 - y0); c.strokeRect(a, y0, b - a, y1 - y0); };
    const at = (d) => X(front + me.face * d);
    for (const s of [0, 1, 2]) {
      const a = me.aim[s]; if (!a) continue;
      const k = fightSlot(fs, s), mode = AIM_MODE[k.kind];
      c.save();
      c.setLineDash([10, 8]); c.lineWidth = 4; c.strokeStyle = a.cancel ? "#888" : "#ffffff";
      if (mode === "dir") {
        const py = Y(me.y + FT.CH * (s === 2 ? 0.35 : 0.28)), edge = X(me.face * (FT.AW / 2 + 80));
        if (FG.set.showRange) green(at(0), edge, py - 16, py + 16);
        c.beginPath(); c.moveTo(at(0), py); c.lineTo(at(70), py); c.stroke();
        c.setLineDash([]); c.fillStyle = a.cancel ? "#888" : "#fff"; // 箭頭＝方向
        c.beginPath(); c.moveTo(at(95), py); c.lineTo(at(65), py - 16); c.lineTo(at(65), py + 16); c.closePath(); c.fill();
      } else if (k.kind === "rect") {
        if (FG.set.showRange) green(at(FT.AIM_MIN - k.width / 2), at(k.range + k.width / 2), gy - H, gy);
        const x0 = at(a.d - k.width / 2), x1 = at(a.d + k.width / 2), lo = Math.min(x0, x1);
        c.fillStyle = a.cancel ? "rgba(120,120,120,0.18)" : "rgba(255,255,255,0.16)"; c.fillRect(lo, gy - H, Math.abs(x1 - x0), H); c.strokeRect(lo, gy - H, Math.abs(x1 - x0), H);
        fightLabel(c, "預告 " + fightTeleDelay(g, k, a.d).toFixed(2) + " 秒", at(a.d), gy - H - 16, 22, "#ffffff");
      } else if (k.kind === "dash") { // 突進：落點是場地上的位移（左右都可以）；地上一條虛線到落點，落點畫判定範圍
        const wx = (d) => X(me.x + d);
        if (FG.set.showRange) green(wx(-k.range), wx(k.range), gy - 24, gy);
        c.beginPath(); c.moveTo(X(me.x), gy - 10); c.lineTo(wx(a.d), gy - 10); c.stroke();
        c.setLineDash([]); c.strokeRect(wx(a.d) - k.width * fScale / 2, gy - H * 0.6, k.width * fScale, H * 0.6);
      } else if (k.kind === "lob") {
        if (FG.set.showRange) green(at(FT.AIM_MIN - FT.LOB_R), at(k.range + FT.LOB_R), gy - 24, gy);
        const sx = at(0), ex = at(a.d), sy = Y(me.y + FT.CH * 0.6), top = Math.min(sy, gy) - 120;
        c.beginPath(); c.moveTo(sx, sy); c.quadraticCurveTo((sx + ex) / 2, top, ex, gy); c.stroke();
        c.setLineDash([]); c.beginPath(); c.ellipse(ex, gy - 4, FT.LOB_R * fScale, 12, 0, 0, Math.PI * 2); c.stroke();
      }
      if (a.cancel) { c.fillStyle = "#fff"; c.font = canvasFont(900, 30); c.textAlign = "center"; c.fillText("取消", mode === "dir" ? at(70) : at(a.d), gy - H - 46); }
      c.restore();
    }
  }
  // 有外框的小字（預告秒數、狀態）
  function fightLabel(c, text, x, y, size, color) {
    c.save(); c.font = canvasFont(900, size); c.textAlign = "center"; c.textBaseline = "middle"; c.setLineDash([]);
    c.lineWidth = 5; c.strokeStyle = "#1b2038"; c.strokeText(text, x, y); c.fillStyle = color; c.fillText(text, x, y); c.restore();
  }
  /* 變形：畫成施放者那一招的投射物圖案（資料沒有「變成什麼」，用施放者的圖代替）；沒有圖就畫一團 */
  function fightDrawPoly(c, g, p, X, Y) {
    const ps = p.st.poly, f = g.cfg.f[ps.own], dr = ps.bul && f.bul[ps.bul.p], k = fScale * FT.CH / f.h;
    const anim = dr && pickAnim(dr.part, ["normal", "idle", "wait", "finish"]);
    if (anim) {
      const n = dr.part.animations[anim].frame_count, idx = Math.floor(g.t * (dr.part.anim_rate || 24)) % Math.max(1, n);
      c.save(); c.translate(X(p.x), Y(p.y + FT.CH * 0.3)); c.scale(k * 1.3, k * 1.3); drawPartCtx(c, dr, anim, idx, 0, 0, p.face < 0, 0); c.restore();
    } else {
      c.save(); c.fillStyle = "#ffd84a"; c.strokeStyle = "#1b2038"; c.lineWidth = 4;
      c.beginPath(); c.ellipse(X(p.x), Y(p.y + FT.CH * 0.25), FT.CH * 0.28 * fScale, FT.CH * 0.22 * fScale, 0, 0, Math.PI * 2); c.fill(); c.stroke(); c.restore();
    }
  }
  // 複製體：用對手的樣子、半透明紫色調，播目前招式的動作
  function fightDrawClone(c, g, cl, X, Y) {
    const f = g.cfg.f[cl.from], a = cl.act;
    let clip = a ? a.clip : null; if (!clip || !f.part.animations[clip]) clip = idleClip(f);
    const n = f.part.animations[clip].frame_count, idx = a ? Math.min(n - 1, Math.floor(a.t / a.dur * n)) : Math.floor(cl.anim.t * (f.part.anim_rate || 24)) % Math.max(1, n);
    const k = fScale * FT.CH / f.h;
    c.save(); c.translate(X(cl.x), Y(cl.y)); c.scale(k, k);
    drawFighterCtx(c, f, clip, idx, 0, cl.face < 0, false, 0.55);
    c.restore();
    fightLabel(c, "複製體", X(cl.x), Y(FT.CH * 1.15), 18, "#c9a7ff");
  }
  function fightDrawFighter(c, g, i, X, Y) {
    const p = g.p[i], f = g.cfg.f[i];
    let clip = p.act ? p.act.clip : p.anim.clip;
    if (!clip || !f.part.animations[clip]) clip = idleClip(f);
    const A = f.part.animations[clip], n = A.frame_count;
    let idx;
    if (p.act) idx = Math.min(n - 1, Math.floor(p.act.t / p.act.dur * n));
    else if (p.stun > 0 || p.ko) idx = Math.min(n - 1, Math.floor(p.anim.t * (f.part.anim_rate || 24)));
    else idx = Math.floor(p.anim.t * (f.part.anim_rate || 24)) % Math.max(1, n);
    const big = fHurtMul(p), k = fScale * FT.CH / f.h * big; // 縮放：整個角色跟著變大
    let alpha = 1;
    if (p.inv > 0 && Math.floor(p.inv * 12) % 2) alpha = 0.3;
    // 陰影
    c.fillStyle = "rgba(0,0,0,0.25)"; c.beginPath(); c.ellipse(X(p.x), Y(0), g.cfg.fs[i].bw * fScale * 0.6 * big, 8, 0, 0, Math.PI * 2); c.fill();
    if (p.st.poly) fightDrawPoly(c, g, p, X, Y);
    else {
      c.save(); c.translate(X(p.x), Y(p.y)); c.scale(k, k);
      drawFighterCtx(c, f, clip, idx, 0, p.face < 0, p.quiet < 0.08 && !p.guard && p.stunKind !== "block", alpha);
      c.restore();
    }
    // 泡泡：包住角色的大泡泡
    if (p.stunKind === "bubble" && p.stun > 0) {
      c.save(); c.strokeStyle = "rgba(160,225,255,0.95)"; c.fillStyle = "rgba(160,225,255,0.22)"; c.lineWidth = 4;
      c.beginPath(); c.arc(X(p.x), Y(p.y + FT.CH * 0.5), FT.CH * 0.62 * fScale, 0, Math.PI * 2); c.fill(); c.stroke(); c.restore();
    }
    // 防護罩：防禦條越少越紅
    if (p.guard) {
      const r = 1 - Math.max(0, p.gauge) / FT.GAUGE_MAX;
      c.strokeStyle = `rgb(${Math.round(90 + 165 * r)},${Math.round(180 - 140 * r)},${Math.round(255 - 205 * r)})`; c.lineWidth = 6;
      c.fillStyle = `rgba(${Math.round(90 + 165 * r)},${Math.round(180 - 140 * r)},${Math.round(255 - 205 * r)},0.18)`;
      c.beginPath(); c.ellipse(X(p.x), Y(p.y + FT.CH * 0.5), g.cfg.fs[i].bw * fScale * 0.85, FT.CH * fScale * 0.62, 0, 0, Math.PI * 2); c.fill(); c.stroke();
    }
    // 護盾：藍色外框，越少越淡
    if (p.st.shield) {
      const r = Math.min(1, p.st.shield.v / (p.st.shield.max || p.st.shield.v));
      c.strokeStyle = `rgba(125,211,255,${0.35 + 0.6 * r})`; c.lineWidth = 5; c.setLineDash([]);
      c.beginPath(); c.ellipse(X(p.x), Y(p.y + FT.CH * 0.5), g.cfg.fs[i].bw * fScale * 0.95, FT.CH * fScale * 0.68, 0, 0, Math.PI * 2); c.stroke();
    }
    // 狀態標籤（暈眩、沉默、攻↑…）排在頭上
    const tags = [];
    if (p.stunKind === "stunfx" && p.stun > 0) tags.push(["暈", "#ffd84a", p.stun]);
    if (p.buff > 0) tags.push(["▲攻", "#ffd84a", p.buff]);
    for (const [name, st] of Object.entries(p.st)) if (FX_STATUS_TAG[name]) tags.push([...FX_STATUS_TAG[name], st.t]);
    tags.forEach(([txt, color, t], n) => {
      const x = X(p.x) + (n - (tags.length - 1) / 2) * 58, y = Y(p.y + FT.CH * 1.15);
      c.fillStyle = "rgba(14,17,34,0.8)"; c.beginPath(); if (c.roundRect) c.roundRect(x - 27, y - 16, 54, 32, 8); else c.rect(x - 27, y - 16, 54, 32); c.fill();
      c.fillStyle = color; c.font = canvasFont(900, 18); c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(txt, x, y - 3);
      c.fillStyle = "#cfd6ff"; c.font = canvasFont(700, 11); c.fillText(t.toFixed(1), x, y + 10);
    });
  }
  function fightDrawFx(c, g, e, X, Y, gy) {
    const pr = e.t / (e.life || 0.6);
    c.save(); c.globalAlpha = Math.max(0, 1 - pr);
    if (e.kind === "dlineTele" || e.kind === "dline") { // 瞬間直線：前搖期間細線預告，出手瞬間粗線
      const y = Y(e.y), tele = e.kind === "dlineTele";
      c.globalAlpha = tele ? 0.5 + 0.5 * pr : Math.max(0, 1 - pr);
      c.strokeStyle = tele ? "#ffd0d0" : "#fff6a8"; c.lineWidth = tele ? 3 : 14; c.setLineDash(tele ? [10, 8] : []);
      c.beginPath(); c.moveTo(X(e.x0), y); c.lineTo(X(e.x1), y); c.stroke();
    } else if (e.kind === "reach" || e.kind === "selfring") {
      if (FG.set.showRange) {
        c.globalAlpha = Math.max(0, 1 - pr) * 0.9; c.fillStyle = "rgba(60,220,110,0.22)"; c.strokeStyle = "rgba(60,220,110,0.9)"; c.lineWidth = 3;
        if (e.kind === "reach") { const a = Math.min(X(e.x0), X(e.x1)), b = Math.max(X(e.x0), X(e.x1)); c.fillRect(a, Y(e.y + FT.CH * 0.8), b - a, FT.CH * 0.8 * fScale); c.strokeRect(a, Y(e.y + FT.CH * 0.8), b - a, FT.CH * 0.8 * fScale); }
        else { c.beginPath(); c.arc(X(g.p[e.own].x), Y(g.p[e.own].y + FT.CH * 0.5), FT.CH * 0.75 * fScale, 0, Math.PI * 2); c.fill(); c.stroke(); }
      }
    } else if (e.kind === "spark") { c.strokeStyle = "#fff6a8"; c.lineWidth = 5; c.beginPath(); c.arc(X(e.x), Y(e.y), 10 + 40 * pr, 0, Math.PI * 2); c.stroke(); }
    else if (e.kind === "boom") { c.fillStyle = "#ffb14a"; c.beginPath(); c.arc(X(e.x), Y(20), 20 + 60 * pr, 0, Math.PI * 2); c.fill(); }
    else if (e.kind === "impact") {
      const h = FT.CH * 0.95 * fScale, f = g.cfg.f[e.own], dr = e.bul && f.bul[e.bul.p];
      c.fillStyle = "rgba(255,240,200,0.6)"; c.fillRect(X(e.x - e.w / 2), gy - h, e.w * fScale, h);
      if (dr) {
        const anim = pickAnim(dr.part, ["finish", "hit", "end", "normal", "idle"]);
        if (anim) { const n = dr.part.animations[anim].frame_count; c.globalAlpha = 1; c.translate(X(e.x), gy); const k = fScale * FT.CH / f.h; c.scale(k, k); drawPartCtx(c, dr, anim, Math.min(n - 1, Math.floor(pr * n)), 0, 0, false, 0); }
      }
    } else if (e.kind === "num" || e.kind === "text") {
      c.font = canvasFont(900, e.kind === "num" ? (e.heavy ? 40 : 32) : 26); c.textAlign = "center"; c.lineWidth = 6; c.strokeStyle = "#1b2038";
      c.fillStyle = e.color || (e.guard ? "#9fd0ff" : e.heal ? "#7dff9a" : e.dot ? "#d7a6ff" : e.kind === "text" ? "#ffd84a" : "#ffffff");
      const y = Y(e.y + 60 * pr); c.strokeText(e.text, X(e.x), y); c.fillText(e.text, X(e.x), y);
    } else if (e.kind === "buff") { c.strokeStyle = "#7dff9a"; c.lineWidth = 6; c.beginPath(); c.arc(X(e.x), Y(FT.CH * 0.5), 40 + 50 * pr, 0, Math.PI * 2); c.stroke(); }
    else if (e.kind === "break") { c.font = canvasFont(900, 40); c.textAlign = "center"; c.fillStyle = "#ff5060"; c.lineWidth = 6; c.strokeStyle = "#1b2038"; c.strokeText("破防！", X(e.x), Y(e.y + 70 + 40 * pr)); c.fillText("破防！", X(e.x), Y(e.y + 70 + 40 * pr)); }
    c.restore();
  }
  function fightBanner(c, g, y) {
    let txt = "", sub = "";
    if (g.phase === "intro") txt = g.cfg.mode === "dummy" ? "練習" : `第 ${g.round} 回合`;
    else if (g.phase === "count") txt = String(3 - Math.floor(g.phaseT));
    else if (g.phase === "fight" && g.phaseT < 0.6) txt = "開打！";
    else if (g.phase === "end") { txt = g.endKind === "ko" ? "K.O." : "時間到"; sub = g.roundWinner === -1 ? "平手" : `${g.roundWinner ? "右方" : "左方"}拿下這回合`; }
    else if (g.phase === "over") txt = g.winner === -1 ? "平手" : `${g.winner ? "右方" : "左方"}獲勝`;
    if (!txt) return;
    c.textAlign = "center"; c.textBaseline = "middle"; c.lineWidth = 10; c.strokeStyle = "#1b2038"; c.fillStyle = "#ffffff";
    c.font = canvasFont(900, 84, true); c.strokeText(txt, FW / 2, y); c.fillText(txt, FW / 2, y);
    if (sub) { c.font = canvasFont(900, 34); c.lineWidth = 7; c.strokeText(sub, FW / 2, y + 70); c.fillText(sub, FW / 2, y + 70); }
  }
  // 血條＋秒數＋回合（一人：最上面；兩人：中間，紅左藍右）
  function fightHudBar(c, g, y, h, pvp) {
    c.save();
    c.fillStyle = "#0e1122"; c.fillRect(0, y - (pvp ? 0 : 18), FW, h + (pvp ? 0 : 18));
    // 兩人模式左邊留位置給「離開」按鈕，兩條血條對稱縮短
    const cy = y + h / 2, bw = pvp ? 215 : 270, bh = pvp ? 24 : 30, edge = pvp ? 110 : 20;
    const bar = (i) => {
      const p = g.p[i], r = Math.max(0, p.hp / p.maxHp), x0 = i ? FW - edge - bw : edge;
      // 從中間往外縮的橫條（左方靠右對齊、右方靠左對齊）
      const fill = (y, h, ratio, color) => { c.fillStyle = color; if (i) c.fillRect(x0, y, bw * ratio, h); else c.fillRect(x0 + bw * (1 - ratio), y, bw * ratio, h); };
      c.fillStyle = "#333a5c"; c.fillRect(x0, cy - bh / 2, bw, bh);
      fill(cy - bh / 2, bh, r, i ? "#2f6fe0" : "#e0323f");
      c.strokeStyle = "#fff"; c.lineWidth = 2; c.strokeRect(x0, cy - bh / 2, bw, bh);
      // 硬直累積值（滿了倒地）
      const sh = pvp ? 5 : 7;
      c.fillStyle = "#262b48"; c.fillRect(x0, cy + bh / 2 + 3, bw, sh);
      fill(cy + bh / 2 + 3, sh, Math.min(1, p.sv / FT.SV_MAX), p.sv / FT.SV_MAX > 0.7 ? "#ff8a3d" : "#ffd84a");
      if (!pvp) { c.fillStyle = "#e8ebff"; c.font = canvasFont(700, 20); c.textAlign = i ? "right" : "left"; c.textBaseline = "top"; c.fillText(`${g.cfg.f[i].r.name}　${Math.max(0, Math.ceil(p.hp))}／${p.maxHp}`, i ? FW - 20 : 20, cy + bh / 2 + 14); }
      if (g.cfg.mode !== "dummy") for (let n = 0; n < Math.ceil(g.cfg.rounds / 2); n++) {
        c.fillStyle = n < g.wins[i] ? "#ffd84a" : "#444a6e"; c.beginPath(); c.arc(i ? FW - edge - 10 - n * 18 : edge + 10 + n * 18, cy - bh / 2 - 10, 6, 0, Math.PI * 2); c.fill();
      }
    };
    bar(0); bar(1);
    c.fillStyle = "#1b2038"; c.strokeStyle = "#fff"; c.lineWidth = 3; c.beginPath(); c.arc(FW / 2, cy, pvp ? 30 : 38, 0, Math.PI * 2); c.fill(); c.stroke();
    c.fillStyle = "#fff"; c.font = canvasFont(900, pvp ? 28 : 34); c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText(g.cfg.secs > 0 && g.cfg.mode !== "dummy" ? String(Math.ceil(g.timeLeft)) : "∞", FW / 2, cy + 2);
    c.restore();
  }
  // 按鈕：搖桿、普攻、技能（冷卻轉圈；矩形技能按住時顯示取消圈）
  function fightDrawControls(c, g, L, who) {
    const B = fightButtons(L), ctl = FG.ctl[who], p = g.p[who], fs = g.cfg.fs[who];
    const human = FG.set.mode === "pvp" || who === 0;
    c.save();
    c.fillStyle = "#1a1e36"; c.fillRect(0, L.ctrl.y, FW, L.ctrl.h);
    if (!human) { c.restore(); return; }
    const held = new Set(ctl ? ctl.pads.values() : []);
    const pad = (key, label) => {
      const b = B[key], on = held.has(key), w = b.w || b.r * 2, h = b.h || b.r * 2;
      c.fillStyle = on ? "#ffd84a" : "rgba(255,255,255,0.12)"; c.strokeStyle = "rgba(255,255,255,0.55)"; c.lineWidth = 3;
      c.beginPath(); if (c.roundRect) c.roundRect(b.x - w / 2, b.y - h / 2, w, h, 14); else c.rect(b.x - w / 2, b.y - h / 2, w, h); c.fill(); c.stroke();
      c.fillStyle = on ? "#1b2038" : "#fff"; c.font = canvasFont(900, 26); c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(label, b.x, b.y);
    };
    pad("up", "跳"); pad("down", "防"); pad("left", "◀"); pad("right", "▶");
    { // 防禦條（破防後要回到 GAUGE_REARM 才能再防：這段期間顯示灰色）
      const r = Math.max(0, p.gauge) / FT.GAUGE_MAX, b = B.down;
      // 放在「防」左邊
      const gw = 90, gx = b.x - b.r - 10 - gw, gy = b.y - 6;
      c.fillStyle = "#333a5c"; c.fillRect(gx, gy, gw, 12);
      c.fillStyle = p.guardLock ? "#777c99" : r < 0.3 ? "#ff5060" : "#59a7ff"; c.fillRect(gx, gy, gw * r, 12);
      c.strokeStyle = "rgba(255,255,255,0.6)"; c.lineWidth = 1; c.strokeRect(gx, gy, gw, 12);
    }
    const btn = (key, label, cdLeft, cdMax, off) => {
      const b = B[key], held = ctl && ctl.btn[key];
      const slot = fightSlot(fs, SLOT_OF[key]);
      if (held && slot && FT_AIMED[slot.kind]) { // 拖曳中：外圈是取消區
        c.strokeStyle = "rgba(255,90,90,0.5)"; c.setLineDash([8, 8]); c.lineWidth = 3; c.beginPath();
        if (slot.kind === "dash") { const dy = b.r * CANCEL_R; c.moveTo(0, b.y - dy); c.lineTo(FW, b.y - dy); c.moveTo(0, b.y + dy); c.lineTo(FW, b.y + dy); } // 突進：上下兩條線外＝取消
        else c.arc(b.x, b.y, b.r * CANCEL_R, 0, Math.PI * 2);
        c.stroke(); c.setLineDash([]);
      }
      c.fillStyle = off ? "#3a3f5c" : held ? "#ffd84a" : key === "atk" ? "#e0323f" : "#7c5cff";
      c.beginPath(); c.arc(b.x, b.y, b.r, 0, Math.PI * 2); c.fill();
      if (cdLeft > 0) { c.fillStyle = "rgba(0,0,0,0.55)"; c.beginPath(); c.moveTo(b.x, b.y); c.arc(b.x, b.y, b.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (cdLeft / cdMax)); c.closePath(); c.fill(); }
      c.strokeStyle = "#fff"; c.lineWidth = 3; c.beginPath(); c.arc(b.x, b.y, b.r, 0, Math.PI * 2); c.stroke();
      c.fillStyle = "#fff"; c.font = canvasFont(900, key === "atk" ? 30 : 22); c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText(label, b.x, b.y - (cdLeft > 0 ? 10 : 0));
      if (cdLeft > 0) { c.font = canvasFont(900, 22); c.fillText(cdLeft.toFixed(1), b.x, b.y + 16); }
    };
    btn("atk", { shot: "普攻↔", lob: "普攻⌒", dline: "普攻→" }[fs.atk.kind] || "普攻", p.atkCd, fs.atk.cd, false);
    for (const s of [0, 1]) {
      const k = fs.sk[s];
      const lab = k ? ({ rect: "定點", line: "直線", lob: "拋物", self: "自身", dash: "突進", buff: "輔助" }[k.kind] + (s + 1)) : "—";
      btn("sk" + s, lab, k ? p.cd[s] : 0, k ? k.cd : 1, !k);
    }
    c.restore();
  }
