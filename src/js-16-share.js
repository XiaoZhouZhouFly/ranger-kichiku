  /* ---------- 分享：網址帶上目前的角色、動作、對戰設定；太長時改用專案檔 ---------- */
  const URLP = (() => { try { return new URLSearchParams(location.search); } catch { return new URLSearchParams(); } })();
  const URLD = {}; // 網址裡壓縮過的長資料（d=）：惡搞片段、自訂招式、金手指、攻擊距離、移動速度
  const URL_WARN = 2000;
  const b64u = {
    enc: (str) => btoa(unescape(encodeURIComponent(str))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
    dec: (str) => { let t = str.replace(/-/g, "+").replace(/_/g, "/"); while (t.length % 4) t += "="; return decodeURIComponent(escape(atob(t))); },
  };
  const bytesToB64u = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
  const b64uToBytes = (str) => { let t = str.replace(/-/g, "+").replace(/_/g, "/"); while (t.length % 4) t += "="; const bin = atob(t), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8; };
  // 用瀏覽器內建的壓縮（不用另外載程式庫）；舊瀏覽器就不壓縮
  async function packD(obj) {
    const json = JSON.stringify(obj);
    try {
      if (window.CompressionStream) {
        const st = new Blob([json]).stream().pipeThrough(new CompressionStream("deflate-raw"));
        return "z" + bytesToB64u(new Uint8Array(await new Response(st).arrayBuffer()));
      }
    } catch {}
    return "j" + b64u.enc(json);
  }
  async function unpackD(str) {
    if (str[0] === "z") {
      const st = new Blob([b64uToBytes(str.slice(1))]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return JSON.parse(await new Response(st).text());
    }
    if (str[0] === "j") return JSON.parse(b64u.dec(str.slice(1)));
    throw new Error("bad");
  }
  const MOVE_CODE = { move: "m", attack: "a", skill1: "1", skill2: "2" };
  const CODE_MOVE = { m: "move", a: "attack", 1: "skill1", 2: "skill2" };
  function encMoves(moves) {
    return moves.map((m) => (m.who === "B" ? "B" : "A") + (MOVE_CODE[m.action] || "a") + (m.repeat > 1 ? "x" + m.repeat : "") + (m.slow ? "s" : "")).join(".");
  }
  function decMoves(str) {
    const out = [];
    for (const t of String(str || "").split(".")) {
      const m = t.match(/^([AB])([ma12])(?:x(\d+))?(s)?$/);
      if (!m) continue;
      const mv = { who: m[1], action: CODE_MOVE[m[2]] };
      if (m[3]) mv.repeat = Math.max(1, Math.min(8, +m[3]));
      if (m[4]) mv.slow = true;
      out.push(mv);
    }
    return out;
  }
  // 惡搞片段只記和預設不同的欄位
  function segsDiff(segs) {
    const n = anim() ? clipN() : 1, d0 = defSeg(n);
    return segs.map((sg) => { const o = {}; for (const k in sg) if (JSON.stringify(sg[k]) !== JSON.stringify(d0[k])) o[k] = sg[k]; return o; });
  }
  function segsFromDiff(arr) {
    if (!Array.isArray(arr) || !arr.length || arr.length > 60) throw new Error("bad");
    const n = anim() ? clipN() : 1;
    return arr.map((o) => Object.assign(defSeg(n), o && typeof o === "object" ? o : {}));
  }
  const hasCheat = (c) => Array.isArray(c) && c.some((x) => x && Object.keys(x).some((k) => x[k] !== undefined && (k !== "sk" || (Array.isArray(x.sk) && x.sk.some((y) => y && Object.keys(y).length)))));
  async function shareUrl() {
    const p = new URLSearchParams(), d = {};
    if (S.app === "duel" && D.f[0] && D.f[1]) {
      p.set("app", "duel"); p.set("l", D.f[0].r.id); p.set("r", D.f[1].r.id);
      if (D.mode !== "trade" && D.moves.length) d.mv = encMoves(D.moves);
      settingsToUrl(p, d); // 其他設定：見 js-10 的 DUEL_SETTINGS
    } else if (S.unit) {
      p.set("app", "single"); p.set("u", S.unit.id);
      const ck = currentClipKey(); if (ck) p.set("clip", ck);
      if (S.mode === "remix") { p.set("mode", "remix"); try { d.s = segsDiff(S.segs); } catch {} }
    }
    if (Object.keys(d).length) p.set("d", await packD(d));
    return location.origin + location.pathname + "?" + p.toString();
  }
  // 網址列跟著目前畫面更新（只更新、不新增瀏覽紀錄）；短時間內多次呼叫只做最後一次。
  // 任何時候都可以直接呼叫：啟動完成前（S.urlSync.on 還是 false）會略過。
  function syncUrl() {
    if (!S.urlSync.on) return;
    clearTimeout(S.urlSync.timer);
    S.urlSync.timer = setTimeout(async () => { try { const u = await shareUrl(); history.replaceState(history.state, "", "?" + u.split("?")[1]); } catch {} }, 250);
  }
  let toastTimer = 0;
  function toast(msg) {
    let t = document.querySelector(".toast");
    if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2400);
  }
  /* 專案檔：完整設定（含金手指、音效選擇），不含自己上傳的音效與背景。
     格式有不相容的改變時把 PROJECT_VER 加 1，並在 migrateProject 補上舊版轉新版的步驟；
     雙人設定的舊欄位（kind／raw、召喚上限 5）由 settingsFromSaved 處理，不用改版號。 */
  const PROJECT_VER = 1;
  function migrateProject(obj) {
    if (!obj || obj.app !== "ranger-kichiku") throw new Error("這不是惡搞工坊的專案檔");
    const ver = +obj.ver || 1;
    if (ver > PROJECT_VER) throw new Error("這個專案檔是用較新版的網頁存的，請重新整理網頁後再開啟");
    // 之後的版本：if (ver < 2) { …把 obj 改成第 2 版的格式… }
    return obj;
  }
  // 雙人對戰的存檔（瀏覽器與專案檔共用同一個格式）：角色、招式＋設定表的全部設定
  function duelState() {
    return { a: D.f[0]?.r.id, b: D.f[1]?.r.id, moves: D.moves, ...settingsToSaved() };
  }
  function projectData() {
    const base = { app: "ranger-kichiku", ver: PROJECT_VER, saved: new Date().toISOString() };
    if (S.app === "duel" && D.f[0] && D.f[1]) return { ...base, type: "duel", title: `${D.f[0].r.name} vs ${D.f[1].r.name}`, duel: duelState(), dsize: store.get("dsize", "1280x720"), sfx: SFX.cfg.duel };
    return { ...base, type: "single", title: S.unit ? S.unit.name : "", single: { u: S.unit && S.unit.id, part: S.partKey, clip: currentClipKey(), anim: S.animName, mode: S.mode, segs: S.segs, comps: S.comps, speed: S.speed }, sfx: SFX.cfg.single };
  }
  function projectFileName(obj) {
    const d = new Date(), pad = (n) => String(n).padStart(2, "0");
    const t = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
    const name = (obj.title || obj.type).replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 40);
    return `惡搞工坊_${name}_${t}.json`;
  }
  // 開啟專案檔：把設定寫進瀏覽器，再重新整理套用
  async function openProject(file) {
    let obj;
    try { obj = JSON.parse(await file.text()); } catch { throw new Error("檔案不是正確的格式"); }
    obj = migrateProject(obj);
    const has = (id) => id && S.index.some((r) => r.id === id);
    if (obj.type === "duel" && obj.duel) {
      if (!has(obj.duel.a) || !has(obj.duel.b)) throw new Error("專案裡的角色在目前資料中找不到");
      store.set("duel", obj.duel);
      if (obj.dsize) store.set("dsize", obj.dsize);
      if (Array.isArray(obj.sfx)) { SFX.cfg.duel = obj.sfx; sfxSave(); }
      store.set("app", "duel");
    } else if (obj.type === "single" && obj.single) {
      const sg = obj.single;
      if (!has(sg.u)) throw new Error("專案裡的角色在目前資料中找不到");
      store.set("unit", sg.u);
      if (Array.isArray(sg.segs) && sg.part && sg.anim) store.set("segs:" + sg.u + ":" + sg.part + ":" + sg.anim, sg.segs);
      store.set("pendingSingle", { part: sg.part, clip: sg.clip, mode: sg.mode, comps: sg.comps, speed: sg.speed });
      if (obj.sfx && typeof obj.sfx === "object") { SFX.cfg.single = obj.sfx; sfxSave(); }
      store.set("app", "single");
    } else throw new Error("看不懂這個專案檔");
    const modeName = obj.type === "duel" ? "雙人對戰" : "單人";
    store.set("pendingToast", obj.type !== S.app ? `這是${modeName}的專案檔，已切換到${modeName}：${obj.title || ""}` : `已開啟專案檔：${obj.title || ""}`);
    location.href = location.pathname;
  }
  // 分享視窗
  function openModal(m) {
    document.querySelectorAll(".modal").forEach((x) => { x.hidden = true; });
    m.hidden = false; document.body.classList.add("modal-open");
  }
  function closeModal(m) { m.hidden = true; if (![...document.querySelectorAll(".modal")].some((x) => !x.hidden)) document.body.classList.remove("modal-open"); }
  async function openShare() {
    const m = $("shareModal");
    syncUrl();
    $("shareWhat").textContent = S.app === "duel" && D.f[0] && D.f[1]
      ? `${D.f[0].r.name} vs ${D.f[1].r.name}・${KINDS[D.type].label}`
      : `${S.unit ? S.unit.name : ""}・${S.mode === "remix" ? "惡搞剪輯" : "原始動作"}`;
    $("shareStatus").textContent = "";
    $("shareLink").value = "產生連結中…";
    $("shareCopy").disabled = true; // 連結還沒產生好之前不能按，避免複製到空白
    openModal(m);
    const url = await shareUrl();
    $("shareLink").value = url;
    $("shareCopy").disabled = false;
    const long = url.length > URL_WARN;
    $("shareWarn").hidden = !long;
    $("shareWarn").textContent = long ? `內容比較多（網址 ${url.length.toLocaleString()} 字元），貼到 LINE 等通訊軟體可能會被截斷。建議改用「下載專案檔」分享。` : "";
    $("shareCopy").focus();
  }
  function closeShare() { closeModal($("shareModal")); }
  // 複製：連結在打開視窗時就算好了，按下時立刻複製（中間不等待，iPhone 才不會失去點擊權限）
  function legacyCopy(text) {
    const i = $("shareLink");
    i.value = text; i.removeAttribute("readonly");
    i.focus(); i.select(); i.setSelectionRange(0, text.length); // iOS 需要 setSelectionRange
    let ok = false; try { ok = document.execCommand("copy"); } catch {}
    i.setAttribute("readonly", ""); i.blur();
    return ok;
  }
  function copyShareLink() {
    const url = $("shareLink").value;
    if (!/^https?:/.test(url)) return;
    const done = () => toast("已複製連結");
    const fail = () => { if (legacyCopy(url)) done(); else { $("shareStatus").textContent = "這個瀏覽器不讓網頁自動複製，請長按上面的連結手動複製。"; $("shareLink").select(); } };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, fail);
    else fail();
  }
  async function downloadProject() {
    const obj = projectData();
    const blob = new Blob([JSON.stringify(obj, null, 1)], { type: "application/json" });
    await offerFile(blob, projectFileName(obj), $("shareStatus"));
  }
  // 隨機挑角色：排除召喚物與沒有名字的資料
  function randomUnit(excludeId) {
    const pool = S.index.filter((r) => r.name && r.name !== r.id && !/sk-/.test(r.id) && r.id !== excludeId);
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  }
  document.querySelectorAll(".share-btn").forEach((b) => (b.onclick = openShare));
  $("shareClose").onclick = closeShare;
  $("shareCopy").onclick = copyShareLink;
  $("shareFile").onclick = downloadProject;
  $("shareLink").onfocus = () => $("shareLink").select();
  // 開啟專案檔視窗：選檔或拖放
  document.querySelectorAll(".import-btn").forEach((b) => (b.onclick = () => { $("importStatus").textContent = ""; openModal($("importModal")); }));
  $("importClose").onclick = () => closeModal($("importModal"));
  const importFile = async (f) => {
    if (!f) return;
    $("importStatus").textContent = `開啟 ${f.name} …`;
    try { await openProject(f); } catch (e) { $("importStatus").textContent = e.message || "無法開啟這個檔案"; }
  };
  $("importFile").onchange = async () => { await importFile($("importFile").files && $("importFile").files[0]); $("importFile").value = ""; };
  const dz = $("importDrop");
  ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, () => dz.classList.remove("over")));
  dz.addEventListener("drop", (e) => { e.preventDefault(); importFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]); });
  document.querySelectorAll(".modal").forEach((m) => m.addEventListener("click", (e) => { if (e.target === m) closeModal(m); }));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") document.querySelectorAll(".modal").forEach((m) => { if (!m.hidden) closeModal(m); }); });
  $("randBtn").onclick = async () => { const r = randomUnit(S.unit && S.unit.id); if (r) { $("q").value = r.name; renderResults(r.name); await selectUnit(r, { clip: currentClipKey() || "skill1" }); } };
  document.querySelectorAll("[data-rand-side]").forEach((b) => (b.onclick = async () => {
    const i = +b.dataset.randSide, r = randomUnit(D.f[1 - i] && D.f[1 - i].r.id);
    if (r) await setFighter(i, r, true);
  }));
  $("dRandAll").onclick = async () => {
    const a = randomUnit(), b = randomUnit(a && a.id);
    if (a) await setFighter(0, a, true);
    if (b) await setFighter(1, b, true);
  };

