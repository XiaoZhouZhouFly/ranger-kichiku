  /* 播放狀態：
     - 還沒開始／已播完（D.idle）：畫面蓋 50% 黑幕＋播放鈕，不會自動播放、也不重複。
     - 按播放：3、2、1 倒數（D.cd = 倒數經過的幀數），黑幕跟著變淡，倒數完才開打。
     - 播到一半暫停再播放：直接接著播，不倒數。 */
  function duelPlayBtn(on) { $("dPlay").textContent = on ? "❚❚" : "▶"; $("dPlay").setAttribute("aria-label", on ? "暫停" : "播放"); }
  function duelIdle(atEnd) {
    D.playing = false; D.cd = null; D.idle = true;
    D.pos = atEnd ? Math.max(0, D.len - 1) : 0;
    $("dStart").hidden = !!atEnd; // 播完停在最後一格（保留 K.O. 畫面），按播放列的播放鍵重新倒數
    duelPlayBtn(false); markDirty();
  }
  function duelStart() {
    if (!D.f[0] || !D.f[1] || D.recording) return;
    sfxUnlock();
    D.idle = false; D.playing = false; D.pos = 0; D.cd = 0; D.cdSt = {};
    $("dStart").hidden = true; duelPlayBtn(true); markDirty();
  }
  function duelPause() { D.playing = false; D.cd = null; D.idle = false; $("dStart").hidden = true; duelPlayBtn(false); }
  function duelTick(dt) {
    if (D.recording) return;
    if (D.cd != null && D.f[0] && D.f[1]) {
      D.cd += dt * FPS;
      sfxRun(D.cdSt, cdSfx(FPS), D.cd, FPS, 1e9, duelSfxPlay);
      if (D.cd >= CD_SEC * FPS) { D.cd = null; D.pos = 0; D.playing = true; clockStop(D.clock, false); } // 開打的嗶聲已預約，不取消
    }
    if (D.playing && D.f[0] && D.f[1]) {
      D.pos = clockAdvance(D.clock, D.pos, dt * FPS);
      if (D.pos >= D.len) duelIdle(true); // 播完停在最後一格，不重複
      else clockSchedule(D.clock, D.pos, duelSfxList(), 1e9, FPS, duelSfxPlay);
    } else clockStop(D.clock, D.cd == null); // 倒數中不取消（倒數的嗶聲已預約）
    const active = (D.playing || D.cd != null) && D.f[0] && D.f[1];
    if (!shouldDraw(active)) return;
    renderDuel(Math.floor(D.pos));
    if (D.cd != null) drawCountdown(dctx, dcv.width, dcv.height, D.cd);
    $("dframeNo").textContent = `${Math.floor(D.pos)} / ${Math.max(0, D.len - 1)}`;
    if (!dscrubbing) $("dscrub").value = String(Math.floor(D.pos));
  }
  let dscrubbing = false;

  /* 招式預設 */
  function availActions(i) { const f = D.f[i]; return f ? ["move", "attack", "skill1", "skill2"].filter((a) => f.clips[a] && !(a === "move" && isSim())) : []; }
  function presetTrade() {
    const out = [{ who: "A", action: "move" }, { who: "B", action: "move" }];
    const pick = (i, list) => list.find((a) => availActions(i).includes(a));
    const seq = [["attack"], ["attack"], ["skill1", "attack"], ["skill1", "attack"], ["skill2", "skill1", "attack"], ["skill2", "skill1", "attack"], ["skill1", "attack"], ["skill1", "attack"], ["skill2", "skill1"], ["skill2", "skill1"]];
    seq.forEach((opts, n) => { const who = n % 2 ? "B" : "A"; const a = pick(who === "A" ? 0 : 1, opts); if (a) out.push({ who, action: a }); });
    return out;
  }
  function presetRandomDuel() {
    D.seed = newSeed(1000);
    const out = [{ who: "A", action: "move" }];
    for (let n = 0; n < 12; n++) {
      const who = Math.random() < 0.5 ? "A" : "B";
      const acts = availActions(who === "A" ? 0 : 1).filter((a) => a !== "move");
      const a = acts[Math.floor(Math.random() * acts.length)];
      out.push({ who, action: a, repeat: Math.random() < 0.25 ? 2 + Math.floor(Math.random() * 3) : 1 });
    }
    return out;
  }

  /* 介面 */
  function actionLabel(i, a) {
    const f = D.f[i]; if (!f) return ACTION_LABEL[a];
    const sk = a === "skill1" ? f.skills[0] : a === "skill2" ? f.skills[1] : null;
    return ACTION_LABEL[a] + (sk ? "・" + sk.name : "") + (summonInfo(i, a) ? (summonInfo(i, a).cpy ? "（複製對手）" : "（召喚）") : isSim() && isSupport(i, a) ? "（輔助）" : "");
  }
  function renderMoves() {
    const box = $("moves"); box.textContent = "";
    const real = isSim();
    const order = real ? [...D.moves.keys()].filter((n) => D.moves[n].who !== "B" && D.moves[n].action !== "move").concat([...D.moves.keys()].filter((n) => D.moves[n].who === "B" && D.moves[n].action !== "move")) : [...D.moves.keys()];
    let lastSide = null;
    order.forEach((n) => {
      const m = D.moves[n];
      if (real && m.who !== lastSide) {
        lastSide = m.who;
        const h = document.createElement("p"); h.className = "moves-side";
        h.textContent = (m.who === "B" ? "右方・" + (D.f[1]?.r.name || "") : "左方・" + (D.f[0]?.r.name || "")) + "（由上往下循環出招）";
        box.appendChild(h);
      }
      const i = m.who === "B" ? 1 : 0;
      const row = document.createElement("div"); row.className = "move " + (i ? "is-b" : "is-a");
      const no = document.createElement("span"); no.className = "move-no"; no.textContent = n + 1;
      const who = document.createElement("select"); who.id = `mv${n}_who`; who.setAttribute("aria-label", "出招方");
      [["A", "左 " + (D.f[0]?.r.name || "")], ["B", "右 " + (D.f[1]?.r.name || "")]].forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; who.appendChild(o); });
      who.value = m.who;
      const act = document.createElement("select"); act.id = `mv${n}_act`; act.setAttribute("aria-label", "招式");
      for (const a of availActions(i)) { const o = document.createElement("option"); o.value = a; o.textContent = actionLabel(i, a); act.appendChild(o); }
      if (![...act.options].some((o) => o.value === m.action)) m.action = act.options[0]?.value || "attack";
      act.value = m.action;
      const rep = document.createElement("input"); rep.type = "number"; rep.min = 1; rep.max = 8; rep.value = m.repeat || 1; rep.id = `mv${n}_rep`; rep.title = "連打次數"; rep.setAttribute("aria-label", "連打次數");
      const slowL = document.createElement("label"); slowL.className = "check";
      const slow = document.createElement("input"); slow.type = "checkbox"; slow.checked = !!m.slow; slow.id = `mv${n}_slow`;
      slowL.append(slow, document.createTextNode(" 慢動作"));
      who.onchange = () => { m.who = who.value; movesChanged(true); };
      act.onchange = () => { m.action = act.value; movesChanged(); };
      rep.onchange = () => { m.repeat = clampInt(rep.value, 1, 8); movesChanged(); };
      slow.onchange = () => { m.slow = slow.checked; movesChanged(); };
      const tools = document.createElement("span"); tools.className = "move-tools";
      const tb = (t, fn, label) => { const b = document.createElement("button"); b.className = "btn small"; b.textContent = t; b.setAttribute("aria-label", label); b.onclick = fn; tools.appendChild(b); };
      const sameSide = (from, step) => { for (let q = from + step; q >= 0 && q < D.moves.length; q += step) if (!real || (D.moves[q].who === m.who && D.moves[q].action !== "move")) return q; return -1; };
      tb("↑", () => { const q = sameSide(n, -1); if (q >= 0) { [D.moves[q], D.moves[n]] = [D.moves[n], D.moves[q]]; movesChanged(true); } }, "上移");
      tb("↓", () => { const q = sameSide(n, 1); if (q >= 0) { [D.moves[q], D.moves[n]] = [D.moves[n], D.moves[q]]; movesChanged(true); } }, "下移");
      tb("✕", () => { D.moves.splice(n, 1); movesChanged(true); }, "刪除");
      const repL = document.createElement("label"); repL.className = "rep"; repL.append(document.createTextNode("連打"), rep);
      tools.prepend(slowL);
      row.append(no, who, act, repL, tools);
      box.appendChild(row);
    });
  }
  function movesChanged(rerender) {
    compileDuel(); saveDuel();
    if (D.pos >= D.len) D.pos = 0;
    if (rerender) renderMoves();
  }
  function saveDuel() {
    syncUrl();
    store.set("duel", duelState());
  }
  function fighterPanel(i) {
    const f = D.f[i];
    $(`dname${i}`).textContent = f ? f.r.name : "未選擇";
    const th = $(`dthumb${i}`); th.textContent = "";
    if (f) { const img = document.createElement("img"); img.alt = ""; const urls = thumbUrls(f.r.id); let n = 0; img.onerror = () => { if (++n < urls.length) img.src = urls[n]; }; img.src = urls[0]; th.appendChild(img); }
  }
  async function setFighter(i, r, keepMoves) {
    setLoad($("doverlay"), `載入 ${r.name} …`);
    try {
      const nf = await loadFighter(r);
      const old = D.f[i];
      D.f[i] = nf;
      await loadSummons(i);
      D.range[i] = null; D.mvs[i] = null; D.level[i] = null; D.cheat[i] = {};
      fighterPanel(i);
      if (!keepMoves || D.mode !== "custom") D.moves = D.mode === "random" ? presetRandomDuel() : presetTrade();
      compileDuel(); renderMoves(); saveDuel(); renderRealPanel();
      if (old && old !== D.f[0] && old !== D.f[1]) freeFighter(old);
      pruneSummons();
      D.pos = 0;
      $("doverlay").hidden = true;
    } catch (e) {
      setLoad($("doverlay"), `讀取 ${r.name} 失敗：${e.message || e}`, true);
    }
  }
  function renderDuelResults(i) {
    const q = $(`dq${i}`).value.trim(), box = $(`dr${i}`);
    box.textContent = "";
    if (!q) return;
    const list = S.index.filter((r) => (r.name || "").includes(q) || r.id.includes(q.toLowerCase())).slice(0, 40);
    if (!list.length) { box.innerHTML = `<p class="hint">找不到「${escapeHtml(q)}」。</p>`; return; }
    for (const r of list) box.appendChild(unitCard(r, () => { setFighter(i, r, true); box.textContent = ""; $(`dq${i}`).value = ""; }, { select: false }));
  }
  // 按錄製：先問要不要包含開頭倒數
  function askRecordDuel() {
    if (D.recording || !D.f[0] || !D.f[1]) return;
    $("dRecAsk").hidden = !$("dRecAsk").hidden;
  }
  // shift = 影片開頭多出的倒數幀數（0 = 不含倒數）
  function duelOfflineEvents(shift = 0) {
    const fight = duelSfxList().map((e) => {
      const buf = e.sys ? SFX.buffers[e.sys] : sfxBufFor((SFX.cfg.duel[e.side] || {})[e.which], `duel${e.side}-${e.which}`);
      return { t: (e.k + shift) / FPS, buf, rate: e.rate };
    });
    const cd = shift ? cdSfx(FPS).map((e) => ({ t: e.k / FPS, buf: SFX.buffers[e.sys], rate: 1 })) : [];
    return cd.concat(fight);
  }
  async function recordDuel(withCd) {
    $("dRecAsk").hidden = true;
    if (D.recording || !D.f[0] || !D.f[1]) return;
    duelPause();
    if (S.bg === "transparent") setBg("white");
    const CD = withCd ? CD_SEC * FPS : 0, total = D.len + CD; // 含倒數：影片開頭多 3 秒
    const live = (CD ? cdSfx(FPS) : []).concat(duelSfxList().map((e) => Object.assign({}, e, { k: e.k + CD })));
    await recordCanvas({
      canvas: dcv, len: total, fps: FPS,
      draw: (k) => { if (k < CD) { renderDuel(0); drawCountdown(dctx, dcv.width, dcv.height, k); } else renderDuel(k - CD); },
      offEvents: duelOfflineEvents(CD), live: { list: live, len: 1e9, play: duelSfxPlay },
      status: $("dStatus"), badge: $("drecBadge"), buttons: [$("dRec")],
      busy: (on) => { D.recording = on; }, onFrame: (k) => { $("dframeNo").textContent = `${Math.max(0, k - CD)} / ${D.len - 1}`; },
      fileBase: `duel_${D.f[0].r.id}_vs_${D.f[1].r.id}`,
      noSupport: "這個瀏覽器不支援錄製影片。請改用電腦版 Chrome。",
    });
    duelIdle();
  }
  function setDuelSize(sz) {
    const [w, h] = sz.split("x").map(Number);
    dcv.width = w; dcv.height = h;
    dcv.closest(".stage-col").style.setProperty("--ar", String(w / h));
    document.querySelectorAll("#dsizes .chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.size === sz)));
    store.set("dsize", sz);
  }
  async function initDuel() {
    if (D.inited) return; D.inited = true;
    const saved = store.get("duel", {});
    /* 設定的來源：
       - 分享連結（網址有 s＝種子，分享按鈕產生的連結一定有）：會影響結果的設定完全照連結，連結沒寫的用預設值，
         所以同一個連結在任何人的瀏覽器都得到同樣結果；只影響畫面的設定（震動、血條等）保留自己的習慣。
       - 其他網址（例如手打的 ?app=duel&type=raw）：照瀏覽器存檔，網址有寫的再蓋過去。 */
    applyDuelSettings(settingsFromSaved(saved));
    const fromUrl = URLP.get("app") === "duel";
    if (fromUrl) {
      const fromLink = settingsFromUrl(URLP, URLD);
      if (URLP.has("s")) {
        const mine = Object.fromEntries(DUEL_SETTINGS.filter((s) => s.ui).map((s) => [s.key, D[s.key]]));
        applyDuelSettings(Object.assign(fromLink, mine));
      } else applyDuelSettings(Object.assign(settingsToSaved(), fromLink));
    }
    syncDuelInputs();
    await restoreDuelBg();
    setDuelSize(store.get("dsize", "1280x720"));
    const find = (id) => id && S.index.find((r) => r.id === id);
    // 角色：連結 → 存檔 → 單人正在看的角色 → 預設角色（找不到就依序退回，最後任選一隻）
    const a = (fromUrl && find(URLP.get("l"))) || find(saved.a) || S.unit || DEFAULT_LEFT.map(find).find(Boolean) || S.index[0];
    const b = (fromUrl && find(URLP.get("r"))) || find(saved.b) || DEFAULT_RIGHT.map(find).find(Boolean) || S.index.find((r) => r.id !== a.id);
    setLoad($("doverlay"), "載入角色中…");
    const [fa, fb] = await Promise.all([loadFighter(a), loadFighter(b), ensureStats()]);
    D.f = [fa, fb]; fighterPanel(0); fighterPanel(1);
    await loadSummons(0); await loadSummons(1);
    // 招式：從連結開啟時，你來我往用預設招式、隨機與自定義照連結；不是從連結開啟就照存檔
    const mv = fromUrl ? decMoves(URLD.mv || URLP.get("mv")).filter((m) => availActions(m.who === "B" ? 1 : 0).includes(m.action) || m.action === "move") : saved.moves;
    D.moves = (fromUrl ? D.mode !== "trade" : true) && Array.isArray(mv) && mv.length ? mv : presetTrade();
    $("doverlay").hidden = true;
    setDuelMode(D.mode, false);
    renderRealPanel();
  }
  function setApp(mode) {
    if (lib.onPick) { $("library").hidden = true; homeLib(); }
    S.app = mode;
    $("appSingle").setAttribute("aria-pressed", String(mode === "single"));
    $("appDuel").setAttribute("aria-pressed", String(mode === "duel"));
    document.querySelectorAll("[data-app]").forEach((el) => (el.hidden = el.dataset.app !== mode));
    store.set("app", mode);
    syncUrl();
    if (mode === "duel") initDuel();
  }

  $("appSingle").onclick = () => setApp("single");
  $("appDuel").onclick = () => setApp("duel");
  [0, 1].forEach((i) => {
    let t; $(`dq${i}`).addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => renderDuelResults(i), 250); });
    $(`dq${i}`).addEventListener("keydown", (e) => { if (e.key === "Enter") renderDuelResults(i); });
  });
  $("dSwap").onclick = () => { D.f.reverse(); swapDuelSides(); renderRealPanel(); fighterPanel(0); fighterPanel(1); D.moves.forEach((m) => (m.who = m.who === "A" ? "B" : "A")); movesChanged(true); };
  $("dPlay").onclick = () => {
    if (D.cd != null) duelIdle(); // 倒數中按暫停：回到還沒開始
    else if (D.playing) duelPause();
    else if (D.idle) duelStart();
    else { D.playing = true; duelPlayBtn(true); }
  };
  $("dStartBtn").onclick = duelStart;
  $("dscrub").addEventListener("input", () => { dscrubbing = true; duelPause(); D.pos = +$("dscrub").value; });
  $("dscrub").addEventListener("change", () => { dscrubbing = false; });
  $("dAddA").onclick = () => { D.moves.push({ who: "A", action: availActions(0).includes("skill1") ? "skill1" : "attack" }); movesChanged(true); };
  $("dAddB").onclick = () => { D.moves.push({ who: "B", action: availActions(1).includes("skill1") ? "skill1" : "attack" }); movesChanged(true); };
  const MODE_HINT = {
    trade: "雙方輪流出招、逐步換大招。結果要看到最後才知道；想自己排招或先看勝負，請選「自定義」。",
    random: "每按一次「隨機對打」就重新抽一套招式，誰會贏看了才知道。",
    custom: "由上往下依序出招，被打中的一方會自動播放被擊退。血量歸零就 K.O.，後面的招式不再執行。可以從你來我往或隨機的招式接著改。",
  };
  function setDuelMode(mode, regenerate) {
    D.mode = mode;
    document.querySelectorAll("#dModes .chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.dmode === mode)));
    const custom = mode === "custom";
    $("moves").hidden = !custom; $("dAddRow").hidden = !custom; $("duelTotal").hidden = !custom;
    $("dModeHint").textContent = MODE_HINT[mode] + (isSim() ? " 真距離：雙方同時行動，打不到會自動走過去，「移動接近」不再需要；只有體力跌破一半與倒下時才會被擊退。" : "");
    if (regenerate && mode === "trade") D.moves = presetTrade();
    if (regenerate && mode === "random") D.moves = presetRandomDuel();
    movesChanged(true);
  }
  $("dPresetTrade").onclick = () => setDuelMode("trade", true);
  $("dPresetRandom").onclick = () => setDuelMode("random", true);
  $("dPresetCustom").onclick = () => setDuelMode("custom", false);
  $("dDist").addEventListener("input", () => { D.dist = +$("dDist").value; $("dDistOut").textContent = D.dist; movesChanged(); });
  $("dSpeed").addEventListener("input", () => { D.speed = +$("dSpeed").value; $("dSpeedOut").textContent = D.speed.toFixed(2) + "×"; movesChanged(); });
  [["dShake", "shake"], ["dInvert", "invert"], ["dNumbers", "numbers"], ["dBars", "bars"]].forEach(([id, key]) => ($(id).onchange = () => { D[key] = $(id).checked; saveDuel(); }));
  $("dProj").onchange = () => { D.projOn = $("dProj").checked; movesChanged(); };
  $("dFinale").onchange = () => { D.finale = $("dFinale").checked; movesChanged(); };
  function applyDuelBg(img) {
    if (D.bgImg && D.bgImg.src && D.bgImg.src.startsWith("blob:") && D.bgImg !== img) URL.revokeObjectURL(D.bgImg.src);
    D.bgImg = img;
    $("dBgClear").hidden = !img; $("dGroundRow").hidden = !img; $("dBgHint").hidden = !img;
  }
  function loadDuelBg(url) {
    return new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = url; });
  }
  $("dBgFile").onchange = async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const rawUrl = URL.createObjectURL(f), raw = await loadDuelBg(rawUrl);
    setTimeout(() => URL.revokeObjectURL(rawUrl), 0);
    if (!raw) { $("dStatus").textContent = "這張圖片讀不出來，請換一張 JPG 或 PNG。"; return; }
    // 縮小到 1600 寬存起來，下次打開還在
    const s = Math.min(1, 1600 / raw.width), cvs = document.createElement("canvas");
    cvs.width = Math.round(raw.width * s); cvs.height = Math.round(raw.height * s);
    cvs.getContext("2d").drawImage(raw, 0, 0, cvs.width, cvs.height);
    const blob = await new Promise((ok) => cvs.toBlob(ok, "image/jpeg", 0.85));
    if (!blob) return;
    applyDuelBg(await loadDuelBg(URL.createObjectURL(blob)));
    await filePut("duelBg", blob, f.name);
  };
  $("dBgClear").onclick = () => { applyDuelBg(null); $("dBgFile").value = ""; fileDel("duelBg"); try { localStorage.removeItem("rk_duelBg"); } catch {} };
  async function restoreDuelBg() {
    // 舊版存在 localStorage 的背景圖搬進 IndexedDB
    try {
      const old = localStorage.getItem("rk_duelBg");
      if (old) { const b = await (await fetch(old)).blob(); if (await filePut("duelBg", b, "競技場背景")) localStorage.removeItem("rk_duelBg"); }
    } catch {}
    const rec = await fileGet("duelBg");
    if (rec && rec.data) { const img = await loadDuelBg(URL.createObjectURL(recBlob(rec))); if (img) applyDuelBg(img); }
  }
  $("dGround").addEventListener("input", () => { D.ground = +$("dGround").value; $("dGroundOut").textContent = D.ground + "%"; saveDuel(); });
  document.querySelectorAll("#dsizes .chip").forEach((c) => (c.onclick = () => setDuelSize(c.dataset.size)));
  $("dRec").onclick = askRecordDuel;
  $("dRecCd").onclick = () => recordDuel(true);
  $("dRecNo").onclick = () => recordDuel(false);
  $("dRecCancel").onclick = () => { $("dRecAsk").hidden = true; };
  $("dAudio").onchange = async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setBgm(f, f.name); $("dStatus").textContent = `已載入音樂：${f.name}`;
    await filePut("bgm", f, f.name);
  };

