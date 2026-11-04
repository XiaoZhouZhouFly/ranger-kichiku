  /* ---------- 格鬥場：連線層（v6） ----------
     線上對戰用「延遲輸入的 lockstep」：
       - 每一格的輸入不是馬上用，而是排到 delay 格之後才用（自己的立刻送給對方）。
       - 要推進第 N 格時，雙方第 N 格的輸入都到了才走（fightStep）；對方的還沒到就停下來等（畫面會頓一下）。
       - 因為引擎是確定性的，只要雙方輸入一樣，畫面就一定一樣，不用傳遊戲狀態。
     現在（v6 第 2 步）只有「假網路」：對方（右方的電腦或第 2 位玩家）的輸入照設定的網路延遲、抖動晚一點才「到」，
     用來先試手感、找適合的延遲格數。之後的 Firebase／WebRTC 連線只要換掉 send／收到的那一段。 */
  const NET_DELAYS = [0, 2, 3, 4, 5, 6, 8];         // 輸入延遲（格；1 格＝1/60 秒≈16.7ms）
  const NET_LATS = [0, 50, 100, 150, 250];           // 假網路：單程延遲（毫秒）
  const NET_JITS = [0, 30, 60];                      // 假網路：每包額外隨機延遲 0～這麼多（毫秒）

  // 輸入整數化：線上對戰要把輸入原封不動送給對方，拖曳距離不能帶小數（各裝置螢幕不同）
  function netQuant(inp) {
    return { mx: inp.mx | 0, jump: !!inp.jump, guard: !!inp.guard, atk: !!inp.atk, skDown: inp.skDown.map(Boolean), skUp: inp.skUp.map(Boolean),
      skCancel: inp.skCancel.map(Boolean), skAim: inp.skAim.map((v) => (v == null ? null : Math.round(v))) };
  }
  /* 輸入壓成小陣列再送出：[mx, 按鍵位元, 拖曳0, 拖曳1, 拖曳2]（位元：跳、防、普攻、按下×3、放開×3、取消×3） */
  function netPack(i) {
    let b = (i.jump ? 1 : 0) | (i.guard ? 2 : 0) | (i.atk ? 4 : 0);
    for (let s = 0; s < 3; s++) b |= (i.skDown[s] ? 8 << s : 0) | (i.skUp[s] ? 64 << s : 0) | (i.skCancel[s] ? 512 << s : 0);
    return [i.mx, b, ...i.skAim];
  }
  function netUnpack(a) {
    const b = a[1], i = fightBlankInput();
    i.mx = a[0]; i.jump = !!(b & 1); i.guard = !!(b & 2); i.atk = !!(b & 4);
    for (let s = 0; s < 3; s++) { i.skDown[s] = !!(b & (8 << s)); i.skUp[s] = !!(b & (64 << s)); i.skCancel[s] = !!(b & (512 << s)); i.skAim[s] = a[2 + s] ?? null; }
    return netQuant(i);
  }
  /* 開打時建立：delay＝輸入延遲格數；lat／jit＝假網路的延遲與抖動（毫秒）。
     link（線上對戰）：{ send(訊息) }，收到對方的訊息時呼叫 netRecv；me＝自己是哪一方（0 左、1 右） */
  function netNew(delay, lat, jit, link = null, me = 0) {
    const n = { delay, lat, jit, link, me, frame: 0, q: [new Map(), new Map()], inflight: [], stalls: 0, stallFrames: 0, waiting: false, hash: [new Map(), new Map()], desync: null };
    for (let f = 0; f < delay; f++) for (const s of [0, 1]) n.q[s].set(f, netQuant(fightBlankInput())); // 一開始的 delay 格是空輸入
    return n;
  }
  // 線上對戰：收到對方的訊息（i＝某一格的輸入、h＝某一格的狀態雜湊）
  function netRecv(n, m) {
    const other = 1 - n.me;
    if (m.t === "i") n.q[other].set(m.f, netUnpack(m.i));
    if (m.t === "h") { n.hash[other].set(m.f, m.h); netCheckHash(n, m.f); }
  }
  // 每 60 格互傳一次狀態雜湊，對得上就丟掉；對不上＝不同步
  const NET_HASH_EVERY = 60;
  function netAfterStep(n, g) {
    if (!n.link || n.frame % NET_HASH_EVERY) return;
    const h = fightStateHash(g);
    n.hash[n.me].set(n.frame, h); n.link.send({ t: "h", f: n.frame, h });
    netCheckHash(n, n.frame);
  }
  function netCheckHash(n, f) {
    const a = n.hash[0].get(f), b = n.hash[1].get(f);
    if (a == null || b == null) return;
    if (a !== b && !n.desync) n.desync = { f, a, b };
    n.hash[0].delete(f); n.hash[1].delete(f);
  }
  /* 試著推進一格：produce(side)＝讀這一方現在的輸入。回傳雙方這一格的輸入，或 null（還在等對方）。
     線上：自己的輸入排進佇列並送給對方，對方的由 netRecv 放進來。
     單機：左方是自己；右方當成「遠端」，經過假網路（lat／jit）才進佇列。 */
  function netStep(n, produce, now) {
    const at = n.frame + n.delay;
    if (n.link) {
      if (!n.q[n.me].has(at)) { const inp = netQuant(produce(n.me)); n.q[n.me].set(at, inp); n.link.send({ t: "i", f: at, i: netPack(inp) }); }
    } else if (!n.q[0].has(at)) {
      n.q[0].set(at, netQuant(produce(0)));
      const remote = netQuant(produce(1));
      if (!n.lat && !n.jit) n.q[1].set(at, remote);
      else n.inflight.push({ f: at, inp: remote, arrive: now + n.lat + Math.random() * n.jit });
    }
    for (let i = n.inflight.length - 1; i >= 0; i--) if (n.inflight[i].arrive <= now) { n.q[1].set(n.inflight[i].f, n.inflight[i].inp); n.inflight.splice(i, 1); }
    if (n.desync || !n.q[0].has(n.frame) || !n.q[1].has(n.frame)) {
      if (!n.waiting) n.stalls++;
      n.waiting = true; n.stallFrames++;
      return null;
    }
    n.waiting = false;
    const inputs = [n.q[0].get(n.frame), n.q[1].get(n.frame)];
    n.q[0].delete(n.frame); n.q[1].delete(n.frame); n.frame++;
    return inputs;
  }
  // 畫面上的小字
  const netLabel = (n) => `${n.link ? (n.link.kind === "relay" ? "轉送模式・" : "直連・") : ""}延遲 ${n.delay} 格${n.lat || n.jit ? `・假網路 ${n.lat}ms${n.jit ? `±${n.jit}` : ""}` : ""}・卡頓 ${n.stalls} 次${n.waiting ? "・等待對手…" : ""}`;

  /* 同步檢查：固定種子、固定角色，電腦對打 6 場，每 60 格把遊戲狀態混進雜湊。
     不同裝置算出同一組代碼＝計算結果完全一樣（線上對戰的前提）。角色挑會用到各種效果的。 */
  const NET_SYNC_MATCHES = [
    ["x001-cube", "x002-orb"],           // 自製角色：近戰、矩形、投射物、拋物線
    ["u1009e-sally", "u1004e-sally"],     // 召喚、對手複製體
    ["u1021e-pink", "u1015h-sally"],      // 擊飛撞牆、持續傷害
    ["u099u-alice", "u1418e-moon"],       // 變形、泡泡
    ["u1216e-towa", "u1116h-claris"],     // 突進、魅惑、沉默
    ["u1617h-ka", "u1065e-cony"],         // 恐懼、變大、擊退
  ];
  async function netSyncCheck(onProgress) {
    await Promise.all([ensureStats(), ensureSkillFx()]);
    const hex = (h) => (h >>> 0).toString(16).padStart(8, "0");
    const rows = [];
    let all = 2166136261;
    for (const [c0, c1] of NET_SYNC_MATCHES) {
      if (!S.index.some((r) => r.id === c0) || !S.index.some((r) => r.id === c1)) { rows.push({ c0, c1, skip: true }); continue; }
      const f = await Promise.all([fightLoad(c0), fightLoad(c1)]), fs = f.map(fightStats), extra = await fightPrepareExtra(f);
      const g = fightNew({ f, fs, extra, rounds: 1, secs: 60, mode: "cpu", seed: 4242, holdMove: true, teleMode: "sync" });
      g.phase = "fight"; g.phaseT = 1;
      const mem = [{}, {}];
      const sh = fs.map(fightStatsHash); // 開打前算（對戰中有些效果會改到數值物件）
      let h = fightHashNums(2166136261, sh);
      for (let k = 0; k < 3600 && g.phase !== "over"; k++) {
        fightStep(g, [0, 1].map((s) => netQuant(fightAi(g, s, "hard", mem[s]))));
        if (k % 60 === 59) h = fightStateHash(g, h);
      }
      h = fightStateHash(g, h);
      all = fightHashNums(all, [h]);
      rows.push({ c0, c1, stats: sh.map(hex), hash: hex(h), hp: g.p.map((p) => Math.round(p.hp)), t: +g.t.toFixed(2) });
      if (onProgress) onProgress(rows.length, NET_SYNC_MATCHES.length);
    }
    const code = hex(all).toUpperCase();
    return { code: code.slice(0, 4) + "-" + code.slice(4), rows };
  }
