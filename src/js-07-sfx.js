  /* ---------- 輸出 ---------- */
  let downloadsApi = null;
  (async () => { try { if (window.claude && window.claude.use) downloadsApi = await window.claude.use("downloads"); } catch {} })();
  async function offerFile(blob, filename, status = $("outStatus")) {
    if (downloadsApi) {
      try { await downloadsApi.save({ filename, data: blob }); status.textContent = `已存檔：${filename}`; return; }
      catch (e) { if (e && e.code === "declined") { status.textContent = "已取消存檔。"; return; } }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    status.textContent = `已產生 ${filename}。若沒有自動下載，請改用 Safari 或 Chrome 開啟本頁。`;
  }
  /* ---------- 音效 ----------
     普攻在命中時播、技能在發動和命中時播；左右角色與單人各自設定。
     1. 音效在網頁一打開就先合成、解碼好（不需要點擊）。
     2. 瀏覽器要求「使用者點過」才能出聲：持續監聽各種點擊直到聲音真的啟動，切回網頁會自動恢復。
     3. 聲音還沒啟動時直接略過，不排隊（避免之後一次湧出一串）。
     4. 依事先算好的時間表，提前 0.15 秒「預約」播放時間，畫面卡頓也不影響音效準度。
     所有聲音（含背景音樂）都走同一個 AudioContext，錄影時一起混進影片。 */
  const SFX_PRESETS = [
    ["none", "無聲"], ["game", "遊戲技能發動聲"], ["punch", "拳擊"], ["slash", "斬擊"], ["magic", "魔法彈"],
    ["laser", "雷射"], ["boom", "爆炸"], ["thunder", "雷電"], ["shine", "閃光"], ["charge", "蓄力"], ["custom", "自己上傳…"],
  ];
  const SFX_SYS = ["cdBeep", "cdGo", "ko"]; // 系統音效：雙人倒數、K.O.（程式合成，跟著音量與靜音）
  const SFX_LOOK = 0.15; // 預約的提前量（秒）
  const SFX = {
    ctx: null, master: null, buffers: {}, custom: {}, voices: {}, pending: [], ready: null,
    vol: store.get("sfxVol", 0.7), muted: !!store.get("sfxMuted", false), out: null,
    cfg: Object.assign({ single: { atk: "punch", skill: "game", hit: "boom" }, duel: [{ atk: "punch", skill: "game", hit: "boom" }, { atk: "slash", skill: "game", hit: "thunder" }] }, store.get("sfx", {})),
  };
  [SFX.cfg.single, ...(SFX.cfg.duel || [])].forEach((c, n) => { if (c && !c.hit) c.hit = n === 2 ? "thunder" : "boom"; });
  function sfxSave() { store.set("sfx", SFX.cfg); store.set("sfxVol", SFX.vol); }
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  function sfxDecode(ab) {
    // 用離線的 AudioContext 解碼，不必等使用者點擊
    const c = SFX.ctx || (OAC ? new OAC(1, 1, 44100) : null);
    if (!c) return Promise.reject(new Error("no audio"));
    return new Promise((ok, bad) => { const p = c.decodeAudioData(ab, ok, bad); if (p && p.then) p.then(ok, bad); });
  }
  /* ---------- 自己上傳的檔案存在這台裝置（IndexedDB） ----------
     key：sfx:<single|duel0|duel1>-<atk|skill|hit>、bgm、duelBg
     值：{ data: ArrayBuffer, type, name, size, saved }（存 ArrayBuffer 而不是 Blob，舊版 Safari 也能存） */
  const FILES = { db: null, meta: {}, clearArm: 0 };
  function filesDb() {
    if (!FILES.db) {
      FILES.db = new Promise((ok, bad) => {
        try {
          const rq = indexedDB.open("ranger-kichiku", 1);
          rq.onupgradeneeded = () => rq.result.createObjectStore("files");
          rq.onsuccess = () => ok(rq.result); rq.onerror = () => bad(rq.error); rq.onblocked = () => bad(new Error("blocked"));
        } catch (e) { bad(e); }
      });
      FILES.db.catch(() => {});
    }
    return FILES.db;
  }
  async function fileTx(mode, fn) {
    const db = await filesDb();
    return new Promise((ok, bad) => {
      const tx = db.transaction("files", mode); let out;
      const rq = fn(tx.objectStore("files")); if (rq) rq.onsuccess = () => { out = rq.result; };
      tx.oncomplete = () => ok(out); tx.onerror = () => bad(tx.error); tx.onabort = () => bad(tx.error);
    });
  }
  async function fileGet(key) { try { return (await fileTx("readonly", (st) => st.get(key))) || null; } catch { return null; } }
  async function fileAll() {
    const out = {};
    try { await fileTx("readonly", (st) => { const rq = st.openCursor(); rq.onsuccess = () => { const c = rq.result; if (c) { out[c.key] = c.value; c.continue(); } }; }); } catch {}
    return out;
  }
  async function filePut(key, blob, name) {
    if (!blob || blob.size > 60 * 1024 * 1024) return false; // 超過 60 MB 不存
    try {
      const rec = { data: await blob.arrayBuffer(), type: blob.type || "", name: name || "", size: blob.size, saved: Date.now() };
      await fileTx("readwrite", (st) => st.put(rec, key));
      FILES.meta[key] = { name: rec.name, size: rec.size }; filesUi();
      try { if (navigator.storage && navigator.storage.persist && !/firefox/i.test(navigator.userAgent)) navigator.storage.persist(); } catch {}
      return true;
    } catch { return false; }
  }
  async function fileDel(key) { try { await fileTx("readwrite", (st) => st.delete(key)); } catch {} delete FILES.meta[key]; filesUi(); }
  const recBlob = (rec) => new Blob([rec.data], { type: rec.type || "" });
  function fmtSize(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; }
  function filesUi() {
    const keys = Object.keys(FILES.meta);
    const total = keys.reduce((a, k) => a + (FILES.meta[k].size || 0), 0);
    document.querySelectorAll(".saved-files").forEach((box) => {
      box.hidden = !keys.length;
      box.querySelector(".saved-sum").textContent = `這台裝置已存 ${keys.length} 個上傳檔（共 ${fmtSize(total)}）`;
    });
    document.querySelectorAll('[data-saved="bgm"]').forEach((el) => {
      el.hidden = !S.audioUrl;
      el.querySelector("span").textContent = S.audioUrl ? `目前音樂：${S.audioName || "（未命名）"}${FILES.meta.bgm ? "（已存在這台裝置）" : ""}` : "";
    });
    (SFX.refreshers || []).forEach((f) => f());
  }
  function setBgm(blob, name) {
    if (S.audioUrl) URL.revokeObjectURL(S.audioUrl);
    S.audioUrl = blob ? URL.createObjectURL(blob) : null; S.audioName = blob ? name || "" : "";
    filesUi();
  }
  // 開網頁時把存著的音效、背景音樂放回去（競技場背景在進雙人對戰時讀）
  async function filesRestore() {
    const all = await fileAll();
    for (const [key, rec] of Object.entries(all)) {
      if (!rec || !rec.data) continue;
      FILES.meta[key] = { name: rec.name, size: rec.size || rec.data.byteLength };
      if (key.startsWith("sfx:")) { try { SFX.custom[key.slice(4)] = await sfxDecode(rec.data.slice(0)); } catch {} }
      else if (key === "bgm" && !S.audioUrl) setBgm(recBlob(rec), rec.name);
    }
    filesUi();
  }
  async function filesClearAll() {
    try { await fileTx("readwrite", (st) => st.clear()); } catch {}
    FILES.meta = {}; SFX.custom = {};
    setBgm(null); $("audioFile").value = ""; $("dAudio").value = "";
    if (D.bgImg) { applyDuelBg(null); $("dBgFile").value = ""; }
    try { localStorage.removeItem("rk_duelBg"); } catch {}
    document.querySelectorAll(".sfx-row input[type=file]").forEach((i) => (i.value = ""));
    filesUi();
  }
  async function sfxLoad() {
    const ids = SFX_PRESETS.map((p) => p[0]).filter((id) => !["none", "game", "custom"].includes(id)).concat(SFX_SYS);
    await Promise.all(ids.map(async (id) => { try { SFX.buffers[id] = await sfxSynth(id); } catch {} }));
    try { const r = await fetch("sfx/skill-game.mp3"); if (r.ok) SFX.buffers.game = await sfxDecode(await r.arrayBuffer()); } catch {}
  }
  function sfxRunning() { return !!(SFX.ctx && SFX.ctx.state === "running"); }
  function sfxCtx() {
    if (!SFX.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { SFX.ctx = new AC({ latencyHint: "interactive" }); } catch { SFX.ctx = new AC(); }
      // master（音量）→ out（靜音開關）→ 喇叭；錄影從 master 取聲，所以靜音不影響錄影
      SFX.master = SFX.ctx.createGain(); SFX.master.gain.value = SFX.vol;
      SFX.out = SFX.ctx.createGain(); SFX.out.gain.value = SFX.muted ? 0 : 1;
      SFX.master.connect(SFX.out); SFX.out.connect(SFX.ctx.destination);
      SFX.ctx.onstatechange = sfxBadges;
    }
    if (SFX.ctx.state !== "running") SFX.ctx.resume().then(sfxBadges, () => {});
    return SFX.ctx;
  }
  // 在使用者點擊的當下呼叫：啟動聲音，並播一段無聲的極短音（iOS 需要這樣才算解鎖）
  function sfxUnlock() {
    const ctx = sfxCtx(); if (!ctx) return;
    try { const b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0); } catch {}
    sfxBadges();
  }
  const SFX_UNLOCK_EVENTS = ["pointerdown", "pointerup", "touchend", "click", "keydown"];
  function sfxUnlockListener() {
    sfxUnlock();
    if (sfxRunning()) SFX_UNLOCK_EVENTS.forEach((ev) => window.removeEventListener(ev, sfxUnlockListener, true));
  }
  function sfxInit() {
    SFX.ready = sfxLoad();
    SFX_UNLOCK_EVENTS.forEach((ev) => window.addEventListener(ev, sfxUnlockListener, { capture: true, passive: true }));
    // 切到別的 App、鎖螢幕再回來時，聲音可能被暫停或中斷：自動恢復
    const wake = () => { if (SFX.ctx && SFX.ctx.state !== "running" && document.visibilityState === "visible") SFX.ctx.resume().then(sfxBadges, () => {}); sfxBadges(); };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("pageshow", wake);
    sfxBadges();
  }
  // 舞台角落的「點一下開啟音效」提示
  function sfxBadges() {
    const on = sfxRunning();
    document.querySelectorAll(".sfx-unlock").forEach((b) => { b.hidden = on; });
    if (on) SFX_UNLOCK_EVENTS.forEach((ev) => window.removeEventListener(ev, sfxUnlockListener, true));
  }
  async function sfxSynth(id) {
    const sr = 44100;
    const dur = { punch: 0.24, slash: 0.32, magic: 0.48, laser: 0.26, boom: 1.1, thunder: 1.1, shine: 0.95, charge: 0.8, cdBeep: 0.22, cdGo: 0.6, ko: 1.5 }[id] || 0.4;
    const oc = new OAC(1, Math.ceil(sr * dur), sr);
    const out = oc.createGain(); out.connect(oc.destination);
    let seed = 12345;
    const noise = () => {
      const b = oc.createBuffer(1, Math.ceil(sr * dur), sr), d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; d[i] = seed / 0x3fffffff - 1; }
      const n = oc.createBufferSource(); n.buffer = b; return n;
    };
    const env = (g, t0, a, peak, d) => {
      g.gain.setValueAtTime(0.0001, 0); g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
    };
    const osc = (type, f0, f1, t0, t1, peak, a, d, dest = out) => {
      const o = oc.createOscillator(), g = oc.createGain(); o.type = type;
      o.frequency.setValueAtTime(f0, t0); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t1);
      env(g, t0, a, peak, d); o.connect(g); g.connect(dest); o.start(t0); o.stop(Math.min(dur, t0 + a + d + 0.02));
    };
    const nz = (type, f0, f1, t0, t1, q, peak, a, d) => {
      const n = noise(), f = oc.createBiquadFilter(), g = oc.createGain(); f.type = type; f.Q.value = q;
      f.frequency.setValueAtTime(f0, t0); if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t1);
      env(g, t0, a, peak, d); n.connect(f); f.connect(g); g.connect(out); n.start(t0);
    };
    switch (id) {
      case "punch": osc("sine", 170, 45, 0, 0.18, 1, 0.003, 0.19); nz("lowpass", 2200, 600, 0, 0.06, 0.7, 0.7, 0.002, 0.06); break;
      case "slash": nz("bandpass", 7500, 1100, 0, 0.24, 2.2, 1, 0.02, 0.27); nz("highpass", 5000, 5000, 0, 0.1, 0.7, 0.25, 0.005, 0.08); break;
      case "magic": osc("sine", 480, 1500, 0, 0.32, 0.7, 0.01, 0.42); osc("triangle", 960, 3000, 0, 0.32, 0.22, 0.01, 0.36); osc("sine", 2400, 2400, 0.12, 0.12, 0.15, 0.005, 0.25); break;
      case "laser": { const f = oc.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 3800; f.connect(out); osc("square", 1700, 170, 0, 0.21, 0.45, 0.003, 0.23, f); break; }
      case "boom": nz("lowpass", 1600, 110, 0, 1.0, 0.8, 1, 0.006, 1.05); osc("sine", 95, 28, 0, 0.6, 0.9, 0.004, 0.65); break;
      case "thunder": [0, 0.05, 0.13, 0.2].forEach((t, n) => nz("highpass", 2500, 900, t, t + 0.12, 0.8, 0.8 - n * 0.12, 0.002, 0.1)); nz("lowpass", 420, 120, 0.05, 1.0, 0.8, 0.9, 0.03, 1.0); break;
      case "shine": [1320, 1980, 2640, 3520].forEach((fq, n) => osc("sine", fq, fq, n * 0.045, n * 0.045, 0.32, 0.004, 0.75 - n * 0.1)); break;
      // 系統音效（不在選單裡）：倒數嗶聲、開打、K.O.
      case "cdBeep": osc("square", 880, 880, 0, 0, 0.5, 0.004, 0.17); break;
      case "cdGo": osc("square", 1320, 1320, 0, 0, 0.5, 0.004, 0.5); osc("sine", 660, 660, 0, 0, 0.35, 0.004, 0.45); break;
      case "ko": osc("sine", 140, 32, 0, 0.7, 1, 0.003, 0.8); nz("lowpass", 2400, 90, 0, 1.2, 0.8, 0.9, 0.004, 1.3); osc("sawtooth", 220, 110, 0.02, 0.5, 0.25, 0.01, 0.5); [523, 659, 784].forEach((fq) => osc("triangle", fq, fq, 0.12, 0.12, 0.22, 0.01, 1.2)); break;
      case "charge": {
        const f = oc.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 2600; f.connect(out);
        const o = oc.createOscillator(), g = oc.createGain(); o.type = "sawtooth";
        o.frequency.setValueAtTime(170, 0); o.frequency.exponentialRampToValueAtTime(1150, 0.56);
        g.gain.setValueAtTime(0.03, 0); g.gain.exponentialRampToValueAtTime(0.45, 0.54); g.gain.exponentialRampToValueAtTime(0.0001, 0.6);
        o.connect(g); g.connect(f); o.start(0); o.stop(0.62);
        osc("sine", 1760, 1760, 0.56, 0.56, 0.5, 0.004, 0.22); break;
      }
    }
    const buf = await oc.startRendering();
    const d = buf.getChannelData(0); let pk = 0; for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
    const top = { cdBeep: 0.55, cdGo: 0.65 }[id] || 0.9;
    if (pk > 0) for (let i = 0; i < d.length; i++) d[i] *= top / pk;
    return buf;
  }
  // 播放（可指定精確時間 when）。聲音沒啟動就直接略過。
  // choke = 同一個聲道重播時先切掉上一個（惡搞連發時會有斷音效果）
  function sfxPlay(id, customKey, opt = {}) {
    if (!id || id === "none" || !sfxRunning()) return;
    const ctx = SFX.ctx;
    const buf = id === "custom" ? SFX.custom[customKey] : SFX.buffers[id];
    if (!buf) return;
    const when = Math.max(ctx.currentTime, opt.when || 0);
    if (opt.choke && SFX.voices[opt.choke]) { try { SFX.voices[opt.choke].stop(when); } catch {} }
    const src = ctx.createBufferSource(); src.buffer = buf;
    src.playbackRate.value = Math.max(0.5, Math.min(2, opt.rate || 1));
    src.connect(SFX.master); src.start(when);
    if (opt.choke) SFX.voices[opt.choke] = src;
    const now = ctx.currentTime;
    SFX.pending = SFX.pending.filter((p) => p.when > now - 0.5);
    SFX.pending.push({ src, when });
  }
  // 暫停、拖進度條時：取消已預約但還沒開始的音效
  function sfxStopPending() {
    if (!SFX.ctx) return;
    const now = SFX.ctx.currentTime;
    for (const p of SFX.pending) if (p.when > now + 0.005) { try { p.src.stop(); } catch {} }
    SFX.pending = [];
  }
  function sfxSetVol(v) { SFX.vol = Math.max(0, Math.min(1, v)); if (SFX.master) SFX.master.gain.value = SFX.vol; sfxSave(); sfxVolIcons(); }
  function sfxSetMuted(m) { SFX.muted = !!m; if (SFX.out) SFX.out.gain.value = SFX.muted ? 0 : 1; store.set("sfxMuted", SFX.muted); sfxVolIcons(); }
  // 播放列的喇叭圖示：靜音／小聲／大聲
  function sfxVolIcons() {
    const off = SFX.muted || SFX.vol <= 0;
    const waves = off ? '<path d="M16 9.5l5 5m0-5-5 5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'
      : '<path d="M15.5 9.5a3.5 3.5 0 0 1 0 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>' + (SFX.vol >= 0.5 ? '<path d="M18 7a7 7 0 0 1 0 10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>' : "");
    document.querySelectorAll(".vol-btn").forEach((b) => {
      b.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/>' + waves + "</svg>";
      b.classList.toggle("muted", SFX.muted);
      b.setAttribute("aria-label", SFX.muted ? "取消靜音" : "靜音");
      b.title = SFX.muted ? "取消靜音（音量 " + Math.round(SFX.vol * 100) + "%）" : "靜音";
    });
  }
  // 點喇叭：切換靜音，靜音時順便打開音量滑桿；拖滑桿會自動取消靜音
  function sfxVolButtons() {
    document.querySelectorAll(".vol-wrap").forEach((w) => {
      const btn = w.querySelector(".vol-btn"), pop = w.querySelector(".vol-pop");
      sfxVolControl(pop);
      const h = document.createElement("p"); h.className = "hint"; h.textContent = "靜音只影響你聽到的聲音，錄影時照樣會收音。";
      pop.appendChild(h);
      btn.onclick = (e) => {
        e.stopPropagation(); sfxUnlock();
        sfxSetMuted(!SFX.muted);
        document.querySelectorAll(".vol-pop").forEach((p2) => { if (p2 !== pop) p2.hidden = true; });
        pop.hidden = !SFX.muted; btn.setAttribute("aria-expanded", String(!pop.hidden));
      };
      pop.addEventListener("click", (e) => e.stopPropagation());
    });
    document.addEventListener("click", () => document.querySelectorAll(".vol-pop").forEach((p2) => { p2.hidden = true; p2.previousElementSibling.setAttribute("aria-expanded", "false"); }));
    sfxVolIcons();
  }
  // 預約排程：list = [{k, ...}]（第幾幀觸發），len = 一輪幾幀（循環播放用），abs = 不歸零的播放位置（幀）
  function sfxRun(st, list, abs, fps, len, play) {
    const end = abs + SFX_LOOK * fps;
    if (st.upTo == null || abs < st.upTo - SFX_LOOK * fps * 2 - 1 || abs > st.upTo + fps) st.upTo = abs - 1e-6; // 跳轉或剛開始
    if (sfxRunning() && len > 0 && list.length) {
      const now = SFX.ctx.currentTime;
      for (let m = Math.floor(st.upTo / len); m <= Math.floor(end / len); m++) {
        for (const e of list) {
          const t = e.k + m * len;
          if (t > st.upTo && t <= end) play(e, now + Math.max(0, (t - abs) / fps));
        }
      }
    }
    st.upTo = Math.max(st.upTo, end);
  }
  // 錄影：音效與背景音樂一起混進同一條音軌
  async function sfxBeginRecord(bgmUrl, bgmStart) {
    const ctx = sfxCtx(); if (!ctx) return {};
    try { await ctx.resume(); } catch {}
    try { await SFX.ready; } catch {}
    sfxBadges();
    const dest = ctx.createMediaStreamDestination();
    SFX.master.connect(dest);
    let audioEl = null;
    if (bgmUrl) {
      try {
        audioEl = new Audio(bgmUrl); audioEl.currentTime = bgmStart || 0;
        const src = ctx.createMediaElementSource(audioEl);
        src.connect(dest); src.connect(SFX.out);
      } catch { audioEl = null; }
    }
    return { dest, audioEl, track: dest.stream.getAudioTracks()[0] };
  }
  function sfxEndRecord(mix) {
    if (!mix) return;
    if (mix.audioEl) { try { mix.audioEl.pause(); } catch {} }
    if (mix.dest) { try { SFX.master.disconnect(mix.dest); } catch {} }
  }
  // 設定介面：一組「普攻命中／技能發動／技能命中」選單 + 上傳 + 試聽
  function sfxControls(box, getCfg, keyPrefix, title) {
    const wrap = document.createElement("div"); wrap.className = "sfx-set";
    if (title) { const h = document.createElement("strong"); h.textContent = title; wrap.appendChild(h); }
    for (const [kind, label] of [["atk", "普攻命中"], ["skill", "技能發動"], ["hit", "技能命中"]]) {
      const row = document.createElement("div"); row.className = "sfx-row";
      const lab = document.createElement("span"); lab.textContent = label;
      const sel = document.createElement("select"); sel.setAttribute("aria-label", (title || "") + label);
      for (const [id, name] of SFX_PRESETS) { const o = document.createElement("option"); o.value = id; o.textContent = name; sel.appendChild(o); }
      sel.value = getCfg()[kind] || "none";
      const file = document.createElement("input"); file.type = "file"; file.accept = "audio/*"; file.hidden = sel.value !== "custom";
      const ck = keyPrefix + "-" + kind;
      const note = document.createElement("span"); note.className = "sfx-note";
      const refresh = () => {
        file.hidden = sel.value !== "custom";
        const m = FILES.meta["sfx:" + ck];
        note.textContent = sel.value !== "custom" ? "" : !SFX.custom[ck] ? "請選擇音效檔" : m ? `已存：${m.name || "音效檔"}` : "";
      };
      (SFX.refreshers = SFX.refreshers || []).push(refresh);
      const preview = async () => {
        const ctx = sfxCtx(); if (!ctx) return;
        try { await ctx.resume(); } catch {}
        try { await SFX.ready; } catch {}
        sfxBadges(); sfxPlay(getCfg()[kind], ck);
      };
      sel.onchange = () => { getCfg()[kind] = sel.value; sfxSave(); refresh(); if (sel.value !== "custom") preview(); };
      file.onchange = async () => {
        const f = file.files && file.files[0]; if (!f) return;
        try { SFX.custom[ck] = await sfxDecode(await f.arrayBuffer()); note.textContent = ""; preview(); }
        catch { note.textContent = "這個檔案無法讀取"; return; }
        await filePut("sfx:" + ck, f, f.name); refresh();
      };
      const test = document.createElement("button"); test.className = "btn small"; test.textContent = "▶ 試聽"; test.type = "button";
      test.onclick = preview;
      row.append(lab, sel, test, file, note); wrap.appendChild(row);
      refresh();
    }
    box.appendChild(wrap);
  }
  function sfxVolControl(box) {
    const l = document.createElement("label"); l.className = "slider";
    l.append("音效音量 ");
    const r = document.createElement("input"); r.type = "range"; r.min = "0"; r.max = "1"; r.step = "0.05"; r.value = String(SFX.vol); r.className = "sfx-vol";
    const o = document.createElement("output"); o.textContent = Math.round(SFX.vol * 100) + "%";
    r.oninput = () => { if (SFX.muted && +r.value > 0) sfxSetMuted(false); sfxSetVol(+r.value); document.querySelectorAll(".sfx-vol").forEach((x) => { x.value = r.value; x.nextElementSibling.textContent = Math.round(SFX.vol * 100) + "%"; }); };
    l.append(r, o); box.appendChild(l);
  }
  // 單人：依目前動作與剪輯時間表，列出每個音效在第幾幀
  function singleClipKind() {
    const c = CLIPS.find((x) => x.names.includes(S.animName));
    return c ? c.key : "";
  }
  function singleSfxList() {
    const key = `${S.mode}|${S.animName}|${S.mode === "remix" ? S.timeline.length : clipN()}`;
    if (S.sfxCache && S.sfxCache.key === key && S.sfxCache.tl === S.timeline) return S.sfxCache;
    const out = { key, tl: S.timeline, list: [], len: 0 };
    S.sfxCache = out;
    const kind = singleClipKind();
    const a = S.part && S.part.animations[S.animName];
    if (!a || (kind !== "attack" && kind !== "skill1" && kind !== "skill2")) return out;
    const h = Math.min(a.frame_count - 1, Math.floor(hitFrac({ part: S.part }, S.animName) * a.frame_count));
    const add = (k, which, rate) => out.list.push({ k, which, rate, choke: "single-" + which });
    if (S.mode === "remix") {
      out.len = S.timeline.length;
      S.timeline.forEach((e, k) => {
        const p = k > 0 ? S.timeline[k - 1] : null;
        const segStart = !p || p.seg !== e.seg || p.rep !== e.rep;
        const rate = +e.seg.speed || 1;
        const atHit = e.idx === h && (segStart || !p || p.idx !== h);
        if (kind === "attack") { if (atHit) add(k, "atk", rate); }
        else { if (segStart) add(k, "skill", rate); if (atHit) add(k, "hit", rate); }
      });
    } else {
      out.len = Math.max(1, clipN());
      if (kind === "attack") add(h, "atk", 1);
      else { add(0, "skill", 1); add(h, "hit", 1); }
    }
    return out;
  }
  function singleSfxPlay(e, when) { sfxPlay(SFX.cfg.single[e.which], "single-" + e.which, { rate: e.rate, choke: e.choke, when }); }
  // 雙人：模擬時記下的音效點（模擬幀）換算成輸出幀（含 K.O. 慢動作重播）
  function sfxBufFor(id, key) { if (!id || id === "none") return null; return id === "custom" ? SFX.custom[key] : SFX.buffers[id]; }
  function duelSfxList() {
    if (D.sfxOutFor === D.sfxEv && D.sfxOutMap === D.timeMap && D.sfxOut) return D.sfxOut;
    const list = [], ev = D.sfxEv || [], map = D.timeMap && D.timeMap.length ? D.timeMap : null;
    const n = D.len || 0;
    for (let k = 0; k < n; k++) {
      const cur = map ? map[k] : k, prev = k > 0 ? (map ? map[k - 1] : k - 1) : -1;
      if (cur <= prev) continue;
      const slow = D.replayFrom >= 0 && k >= D.replayFrom;
      for (const e of ev) if (e.k > prev && e.k <= cur) list.push({ k, side: e.side, which: e.kind === "skill" ? "skill" : e.kind === "skillhit" ? "hit" : "atk", rate: slow ? 0.7 : 1 });
      if (!slow && D.ko >= 0 && D.ko > prev && D.ko <= cur) list.push({ k, sys: "ko", rate: 1 });
    }
    D.sfxOut = list; D.sfxOutFor = D.sfxEv; D.sfxOutMap = D.timeMap;
    return list;
  }
  function duelSfxPlay(e, when) {
    if (e.sys) { sfxPlay(e.sys, null, { rate: e.rate, when }); return; }
    const c = SFX.cfg.duel[e.side] || {}; sfxPlay(c[e.which], `duel${e.side}-${e.which}`, { rate: e.rate, when });
  }
  // 開場倒數：3、2、1 各一聲，第 CD_SEC 秒（開打）一聲較高的
  const CD_SEC = 3;
  const cdSfx = (fps) => [{ k: 0, sys: "cdBeep" }, { k: fps, sys: "cdBeep" }, { k: 2 * fps, sys: "cdBeep" }, { k: CD_SEC * fps, sys: "cdGo" }];
