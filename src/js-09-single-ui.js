  /* ---------- 單人：錄影、截圖 ---------- */
  function singleOfflineEvents(len, fps) {
    const sl = singleSfxList(), out = [];
    if (!sl.len || !sl.list.length) return out;
    for (let m = 0; m * sl.len < len; m++) for (const e of sl.list) {
      const t = e.k + m * sl.len; if (t >= len) continue;
      out.push({ t: t / fps, buf: sfxBufFor(SFX.cfg.single[e.which], "single-" + e.which), rate: e.rate, choke: e.choke });
    }
    return out.sort((a, b) => a.t - b.t);
  }
  async function record(kind) {
    if (!S.part || S.recording) return;
    if (S.bg === "transparent") { setBg("white"); }
    setMode(kind);
    const loops = kind === "orig" ? +$("origLoops").value : 1;
    const len = kind === "remix" ? S.timeline.length : clipN() * loops;
    const fps = kind === "remix" ? FPS : Math.round((S.part.anim_rate || 24) * S.speed) || 30;
    const clipKey = (CLIPS.find((c) => c.names.includes(S.animName)) || {}).key || S.animName;
    const sl = singleSfxList();
    await recordCanvas({
      canvas: cv, len, fps, draw: (k) => render(...firstArgs(kind, k)),
      offEvents: singleOfflineEvents(len, fps), live: { list: sl.list, len: sl.len, play: singleSfxPlay },
      status: $("outStatus"), badge: $("recBadge"), buttons: [...document.querySelectorAll("#recRemix,#recOrig")],
      busy: (on) => { S.recording = on; }, onFrame: (k) => { $("frameNo").textContent = `${k} / ${len - 1}`; },
      fileBase: `${S.unit.id}_${clipKey}_${kind === "remix" ? "egao" : "orig"}`,
      noSupport: "這個瀏覽器不支援錄製影片。請改用電腦版 Chrome，或用 Python 腳本輸出。",
    });
    S.pos = 0; markDirty();
  }
  function firstArgs(kind, k) {
    if (kind === "remix") { const st = remixState(k); return [st.idx, st.cam, st.fx, k]; }
    const n = clipN(), i = k % n;
    return [i, origCam(i), {}, k];
  }
  async function savePng() {
    drawCurrent();
    const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
    if (blob) await offerFile(blob, `${S.unit.id}_${S.animName}_${Math.floor(S.pos)}.png`);
  }

  /* ---------- 介面事件 ---------- */
  // 載入畫面：轉圈 + 文字；err = 顯示錯誤訊息（不轉圈）
  function setLoad(el, text, err) {
    el.hidden = false; el.classList.toggle("err", !!err);
    if (!el.querySelector(".ld-text")) el.innerHTML = '<div class="ld-box"><i class="ld-spin"></i></div><span class="ld-text"></span>';
    el.querySelector(".ld-text").textContent = text;
  }
  function showOverlay(t, err) { setLoad($("overlay"), t, err); }
  function hideOverlay() { $("overlay").hidden = true; }
  function setBg(bg) {
    S.bg = bg;
    document.querySelectorAll("[data-bg]").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.bg === bg)));
    cv.classList.toggle("checker", bg === "transparent");
    store.set("bg", bg); drawCurrent();
  }
  function setSize(sz) {
    const [w, h] = sz.split("x").map(Number);
    cv.width = w; cv.height = h;
    cv.closest(".stage-col").style.setProperty("--ar", String(w / h));
    document.querySelectorAll("#sizes .chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.size === sz)));
    store.set("size", sz); drawCurrent();
  }

  $("qBtn").onclick = () => { toggleLib(false); renderResults($("q").value); };
  $("libBtn").onclick = () => toggleLib($("library").hidden);
  $("libClose").onclick = () => { if (lib.onPick) { $("library").hidden = true; homeLib(); } else toggleLib(false); };
  document.querySelectorAll("[data-lib-side]").forEach((b) => (b.onclick = () => openLibFor(+b.dataset.libSide)));
  $("libMore").onclick = () => { lib.shown += LIB_PAGE; renderLib(); };
  $("q").addEventListener("keydown", (e) => { if (e.key === "Enter") renderResults($("q").value); });
  let qTimer; $("q").addEventListener("input", () => { clearTimeout(qTimer); qTimer = setTimeout(() => { toggleLib(false); renderResults($("q").value); }, 250); });
  $("playBtn").onclick = () => setPlaying(!S.playing);
  $("modeOrig").onclick = () => setMode("orig");
  $("modeRemix").onclick = () => setMode("remix");
  $("scrub").addEventListener("input", () => { scrubbing = true; S.pos = +$("scrub").value; setPlaying(false); drawCurrent(); });
  $("scrub").addEventListener("change", () => { scrubbing = false; });
  const bindRange = (id, outId, fmt, fn) => { const r = $(id), o = $(outId); r.addEventListener("input", () => { o.textContent = fmt(+r.value); fn(+r.value); }); };
  bindRange("speed", "speedOut", (v) => v.toFixed(2) + "×", (v) => (S.speed = v));
  bindRange("camZoom", "camZoomOut", (v) => v.toFixed(2) + "×", (v) => { S.camZoom = v; drawCurrent(); });
  bindRange("audioStart", "audioStartOut", (v) => v.toFixed(1) + "s", () => {});
  bindRange("origLoops", "origLoopsOut", (v) => v + " 次", () => {});
  $("follow").onchange = (e) => { S.follow = e.target.checked; drawCurrent(); };
  $("singleProj").onchange = (e) => { S.projOn = e.target.checked; store.set("singleProj", S.projOn); if (S.part) selectAnim(S.animName); };
  $("loop").onchange = (e) => { S.loop = e.target.checked; if (S.loop && !S.playing) setPlaying(true); };
  document.querySelectorAll("[data-bg]").forEach((c) => (c.onclick = () => setBg(c.dataset.bg)));
  document.querySelectorAll("#sizes .chip").forEach((c) => (c.onclick = () => setSize(c.dataset.size)));
  document.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => {
    document.querySelectorAll(".tabs button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    document.querySelectorAll("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== b.dataset.tab));
    if (b.dataset.tab === "remix" && S.mode !== "remix") setMode("remix");
  }));
  document.querySelectorAll("[data-preset]").forEach((b) => (b.onclick = () => {
    const n = clipN();
    S.segs = { plain: presetPlain, spam: presetSpam, demo1: presetDemo1, demo2: presetDemo2, random: presetRandom }[b.dataset.preset](n);
    segsChanged(); setMode("remix"); setPlaying(true);
  }));
  $("remixAnim").onchange = (e) => { selectAnim(e.target.value); setMode("remix"); setPlaying(true); };
  $("segAdd").onclick = () => { const n = clipN(); S.segs.push(defSeg(n)); segsChanged(); };
  $("compReset").onclick = () => { for (const k in S.comps) S.comps[k] = defComp(); buildComps(); compsChanged(); };
  $("compShowAll").onclick = () => { for (const k in S.comps) S.comps[k].show = true; buildComps(); compsChanged(); };
  $("compChaos").onclick = () => {
    const R = Math.random;
    for (const k in S.comps) {
      const c = S.comps[k];
      c.scale = R() < 0.35 ? +(0.5 + R() * 2.5).toFixed(2) : 1;
      c.spin = R() < 0.35 ? Math.round((R() - 0.5) * 60) : 0;
      c.hue = R() < 0.4 ? Math.floor(R() * 24) * 15 : 0;
      c.jitter = R() < 0.25 ? Math.round(R() * 20) : 0;
      c.show = R() > 0.05;
    }
    buildComps(); compsChanged();
  };
  $("undoBtn").onclick = () => histGo(-1);
  $("redoBtn").onclick = () => histGo(1);
  document.addEventListener("keydown", (e) => {
    if (S.app !== "single" || !(e.ctrlKey || e.metaKey) || e.altKey) return;
    const t = e.target, tag = t && t.tagName;
    if (tag === "TEXTAREA" || tag === "SELECT" || (tag === "INPUT" && !["range", "checkbox", "radio", "button"].includes(t.type)) || (t && t.isContentEditable)) return; // 輸入框裡交給瀏覽器
    if (document.querySelector(".modal:not([hidden])")) return;
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) { e.preventDefault(); histGo(-1); }
    else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); histGo(1); }
  });
  $("recRemix").onclick = () => record("remix");
  $("recOrig").onclick = () => record("orig");
  $("savePng").onclick = savePng;
  $("audioFile").onchange = async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setBgm(f, f.name); $("outStatus").textContent = `已載入音樂：${f.name}`;
    await filePut("bgm", f, f.name);
  };
  document.querySelectorAll('[data-saved="bgm"] button').forEach((b) => (b.onclick = () => { setBgm(null); $("audioFile").value = ""; $("dAudio").value = ""; fileDel("bgm"); }));
  document.querySelectorAll(".saved-clear").forEach((b) => (b.onclick = () => {
    // 按兩次才清除，避免誤觸
    if (Date.now() - FILES.clearArm > 4000) {
      FILES.clearArm = Date.now();
      document.querySelectorAll(".saved-clear").forEach((x) => (x.textContent = "再按一次確定清除"));
      setTimeout(() => document.querySelectorAll(".saved-clear").forEach((x) => (x.textContent = "清除已存的檔案")), 4000);
      return;
    }
    FILES.clearArm = 0;
    document.querySelectorAll(".saved-clear").forEach((x) => (x.textContent = "清除已存的檔案"));
    filesClearAll();
  }));

  // 拖曳平移
  let drag = null;
  cv.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, px: S.panX, py: S.panY }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const r = cv.getBoundingClientRect(), k = cv.width / r.width;
    S.panX = drag.px + (e.clientX - drag.x) * k; S.panY = drag.py + (e.clientY - drag.y) * k; drawCurrent();
  });
  cv.addEventListener("pointerup", () => (drag = null));
  cv.addEventListener("pointercancel", () => (drag = null));
  cv.addEventListener("dblclick", () => { S.panX = 0; S.panY = 0; drawCurrent(); });

