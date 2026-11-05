  /* ---------- 格鬥場：線上對戰（v6） ----------
     Firebase Realtime Database 只用來「開房間、交換連線資訊、選角」，連不上直連時也用來轉送按鍵。
     對戰本身走 WebRTC 直連（RTCDataChannel），連不上就改走 Firebase 轉送（比較慢，延遲加大）。
     資料庫結構（rooms/房號）：
       host、guest：雙方的匿名帳號 id；cfg：{ rounds, secs, seed, v 網頁版本 }；go：開打（房主寫）
       p0、p1：雙方的選角 { id 角色, h 雙方角色數值的雜湊, ready }（0＝房主＝左方、1＝加入者＝右方）
       sig：{ offer, answer, c0、c1（連線候選，ICE） }；r0、r1：轉送模式的訊息
     測試：網址加 ?fakefb=1 改用假的資料庫（同一個瀏覽器的分頁之間互通，不連網）；加 ?relay=1 不試直連、直接轉送；
     ?fakelag=毫秒：假資料庫看到其他分頁的變化要晚這麼久（模擬網路慢、一方比較晚開打）。 */
  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyBOOQFpDRNq9VVmA-icCiZzrT4NoP4Huv0",
    authDomain: "ranger-kichiku.firebaseapp.com",
    databaseURL: "https://ranger-kichiku-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "ranger-kichiku",
    appId: "1:707177011859:web:021039344abe263cfc4b66",
  };
  const FB_SDK = "https://cdn.jsdelivr.net/npm/firebase@10.12.2/";
  const ONLINE = {
    DELAY: 4,          // 直連的輸入延遲（格）
    ROOM_TTL: 2 * 3600 * 1000, // 房間建立超過這麼久算過期（房主斷線時 Firebase 沒自動刪掉的會留下來）
    CLEAN_MAX: 20,     // 每次開房最多順便刪幾間過期房間（安全規則也限制一次最多查 20 間）
    RELAY_DELAY: 6,    // 轉送模式的輸入延遲（格；繞伺服器比較慢）
    P2P_TIMEOUT: 8000, // 幾毫秒內直連沒通就改轉送
    ICE: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }],
    CODE_CHARS: "ABCDEFGHJKMNPQRSTUVWXYZ23456789", // 房號不用容易看錯的 I、L、O、0、1
  };
  const qs = new URLSearchParams(location.search);

  function loadScriptOnce(src) {
    return new Promise((res, rej) => {
      if (document.querySelector(`script[src="${src}"]`)) return res();
      const sc = document.createElement("script"); sc.src = src; sc.onload = res; sc.onerror = () => rej(new Error("無法載入 " + src.split("/").pop()));
      document.head.appendChild(sc);
    });
  }

  /* 資料庫的小介面（真的 Firebase 跟假的都一樣）：
     set(路徑, 值)、update(路徑, 物件)、push(路徑, 值)、get(路徑)、remove(路徑)、
     watch(路徑, 回呼(值)) → 取消函式、added(路徑, 回呼(值)) → 取消函式（新增的子項目）、dropOnLeave(路徑)（斷線時自動刪）、uid、
     oldRooms(時間, 幾間) → 建立時間早於「時間」的房號清單（過期房間清理用） */
  let onlineDbPromise = null;
  function onlineDb() {
    if (!onlineDbPromise) onlineDbPromise = (qs.has("fakefb") ? fakeDb() : firebaseDb()).catch((e) => { onlineDbPromise = null; throw e; });
    return onlineDbPromise;
  }
  async function firebaseDb() {
    for (const f of ["firebase-app-compat.js", "firebase-auth-compat.js", "firebase-database-compat.js"]) await loadScriptOnce(FB_SDK + f);
    const fb = window.firebase, app = fb.apps.length ? fb.app() : fb.initializeApp(FIREBASE_CONFIG);
    const cred = await app.auth().signInAnonymously();
    const db = app.database(), R = (p) => db.ref(p);
    return {
      uid: cred.user.uid,
      set: (p, v) => R(p).set(v), update: (p, v) => R(p).update(v), push: (p, v) => R(p).push(v), remove: (p) => R(p).remove(),
      get: async (p) => (await R(p).get()).val(),
      watch: (p, cb) => { const f = (s) => cb(s.val()); R(p).on("value", f); return () => R(p).off("value", f); },
      added: (p, cb) => { const f = (s) => cb(s.val()); R(p).on("child_added", f); return () => R(p).off("child_added", f); },
      dropOnLeave: (p) => R(p).onDisconnect().remove(),
      oldRooms: async (before, n) => Object.keys((await db.ref("rooms").orderByChild("created").endAt(before).limitToFirst(n).get()).val() || {}),
    };
  }
  /* 假資料庫（只給本機測試用）：每個路徑各存成一筆 localStorage（rk_fakefb:路徑），
     兩個分頁同時寫不同路徑不會互相蓋掉；靠 storage 事件通知其他分頁 */
  async function fakeDb() {
    const PRE = "rk_fakefb:", uid = "u" + Math.random().toString(36).slice(2, 10), subs = new Set();
    const norm = (p) => p.split("/").filter(Boolean).join("/");
    const keys = () => { const out = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(PRE)) out.push(k.slice(PRE.length)); } return out; };
    const load = () => {
      const t = {};
      for (const k of keys().sort((x, y) => x.split("/").length - y.split("/").length)) {
        const ks = k.split("/"); let o = t;
        for (const x of ks.slice(0, -1)) o = o[x] = o[x] && typeof o[x] === "object" ? o[x] : {};
        try { o[ks[ks.length - 1]] = JSON.parse(localStorage.getItem(PRE + k)); } catch {}
      }
      return t;
    };
    const at = (t, p) => norm(p).split("/").reduce((o, k) => (o == null ? undefined : o[k]), t);
    const drop = (p) => { p = norm(p); for (const k of keys()) if (k === p || k.startsWith(p + "/")) localStorage.removeItem(PRE + k); };
    const put = (p, v) => localStorage.setItem(PRE + norm(p), JSON.stringify(v));
    const fire = () => { const t = load(); for (const s of subs) s(t); };
    const lag = +(qs.get("fakelag") || 0); // 測試：其他分頁的變化晚這麼多毫秒才看到（模擬手機網路慢）
    window.addEventListener("storage", (e) => { if (e.key && e.key.startsWith(PRE)) { if (lag) setTimeout(fire, lag); else fire(); } });
    let n = 0;
    return {
      uid,
      set: async (p, v) => { drop(p); if (v != null) put(p, v); fire(); },
      update: async (p, v) => { for (const [k, x] of Object.entries(v)) { drop(p + "/" + k); put(p + "/" + k, x); } fire(); },
      push: async (p, v) => { put(`${p}/${Date.now().toString(36)}${(n++).toString(36).padStart(4, "0")}${uid}`, v); fire(); },
      remove: async (p) => { drop(p); fire(); },
      get: async (p) => at(load(), p) ?? null,
      watch: (p, cb) => { let last; const s = (t) => { const v = JSON.stringify(at(t, p) ?? null); if (v !== last) { last = v; cb(JSON.parse(v)); } }; subs.add(s); s(load()); return () => subs.delete(s); },
      added: (p, cb) => { const seen = new Set(); const s = (t) => { const o = at(t, p) || {}; for (const k of Object.keys(o).sort()) if (!seen.has(k)) { seen.add(k); cb(o[k]); } }; subs.add(s); s(load()); return () => subs.delete(s); },
      dropOnLeave: (p) => window.addEventListener("pagehide", () => { drop(p); }),
      oldRooms: async (before, n) => Object.entries(load().rooms || {}).filter(([, r]) => r && r.created <= before).sort((a, b) => a[1].created - b[1].created).slice(0, n).map(([k]) => k),
    };
  }

  /* ---------- 房間 ---------- */
  const OL = { pend: {}, db: null, code: null, side: 0, room: null, unsub: [], link: null, pc: null, status: "", onChange: null, started: false };
  const olRoot = () => `rooms/${OL.code}`;
  // 連線紀錄（「複製連線紀錄」用；最多留 200 行）
  const OL_LOG = [], olT0 = Date.now();
  function olLog(msg) { OL_LOG.push(`${((Date.now() - olT0) / 1000).toFixed(1)}s ${msg}`); if (OL_LOG.length > 200) OL_LOG.shift(); }
  function olSet(status) { olLog("狀態：" + status); OL.status = status; if (OL.onChange) OL.onChange(); }
  function olCode() { let s = ""; for (let i = 0; i < 4; i++) s += ONLINE.CODE_CHARS[Math.floor(Math.random() * ONLINE.CODE_CHARS.length)]; return s; }
  // 建立房間（自己＝房主＝左方）
  async function olCreate(cfg) {
    olLeave();
    OL.db = await onlineDb();
    for (let k = 0; k < 5; k++) { const c = olCode(); if (!(await OL.db.get(`rooms/${c}`))) { OL.code = c; break; } }
    if (!OL.code) throw new Error("建立房間失敗，請再試一次");
    OL.side = 0;
    await OL.db.set(olRoot(), { host: OL.db.uid, created: Date.now(), cfg: Object.assign({ seed: newSeed(1e9), v: APP_VERSION }, cfg) });
    OL.db.dropOnLeave(olRoot()); // 房主離開＝房間消失
    olLog(`建立房間 ${OL.code}`); olWatch(); olSet("等待對手加入…");
    olCleanup();
  }
  // 加入房間（自己＝右方）
  async function olJoin(code) {
    olLeave();
    code = String(code || "").trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(code)) throw new Error("房號是 4 個英文或數字");
    OL.db = await onlineDb();
    const room = await OL.db.get(`rooms/${code}`);
    if (!room) throw new Error(`找不到房間 ${code}（可能已經關閉）`);
    if (room.guest && room.guest !== OL.db.uid) throw new Error(`房間 ${code} 已經滿了`);
    OL.code = code; OL.side = 1;
    await OL.db.set(`${olRoot()}/guest`, OL.db.uid);
    OL.db.dropOnLeave(`${olRoot()}/guest`); OL.db.dropOnLeave(`${olRoot()}/p1`);
    olLog(`加入房間 ${OL.code}`); olWatch(); olSet("已加入，建立連線中…");
    olConnect();
  }
  function olWatch() {
    let hadGuest = false;
    OL.unsub.push(OL.db.watch(olRoot(), (room) => {
      const was = OL.room; OL.room = room;
      if (!room) { olSet("房間已關閉（房主離開）"); olCloseLink(); return; }
      if (OL.side === 0 && room.guest && !hadGuest) { hadGuest = true; olSet("對手已加入，建立連線中…"); olConnect(); }
      if (OL.side === 0 && hadGuest && !room.guest) { hadGuest = false; olCloseLink(); olSet("對手離開了，等待新的對手…"); OL.db.remove(`${olRoot()}/sig`); OL.db.remove(`${olRoot()}/r0`); OL.db.remove(`${olRoot()}/r1`); OL.db.remove(`${olRoot()}/go`); }
      if (OL.onChange) OL.onChange(was);
    }));
  }
  function olLeave() {
    olCloseLink();
    for (const f of OL.unsub) f(); OL.unsub = [];
    if (OL.db && OL.code) { if (OL.side === 0) OL.db.remove(olRoot()); else { OL.db.remove(`${olRoot()}/guest`); OL.db.remove(`${olRoot()}/p1`); } }
    Object.assign(OL, { code: null, room: null, started: false, status: "" });
  }
  /* 過期房間清理：開房時順便刪掉建立超過 ROOM_TTL 的房間（最多 CLEAN_MAX 間）。
     平常房主離開時 Firebase 會自動刪房間；手機斷電、閃退時偶爾沒刪到，就靠這裡清。失敗不影響開房。 */
  async function olCleanup() {
    try {
      const old = (await OL.db.oldRooms(Date.now() - ONLINE.ROOM_TTL, ONLINE.CLEAN_MAX)).filter((c) => c !== OL.code);
      for (const c of old) await OL.db.remove(`rooms/${c}`);
      if (old.length) olLog(`清掉 ${old.length} 間過期房間`);
    } catch (e) { olLog("過期房間清理失敗：" + (e.message || e)); }
  }
  // 自己的選角：角色 id、雙方角色數值雜湊（兩邊算出來要一樣）、準備好了沒
  const olPick = (v) => OL.db && OL.code && OL.db.update(`${olRoot()}/p${OL.side}`, v);

  /* ---------- 連線：先試 WebRTC 直連，P2P_TIMEOUT 內沒通就改 Firebase 轉送 ---------- */
  function olCloseLink() {
    if (OL.link) { OL.link.closed = true; if (OL.link.close) OL.link.close(); }
    if (OL.pc) try { OL.pc.close(); } catch {}
    OL.link = null; OL.pc = null;
  }
  // 連線物件：{ kind: "p2p"／"relay", send(訊息), onmsg（收到時呼叫）, onclose, close() }
  function olLinkReady(link) {
    if (OL.link && OL.link !== link) return;
    OL.link = link; link.ready = true;
    link.onmsg = olOnMsg; // 一連上就開始收（對方可能比自己早開打，先到的按鍵存進 OL.pend）
    link.onclose = () => { olLog("直連關閉"); FG.olGone = true; };
    olSet(link.kind === "relay" ? "已連線（轉送模式：直連失敗，延遲會比較高）" : "已連線（直連）");
  }
  function olConnect() {
    olCloseLink();
    if (qs.has("relay") || !window.RTCPeerConnection) return olRelay();
    const pc = new RTCPeerConnection({ iceServers: ONLINE.ICE }); OL.pc = pc;
    const me = OL.side, other = 1 - me, sig = `${olRoot()}/sig`;
    const link = { kind: "p2p", onmsg: null, onclose: null };
    const bind = (ch) => {
      link.send = (m) => { if (ch.readyState === "open") ch.send(JSON.stringify(m)); };
      link.close = () => { try { ch.close(); } catch {} };
      ch.onmessage = (e) => link.onmsg && link.onmsg(JSON.parse(e.data));
      ch.onopen = () => olLinkReady(link);
      ch.onclose = () => { if (!link.closed && link.onclose) link.onclose(); };
    };
    pc.onicecandidate = (e) => { if (e.candidate) OL.db.push(`${sig}/c${me}`, JSON.stringify(e.candidate)); };
    OL.unsub.push(OL.db.added(`${sig}/c${other}`, (c) => pc.addIceCandidate(JSON.parse(c)).catch(() => {})));
    if (me === 0) {
      bind(pc.createDataChannel("rk", { ordered: true }));
      pc.createOffer().then((o) => pc.setLocalDescription(o)).then(() => OL.db.set(`${sig}/offer`, JSON.stringify(pc.localDescription)));
      OL.unsub.push(OL.db.watch(`${sig}/answer`, (a) => { if (a && !pc.currentRemoteDescription) pc.setRemoteDescription(JSON.parse(a)).catch(() => {}); }));
    } else {
      pc.ondatachannel = (e) => bind(e.channel);
      let done = false;
      OL.unsub.push(OL.db.watch(`${sig}/offer`, async (o) => {
        if (!o || done) return; done = true;
        await pc.setRemoteDescription(JSON.parse(o));
        const a = await pc.createAnswer(); await pc.setLocalDescription(a);
        OL.db.set(`${sig}/answer`, JSON.stringify(pc.localDescription));
      }));
    }
    // 直連沒通：雙方都改走轉送（房主寫 mode=relay，加入者看到也跟著改）
    pc.onconnectionstatechange = () => olLog("直連狀態：" + pc.connectionState);
    const t = setTimeout(() => { if (!link.ready && OL.pc === pc && me === 0) OL.db.set(`${olRoot()}/mode`, "relay"); }, ONLINE.P2P_TIMEOUT);
    OL.unsub.push(() => clearTimeout(t));
    OL.unsub.push(OL.db.watch(`${olRoot()}/mode`, (m) => { if (m === "relay" && (!OL.link || OL.link.kind !== "relay")) olRelay(); }));
  }
  function olRelay() {
    if (OL.pc) try { OL.pc.close(); } catch {}
    OL.pc = null;
    if (OL.side === 0) OL.db.set(`${olRoot()}/mode`, "relay");
    const me = OL.side, link = { kind: "relay", onmsg: null, onclose: null };
    link.send = (m) => OL.db.push(`${olRoot()}/r${me}`, m);
    const off = OL.db.added(`${olRoot()}/r${1 - me}`, (m) => link.onmsg && link.onmsg(m));
    link.close = off; OL.unsub.push(off);
    OL.link = link; olLinkReady(link);
  }

  /* ---------- 線上對戰的畫面（格鬥場設定頁裡的「線上對戰」區塊） ---------- */
  const olOther = () => (OL.room && OL.room[`p${1 - OL.side}`]) || null;
  const olMine = () => (OL.room && OL.room[`p${OL.side}`]) || null;
  // 雙方角色 id（照左右方：0＝房主）
  const olIds = () => { const a = OL.room && OL.room.p0, b = OL.room && OL.room.p1; return a && b && a.id && b.id ? [a.id, b.id] : null; };
  function olUi() {
    const inRoom = !!OL.code;
    $("fRoundBox").hidden = inRoom && OL.side === 1; // 回合數、秒數由房主決定
    $("fOnCreate").hidden = inRoom; $("fOnJoin").hidden = inRoom; $("fOnCode").hidden = inRoom; $("fOnLeave").hidden = !inRoom;
    $("fOnStatus").textContent = OL.status || "建立房間後把網址傳給朋友，或請朋友輸入房號。你的角色在左邊卡片選，右邊會顯示對手選的角色。";
    $("fOnShare").hidden = !(inRoom && OL.side === 0 && OL.room && !OL.room.guest);
    if (inRoom) $("fOnRoom").textContent = `房號 ${OL.code}`;
    const other = olOther(), mine = olMine(), connected = !!(OL.link && OL.link.ready);
    // 步驟：①開房／加入（連上對手才算完成）②選角色（雙方都選了）③準備開打
    const step = !inRoom || !connected ? 0 : !(other && other.id && mine && mine.id) ? 1 : 2;
    document.querySelectorAll("#fOnSteps li").forEach((li, k) => { li.classList.toggle("done", k < step); li.classList.toggle("now", k === step); });
    $("fOnReady").hidden = !(inRoom && connected && other && other.id);
    $("fOnReady").textContent = mine && mine.ready ? "取消準備" : "準備";
    const hashBad = mine && other && mine.h && other.h && mine.h !== other.h;
    $("fOnReadyMsg").textContent = !inRoom ? "" : hashBad ? "雙方的角色資料不一樣（網頁版本或資料不同），請兩邊都重新整理頁面" :
      !connected ? "" : !other || !other.id ? "等待對手選角色…" : other.ready && mine && mine.ready ? "雙方都準備好了，開打！" : other.ready ? "對手已準備" : "對手還沒準備";
    // 右邊卡片＝對手的角色
    const opp = other && other.id ? other.id : null;
    if (FG.olOpp !== opp) { FG.olOpp = opp; fightPanel(1); fightInfo(1); }
  }
  function olShareUrl() { return `${location.origin}${location.pathname}?app=fight&room=${OL.code}${qs.has("fakefb") ? "&fakefb=1" : ""}${qs.has("relay") ? "&relay=1" : ""}`; }
  async function olShowQr() {
    const box = $("fOnQr"); box.textContent = "";
    try {
      await loadScriptOnce("https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js");
      const q = window.qrcode(0, "M"); q.addData(olShareUrl()); q.make();
      box.innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    } catch { box.textContent = "（QR Code 載入失敗，請用複製網址）"; }
  }
  // 自己的選角寫進房間（換角色＝取消準備），並算雙方角色數值的雜湊
  async function olMyPick() {
    if (!OL.code) return;
    await olPick({ id: FG.set.c0, ready: false, h: null });
    olHash();
  }
  async function olHash() {
    const ids = olIds(); if (!ids) return;
    try {
      const fs = (await Promise.all(ids.map(fightLoad))).map(fightStats);
      const h = fightHashNums(2166136261, fs.map(fightStatsHash)).toString(16);
      const mine = olMine(); if (mine && mine.h !== h && JSON.stringify(olIds()) === JSON.stringify(ids)) olPick({ h });
    } catch {}
  }
  function olReady(on) { const mine = olMine(); if (mine && mine.id) { const v = on == null ? !mine.ready : on; olLog(v ? "按了準備" : "取消準備"); olPick({ ready: v }); } }
  // 房間有變化：更新畫面；房主看到雙方都準備好（雜湊一樣）就喊開打；兩邊看到新的 go 就開打
  let olLastGo = "", olLastIds = ""; // olLastGo＝「房號:第幾場」，避免同一場開兩次（換房間會從第 1 場重算）
  function olOnRoom() {
    if (FG.set.mode !== "online") return;
    olUi();
    const room = OL.room; if (!room) return;
    const ids = JSON.stringify(olIds()); if (ids !== olLastIds) { olLastIds = ids; olHash(); }
    const a = room.p0, b = room.p1;
    if (OL.side === 0 && a && b && a.ready && b.ready && a.h && a.h === b.h && OL.link && OL.link.ready && (!room.go || room.go.done)) {
      OL.db.remove(`${olRoot()}/r0`); OL.db.remove(`${olRoot()}/r1`);
      OL.db.set(`${olRoot()}/go`, { n: ((room.go && room.go.n) || 0) + 1, done: false });
      olLog(`房主喊開打（第 ${((room.go && room.go.n) || 0) + 1} 場）`);
    }
    const goKey = room.go ? `${OL.code}:${room.go.n}` : "";
    if (room.go && !room.go.done && goKey !== olLastGo) { olLastGo = goKey; olStartGame(room); }
  }
  async function olStartGame(room) {
    const ids = olIds(); if (!ids || !OL.link) return;
    try {
      const f = await Promise.all(ids.map(fightLoad)); FG.f = f; FG.fs = f.map(fightStats);
      for (const x of FG.fs) for (const k of x.sk) fightSkillIcon(k);
      const extra = await fightPrepareExtra(f), cfg = room.cfg || {};
      FG.g = fightNew({ f, fs: FG.fs, extra, rounds: cfg.rounds || 3, secs: cfg.secs || 60, mode: "online", seed: (cfg.seed || 1) + room.go.n,
        holdMove: !!(FIGHT_FIXED_OPTS || FG.set).holdMove, teleMode: (FIGHT_FIXED_OPTS || FG.set).teleMode === "sync" ? "sync" : "dist" });
      FG.cam = null; FG.pauseUntil = 0;
      FG.me = OL.side; FG.mirror = OL.side === 1; FG.ai = [{}, {}]; FG.acc = 0; FG.ctl = [fightCtl(), fightCtl()]; FG.olGone = false;
      /* 每則訊息標上第幾場（g）：對方可能比自己早開打，先到的訊息先存在 OL.pend，自己這場建好再補進去 */
      const link = OL.link, gn = room.go.n;
      const tagged = { kind: link.kind, ready: true, send: (m) => link.send(Object.assign(m, { g: gn })) };
      FG.net = netNew(link.kind === "relay" ? ONLINE.RELAY_DELAY : ONLINE.DELAY, 0, 0, tagged, OL.side); FG.net.game = gn;
      for (const m of OL.pend[gn] || []) netRecv(FG.net, m);
      olLog(`開打：第 ${gn} 場，${link.kind}，延遲 ${FG.net.delay} 格，先到的訊息 ${(OL.pend[gn] || []).length} 則，我是${OL.side ? "右方" : "左方"}`);
      OL.pend = {};
      $("fStage").hidden = false; $("fOver").hidden = true; $("fStage").classList.remove("pvp");
      $("fExit").textContent = "✕ 離開"; document.body.classList.add("fight-on");
      FG.running = true; sfxUnlock(); fightResize();
      OL.started = true;
    } catch (e) { $("fOnReadyMsg").textContent = "載入失敗：" + (e.message || e); }
  }
  function olOnMsg(m) {
    if (FG.net && FG.net.link && FG.net.game === m.g) return netRecv(FG.net, m);
    if (!FG.net || !(FG.net.game >= m.g)) (OL.pend[m.g] = OL.pend[m.g] || []).push(m); // 下一場的訊息先存著
  }
  // 對戰中每一幀：對手斷線、不同步 → 停下來顯示原因
  function olTick(g) {
    if (g !== FG.g) return; // 這一幀開頭拿到的是上一場（剛好開新的一場）
    const n = FG.net, bad = FG.olGone || !OL.room || !OL.room.guest ? "對手已斷線" : n && n.desync ? `同步錯誤（第 ${n.desync.f} 格雙方畫面不一樣），這場只好中止` : "";
    if (n && n.waiting && g.phase !== "over" && n.stallFrames % 120 === 119) olLog(`等待對手的按鍵中：第 ${n.frame} 格，自己的佇列 ${n.q[n.me].size}、對手的佇列 ${n.q[1 - n.me].size}`);
    if (bad && $("fOver").hidden) { olLog("停止：" + bad); g.phase = "over"; g.winner = -2; $("fOver").hidden = false; $("fOverText").textContent = bad; }
    if (g.phase === "over" && OL.started) olAfterGame(); // 打完：雙方都取消準備，下一場要各自再按「再一場」
  }
  // 打完或離開：取消準備；房主把 go 標成結束（下一場要雙方再按準備）
  function olAfterGame() {
    if (!OL.code || !OL.started) return;
    OL.started = false; olPick({ ready: false });
    if (OL.side === 0 && OL.room && OL.room.go) OL.db.update(`${olRoot()}/go`, { done: true });
  }
  // 連線紀錄：網頁版本、裝置、房間狀態（不含連線細節）、連線層統計、最近的事件
  function olReport() {
    const r = OL.room ? Object.assign({}, OL.room) : null, n = FG.net;
    if (r) { delete r.sig; delete r.r0; delete r.r1; for (const k of ["host", "guest"]) if (r[k]) r[k] = String(r[k]).slice(0, 4) + "…"; }
    return [`ranger-kichiku ${APP_VERSION} 線上對戰紀錄`, navigator.userAgent, `房號 ${OL.code || "－"}、我是${OL.side ? "右方（加入者）" : "左方（房主）"}、連線 ${OL.link ? OL.link.kind + (OL.link.ready ? "（已連上）" : "") : "沒有"}`,
      n ? `對戰：第 ${n.frame} 格、延遲 ${n.delay} 格、卡頓 ${n.stalls} 次（共 ${n.stallFrames} 格）、佇列 ${n.q[0].size}／${n.q[1].size}、不同步 ${JSON.stringify(n.desync)}、狀態 ${FG.g && FG.g.phase}` : "對戰：還沒開始",
      `房間：${JSON.stringify(r)}`, "—— 事件 ——", ...OL_LOG].join("\n");
  }
  OL.onChange = () => olOnRoom();
  $("fOnCreate").onclick = async () => {
    $("fOnStatus").textContent = "建立房間中…";
    try { await olCreate({ rounds: FG.set.rounds, secs: FG.set.secs }); await olMyPick(); olUi(); olShowQr(); }
    catch (e) { $("fOnStatus").textContent = "建立失敗：" + (e.message || e); }
  };
  $("fOnJoin").onclick = async () => {
    $("fOnStatus").textContent = "加入中…";
    try { await olJoin($("fOnCode").value); await olMyPick(); olUi(); }
    catch (e) { $("fOnStatus").textContent = "加入失敗：" + (e.message || e); }
  };
  $("fOnLeave").onclick = () => { olLeave(); FG.olOpp = null; olUi(); fightSetupUi(); };
  $("fOnReady").onclick = () => olReady();
  $("fOnLog").onclick = async () => { const t = olReport(); try { await navigator.clipboard.writeText(t); $("fOnLogMsg").textContent = "已複製，貼給開發者即可"; } catch { $("fOnLogMsg").textContent = t; } };
  // 房主開房後改回合數／秒數：寫進房間設定
  for (const id of ["fRounds", "fSecs"]) $(id).addEventListener("change", () => { if (OL.code && OL.side === 0) OL.db.update(`${olRoot()}/cfg`, { rounds: FG.set.rounds, secs: FG.set.secs }); });
  $("fOnCopy").onclick = async () => { try { await navigator.clipboard.writeText(olShareUrl()); $("fOnCopied").textContent = "已複製"; } catch { $("fOnCopied").textContent = olShareUrl(); } };
  // 網址帶房號（朋友點分享連結進來）：切到線上對戰並自動加入
  async function olAutoJoin() {
    const code = qs.get("room"); if (!code || OL.code) return;
    FG.set.mode = "online"; fightSetupUi();
    $("fOnCode").value = code; $("fOnJoin").click();
  }
