  /* ---------- 回報資訊 ----------
     一鍵整理：版本、瀏覽器、螢幕、目前模式、錄影會走哪條路、音效狀態，以及能重現當下畫面的分享連結。 */
  async function reportInfo() {
    const ua = navigator.userAgent;
    const lines = [`Ranger 惡搞工坊 ${APP_VERSION}`];
    lines.push(`時間：${new Date().toLocaleString("zh-TW", { hour12: false })}`);
    lines.push(`瀏覽器：${ua}`);
    lines.push(`畫面：${innerWidth}×${innerHeight}，像素比 ${devicePixelRatio || 1}${matchMedia("(pointer: coarse)").matches ? "，觸控" : ""}`);
    const duel = S.app === "duel";
    const kind = duel ? KINDS[D.type].label : (S.mode === "remix" ? "惡搞" : "原始");
    lines.push(`模式：${duel ? "雙人對戰・" + kind : "單人・" + kind}${duel && D.f[0] && D.f[1] ? `（${D.f[0].r.id} vs ${D.f[1].r.id}）` : S.unit ? `（${S.unit.id}・${S.animName || ""}）` : ""}`);
    const c = duel ? dcv : cv, fps = duel ? FPS : 30;
    let rec = "不支援錄影";
    try {
      const sup = await offlineSupport(c.width, c.height, fps);
      if (sup) rec = `逐格輸出（${sup.vcfg.codec}＋${sup.acfg.codec}）`;
      else { const m = pickMime(); rec = m === null ? "不支援錄影" : `即時錄影（${m || "瀏覽器預設格式"}）`; }
    } catch (e) { rec = "檢查失敗：" + (e && e.message || e); }
    lines.push(`錄影方式：${rec}，輸出尺寸 ${c.width}×${c.height}`);
    lines.push(`音效：${sfxRunning() ? "已啟動" : "尚未啟動"}，音量 ${Math.round(SFX.vol * 100)}%${SFX.muted ? "（靜音）" : ""}；已存上傳檔 ${Object.keys(FILES.meta).length} 個`);
    lines.push(`支援：WebCodecs ${window.VideoEncoder ? "有" : "無"}、MediaRecorder ${window.MediaRecorder ? "有" : "無"}、IndexedDB ${window.indexedDB ? "有" : "無"}、CompressionStream ${window.CompressionStream ? "有" : "無"}`);
    let url = ""; try { url = await shareUrl(); } catch {}
    lines.push(`目前畫面：${url || location.href}`);
    return lines.join("\n");
  }
  $("appVer").textContent = APP_VERSION;
  // 自動健檢用：只讀取狀態摘要，不會改變任何東西
  window.__rk = Object.freeze({
    version: APP_VERSION,
    single: () => ({ unit: S.unit && S.unit.id, anim: S.animName, mode: S.mode, segs: S.segs.length, timeline: S.timeline.length, histAt: H.at, histLen: H.list.length, playing: S.playing, ready: !!(S.part && S.atlas) && $("overlay").hidden }),
    fight: () => { const g = FG.g; return { inited: !!FG.inited, running: FG.running, ready: !!(FG.inited && $("fChar0").options.length), set: Object.assign({}, FG.set),
      phase: g && g.phase, round: g && g.round, wins: g && g.wins.slice(), hp: g && g.p.map((p) => Math.round(p.hp)), x: g && g.p.map((p) => Math.round(p.x)),
      stun: g && g.p.map((p) => +p.stun.toFixed(2)), inv: g && g.p.map((p) => +p.inv.toFixed(2)), gauge: g && g.p.map((p) => +p.gauge.toFixed(1)), sv: g && g.p.map((p) => +p.sv.toFixed(1)), state: g && g.p.map((p) => p.state), aim: g && g.p.map((p) => p.aim.map((a) => (a ? Math.round(a.d) : null))),
      face: g && g.p.map((p) => p.face), teles: g ? g.teles.length : 0, projs: g ? g.projs.length : 0, stats: g && Object.assign({}, g.stats), winner: g && g.winner, t: g && +g.t.toFixed(2),
      fs: FG.fs.map((x) => x && { walk: x.walk, atk: x.atk.kind, sk: x.sk.map((k) => k && k.kind) }), canvas: [FW, FH], btn: fightButtons(fightLayout()) }; },
    /* 格鬥場的固定輸入測試（不畫面、不影響正在玩的那一場）：
       spec = { c0, c1, mode, rounds, secs, seed, steps, holdMove, teleMode, ai: [難度, 難度],
                script: [{ side, from, to, mx, guard, atk: 每幾步按一次, jump, sk: [技能序（2＝投射物普攻）, 按下步, 放開步, 往前拖] }] }
       回傳事件次數、最後狀態與 trace（每一步雙方的 x、y、hp、state）；同樣的 spec 一定得到同樣的結果。 */
    // 格鬥場：一隻角色的標準化結果（相容性）、全部角色的相容性報告
    fightNorm: async (id) => { await Promise.all([ensureStats(), ensureSkillFx()]); const f = await fightLoad(id), fs = fightStats(f); return { N: fs.N, atk: fs.atk.kind, sk: fs.sk.map((k) => k && k.kind), summary: fightSummary(fs) }; },
    fightCompat: () => normAll(),
    // 標準化的小零件（健檢用；都不改任何狀態）
    fightNormUnit: (r, anims) => normUnit(r, new Set(anims)), fightDelivery: (cfg, rg, isAtk) => normDelivery(cfg, rg, isAtk), fightField: (obj, key, def) => normField(obj, key, def),
    fightRun: async (spec) => {
      await ensureSkillFx();
      const f = await Promise.all([fightLoad(spec.c0), fightLoad(spec.c1)]), fs = f.map(fightStats);
      const g = fightNew({ f, fs, rounds: spec.rounds || 1, secs: spec.secs ?? 0, mode: spec.mode || "dummy", seed: spec.seed || 1,
        holdMove: !!spec.holdMove, teleMode: spec.teleMode || "dist" });
      g.phase = "fight"; g.phaseT = 1;
      const log = { hits: 0, guards: 0, breaks: 0, downs: 0, inv: 0, ko: 0, dmg: [], scale: [] }, mem = [{}, {}], trace = [];
      for (let k = 0; k < (spec.steps || 600); k++) {
        const inputs = [0, 1].map((side) => {
          const inp = fightBlankInput();
          if (spec.ai && spec.ai[side]) return fightAi(g, side, spec.ai[side], mem[side]);
          for (const s of spec.script || []) {
            if (s.side !== side || k < (s.from || 0) || k >= (s.to ?? 1e9)) continue;
            if (s.mx) inp.mx = s.mx; if (s.guard) inp.guard = true;
            if (s.atk && (k - (s.from || 0)) % s.atk === 0) inp.atk = true;
            if (s.jump && k === s.from) inp.jump = true;
            if (s.sk) { const [n, down, up, drag] = s.sk; if (k === down) inp.skDown[n] = true; if (k > down && k < up) inp.skAim[n] = drag || 0; if (k === up) { inp.skUp[n] = true; inp.skAim[n] = drag || 0; } }
          }
          return inp;
        });
        const invBefore = g.p.map((p) => p.inv > 0);
        fightStep(g, inputs);
        for (const e of g.events) { if (e.type === "hit") log.hits++; if (e.type === "guard") log.guards++; if (e.type === "break") log.breaks++; if (e.type === "ko") log.ko++; if (e.type === "down") log.downs++; if (e.type === "unsupported") log.unsupported = (log.unsupported || 0) + 1; if (e.type === "fxhit") log.fxhits = (log.fxhits || 0) + 1; if (e.type === "hit") { log.dmg.push(e.dmg); log.scale.push(e.scale); } }
        g.p.forEach((p, i) => { if (p.inv > 0 && !invBefore[i]) log.inv++; });
        if (spec.trace) trace.push(g.p.map((p) => [Math.round(p.x), Math.round(p.y), Math.round(p.hp), p.state, +p.gauge.toFixed(1), +p.sv.toFixed(1), p.face, Object.keys(p.st).sort().join(","), p.st.shield ? Math.round(p.st.shield.v) : 0]));
      }
      return { log, trace, maxHp: g.p.map((p) => p.maxHp), dr: g.p.map((p) => p.dr), gauge: g.p.map((p) => +p.gauge.toFixed(1)), sv: g.p.map((p) => +p.sv.toFixed(1)), state: g.p.map((p) => p.state), face: g.p.map((p) => p.face), hp: g.p.map((p) => Math.round(p.hp)), x: g.p.map((p) => Math.round(p.x)), phase: g.phase, wins: g.wins.slice(), stats: Object.assign({}, g.stats), t: +g.t.toFixed(2) };
    },
    duel: () => ({ inited: !!D.inited, a: D.f[0] && D.f[0].r.id, b: D.f[1] && D.f[1].r.id, kind: D.type, mode: D.mode, seed: D.seed, settings: settingsToSaved(),
      state: D.cd != null ? "countdown" : D.playing ? "playing" : D.idle ? (D.pos > 0 ? "ended" : "idle") : "paused", pos: Math.floor(D.pos || 0),
      sysSfx: duelSfxList().filter((e) => e.sys).map((e) => e.sys + "@" + e.k).join(","), ko: D.ko,
      moves: (D.moves || []).map((m) => m.who + ":" + m.action + (m.repeat > 1 ? "x" + m.repeat : "")).join(","), len: D.len, result: D.resultText, winner: D.winner,
      dealt: [0, 1].map((i) => Math.round((D.events || []).filter((e) => e.attacker === i && e.target !== i && e.dmg > 0).reduce((t, e) => t + e.dmg, 0))),
      summons: (D.summons || []).map((x) => ({ side: x.side, id: x.copy ? "copy:" + x.src : x.f.r.id, k0: x.k0, k1: x.k1 })), sumCap: sumCap(), sumAtk: D.sumAtk, sumHp: D.sumHp,
      sumHit: (D.events || []).filter((e) => e.sumTarget && e.dmg > 0).length, sumKilled: (D.events || []).filter((e) => e.label === "擊倒召喚物").length,
      // 本人在自己有召喚物在場時被打中的次數（技能範圍會波及召喚物後面的本人）
      mainHitWithSum: (D.events || []).filter((e) => !e.sumTarget && e.dmg > 0 && (D.summons || []).some((x) => x.side === e.target && e.k >= x.k0 && e.k < x.k1)).length,
      ready: !!(D.f[0] && D.f[1]) && $("doverlay").hidden }),
    files: () => Object.keys(FILES.meta),
    offline: async (w, h, fps) => { const r = await offlineSupport(w, h, fps); return r ? `${r.vcfg.codec}+${r.acfg.codec}` : ""; },
    index: () => ({ total: S.index.length, custom: [...customIds] }),
    skill: (id, n) => { const sk = ((S.stats[id] || {}).sk || [])[n]; return sk ? { sums: skSums(sk).map((x) => x.id), cpy: !!sk.cpy } : null; },
  });
  $("reportBtn").onclick = async () => {
    $("reportText").value = "整理中…"; $("reportStatus").textContent = ""; $("reportCopy").disabled = true;
    openModal($("reportModal"));
    $("reportText").value = await reportInfo();
    $("reportCopy").disabled = false;
  };
  $("reportClose").onclick = () => closeModal($("reportModal"));
  $("reportCopy").onclick = () => {
    const text = $("reportText").value, ta = $("reportText");
    const ok = () => { $("reportStatus").textContent = "已複製，可以直接貼上。"; toast("已複製回報資訊"); };
    const fallback = () => {
      ta.removeAttribute("readonly"); ta.focus(); ta.select(); ta.setSelectionRange(0, text.length);
      let done = false; try { done = document.execCommand("copy"); } catch {}
      ta.setAttribute("readonly", ""); ta.blur();
      if (done) ok(); else { $("reportStatus").textContent = "這個瀏覽器不讓網頁自動複製，請長按上面的文字，全選後手動複製。"; ta.select(); }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fallback); else fallback();
  };

  /* ---------- 啟動 ---------- */
  (async () => {
    sfxControls($("sfxSingle"), () => SFX.cfg.single, "single", "");
    sfxVolControl($("sfxSingle"));
    sfxControls($("sfxDuel"), () => SFX.cfg.duel[0], "duel0", "左方");
    sfxControls($("sfxDuel"), () => SFX.cfg.duel[1], "duel1", "右方");
    sfxVolControl($("sfxDuel"));
    filesRestore();
    for (const id of ["sfxSingle", "sfxDuel"]) {
      const h = document.createElement("p"); h.className = "hint";
      h.textContent = "普攻在命中時播放；技能在發動和命中時各播一次，可以分別設定。錄影時會一起錄進去。上傳的音效會存在這台裝置，重新整理後不用再選。";
      $(id).appendChild(h);
    }
    // 太長的說明收起來，點「說明」才展開
    document.querySelectorAll("p.hint:not(.warn)").forEach((p) => {
      const txt = p.textContent.trim();
      if (p.closest(".modal")) return; // 彈出視窗裡的說明直接顯示
      if (p.id !== "dModeHint" && txt.length <= 60) return;
      const d = document.createElement("details"); d.className = "hint-fold";
      const sm = document.createElement("summary");
      const m = txt.match(/^([^：，。]{2,8})：/);
      sm.textContent = "說明" + (m ? "・" + m[1] : "");
      p.replaceWith(d); d.append(sm, p);
    });
    // 瀏覽器規定要先有點擊才能出聲：第一次點畫面時啟動音效
    sfxInit();
    sfxVolButtons();
    document.querySelectorAll(".sfx-unlock").forEach((b) => (b.onclick = () => sfxUnlock()));
    S.projOn = store.get("singleProj", true); $("singleProj").checked = S.projOn;
    setBg(store.get("bg", "white"));
    // 分享連結裡壓縮過的長資料，先解開
    if (URLP.get("d")) { try { Object.assign(URLD, await unpackD(URLP.get("d"))); } catch {} }
    await loadIndex();
    const want = store.get("unit", DEFAULT_UNIT);
    const pend = store.get("pendingSingle", null); store.set("pendingSingle", null);
    const urlApp = URLP.get("app");
    const urlUnit = urlApp === "single" && URLP.get("u") ? S.index.find((x) => x.id === URLP.get("u")) : null;
    const urlClip = urlUnit && CLIPS.some((c) => c.key === URLP.get("clip")) ? URLP.get("clip") : null;
    let r = urlUnit || S.index.find((x) => x.id === want) || S.index.find((x) => x.id === DEFAULT_UNIT) || S.index[0];
    $("q").value = r ? (urlUnit ? r.name : r.name.includes("風之痕") ? "風之痕" : r.name) : "";
    renderResults($("q").value);
    const pendOk = pend && !urlApp && r && r.id === want;
    if (r) await selectUnit(r, { clip: urlClip || (pendOk && pend.clip) || "skill1", part: pendOk ? pend.part : undefined });
    else showOverlay("目前無法讀取角色資料。", true);
    setMode("orig");
    // 分享連結帶了惡搞片段：還原並切到惡搞模式
    if (urlUnit && URLP.get("mode") === "remix") {
      const legacy = URLP.get("remix");
      try {
        if (URLD.s) { S.segs = segsFromDiff(URLD.s); segsChanged(); }
        else if (legacy) { S.segs = segsFromDiff(JSON.parse(b64u.dec(legacy))); segsChanged(); }
      } catch {}
      setMode("remix");
    }
    // 剛開啟的專案檔：還原零件設定、速度、模式
    if (pendOk) {
      if (pend.comps && typeof pend.comps === "object") { for (const k in pend.comps) if (S.comps[k]) S.comps[k] = Object.assign(defComp(), pend.comps[k]); buildComps(); }
      if (+pend.speed > 0) { S.speed = +pend.speed; if ($("speed")) { $("speed").value = S.speed; $("speed").dispatchEvent(new Event("input")); } }
      if (pend.mode === "remix") setMode("remix");
    }
    if (S.part) histReset(); // 分享連結或專案檔還原的狀態當作起點
    setApp(["duel", "single", "fight"].includes(urlApp) ? urlApp : store.get("app", "single"));
    S.urlSync.on = true; syncUrl();
    const pt = store.get("pendingToast", null);
    if (pt) { store.set("pendingToast", null); setTimeout(() => toast(pt), 600); }
    requestAnimationFrame(loop);
  })();
