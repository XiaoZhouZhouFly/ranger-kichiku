  /* ---------- 格鬥場（v5.0 測試版）：選角、畫面、觸控、回合 ----------
     畫布寬 720、高度隨手機比例（直拿）。一人：上面血條、中間場地、下面按鈕。
     兩人：上下各半畫同一場（上半轉 180 度給對面的人看），中央共用血條；每人在自己那半邊操作。 */
  const fcv = $("fcv"), fctx = fcv.getContext("2d");
  // 畫布寬固定 720，高度跟著手機螢幕比例（16:9～21:9），整個螢幕都用上
  let FW = 720; // 畫布寬：直向固定 720；橫向（v7.0）依螢幕比例 1100～1700，高固定 720
  let FH = 1280;
  const FG = {
    g: null, f: [null, null], fs: [null, null], acc: 0, cache: new Map(), compat: new Map(), ready: false, ai: [{}, {}], running: false,
    set: Object.assign({ mode: "dummy", level: "normal", dummy: "standing", c0: "x001-cube", c1: "x002-orb", rounds: 3, secs: 60, showRange: true, showBox: true, holdMove: false, teleMode: "dist" }, store.get("fight", {})),
    ctl: [null, null], keys: new Set(),
    // 測試用：網址加 ?fightbot=normal 讓左方也由電腦操作（看電腦互打）
    bots: [["easy", "normal", "hard"].includes(new URLSearchParams(location.search).get("fightbot")) ? new URLSearchParams(location.search).get("fightbot") : null, null],
  };
  const fightSave = () => store.set("fight", FG.set);

  /* 版面：一人／兩人；兩人時每個人用「自己的座標」（下半部），上半部那位畫的時候整個轉 180 度 */
  function fightLayout() {
    if (FG.set.mode === "pvp") { const m = FH / 2, ch = 274; return { pvp: true, view: { y: m + 36, h: FH - ch - m - 36, ground: 52 }, ctrl: { y: FH - ch, h: ch }, hud: { y: m - 36, h: 72 } }; }
    // 橫向（v7.0）：整個畫面都是場地，按鈕半透明疊在下方的地板區（ctrl 只是觸控範圍，不畫底色）
    if (FG.land) return { pvp: false, land: true, view: { y: 110, h: FH - 110, ground: 190 }, ctrl: { y: FH - 300, h: 300 }, hud: { y: 0, h: 110 } };
    const ch = 410; return { pvp: false, view: { y: 150, h: FH - ch - 150, ground: 110 }, ctrl: { y: FH - ch, h: ch }, hud: { y: 0, h: 150 } };
  }
  /* 鏡頭（v7.0）：場地 1500 寬放不進畫面，改成跟著兩人移動、縮放。
     fScale＝畫面上 1 個場地單位幾個像素（每幀由鏡頭決定，只影響畫面）；FS_IN＝觸控拖曳換算用的固定比例（手感不隨鏡頭縮放改變）。
     CAM：MAX_VIEW＝最多縮到看得到多寬（1500＝整張地圖）、MIN_VIEW＝最近時看多寬（兩人靠很近時不再放大）、PAD＝兩人外側各留多少、EASE＝每幀追上目標的比例 */
  // PAD 160：開場兩人相距 440，畫面剛好框住 440 + 160×2 ＝ 760（直向、橫向都一樣）
  const CAM = { MAX_VIEW: 1500, MIN_VIEW: 760, PAD: 160, EASE: 0.12, TOP: 1.4 }; // TOP＝角色頭上要留幾個身高（含狀態字）；放不下就鏡頭往上跟
  const FS_IN = 720 / 760;
  let fScale = FW / CAM.MIN_VIEW;
  function fightCamUpdate(g, L, snap) {
    const a = g.p[0].x, b = g.p[1].x, want = fclamp(Math.abs(a - b) + CAM.PAD * 2, CAM.MIN_VIEW, CAM.MAX_VIEW);
    const view = Math.min(want, FT.AW); // 看到的場地寬
    let cx = (a + b) / 2;
    if (Math.abs(a - b) + CAM.PAD > view) cx = g.p[FG.set.mode === "online" ? FG.me || 0 : 0].x; // 兩人太遠放不下：以自己為中心
    cx = fclamp(cx, -FT.AW / 2 + view / 2, FT.AW / 2 - view / 2);              // 不看到牆外太多
    const cam = FG.cam || (FG.cam = { x: cx, view });
    if (snap) { cam.x = cx; cam.view = view; } else { cam.x += (cx - cam.x) * CAM.EASE; cam.view += (view - cam.view) * CAM.EASE; }
    fScale = FW / cam.view;
    // 上下也會跟（v7.0）：橫向畫面矮，有人跳高、頭上的字快超出畫面時，鏡頭往上移；落地再回來
    const room = (L.view.h - L.view.ground - 8) / fScale, top = Math.max(...g.p.map((p) => p.y)) + FT.CH * CAM.TOP;
    const ty = Math.max(0, top - room);
    cam.y = snap || cam.y == null ? ty : cam.y + (ty - cam.y) * 0.2;
  }
  /* 按鈕位置（自己的座標；兩人模式的上半部整個轉 180 度）
     左手：一整條左右移動（左半邊＝◀、右半邊＝▶，left／right 是兩半的中心與大小）
     右手：普攻（最大）、技能 1、技能 2、跳（右上角）、防（右下角）；r＝圓形按鈕半徑 */
  function fightButtons(L) {
    if (L.land) { // 橫向（v7.0）：左下移動、右下攻擊群（貼著右邊緣，跟直向同樣的相對位置）
      const by = FH - 95, R0 = FW;
      return {
        left: { x: 105, y: by, w: 150, h: 130, r: 65 }, right: { x: 265, y: by, w: 150, h: 130, r: 65 },
        atk: { x: R0 - 175, y: FH - 150, r: 66 },
        sk0: { x: R0 - 305, y: FH - 85, r: 50 }, sk1: { x: R0 - 300, y: FH - 225, r: 50 },
        up: { x: R0 - 60, y: FH - 245, r: 40 }, down: { x: R0 - 60, y: FH - 60, r: 40 },
      };
    }
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

  /* 衝刺速度線（v7.0）：身後幾條短短的白線，位置跟著時間往後流動 */
  function fightSpeedLines(c, p, X, Y) {
    c.save(); c.strokeStyle = "rgba(255,255,255,0.75)"; c.lineCap = "round"; c.lineWidth = Math.max(2, 4 * fScale);
    for (let n = 0; n < 4; n++) {
      const ph = (p.anim.t * 3 + n * 0.37) % 1, back = 30 + ph * 50, len = 26 + (n % 2) * 16; // 從身後往後流、越流越淡
      const y = Y(p.y + FT.CH * (0.22 + n * 0.16)), x0 = X(p.x - p.face * back), x1 = X(p.x - p.face * (back + len));
      c.globalAlpha = 1 - ph; c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke();
    }
    c.restore();
  }
  /* ---------- 鏡像（v6.1） ----------
     線上對戰的加入者（右方）畫面左右對調，看到自己在左邊。只改「怎麼畫」和「按鍵怎麼翻譯」：
     送出去的按鍵、遊戲計算都用場上真正的方向，所以雙方結果一樣。FG.mirror 在開打時設定。 */
  const fightM = () => (FG.mirror ? -1 : 1);
  const fightFlip = (face) => face * fightM() < 0; // 角色圖要不要左右翻
  /* ---------- 按鈕圖案（v5.5）：程式畫的白色線條圖；技能用原作的技能圖標 ---------- */
  // 盾牌（防禦）：x, y＝中心，s＝大小
  function fightIconShield(c, x, y, s, ink) {
    c.save(); c.strokeStyle = ink; c.lineWidth = Math.max(3, s * 0.09); c.lineJoin = "round";
    c.beginPath(); c.moveTo(x, y - s * 0.5); c.lineTo(x + s * 0.4, y - s * 0.34); c.lineTo(x + s * 0.36, y + s * 0.08);
    c.quadraticCurveTo(x + s * 0.28, y + s * 0.36, x, y + s * 0.52); c.quadraticCurveTo(x - s * 0.28, y + s * 0.36, x - s * 0.36, y + s * 0.08);
    c.lineTo(x - s * 0.4, y - s * 0.34); c.closePath(); c.stroke();
    c.beginPath(); c.moveTo(x, y - s * 0.32); c.lineTo(x, y + s * 0.34); c.stroke();
    c.restore();
  }
  // 朝上的箭頭（跳）
  function fightIconUp(c, x, y, s, ink) {
    c.save(); c.strokeStyle = ink; c.lineWidth = Math.max(4, s * 0.12); c.lineCap = "round"; c.lineJoin = "round";
    c.beginPath(); c.moveTo(x, y + s * 0.45); c.lineTo(x, y - s * 0.4); c.moveTo(x - s * 0.36, y - s * 0.06); c.lineTo(x, y - s * 0.45); c.lineTo(x + s * 0.36, y - s * 0.06); c.stroke();
    c.restore();
  }
  // 劍（普攻）：斜放，劍尖朝右上
  function fightIconSword(c, x, y, s, ink) {
    c.save(); c.translate(x, y); c.rotate(-Math.PI / 4); c.strokeStyle = ink; c.fillStyle = ink; c.lineCap = "round"; c.lineJoin = "round";
    c.lineWidth = Math.max(3, s * 0.06);
    c.beginPath(); c.moveTo(-s * 0.05, -s * 0.12); c.lineTo(-s * 0.05, -s * 0.5); c.lineTo(0, -s * 0.58); c.lineTo(s * 0.05, -s * 0.5); c.lineTo(s * 0.05, -s * 0.12); c.closePath(); c.stroke(); // 劍身
    c.beginPath(); c.moveTo(-s * 0.2, -s * 0.1); c.lineTo(s * 0.2, -s * 0.1); c.stroke();                    // 護手
    c.beginPath(); c.moveTo(0, -s * 0.08); c.lineTo(0, s * 0.14); c.stroke();                                  // 握柄
    c.beginPath(); c.arc(0, s * 0.18, s * 0.045, 0, Math.PI * 2); c.fill();                                    // 柄頭
    c.restore();
  }
  // 技能圖標：第一次用到時開始載入，載好之前回傳 null（先畫文字）
  const FIGHT_ICON_IMG = new Map();
  function fightSkillIcon(k) {
    if (!k || !k.icon) return null;
    let im = FIGHT_ICON_IMG.get(k.icon);
    if (!im) { im = new Image(); im.src = skillIconUrl(k.icon); FIGHT_ICON_IMG.set(k.icon, im); }
    return im.complete && im.naturalWidth ? im : null;
  }

  /* ---------- 選角畫面（v5.5：開放全部角色，跟雙人對打一樣用搜尋／角色庫／隨機） ---------- */
  // 介面上藏起來的設定，固定用這兩個值（舊存檔、分享連結裡的值也不採用）；要開回來：body.html 的 fOptBox 拿掉 hidden，這裡設成 null
  const FIGHT_FIXED_OPTS = { holdMove: true, teleMode: "sync" };
  const COMPAT_LABEL = { ok: "✓ 完整", guess: "？ 有推測", unsup: "⚠ 部分不支援", unfit: "✕ 不適合" };
  // 快速相容性判斷（不下載動畫檔）→ { lvl: ok／guess／unsup／unfit, why }；選好角色後的說明才用真正的動畫判斷
  function fightCompatOf(r) {
    if (FG.compat.has(r.id)) return FG.compat.get(r.id);
    const N = normUnit(r, NORM_ALL_ANIMS), has = (l) => N.issues.filter((x) => x.lvl === l);
    const bad = has("unfit"), uns = has("unsupported"), gs = has("guess");
    const c = bad.length ? { lvl: "unfit", why: bad.map((x) => x.msg).join("、") } : uns.length ? { lvl: "unsup", why: uns.map((x) => `${x.where}：${x.msg}`).join("、") }
      : gs.length ? { lvl: "guess", why: gs.map((x) => `${x.where}：${x.msg}`).join("、") } : { lvl: "ok", why: "" };
    FG.compat.set(r.id, c);
    return c;
  }
  // 卡片加上相容性標示；不適合的變灰、點了只顯示原因
  function fightDeco(r, card) {
    const c = fightCompatOf(r), tag = document.createElement("div");
    tag.className = "compat " + c.lvl; tag.textContent = COMPAT_LABEL[c.lvl]; card.appendChild(tag);
    if (c.why) card.title = `${r.name}：${c.why}`;
    if (c.lvl === "unfit") {
      card.classList.add("locked");
      card.addEventListener("click", (e) => { e.stopImmediatePropagation(); tag.textContent = c.why; }, { capture: true });
    }
  }
  const fightPool = (exclude) => S.index.filter((r) => r.id !== exclude && r.name && r.name !== r.id && fightCompatOf(r).lvl !== "unfit");
  // 卡片 i 上的角色：線上對戰時右邊卡片＝對手選的角色
  const fightCardId = (i) => (FG.set.mode === "online" && i === 1 ? FG.olOpp || null : FG.set["c" + i]);
  function fightPanel(i) {
    const r = S.index.find((x) => x.id === fightCardId(i));
    $(`fname${i}`).textContent = r ? r.name : "未選擇";
    document.querySelectorAll(".fight-pick .fighter")[i].classList.toggle("picked", !!r); // 選好了：外框亮起來
    const comp = $(`fcomp${i}`), c = r ? fightCompatOf(r) : null;
    comp.className = "compat" + (c ? " " + c.lvl : ""); comp.textContent = c ? COMPAT_LABEL[c.lvl] : ""; comp.title = c ? c.why : "";
    const th = $(`fthumb${i}`); th.textContent = "";
    if (r) { const img = document.createElement("img"); img.alt = ""; const urls = thumbUrls(r.id); let n = 0; img.onerror = () => { if (++n < urls.length) img.src = urls[n]; }; img.src = urls[0]; th.appendChild(img); }
  }
  function fightSetChar(i, r) {
    if (!r) return;
    FG.set["c" + i] = r.id; fightSave(); fightPanel(i); fightInfo(i);
    if (i === 0 && FG.set.mode === "online") olMyPick(); // 線上：換角色＝重新準備
  }
  function fightSearch(i) {
    const q = $(`fq${i}`).value.trim(), box = $(`fr${i}`);
    box.textContent = "";
    if (!q) return;
    const list = S.index.filter((r) => (r.name || "").includes(q) || r.id.includes(q.toLowerCase())).slice(0, 40);
    if (!list.length) { box.innerHTML = `<p class="hint">找不到「${escapeHtml(q)}」。</p>`; return; }
    for (const r of list) {
      const card = unitCard(r, () => { fightSetChar(i, r); box.textContent = ""; $(`fq${i}`).value = ""; }, { select: false });
      fightDeco(r, card); box.appendChild(card);
    }
  }
  function fightOpenLib(i) {
    openLibPick($("fLibHolder"), i ? "角色庫・選擇右方" : "角色庫・選擇左方", (r) => fightSetChar(i, r),
      { deco: fightDeco, featured: true, extra: (list) => ($("libFeat").checked ? FIGHT_ROSTER.map(([id]) => S.index.find((r) => r.id === id)).filter(Boolean) : list) });
  }
  function fightRandom(i) { const pool = fightPool(FG.set["c" + (1 - i)]); if (pool.length) fightSetChar(i, pool[Math.floor(Math.random() * pool.length)]); }
  async function fightLoad(id) {
    if (FG.cache.has(id)) return FG.cache.get(id);
    const r = S.index.find((x) => x.id === id);
    if (!r) throw new Error("找不到角色 " + id);
    const f = await loadFighter(r);
    FG.cache.set(id, f);
    return f;
  }
  /* 開打前多載入的角色：召喚物、變形後的外觀（找不到就略過，到時候退回替代做法）
     回傳 [{ sum: {id: 角色}, poly: 角色|null }, …]（兩邊各一個），放進 cfg.extra */
  async function fightPrepareExtra(f) {
    const one = async (id) => { try { return await fightLoad(id); } catch { return null; } };
    return Promise.all(f.map(async (x) => {
      const ids = [...new Set([0, 1].flatMap((s) => fightSummonIds(x.r.id, s)))], sum = {};
      for (const id of ids) { const u = await one(id); if (u) sum[id] = u; }
      const pid = fightPolyFormId(x.r.id);
      return { sum, poly: pid ? await one(pid) : null };
    }));
  }
  async function fightInfo(i) {
    const id = fightCardId(i), box = $(`fInfo${i}`);
    if (!id) { box.textContent = FG.set.mode === "online" ? "對手還沒選角色" : ""; return; }
    box.textContent = "讀取中…";
    try {
      const f = await fightLoad(id), fs = fightStats(f);
      if (fightCardId(i) !== id) return; // 讀取途中換了角色
      box.textContent = "";
      const brief = document.createElement("div"); brief.className = "f-brief"; for (const t of fightBrief(fs)) { const sp = document.createElement("span"); sp.textContent = t; brief.appendChild(sp); }
      const det = document.createElement("details"), sum = document.createElement("summary"), body = document.createElement("div");
      det.className = "f-detail"; sum.textContent = "詳細"; body.textContent = fightSummary(fs); det.append(sum, body);
      box.append(brief, det);
    }
    catch (e) { box.textContent = "讀取失敗：" + (e.message || e); }
  }
  function fightSetupUi() {
    const st = FG.set;
    document.querySelectorAll("#fMode .chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.fmode === st.mode)));
    document.querySelectorAll("#fLevel .chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.flevel === st.level)));
    document.querySelectorAll("#fOrient .chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.forient === (st.orient || "auto"))));
    document.querySelectorAll("#fDummy .chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.fdummy === st.dummy)));
    const opt = FIGHT_FIXED_OPTS || st;
    document.querySelectorAll("#fHoldMove .chip").forEach((c) => c.setAttribute("aria-pressed", String((c.dataset.fhold === "move") === !!opt.holdMove)));
    document.querySelectorAll("#fTeleMode .chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.ftele === (opt.teleMode === "sync" ? "sync" : "dist"))));
    $("fCpuBox").hidden = st.mode !== "cpu"; $("fDummyBox").hidden = st.mode !== "dummy";
    const online = st.mode === "online";
    $("fRoundBox").hidden = st.mode === "dummy" || (online && OL.code && OL.side === 1);
    $("fOnlineBox").hidden = !online; document.querySelector(".fight-start-bar").hidden = online; $("fNetBox").hidden = online;
    document.querySelector(".fighter.is-b .f-search").hidden = online; $("fSwap").hidden = online; $("fRandAll").hidden = online;
    if (online) olUi(); else if (OL.code) olLeave();
    for (const i of [0, 1]) { fightPanel(i); }
    $("fRight").textContent = st.mode === "pvp" ? "右方（玩家 2）" : st.mode === "cpu" ? "右方（電腦）" : online ? "對手" : "右方（木樁）";
    document.querySelector(".fighter.is-a .side-tag").textContent = online ? "你" : "左方（玩家 1）";
    $("fRounds").value = String(st.rounds); $("fSecs").value = String(st.secs); $("fShowRange").checked = st.showRange !== false; $("fShowBox").checked = st.showBox !== false;
  }
  async function initFight() {
    if (FG.inited) return; FG.inited = true;
    await Promise.all([ensureStats(), ensureSkillFx()]);
    // 存檔裡的角色不在資料裡（或不適合）就換回預設
    for (const i of [0, 1]) { const r = S.index.find((x) => x.id === FG.set["c" + i]); if (!r || fightCompatOf(r).lvl === "unfit") FG.set["c" + i] = i ? "x002-orb" : "x001-cube"; }
    FG.ready = true;
    if (FG.set.mode === "online" && !new URLSearchParams(location.search).get("room")) FG.set.mode = "dummy"; // 線上對戰要重新開房，不保留
    fightSetupUi(); for (const i of [0, 1]) { fightPanel(i); fightInfo(i); }
    olAutoJoin();
  }
  document.querySelectorAll("#fMode .chip").forEach((c) => (c.onclick = () => { FG.set.mode = c.dataset.fmode; fightSave(); fightSetupUi(); fightInfo(1); }));
  document.querySelectorAll("#fOrient .chip").forEach((c) => (c.onclick = () => { FG.set.orient = c.dataset.forient; fightSave(); fightSetupUi(); }));
  document.querySelectorAll("#fLevel .chip").forEach((c) => (c.onclick = () => { FG.set.level = c.dataset.flevel; fightSave(); fightSetupUi(); }));
  document.querySelectorAll("#fDummy .chip").forEach((c) => (c.onclick = () => { FG.set.dummy = c.dataset.fdummy; fightSave(); fightSetupUi(); }));
  document.querySelectorAll("#fHoldMove .chip").forEach((c) => (c.onclick = () => { FG.set.holdMove = c.dataset.fhold === "move"; fightSave(); fightSetupUi(); }));
  document.querySelectorAll("#fTeleMode .chip").forEach((c) => (c.onclick = () => { FG.set.teleMode = c.dataset.ftele; fightSave(); fightSetupUi(); }));
  for (const i of [0, 1]) {
    let t; $(`fq${i}`).addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => fightSearch(i), 250); });
    $(`fq${i}`).addEventListener("keydown", (e) => { if (e.key === "Enter") fightSearch(i); });
  }
  document.querySelectorAll("[data-flib-side]").forEach((b) => (b.onclick = () => fightOpenLib(+b.dataset.flibSide)));
  document.querySelectorAll("[data-frand-side]").forEach((b) => (b.onclick = () => fightRandom(+b.dataset.frandSide)));
  $("fRandAll").onclick = () => { fightRandom(0); fightRandom(1); };
  $("fSwap").onclick = () => { [FG.set.c0, FG.set.c1] = [FG.set.c1, FG.set.c0]; fightSave(); for (const i of [0, 1]) { fightPanel(i); fightInfo(i); } };
  // v6 測試：同步檢查
  $("fSyncRun").onclick = async () => {
    const out = $("fSyncOut"), btn = $("fSyncRun"); btn.disabled = true; out.textContent = "計算中…";
    try {
      const r = await netSyncCheck((i, n) => (out.textContent = `計算中…（${i}／${n}）`));
      out.textContent = `代碼 ${r.code}（${r.rows.filter((x) => !x.skip).length} 場${r.rows.some((x) => x.skip) ? `，${r.rows.filter((x) => x.skip).length} 場缺角色資料略過` : ""}）`;
    } catch (e) { out.textContent = "失敗：" + (e.message || e); }
    btn.disabled = false;
  };
  // v6 測試：輸入延遲與假網路
  const netSel = (id, key, list, fmt) => {
    const el = $(id); el.textContent = "";
    for (const v of list) { const o = document.createElement("option"); o.value = v; o.textContent = fmt(v); el.appendChild(o); }
    el.value = String(FG.set[key] || 0); el.onchange = () => { FG.set[key] = +el.value; fightSave(); };
  };
  netSel("fNetDelay", "netDelay", NET_DELAYS, (v) => (v ? `${v} 格（約 ${Math.round(v * 1000 / 60)}ms）` : "0（不延遲）"));
  netSel("fNetLat", "netLat", NET_LATS, (v) => (v ? `${v}ms` : "無"));
  netSel("fNetJit", "netJit", NET_JITS, (v) => (v ? `0～${v}ms` : "無"));
  $("fShowRange").onchange = () => { FG.set.showRange = $("fShowRange").checked; fightSave(); };
  $("fShowBox").onchange = () => { FG.set.showBox = $("fShowBox").checked; fightSave(); };
  $("fRounds").onchange = () => { FG.set.rounds = Math.max(1, Math.min(9, +$("fRounds").value || 3)); fightSave(); };
  $("fSecs").onchange = () => { FG.set.secs = Math.max(20, Math.min(300, Math.round(+$("fSecs").value || 60))); $("fSecs").value = FG.set.secs; fightSave(); };
  /* ---------- 開始／結束 ---------- */
  async function fightStart() {
    $("fStart").disabled = true; $("fStartMsg").textContent = "載入角色中…";
    try {
      const f = await Promise.all([fightLoad(FG.set.c0), fightLoad(FG.set.c1)]);
      FG.f = f; FG.fs = f.map(fightStats);
      for (const x of FG.fs) for (const k of x.sk) fightSkillIcon(k); // 先開始載入技能圖標
      const extra = await fightPrepareExtra(f);
      const mode = FG.set.mode;
      FG.g = fightNew({ f, fs: FG.fs, extra, rounds: mode === "dummy" ? 1 : FG.set.rounds, secs: mode === "dummy" ? 0 : FG.set.secs, mode, seed: newSeed(100000),
        holdMove: !!(FIGHT_FIXED_OPTS || FG.set).holdMove, teleMode: (FIGHT_FIXED_OPTS || FG.set).teleMode === "sync" ? "sync" : "dist" });
      FG.ai = [{}, {}]; FG.acc = 0; FG.ctl = [fightCtl(), fightCtl()]; FG.mirror = false; FG.cam = null; FG.pauseUntil = 0;
      FG.net = netNew(FG.set.netDelay || 0, FG.set.netLat || 0, FG.set.netJit || 0);
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
    if (FG.set.mode === "online") { olAfterGame(); if (FG.net) FG.net.link = null; } // 中途離開：不再送按鍵
  }
  $("fStart").onclick = fightStart;
  $("fExit").onclick = fightStop;
  $("fBack").onclick = fightStop;
  $("fAgain").onclick = () => {
    if (FG.set.mode !== "online") return fightStart();
    if (FG.olGone || !OL.link) return fightStop(); // 對手已離開：回設定頁
    olReady(true); $("fOverText").textContent += "　（等待對手按「再一場」…）"; // 雙方都按了，房主就會喊開打
  };
  /* 畫面方向（v7.0）：auto＝手機轉橫就用橫向版面；port／land＝固定。兩人同機一律直向（上下對坐）。電腦（寬螢幕）在 auto 時用橫向 */
  const fightWantLand = () => FG.set.mode !== "pvp" && (FG.set.orient === "land" || (FG.set.orient !== "port" && window.innerWidth > window.innerHeight));
  function fightResize() {
    const vw = window.innerWidth, vh = window.innerHeight, land = fightWantLand();
    if (FG.running && FG.land !== undefined && land !== FG.land) fightRotated();
    FG.land = land;
    if (land) { FH = 720; FW = Math.round(fclamp(FH * vw / Math.max(1, vh), 1100, 1700)); }
    else { FW = 720; FH = Math.round(fclamp(FW * vh / Math.max(1, vw), 1280, 1560)); }
    if (fcv.width !== FW) fcv.width = FW;
    if (fcv.height !== FH) fcv.height = FH;
    const w = Math.min(vw, vh * FW / FH);
    fcv.style.width = w + "px"; fcv.style.height = (w * FH / FW) + "px";
  }
  /* 對戰中轉向：瀏覽器常常不會告訴我們手指放開了，所以把按住中的按鍵、瞄準都當成「取消放開」；
     單人模式順便暫停 0.5 秒讓人重新握好手機（線上對戰不能停） */
  function fightRotated() {
    for (const c of FG.ctl) {
      if (!c) continue;
      for (const [key, s] of Object.entries(SLOT_OF)) if (c.btn[key]) { c.skUp[s] = true; c.skCancelAt[s] = true; }
      c.btn = {}; c.pads.clear();
    }
    fTouches.clear(); FG.keys.clear();
    if (FG.set.mode !== "online") FG.pauseUntil = performance.now() + 500;
  }
  window.addEventListener("resize", () => { if (FG.running) fightResize(); });

  /* ---------- 觸控 ----------
     每一根手指記住它屬於哪位玩家、按的是什麼（搖桿／普攻／技能）。座標一律換成「該玩家自己的座標」：
     上半部那位（兩人模式的玩家 2）把畫布轉 180 度來看。 */
  // 每位玩家的觸控狀態：pads＝方向鍵（手指 → 哪一顆），btn＝按住中的普攻／技能（手指位置），以及這一步要送出的「按下／放開」
  const RUN_TAP = 260; // 連點兩下方向鍵算衝刺的間隔（毫秒）
  const fightCtl = () => ({ run: null, lastTap: null, pads: new Map(), btn: {}, jump: false, atk: false, skDown: [false, false, false], skUp: [false, false, false], skCancelAt: [false, false, false] });
  const SLOT_OF = { sk0: 0, sk1: 1, atk: 2 };
  const RIGHT_KEYS = ["atk", "sk0", "sk1", "up", "down"]; // 右手的按鈕（up＝跳、down＝防）
  // 普攻是「按住才出」的種類（直線投射物、拋物線）：普攻鈕改走按住／放開的流程
  const atkIsShot = (who) => !!(FG.fs[who] && FT_AIMED[FG.fs[who].atk.kind]);
  function fightLocal(ev) {
    const r = fcv.getBoundingClientRect();
    let x = (ev.clientX - r.left) / r.width * FW, y = (ev.clientY - r.top) / r.height * FH;
    const L = fightLayout();
    let who = FG.set.mode === "online" ? FG.me : 0; // 線上對戰：觸控一律是自己那一方
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
    if (!c || (FG.set.mode !== "pvp" && who !== (FG.set.mode === "online" ? FG.me : 0))) return; // 單人：只有自己那一方（線上對戰的加入者是右方）
    if (y < L.ctrl.y - 60) return;
    if (x < MOVE_SPLIT) {
      const dir = padAt(B, x), now = performance.now();
      // 衝刺（v7.0）：同一個方向在 RUN_TAP 毫秒內點兩下 → 按住期間衝刺
      c.run = c.lastTap && c.lastTap.dir === dir && now - c.lastTap.t < RUN_TAP ? dir : null;
      c.lastTap = { dir, t: now };
      c.pads.set(ev.pointerId, dir);
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
      if (t.move) { const d = padAt(fightButtons(fightLayout()), x); if (d !== c.pads.get(ev.pointerId)) c.run = null; c.pads.set(ev.pointerId, d); } // 移動區可以滑來滑去換方向（換方向就停止衝刺）；跳、防不跟著手指
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
    if (t.kind === "pad") { if (c.pads.get(ev.pointerId) === c.run) c.run = null; c.pads.delete(ev.pointerId); return; }
    const s = SLOT_OF[t.kind], b = c.btn[t.kind], B = fightButtons(fightLayout())[t.kind];
    if (s < 2 || atkIsShot(t.who)) { c.skCancelAt[s] = fightCancelAt(t.who, t.kind, b, B); c.skUp[s] = true; }
    delete c.btn[t.kind];
  };
  fcv.addEventListener("pointerup", fUp); fcv.addEventListener("pointercancel", fUp);
  // 鍵盤（電腦上測試用）：左方 A D 移動、W 跳、S 防禦、J 普攻、K L 技能；兩人模式右方用方向鍵、1 2 3
  // 鍵盤組 → 哪一方（線上對戰只用第 1 組，對到自己那一方）
  const fightKeyMap = (fn) => (FG.set.mode === "online" ? fn(FKEYS[0], FG.me) : FKEYS.forEach(fn));
  const FKEYS = [{ l: "a", r: "d", u: "w", d: "s", atk: "j", s0: "k", s1: "l" }, { l: "arrowleft", r: "arrowright", u: "arrowup", d: "arrowdown", atk: "1", s0: "2", s1: "3" }];
  window.addEventListener("keydown", (e) => {
    if (!FG.running || e.repeat) return;
    const k = e.key.toLowerCase(); FG.keys.add(k);
    fightKeyMap((m, i) => { const c = FG.ctl[i]; if (!c) return;
      if (k === m.l || k === m.r) { const d = k === m.r ? "right" : "left", now = performance.now(); c.keyRun = c.lastKey && c.lastKey.d === d && now - c.lastKey.t < RUN_TAP ? d : null; c.lastKey = { d, t: now }; }
      if (k === m.atk) { if (atkIsShot(i)) c.skDown[2] = true; else c.atk = true; } if (k === m.s0) c.skDown[0] = true; if (k === m.s1) c.skDown[1] = true; if (k === m.u) c.jump = true; });
  });
  window.addEventListener("keyup", (e) => {
    if (!FG.running) return;
    const k = e.key.toLowerCase(); FG.keys.delete(k);
    fightKeyMap((m, i) => { const c = FG.ctl[i]; if (!c) return; if (k === m.l || k === m.r) c.keyRun = null; if (k === m.s0) c.skUp[0] = true; if (k === m.s1) c.skUp[1] = true; if (k === m.atk && atkIsShot(i)) c.skUp[2] = true; });
  });

  // 觸控狀態 → 這一步的按鍵（引擎格式）
  // i＝哪一方（也是第幾組觸控按鈕）；keys＝用哪一組鍵盤（線上對戰的右方用第 1 組 A D W S J K L）
  function fightInput(i, keys = i) {
    const c = FG.ctl[i], g = FG.g, inp = fightBlankInput();
    if (!c) return inp;
    /* 兩人模式上半部的人：觸控座標已經換成他自己的座標（fightLocal），而他看到的畫面也是轉正的，
       所以他的「左」就是場地的左，不用再反轉 */
    const held = new Set(c.pads.values());
    let lx = held.has("right") ? 1 : held.has("left") ? -1 : 0;
    if (held.has("down")) inp.guard = true;
    const m = FKEYS[keys], K = FG.keys;
    if (K.has(m.l)) lx = -1; if (K.has(m.r)) lx = 1; if (K.has(m.d)) inp.guard = true;
    // 衝刺：觸控（c.run）或鍵盤（c.keyRun）連點兩下的那個方向還按著
    const dirNow = lx > 0 ? "right" : lx < 0 ? "left" : null;
    inp.run = !!dirNow && (c.run === dirNow || c.keyRun === dirNow);
    inp.mx = lx * fightM(); // 鏡像時畫面的左＝場上的右
    inp.jump = c.jump; inp.atk = c.atk; inp.skDown = c.skDown.slice(); inp.skUp = c.skUp.slice(); inp.skCancel = c.skCancelAt.slice();
    const face = g ? g.p[i].face : 1, B = fightButtons(fightLayout());
    for (const [key, s] of Object.entries(SLOT_OF)) {
      const b = c.btn[key]; if (!b || (s === 2 && !atkIsShot(i))) continue;
      inp.skAim[s] = ((b.x - b.x0) / FS_IN) * 1.6 * face * fightM(); // 往自己看到的「前方」拖＝打更遠（鏡像時畫面方向相反）
      inp.skCancel[s] = fightCancelAt(i, key, b, B[key]);
    }
    c.jump = false; c.atk = false; c.skDown = [false, false, false]; c.skUp = [false, false, false]; c.skCancelAt = [false, false, false];
    return inp;
  }

  /* ---------- 每一格 ---------- */
  function fightTick(dt) {
    if (!FG.running || !FG.g) return;
    const g = FG.g;
    if (FG.pauseUntil && performance.now() < FG.pauseUntil) { FG.acc = 0; fightDraw(); return; } // 轉向後的短暫暫停
    FG.acc = Math.min(FG.acc + dt, 0.25);
    while (FG.acc >= FT.STEP) {
      const mode = FG.set.mode;
      const produce = mode === "online" ? (side) => fightInput(side, 0) : (side) => side === 0 ? (FG.bots[0] ? fightAi(g, 0, FG.bots[0], FG.ai[0]) : fightInput(0))
        : mode === "pvp" ? fightInput(1) : fightAi(g, 1, mode === "dummy" ? FG.set.dummy : FG.set.level, FG.ai[1]);
      // v6：經過連線層（延遲輸入＋假網路）；還在等對方的輸入就先不推進
      const inputs = netStep(FG.net, produce, performance.now());
      if (!inputs) { FG.acc = 0; break; }
      fightStep(g, inputs);
      netAfterStep(FG.net, g); // 線上：定期互傳狀態雜湊
      for (const e of g.events) fightSound(e);
      FG.acc -= FT.STEP;
    }
    if (FG.set.mode === "online") olTick(g);
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
    fightCamUpdate(g, L);
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1;
    c.fillStyle = "#14182b"; c.fillRect(0, 0, FW, FH);
    if (L.pvp) {
      fightDrawPlayer(c, g, L, 0);
      c.save(); c.translate(FW, FH); c.rotate(Math.PI); fightDrawPlayer(c, g, L, 1); c.restore();
      fightHudBar(c, g, L.hud.y, L.hud.h, true);
    } else {
      fightDrawPlayer(c, g, L, FG.set.mode === "online" ? FG.me : 0);
      fightHudBar(c, g, 18, 110, false);
      if (FG.net && (FG.net.delay || FG.net.lat || FG.net.jit)) { // v6 測試：連線層狀態
        c.fillStyle = FG.net.waiting ? "#ffd84a" : "#9aa3c8"; c.font = canvasFont(700, 20); c.textAlign = "right"; c.textBaseline = "top";
        c.fillText(netLabel(FG.net), FW - 20, L.view.y + 44);
      }
      if (g.cfg.mode === "dummy") {
        const st = g.stats;
        c.fillStyle = "#cfd6ff"; c.font = canvasFont(700, 24); c.textAlign = "left"; c.textBaseline = "top";
        c.fillText(`木樁・這一串 ${st.lastCombo || 0}　最後一下 ${st.lastDmg || 0}　總共 ${st.total}（${st.hits} 下）`, 20, L.view.y + 10);
      }
    }
  }
  /* 背景參照物（v7.0）：鏡頭移動、縮放時看得出場景在動、自己在場地哪裡。都是程式畫的簡單形狀。
     遠山：視差 0.3（移動比較慢，看起來比較遠）；路燈：每 250 一支，跟場地一起動；地板：每 100 一條刻度，正中央比較明顯 */
  function fightDrawScenery(c, X, Y, gy, v, cx) {
    c.save();
    const far = (wx) => FW / 2 + fightM() * (wx - cx * 0.3) * fScale * 0.6;
    c.fillStyle = "rgba(160,170,230,0.18)";
    for (let i = -8; i <= 8; i++) { // 遠山：位置、高度固定（每次看都一樣）
      const wx = i * 330, h = (150 + ((i * 7919) % 5 + 5) % 5 * 40) * fScale * 0.6, w = 420 * fScale * 0.6, x = far(wx);
      if (x + w < 0 || x - w > FW) continue;
      c.beginPath(); c.moveTo(x - w, gy); c.quadraticCurveTo(x, gy - h * 2, x + w, gy); c.fill();
    }
    c.strokeStyle = "rgba(200,205,240,0.35)"; c.fillStyle = "rgba(255,226,140,0.55)"; c.lineWidth = Math.max(2, 6 * fScale);
    for (let wx = -FT.AW / 2 + 125; wx < FT.AW / 2; wx += 250) { // 路燈
      const x = X(wx); if (x < -40 || x > FW + 40) continue;
      c.beginPath(); c.moveTo(x, gy); c.lineTo(x, Y(240)); c.lineTo(x + 26 * fScale, Y(240)); c.stroke();
      c.beginPath(); c.arc(x + 26 * fScale, Y(228), 10 * fScale, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }
  function fightDrawFloor(c, X, gy) {
    c.save(); c.fillStyle = "rgba(255,255,255,0.18)";
    for (let wx = -FT.AW / 2 + 50; wx < FT.AW / 2; wx += 100) {
      const x = X(wx); if (x < -10 || x > FW + 10) continue;
      const big = Math.abs(wx) < 1; c.fillRect(x - (big ? 3 : 1.5), gy + 6, big ? 6 : 3, big ? 26 : 12);
    }
    c.fillStyle = "rgba(255,255,255,0.35)"; const x0 = X(0); c.fillRect(x0 - 3, gy + 6, 6, 26); // 場地正中央
    c.restore();
  }
  // 一位玩家看到的畫面（自己的座標：場地＋按鈕）
  function fightDrawPlayer(c, g, L, who) {
    const v = L.view, gy = v.y + v.h - v.ground + (FG.cam && FG.cam.y ? FG.cam.y * fScale : 0); // 鏡頭往上跟時地面往下移
    c.save();
    c.beginPath(); c.rect(0, v.y, FW, v.h); c.clip();
    const sky = c.createLinearGradient(0, v.y, 0, gy); sky.addColorStop(0, "#2a3363"); sky.addColorStop(1, "#5b6aa8");
    c.fillStyle = sky; c.fillRect(0, v.y, FW, v.h);
    // 鏡像（v6.1：線上對戰的加入者看到自己在左邊）：場上的 x 左右對調；文字不翻轉，只是位置對調
    const cx = FG.cam ? FG.cam.x : 0, X = (x) => FW / 2 + fightM() * (x - cx) * fScale, Y = (y) => gy - y * fScale;
    fightDrawScenery(c, X, Y, gy, v, cx);
    c.fillStyle = "#3d3a52"; c.fillRect(0, gy, FW, FH);
    c.fillStyle = "#8f8bb0"; c.fillRect(0, gy, FW, 4);
    fightDrawFloor(c, X, gy);
    { // 場地兩端的牆（v7.0）：牆外塗暗、邊界畫一條亮線
      const wl = X(-FT.AW / 2), wr = X(FT.AW / 2), lo = Math.min(wl, wr), hi = Math.max(wl, wr);
      c.fillStyle = "rgba(10,12,24,0.75)"; if (lo > 0) c.fillRect(0, v.y, lo, v.h); if (hi < FW) c.fillRect(hi, v.y, FW - hi, v.h);
      c.fillStyle = "#c9a7ff"; for (const x of [lo, hi]) if (x > -6 && x < FW + 6) c.fillRect(x - 3, v.y, 6, v.h);
    }
    // 矩形預告（雙方都看得到）
    for (const t of g.teles) {
      const pr = Math.min(1, t.t / t.delay), w = t.w * fScale, x0 = X(t.x) - w / 2, h = FT.CH * 0.95 * fScale;
      c.fillStyle = `rgba(255,60,60,${0.12 + 0.25 * pr})`; c.fillRect(x0, gy - h, w, h);
      c.fillStyle = "rgba(255,60,60,0.45)"; c.fillRect(x0, gy - h * pr, w, h * pr);
      c.strokeStyle = Math.floor(t.t * 12) % 2 ? "#ff4050" : "#ffd0d0"; c.lineWidth = 3; c.strokeRect(x0, gy - h, w, h);
      fightLabel(c, Math.max(0, t.delay - t.t).toFixed(2) + " 秒", x0 + w / 2, gy - h - 16, 22, "#ffd0d0");
    }
    // 拖曳瞄準：綠色＝這招能打到的全部範圍，白色＝目前拖到的位置（自己的一定畫；勾選「顯示判定範圍」時也畫對手的）
    for (const i of [0, 1]) if (i === who || FG.set.showRange) fightDrawAims(c, g, i, X, Y, gy);
    // 角色
    for (const cl of g.clones) fightDrawClone(c, g, cl, X, Y);
    for (const m of g.summons) fightDrawSummon(c, g, m, X, Y);
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
        c.strokeRect(X(p.x) - hw * fScale, Y(p.y + FT.CH), FT.HURT_W * fScale, FT.CH * fScale);
        c.beginPath(); c.moveTo(X(p.x + p.face * hw), Y(p.y + FT.CH * 0.5)); c.lineTo(X(p.x + p.face * (hw + 18)), Y(p.y + FT.CH * 0.5)); c.stroke(); // 面向
        fightLabel(c, FT_STATE_LABEL[p.state] || p.state, X(p.x), Y(p.y + FT.CH * 1.32), 22, "#ffd84a");
      }
      for (const q of g.projs) { c.beginPath(); c.arc(X(q.x), Y(q.y), (q.kind === "lob" ? 26 : 14) * fScale, 0, Math.PI * 2); c.stroke(); }
      c.restore();
    }
    // 投射物
    for (const q of g.projs) {
      const f = q.drawF || g.cfg.f[q.own], dr = q.bul && f.bul[q.bul.p], k = fScale * FT.CH / f.h;
      if (dr) {
        const anim = pickAnim(dr.part, ["normal", "idle", "wait", "shot", "fire", "attack"]);
        if (anim) {
          const n = dr.part.animations[anim].frame_count, idx = Math.floor(q.t * (dr.part.anim_rate || 24)) % Math.max(1, n);
          const rot = q.kind === "lob" && q.bul.r ? Math.atan2(-q.vy, Math.abs(q.vx)) * 180 / Math.PI * -1 : 0;
          c.save(); c.translate(X(q.x), Y(q.y)); c.scale(k, k); drawPartCtx(c, dr, anim, idx, 0, 0, fightFlip(q.face), rot); c.restore();
          continue;
        }
      }
      c.fillStyle = q.own ? "#59a7ff" : "#ff6b6b";
      c.beginPath(); c.arc(X(q.x), Y(q.y), q.kind === "lob" ? 16 : 12, 0, Math.PI * 2); c.fill();
      c.strokeStyle = "#fff"; c.lineWidth = 3; c.stroke();
    }
    // 特效
    for (const e of g.fx) fightDrawFx(c, g, e, X, Y, gy);
    // 對手在畫面外（地圖比鏡頭最遠看得到的還寬時）：畫面邊緣畫箭頭＋距離（v7.0）
    for (const i of [0, 1]) {
      const p = g.p[i], sx = X(p.x); if (sx > -20 && sx < FW + 20) continue;
      const right = sx > FW, ax = right ? FW - 34 : 34, ay = Y(p.y + FT.CH * 0.5), d = Math.round(Math.abs(p.x - g.p[1 - i].x));
      c.save(); c.fillStyle = i ? "#59a7ff" : "#ff6b6b"; c.strokeStyle = "#fff"; c.lineWidth = 3;
      c.beginPath(); c.moveTo(ax + (right ? 22 : -22), ay); c.lineTo(ax - (right ? 10 : -10), ay - 22); c.lineTo(ax - (right ? 10 : -10), ay + 22); c.closePath(); c.fill(); c.stroke();
      fightLabel(c, String(d), ax - (right ? 26 : -26), ay - 36, 20, "#fff"); c.restore();
    }
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
  /* 變形：畫成施放者的變形外觀（同編號 sk 角色，例如 u376u-cony → u376sk-cony）的待機動作；
     找不到外觀時退回施放者那一招的投射物圖案，再沒有就畫一團 */
  function fightDrawPoly(c, g, p, X, Y) {
    const ps = p.st.poly, form = g.cfg.extra && g.cfg.extra[ps.own] && g.cfg.extra[ps.own].poly;
    if (form) {
      const clip = idleClip(form), n = form.part.animations[clip].frame_count, idx = Math.floor(g.t * (form.part.anim_rate || 24)) % Math.max(1, n);
      c.save(); c.translate(X(p.x), Y(p.y)); const s = fScale * FT.CH * 0.75 / form.h; c.scale(s, s); drawFighterCtx(c, form, clip, idx, 0, fightFlip(p.face), false, 1); c.restore();
      return;
    }
    const f = g.cfg.f[ps.own], dr = ps.bul && f.bul[ps.bul.p], k = fScale * FT.CH / f.h;
    const anim = dr && pickAnim(dr.part, ["normal", "idle", "wait", "finish"]);
    if (anim) {
      const n = dr.part.animations[anim].frame_count, idx = Math.floor(g.t * (dr.part.anim_rate || 24)) % Math.max(1, n);
      c.save(); c.translate(X(p.x), Y(p.y + FT.CH * 0.3)); c.scale(k * 1.3, k * 1.3); drawPartCtx(c, dr, anim, idx, 0, 0, fightFlip(p.face), 0); c.restore();
    } else {
      c.save(); c.fillStyle = "#ffd84a"; c.strokeStyle = "#1b2038"; c.lineWidth = 4;
      c.beginPath(); c.ellipse(X(p.x), Y(p.y + FT.CH * 0.25), FT.CH * 0.28 * fScale, FT.CH * 0.22 * fScale, 0, 0, Math.PI * 2); c.fill(); c.stroke(); c.restore();
    }
  }
  // 召喚物：自己的動畫（走路／攻擊／待機），頭上小血條，剩最後 1.5 秒時閃爍
  function fightDrawSummon(c, g, m, X, Y) {
    const f = m.f, a = m.act;
    let clip = a ? a.clip : m.moving ? f.clips.move : null; if (!clip || !f.part.animations[clip]) clip = idleClip(f);
    if (!clip) return;
    const n = f.part.animations[clip].frame_count, idx = a ? Math.min(n - 1, Math.floor(a.t / a.dur * n)) : Math.floor(m.anim.t * (f.part.anim_rate || 24)) % Math.max(1, n);
    const k = fScale * FT.CH * FT.SUM_H / f.h, blink = m.T - m.life < 1.5 && Math.floor(m.life * 8) % 2;
    c.save(); c.translate(X(m.x), Y(m.y)); c.scale(k, k);
    drawFighterCtx(c, f, clip, idx, 0, fightFlip(m.face), false, blink ? 0.4 : 1);
    c.restore();
    const w = 70, x0 = X(m.x) - w / 2, y0 = Y(FT.CH * FT.SUM_H) - 14, r = Math.max(0, m.hp / m.maxHp);
    c.fillStyle = "#333a5c"; c.fillRect(x0, y0, w, 7); c.fillStyle = m.side ? "#59a7ff" : "#ff6b6b"; c.fillRect(x0, y0, w * r, 7);
  }
  // 複製體：用對手的樣子、半透明紫色調，播目前招式的動作
  function fightDrawClone(c, g, cl, X, Y) {
    const f = g.cfg.f[cl.from], a = cl.act;
    let clip = a ? a.clip : null; if (!clip || !f.part.animations[clip]) clip = idleClip(f);
    const n = f.part.animations[clip].frame_count, idx = a ? Math.min(n - 1, Math.floor(a.t / a.dur * n)) : Math.floor(cl.anim.t * (f.part.anim_rate || 24)) % Math.max(1, n);
    const k = fScale * FT.CH / f.h;
    c.save(); c.translate(X(cl.x), Y(cl.y)); c.scale(k, k);
    drawFighterCtx(c, f, clip, idx, 0, fightFlip(cl.face), false, 0.55);
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
      if (p.running) fightSpeedLines(c, p, X, Y);
      c.save(); c.translate(X(p.x), Y(p.y)); c.scale(k, k);
      drawFighterCtx(c, f, clip, idx, 0, fightFlip(p.face), p.quiet < 0.08 && !p.guard && p.stunKind !== "block", alpha);
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
    else if (e.kind === "dust") { // 衝刺塵土（v7.0）：往身後散開的灰色小團
      c.fillStyle = "rgba(220,215,235,0.7)";
      for (let n = 0; n < (e.big ? 5 : 2); n++) { const sp = (12 + n * 9) * pr * fScale * 3; c.beginPath(); c.arc(X(e.x - e.dir * (sp / fScale)), Y(6 + n * 7 * pr), (e.big ? 12 : 7) * fScale * (1 + pr), 0, Math.PI * 2); c.fill(); }
    }
    else if (e.kind === "boom") { c.fillStyle = "#ffb14a"; c.beginPath(); c.arc(X(e.x), Y(20), 20 + 60 * pr, 0, Math.PI * 2); c.fill(); }
    else if (e.kind === "impact") {
      const h = FT.CH * 0.95 * fScale, f = g.cfg.f[e.own], dr = e.bul && f.bul[e.bul.p];
      c.fillStyle = "rgba(255,240,200,0.6)"; c.fillRect(X(e.x) - e.w * fScale / 2, gy - h, e.w * fScale, h);
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
      const d = FG.mirror ? 1 - i : i; // 畫在哪一邊（鏡像時自己在左邊；顏色仍照左右方）
      const p = g.p[i], r = Math.max(0, p.hp / p.maxHp), x0 = d ? FW - edge - bw : edge;
      // 從中間往外縮的橫條（左方靠右對齊、右方靠左對齊）
      const fill = (y, h, ratio, color) => { c.fillStyle = color; if (d) c.fillRect(x0, y, bw * ratio, h); else c.fillRect(x0 + bw * (1 - ratio), y, bw * ratio, h); };
      c.fillStyle = "#333a5c"; c.fillRect(x0, cy - bh / 2, bw, bh);
      fill(cy - bh / 2, bh, r, i ? "#2f6fe0" : "#e0323f");
      c.strokeStyle = "#fff"; c.lineWidth = 2; c.strokeRect(x0, cy - bh / 2, bw, bh);
      // 硬直累積值（滿了倒地）
      const sh = pvp ? 5 : 7;
      c.fillStyle = "#262b48"; c.fillRect(x0, cy + bh / 2 + 3, bw, sh);
      fill(cy + bh / 2 + 3, sh, Math.min(1, p.sv / FT.SV_MAX), p.sv / FT.SV_MAX > 0.7 ? "#ff8a3d" : "#ffd84a");
      if (!pvp) { c.fillStyle = "#e8ebff"; c.font = canvasFont(700, 20); c.textAlign = d ? "right" : "left"; c.textBaseline = "top"; c.fillText(`${g.cfg.f[i].r.name}${g.cfg.mode === "online" && i === FG.me ? "（你）" : ""}　${Math.max(0, Math.ceil(p.hp))}／${p.maxHp}`, d ? FW - 20 : 20, cy + bh / 2 + 14); }
      if (g.cfg.mode !== "dummy") for (let n = 0; n < Math.ceil(g.cfg.rounds / 2); n++) {
        c.fillStyle = n < g.wins[i] ? "#ffd84a" : "#444a6e"; c.beginPath(); c.arc(d ? FW - edge - 10 - n * 18 : edge + 10 + n * 18, cy - bh / 2 - 10, 6, 0, Math.PI * 2); c.fill();
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
    const human = FG.set.mode === "pvp" || who === (FG.set.mode === "online" ? FG.me : 0);
    c.save();
    if (!L.land) { c.fillStyle = "#1a1e36"; c.fillRect(0, L.ctrl.y, FW, L.ctrl.h); }
    else c.globalAlpha = 0.78; // 橫向：按鈕半透明疊在場地上
    if (!human) { c.restore(); return; }
    const held = new Set(ctl ? ctl.pads.values() : []);
    const pad = (key, label, icon) => {
      const b = B[key], on = held.has(key), w = b.w || b.r * 2, h = b.h || b.r * 2, ink = on ? "#1b2038" : "#fff";
      c.fillStyle = on ? "#ffd84a" : "rgba(255,255,255,0.12)"; c.strokeStyle = "rgba(255,255,255,0.55)"; c.lineWidth = 3;
      c.beginPath(); if (c.roundRect) c.roundRect(b.x - w / 2, b.y - h / 2, w, h, 14); else c.rect(b.x - w / 2, b.y - h / 2, w, h); c.fill(); c.stroke();
      c.textAlign = "center"; c.textBaseline = "middle";
      if (!icon) { c.fillStyle = ink; c.font = canvasFont(900, 26); c.fillText(label, b.x, b.y); return; }
      const s = Math.min(w, h);
      icon(c, b.x, b.y + s * 0.08, s * 0.5, ink);              // 圖案（往下一點，上面留給小字）
      c.fillStyle = ink; c.font = canvasFont(900, 14); c.fillText(label, b.x, b.y - h / 2 + 12); // 原本的字（小字）
    };
    pad("up", "跳", fightIconUp); pad("down", "防", fightIconShield); pad("left", "◀"); pad("right", "▶");
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
      // 圖案：普攻＝劍；技能＝原作的技能圖標（載入失敗或沒有就用原本的文字）
      const img = key !== "atk" && !off && fightSkillIcon(slot);
      const hasIcon = key === "atk" || !!img;
      if (img) { c.save(); c.beginPath(); c.arc(b.x, b.y, b.r - 5, 0, Math.PI * 2); c.clip(); c.drawImage(img, b.x - b.r + 5, b.y - b.r + 5, (b.r - 5) * 2, (b.r - 5) * 2); c.restore(); }
      else if (key === "atk") fightIconSword(c, b.x, b.y + b.r * 0.12, b.r * 1.1, held ? "#1b2038" : "#fff");
      if (cdLeft > 0) { c.fillStyle = "rgba(0,0,0,0.55)"; c.beginPath(); c.moveTo(b.x, b.y); c.arc(b.x, b.y, b.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (cdLeft / cdMax)); c.closePath(); c.fill(); }
      c.strokeStyle = held ? "#ffd84a" : "#fff"; c.lineWidth = held && img ? 6 : 3; c.beginPath(); c.arc(b.x, b.y, b.r, 0, Math.PI * 2); c.stroke();
      c.textAlign = "center"; c.textBaseline = "middle";
      if (hasIcon) { // 原本的字：小字貼在圓的上緣（有底色比較看得清楚）
        c.font = canvasFont(900, 14); const tw = c.measureText(label).width + 12, ty = b.y - b.r + 4;
        c.fillStyle = "rgba(20,24,48,0.8)"; c.beginPath(); if (c.roundRect) c.roundRect(b.x - tw / 2, ty - 10, tw, 20, 10); else c.rect(b.x - tw / 2, ty - 10, tw, 20); c.fill();
        c.fillStyle = "#fff"; c.fillText(label, b.x, ty);
      } else { c.fillStyle = "#fff"; c.font = canvasFont(900, 22); c.fillText(label, b.x, b.y - (cdLeft > 0 ? 10 : 0)); }
      if (cdLeft > 0) { c.font = canvasFont(900, 22); c.fillStyle = "#fff"; c.lineWidth = 4; c.strokeStyle = "rgba(0,0,0,0.7)"; const ty = b.y + (hasIcon ? 6 : 16); c.strokeText(cdLeft.toFixed(1), b.x, ty); c.fillText(cdLeft.toFixed(1), b.x, ty); }
    };
    btn("atk", { shot: "普攻↔", lob: "普攻⌒", dline: "普攻→" }[fs.atk.kind] || "普攻", p.atkCd, fs.atk.cd, false);
    for (const s of [0, 1]) {
      const k = fs.sk[s];
      const lab = k ? ({ rect: "定點", line: "直線", lob: "拋物", self: "自身", dash: "突進", buff: "輔助" }[k.kind] + (s + 1)) : "—";
      btn("sk" + s, lab, k ? p.cd[s] : 0, k ? k.cd : 1, !k);
    }
    c.restore();
  }
