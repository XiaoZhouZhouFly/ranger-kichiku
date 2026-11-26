  /* ---------- 格鬥場新版介面（v7.6，測試中） ----------
     規格：專案根目錄「格鬥場改版_圖檔與施作說明」。預設維持原版，「介面：原版／新版」開關切換（存這台裝置；網址 ?fui=new／old 只影響這一次）。
     做法：新版設定頁是另一層畫面（#fxSetup）；原本的控制（開始鈕、難度、回合、畫面方向、測試工具、線上、角色庫）在切成新版時
     「整個搬」到新版的位置，切回原版再搬回原處，所以它們原本的功能與健檢都不受影響。
     對戰畫面只改「怎麼畫」與「暫停」：暫停時引擎不前進（本機模式）；線上對戰不能暫停，按鈕只打開選單。
     戰鬥規則、數值、同步碼都不動。這個檔案只在開關打開時才做事（fuiOn() 為 false 時所有入口都直接返回）。 */
  const FUI_KEY = "fightUi";
  const FUI = { on: false, moved: [], dbl: 0, waitSince: 0 };
  const fuiOn = () => FUI.on;
  const FUI_MODE = { dummy: "打木樁", cpu: "打電腦", pvp: "兩人同機", online: "線上對戰" };
  const FUI_LEVEL = { easy: "簡單", normal: "普通", hard: "困難" };
  const FUI_SUP = { ok: ["完整支援", "ok"], guess: ["有推測", "guess"], unsup: ["部分支援", "unsup"], unfit: ["不適合", "unfit"] };
  // 線條圖示（SVG，stroke 2.6、round cap）
  const fuiIcon = (d, size = 22) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const FUI_ICONS = {
    swap: '<path d="M7 7h12l-3-3M17 17H5l3 3"/>', dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.2" fill="currentColor"/><circle cx="15" cy="15" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
    pause: '<path d="M9 6v12M15 6v12"/>', play: '<path d="M8 5l11 7-11 7z" fill="currentColor"/>', restart: '<path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5"/>',
    leave: '<path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9"/>', chev: '<path d="M6 9l6 6 6-6"/>', alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/>',
  };

  /* ---------- 開關 ---------- */
  function fuiInit() {
    const q = new URLSearchParams(location.search).get("fui");
    let on = false; try { on = store.get(FUI_KEY, "old") === "new"; } catch {}
    if (q === "new" || q === "old") on = q === "new";
    // 原版設定頁最上面加一個「介面」選項（新版裡也有一份在「更多設定」）
    const box = document.createElement("div"); box.className = "group"; box.id = "fUiBox";
    box.innerHTML = '<span class="lbl">介面</span><div class="chips"><button class="chip" type="button" data-fui="old">原版</button><button class="chip" type="button" data-fui="new">新版（測試）</button></div>';
    document.querySelector(".fight-setup").prepend(box);
    document.querySelectorAll("[data-fui]").forEach((b) => (b.onclick = () => fuiSet(b.dataset.fui === "new", true)));
    // 全螢幕鈕（頁首右上角；只在新版顯示；瀏覽器不支援時不出現，例如 iPhone Safari、部分內嵌頁）
    const fs = document.createElement("button"); fs.type = "button"; fs.id = "fxFull"; fs.className = "fx-full";
    fs.onclick = fuiFullToggle; document.querySelector(".brand").appendChild(fs); // 放在頁首自己的排版裡（不用絕對定位，不會壓到分頁）
    window.addEventListener("resize", () => { clearTimeout(FUI.fitT); FUI.fitT = setTimeout(fuiFit, 120); });
    try { document.fonts.ready.then(() => setTimeout(fuiFit, 30)); document.fonts.addEventListener("loadingdone", () => setTimeout(fuiFit, 30)); } catch {} // 網頁字型載完後字變寬：重新排一次
    document.addEventListener("fullscreenchange", fuiFullUi); document.addEventListener("webkitfullscreenchange", fuiFullUi);
    fuiSet(on, false);
  }
  // 切換：存檔、頁首樣式、把原本的控制搬過去／搬回來
  function fuiSet(on, save) {
    if (save) { try { store.set(FUI_KEY, on ? "new" : "old"); } catch {} }
    FUI.on = on;
    document.body.classList.toggle("fui-new", on); // 頁首（三個模式共用）的新樣式跟著開關走
    document.querySelectorAll("[data-fui]").forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.fui === "new") === on)));
    $("fxSetup").hidden = !on; document.querySelector(".fight-setup").hidden = on;
    if (on) fuiMoveIn(); else fuiMoveOut();
    fuiRefresh(); fuiFullUi(); setTimeout(fuiFit, 50);
  }
  /* 第一眼的版面（v7.6）：量目前畫面還剩多少高度。
     有多的空間：加大區塊之間的間距，並把「更多設定」與最下方的小字推到第一屏之下；空間不夠：維持緊湊（CSS 依高度縮放）。 */
  function fuiFit() {
    const box = $("fxSetup"); if (!fuiOn() || box.hidden || FG.running) return;
    const st = box.style; st.setProperty("--fx-extra", "0px"); st.setProperty("--fx-ava-x", "0px"); st.removeProperty("min-height");
    fuiStatsFit(); fuiNameFit(0); fuiNameFit(1);
    const anchors = [$("fxTools"), box.querySelector(".fx-cards"), $("fxOlJoin")]; for (const a of anchors) a.style.marginBottom = "";
    // v7.6.1 手機橫放的對齊（下面設定的位置）每次先清掉：轉回直向、或平板橫放時都不能留著
    const colC = box.querySelector(".fx-col.is-c"), how = $("fxOlHow"), join = $("fxOlJoin");
    colC.style.paddingTop = ""; how.style.marginTop = ""; join.style.marginTop = ""; join.style.height = "";
    // 線上對戰沒有交換／隨機：改以角色卡（或加入房間卡）為準；底部按鈕列也換成線上那一條
    const anchor = anchors.find((a) => a.offsetParent !== null) || $("fxTools"), barEl = $("fxStartBar").hidden ? $("fxOlBar") : $("fxStartBar");
    const land = window.innerWidth > window.innerHeight, H = window.innerHeight, top = box.getBoundingClientRect().top + window.scrollY;
    const bottomOf = (el) => el.getBoundingClientRect().bottom + window.scrollY;
    if (!land) {
      const bar = barEl.getBoundingClientRect().height, room = H - bar - bottomOf(anchor) - 8;
      if (room <= 0) return;
      st.setProperty("--fx-extra", Math.min(room * 0.5 / 6, 14).toFixed(1) + "px");
      const left = H - bar - bottomOf(anchor);
      anchor.style.marginBottom = Math.max(12, left + 12) + "px"; // 更多設定從第一屏之下開始
    } else if (!matchMedia("(orientation: landscape) and (max-height: 500px)").matches) {
      // 平板橫放（高度超過 500）：跟 v7.6 一樣
      const cols = [...box.querySelectorAll(".fx-col")].map(bottomOf), room = H - Math.max(...cols) - 8;
      if (room > 0) st.setProperty("--fx-extra", Math.min(room / 5, 12).toFixed(1) + "px");
      st.minHeight = Math.max(0, H - top) + "px";
    } else {
      // v7.6.1：三欄等高（＝畫面扣掉頁首），多出來的高度給角色卡（頭像放大），不再平均加間距
      st.minHeight = Math.max(0, H - top) + "px";
      // 開始鈕往下長，最多到「打木樁」按鈕的兩倍高（進房後左欄沒有模式按鈕，沿用上次量到的）
      const m0 = document.querySelector('#fxModes [data-fxmode="dummy"]'), mh = m0 && m0.offsetParent ? m0.getBoundingClientRect().height : 0;
      if (mh) FUI.startMax = mh * 2; if (FUI.startMax) st.setProperty("--fx-start-max", FUI.startMax.toFixed(1) + "px");
      // 右欄：開始鈕（線上＝建立房間／我準備好了）的上緣對齊左欄「打木樁」按鈕的上緣（進房後沿用上次量到的）
      if (mh) FUI.cTop = m0.getBoundingClientRect().top - colC.getBoundingClientRect().top;
      if (FUI.cTop > 0) colC.style.paddingTop = FUI.cTop.toFixed(1) + "px";
      // 線上步驟說明：中心線對齊「打木樁」按鈕的上緣
      if (how.offsetParent && mh) { const r = how.getBoundingClientRect(); how.style.marginTop = Math.max(0, m0.getBoundingClientRect().top - r.height / 2 - r.top).toFixed(1) + "px"; }
      // 線上（還沒進房）：「加入房間」框上緣對齊「打木樁」按鈕的中心線、下緣對齊「線上對戰」按鈕的下緣
      //（小畫面說明比較高時，框往下讓，跟說明至少留 6 點）
      const m3 = document.querySelector('#fxModes [data-fxmode="online"]');
      if (join.offsetParent && mh && m3 && m3.offsetParent) {
        const mr = m0.getBoundingClientRect(), jt = join.getBoundingClientRect().top;
        const want = Math.max(mr.top + mr.height / 2, how.offsetParent ? how.getBoundingClientRect().bottom + 6 : 0);
        join.style.marginTop = (want - jt).toFixed(1) + "px"; // 可以是負的（欄內間距 10，比 6 大）
        const hgt = m3.getBoundingClientRect().bottom - want; if (hgt > 0) join.style.height = hgt.toFixed(1) + "px";
      }
      const cards = box.querySelector(".fx-cards"), card = $("fxCard0");
      if (cards.offsetParent) {
        box.classList.add("is-measure"); const h0 = card.getBoundingClientRect().height; box.classList.remove("is-measure");
        const free = card.getBoundingClientRect().height - h0;
        // 頭像放大會讓名字區變窄：名字因此要被截成「…」的話，頭像就少放大一點（名字優先）
        if (free > 4) for (const x of [Math.min(free * 0.6, 28), Math.min(free * 0.3, 14), 0]) {
          st.setProperty("--fx-ava-x", x.toFixed(1) + "px"); fuiNameFit(0); fuiNameFit(1);
          if ([0, 1].every((i) => !$(`fxName${i}`).classList.contains("is-clamp") && $(`fxName${i}`).clientWidth >= 64)) break; // 名字區至少留 64 點寬
        }
        fuiStatsFit();
      }
    }
  }
  // 角色卡名字（v7.6.1）：最多兩行；不讓最後一個字單獨一行；有空格時優先在空格換行；放不下先縮小一級字，再不行才「…」
  function fuiName(i, text) { const el = $(`fxName${i}`); el.dataset.full = text; el.textContent = text; fuiNameFit(i); }
  function fuiNameFit(i) {
    const el = $(`fxName${i}`), full = el.dataset.full; if (full == null) return;
    el.style.fontSize = ""; el.classList.remove("is-clamp"); el.textContent = full;
    if (!el.offsetParent) return;
    const parts = full.split(/[ 　]+/).filter(Boolean);
    const lines = () => Math.round(el.scrollHeight / (parseFloat(getComputedStyle(el).lineHeight) || 18));
    let cut = full.length; for (let n = 0; cut > 0 && n < 2; ) if (full[--cut].trim()) n++; // 最後兩個「看得到的字」黏在一起（中間的空格也一起）
    const plain = () => { el.textContent = ""; if (cut > 0) { el.append(full.slice(0, cut)); const g = document.createElement("span"); g.className = "fx-nglue"; g.textContent = full.slice(cut); el.append(g); } else el.append(full); };
    const split = () => { el.textContent = ""; parts.forEach((p, k) => { if (k) el.append(" "); const s = document.createElement("span"); s.className = "fx-nseg"; s.textContent = p; el.append(s); }); };
    const fits = () => {
      plain(); if (lines() <= 1) return true;
      // 空格後只有一個字（例如「… 琉」）就不在空格換行
      if (parts.length > 1 && [...parts[parts.length - 1]].length > 1) { split(); const W = el.clientWidth + 0.5; if ([...el.children].every((s) => s.getBoundingClientRect().width <= W) && lines() <= 2) return true; plain(); }
      return lines() <= 2;
    };
    if (fits()) return;
    el.style.fontSize = Math.max(11, parseFloat(getComputedStyle(el).fontSize) - 2) + "px";
    if (fits()) return;
    el.classList.add("is-clamp");
  }
  // 角色卡數字：字太寬（手機寬字型、放大字）時把數字縮小，不讓數字超出卡片
  function fuiStatsFit() {
    for (const st of document.querySelectorAll("#fxSetup .fx-stats")) {
      const bs = [...st.querySelectorAll("b")], card = st.closest(".fx-card"); bs.forEach((b) => (b.style.fontSize = "")); st.classList.remove("is-wrap");
      if (!bs.length || !card || !st.offsetParent) continue;
      const over = () => { // 數字或圖示跑到卡片邊框（含 2px 留白）外面
        const c = card.getBoundingClientRect(), pad = card.clientLeft + 2;
        return [...st.children].some((x) => { const r = x.getBoundingClientRect(); return r.right > c.right - pad || r.left < c.left + pad; });
      };
      if (!over()) continue;
      const base = parseFloat(getComputedStyle(bs[0]).fontSize);
      let s = 1; while (s > 0.8 && over()) { s -= 0.05; bs.forEach((b) => (b.style.fontSize = (base * s).toFixed(1) + "px")); }
      if (over()) { st.classList.add("is-wrap"); bs.forEach((b) => (b.style.fontSize = "")); } // 縮到八成還放不下：改兩行
      for (s = 0.95; s > 0.6 && over(); s -= 0.05) bs.forEach((b) => (b.style.fontSize = (base * s).toFixed(1) + "px"));
    }
  }
  /* ---------- 全螢幕 ---------- */
  const fuiFullOk = () => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  const fuiIsFull = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  function fuiFullToggle() {
    try {
      if (fuiIsFull()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else { const el = document.documentElement, f = el.requestFullscreen || el.webkitRequestFullscreen; const pr = f && f.call(el, { navigationUI: "hide" }); if (pr && pr.catch) pr.catch(() => {}); }
    } catch {}
  }
  function fuiFullUi() {
    const b = $("fxFull"); if (!b) return;
    const full = fuiIsFull();
    b.hidden = !fuiOn() || !fuiFullOk();
    b.setAttribute("aria-label", full ? "離開全螢幕" : "全螢幕");
    b.innerHTML = fuiIcon(full ? '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>' : '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>', 22) + `<span>${full ? "離開全螢幕" : "全螢幕"}</span>`;
    setTimeout(fuiPlaceBtn, 300); // 全螢幕切換後畫面大小變了
  }
  // 要搬的東西：[元素, 新版的位置]
  function fuiMoveIn() {
    if (FUI.moved.length) return;
    const orient = $("fOrient").closest(".group"), help = document.querySelector(".fight-help");
    const list = [[$("fDummyBox"), "fxDummySlot"], [$("fCpuBox"), "fxCpuSlot"], [$("fOnlineBox"), "fxOnlineSlot"], [$("fLibHolder"), "fxLibSlot"],
      [$("fRoundBox"), "fxMoreBody"], [orient, "fxMoreBody"], [$("fAdvBox"), "fxMoreBody"], [help, "fxMoreBody"], [$("fStart"), "fxStartSlot"], [$("fStartMsg"), "fxStartSlot"]];
    for (const [el, slot] of list) {
      if (!el) continue;
      const mark = document.createComment("fui"); el.before(mark); FUI.moved.push([el, mark]);
      $(slot).appendChild(el);
    }
    $("fStart").appendChild($("fxSum")); // 小字摘要放進開始鈕裡
  }
  function fuiMoveOut() {
    $("fxStartBar").appendChild($("fxSum"));
    for (const [el, mark] of FUI.moved.reverse()) { mark.replaceWith(el); }
    FUI.moved = [];
  }

  /* ---------- 新版設定頁 ---------- */
  function fuiBind() {
    document.querySelectorAll("#fxModes [data-fxmode]").forEach((b) => (b.onclick = () => { const o = document.querySelector(`#fMode [data-fmode="${b.dataset.fxmode}"]`); if (o) o.click(); }));
    for (const i of [0, 1]) $(`fxCard${i}`).onclick = () => { if (FG.set.mode === "online" && i === 1) return; fxpOpen(i); }; // B 段：新的選角面板
    $("fxSwap").onclick = () => $("fSwap").click();
    $("fxRand").onclick = () => $("fRandAll").click();
    $("fxPauseBtn").onclick = fuiPausePress;
    // 手機橫放時「更多設定」展開會浮在右欄上面（CSS）；原位留一塊一樣高的空位，開始鈕才不會跟著移動
    for (const [d, sp] of [["fxMore", "fxMoreSpace"], ["fxOlHelp", "fxOlHelpSpace"]]) $(d).addEventListener("click", (e) => { if (e.target.closest("summary") && !$(d).open) $(sp).style.height = $(d).getBoundingClientRect().height + "px"; });
    $("fxModeHelp").onclick = () => { const box = $("fxModeHelpBox"), open = box.hidden; box.hidden = !open; $("fxModeHelp").setAttribute("aria-expanded", String(open)); fuiFit(); }; // 模式說明
    document.addEventListener("keydown", (e) => { if (!fuiOn() || !FG.running || FG.replay) return; if (e.key === "Escape") { e.preventDefault(); FUI.dbl = Date.now(); fuiPausePress(); } });
  }
  // 設定頁內容跟著目前設定更新（原版的 fightSetupUi／fightPanel 改完時呼叫）
  function fuiRefresh() {
    if (!fuiOn() || !FG.set) return;
    const st = FG.set, online = st.mode === "online";
    document.querySelectorAll("#fxModes [data-fxmode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.fxmode === st.mode)));
    $("fxDummySlot").hidden = st.mode !== "dummy"; $("fxCpuSlot").hidden = st.mode !== "cpu"; $("fxPvpSlot").hidden = st.mode !== "pvp"; $("fxOnlineSlot").hidden = true; // 線上：改用 C 段的新畫面（js-19-fight-uiol.js），原本的區塊藏著
    fuiOl();
    $("fxTools").hidden = online; $("fxStartBar").hidden = online;
    const tagR = { dummy: "木樁", cpu: "電腦", pvp: "玩家 2", online: "對手" }[st.mode];
    $("fxTag0").textContent = st.mode === "pvp" ? "玩家 1" : "你"; $("fxTag1").textContent = tagR;
    for (const i of [0, 1]) fuiCard(i);
    fuiSummary(); fuiFoot(); clearTimeout(FUI.fitT); FUI.fitT = setTimeout(fuiFit, 60);
  }
  // 頁面最下方的小字：模式說明（木樁）＋角色數量與資料日期（原本在頁首、木樁選項下面）
  function fuiFoot() {
    const lines = [];
    const dh = $("fDummyBox").querySelector(".hint"); if (FG.set.mode === "dummy" && dh) lines.push(dh.textContent);
    const note = $("modeNote").textContent.trim(); if (note) lines.push(note);
    $("fxFoot").textContent = ""; for (const t of lines) { const p = document.createElement("p"); p.textContent = t; $("fxFoot").appendChild(p); }
    // 手機橫放（v7.6.1）：模式說明放在中欄選項列下面、資料小字放進「更多設定」；直向仍用上面的 fxFoot
    $("fxOptHint").textContent = FG.set.mode === "dummy" && dh ? dh.textContent : ""; $("fxMoreNote").textContent = note;
  }
  async function fuiCard(i) {
    const id = fightCardId(i), card = $(`fxCard${i}`), blind = i === 0 && FXP.hidden0 && FXP.hidden0 === id; // 盲選：玩家 2 選角時先藏起玩家 1 的角色
    const r = !blind && id && S.index.find((x) => x.id === id);
    if (blind) { fuiName(i, "已選好（盲選）"); $(`fxSup${i}`).textContent = ""; $(`fxAva${i}`).textContent = ""; $(`fxStats${i}`).textContent = ""; return; }
    const waiting = FG.set.mode === "online" && i === 1 && !r;
    card.classList.toggle("is-wait", waiting); card.disabled = FG.set.mode === "online" && i === 1;
    fuiName(i, r ? r.name : waiting ? "等待對手" : "未選擇");
    const sup = $(`fxSup${i}`), c = r ? fightCompatOf(r) : null, lab = waiting ? ["對手選擇中…", "wait"] : c ? FUI_SUP[c.lvl] : null;
    sup.textContent = lab ? lab[0] : ""; sup.className = "fx-sup" + (lab ? " is-" + lab[1] : ""); sup.title = c && c.why ? c.why : "";
    card.setAttribute("aria-label", `${i ? "右方" : "左方"}角色：${r ? r.name : "未選擇"}${lab ? "，" + lab[0] : ""}，點一下更換`);
    const ava = $(`fxAva${i}`); ava.textContent = "";
    if (r) { const img = document.createElement("img"); img.alt = ""; img.loading = "lazy"; const urls = thumbUrls(r.id); let n = 0; img.onerror = () => { if (++n < urls.length) img.src = urls[n]; }; img.src = urls[0]; ava.appendChild(img); }
    const stats = $(`fxStats${i}`); stats.innerHTML = r ? fuiStatsHtml(null) : "";
    if (!r) return;
    try {
      const fs = fightStats(await fightLoad(r.id));
      if (fightCardId(i) === id) stats.innerHTML = fuiStatsHtml(fs);
    } catch { /* 讀不到就留「—」 */ }
  }
  // 數值三格：直向顯示文字標籤；橫向改成小圖示一橫排（CSS 切換）
  const FUI_STAT_ICON = { 血量: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>', 攻擊: '<path d="M14 4h6v6L9 21l-6-6z"/><path d="M5 13l6 6"/>', 速度: '<path d="M7 3h5v8l6 3a2 2 0 0 1 2 2v3H5V3z"/><path d="M5 16h15"/>' }; // 速度＝靴子
  const fuiStatsHtml = (fs) => [["血量", fs && fs.hp], ["攻擊", fs && fs.atk && fs.atk.dmg], ["速度", fs && Math.round(fs.walk)]]
    .map(([k, v]) => `<span title="${k}"><i class="fx-sico" aria-hidden="true">${fuiIcon(FUI_STAT_ICON[k], 15)}</i><small>${k}</small><b aria-label="${k} ${v == null ? "未知" : Math.round(v)}">${v == null ? "—" : Math.round(v)}</b></span>`).join("");
  // 開始列的小字：模式・左 vs 右；有部分支援／有推測的角色就註明
  function fuiSummary() {
    const st = FG.set, rs = [0, 1].map((i) => S.index.find((x) => x.id === fightCardId(i)));
    const lv = rs.map((r) => (r ? fightCompatOf(r).lvl : null));
    let s = `${FUI_MODE[st.mode]}${st.mode === "cpu" ? "・" + FUI_LEVEL[st.level] : ""}`; // 不放角色名字（使用者決定）
    if (lv.includes("unsup")) s += "・含部分支援角色"; else if (lv.includes("guess")) s += "・含有推測角色";
    $("fxSum").textContent = s;
  }

  /* ---------- 對戰：暫停鈕、暫停選單 ---------- */
  // 開打時（一般對戰與線上）呼叫：決定暫停鈕顯不顯示、放哪裡
  function fuiOnStart() {
    fuiCloseMenu(); fuiNoticeClose(); FUI.waitSince = 0; FG.paused = false;
    if (!FG.replay) FXP.prevPair = [FG.set.c0, FG.set.c1]; // 選角的「同上一場」
    const on = fuiOn() && !FG.replay;
    $("fxPauseBtn").hidden = !on; $("fExit").hidden = on;
    if (on) fuiPlaceBtn();
  }
  // 暫停鈕的位置（畫布座標 → 螢幕）：直向＝右側 HUD 內、橫向＝左上、兩人同機＝中央條左側
  function fuiPlaceBtn() {
    if (!fuiOn() || FG.replay) return;
    const r = fcv.getBoundingClientRect(), k = r.width / FW, L = fightLayout(), b = $("fxPauseBtn");
    const [x, y] = L.pvp ? [56, L.hud.y + L.hud.h / 2] : L.land ? [52, 52] : [FW - 54, 146]; // 直向：右側血條下方（不蓋住血條）
    const size = Math.max(44, 84 * k), sr = $("fStage").getBoundingClientRect();
    Object.assign(b.style, { width: size + "px", height: size + "px", left: r.left - sr.left + x * k - size / 2 + "px", top: r.top - sr.top + y * k - size / 2 + "px" });
    b.classList.toggle("is-rot", !!L.pvp);
  }
  // 按暫停：兩人同機要在 1.5 秒內按兩次（防誤觸）
  function fuiPausePress() {
    if (!FG.running || FG.replay) return;
    const g = FG.g; if (!g || g.phase === "over") return;
    if (FG.set.mode === "pvp" && Date.now() - FUI.dbl > 1500) { FUI.dbl = Date.now(); fuiHint("再按一次暫停"); return; }
    FUI.dbl = 0; fuiOpenMenu();
  }
  function fuiHint(text) {
    const h = $("fxHint"); h.textContent = text; h.hidden = false;
    clearTimeout(FUI.hintT); FUI.hintT = setTimeout(() => (h.hidden = true), 1500);
  }
  function fuiOpenMenu() {
    const online = FG.set.mode === "online", pvp = FG.set.mode === "pvp", g = FG.g;
    if (!online) FG.paused = true; // 本機模式：整個停住（含倒數計時）；線上不能停
    const t = Math.max(0, Math.floor(g.t)), sub = online ? "線上對戰不會暫停，對戰還在進行" : `${FUI_MODE[FG.set.mode]}　已進行 ${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
    const box = $("fxPause"); box.textContent = ""; box.classList.toggle("is-pvp", pvp);
    for (const who of pvp ? [1, 0] : [0]) box.appendChild(fuiMenuCard(online ? "選單" : "暫停", sub, online, who));
    box.hidden = false;
    const first = box.querySelector("[data-act=resume]"); if (first) first.focus();
  }
  function fuiMenuCard(title, sub, online, who) {
    const card = document.createElement("div"); card.className = "fx-pcard" + (who === 1 ? " is-top" : ""); card.setAttribute("role", "dialog"); card.setAttribute("aria-label", title);
    const btn = (act, cls, icon, text, extra) => `<button class="fx-pbtn ${cls}" type="button" data-act="${act}">${fuiIcon(FUI_ICONS[icon])}<span>${text}</span>${extra ? `<small>${extra}</small>` : ""}</button>`;
    card.innerHTML = `<h2>${title}</h2><p class="fx-psub">${sub}</p>` +
      btn("resume", "is-main", "play", "繼續") + (online ? "" : btn("restart", "", "restart", "重新開始")) +
      (fuiFullOk() ? `<button class="fx-pbtn" type="button" data-act="full">${fuiIcon('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>')}<span>${fuiIsFull() ? "離開全螢幕" : "全螢幕"}</span></button>` : "") + btn("leave", "is-danger", "leave", "離開對戰") +
      '<p class="fx-pnote">點「離開對戰」會再確認一次</p>';
    card.onclick = (e) => {
      const b = e.target.closest("[data-act]"); if (!b) return;
      const act = b.dataset.act;
      if (act === "resume") fuiCloseMenu();
      else if (act === "full") { fuiFullToggle(); fuiCloseMenu(); }
      else if (act === "restart") { fuiCloseMenu(); fightStart(); }
      else if (act === "leave") fuiConfirmLeave(card);
      else if (act === "leave-yes") { fuiCloseMenu(); fightStop(); }
      else if (act === "leave-no") { fuiCloseMenu(); fuiOpenMenu(); }
    };
    return card;
  }
  function fuiConfirmLeave(card) {
    card.querySelectorAll(".fx-pbtn, .fx-pnote").forEach((x) => x.remove());
    card.querySelector("h2").textContent = "確定要離開？";
    card.querySelector(".fx-psub").textContent = FG.set.mode === "online" ? "離開後這場對戰會結束，對手會收到通知" : "這場對戰的進度不會保留";
    card.insertAdjacentHTML("beforeend", `<button class="fx-pbtn is-danger-fill" type="button" data-act="leave-yes">${fuiIcon(FUI_ICONS.leave)}<span>確定離開</span></button><button class="fx-pbtn" type="button" data-act="leave-no"><span>取消，回到選單</span></button>`);
  }
  function fuiCloseMenu() { $("fxPause").hidden = true; $("fxPause").textContent = ""; FG.paused = false; FG.acc = 0; }

  /* ---------- 線上：對手離開／沒有回應的彈窗（同暫停選單的樣式） ---------- */
  function fuiNotice(title, text, wait) {
    const box = $("fxNotice");
    if (!box.hidden && box.dataset.title === title) return;
    box.dataset.title = title; box.textContent = "";
    const card = document.createElement("div"); card.className = "fx-pcard"; card.setAttribute("role", "alertdialog"); card.setAttribute("aria-label", title);
    card.innerHTML = `<h2>${fuiIcon(FUI_ICONS.alert, 26)} ${title}</h2><p class="fx-psub">${text}</p>` +
      (wait ? `<button class="fx-pbtn" type="button" data-act="wait"><span>再等一下</span></button>` : "") +
      `<button class="fx-pbtn is-main" type="button" data-act="back">${fuiIcon(FUI_ICONS.leave)}<span>返回選角</span></button>`;
    card.onclick = (e) => { const b = e.target.closest("[data-act]"); if (!b) return; if (b.dataset.act === "wait") { FUI.waitSince = Date.now(); fuiNoticeClose(); } else { fuiNoticeClose(); fightStop(); } };
    box.appendChild(card); box.hidden = false;
  }
  function fuiNoticeClose() { const box = $("fxNotice"); box.hidden = true; box.textContent = ""; box.dataset.title = ""; }
  // 線上每一幀（olTick 呼叫）：對手 8 秒沒有送按鍵就問要不要繼續等。回傳 true＝這一幀由新版處理掉了
  function fuiOnlineTick(g, bad) {
    if (!fuiOn()) return false;
    if (bad) { if (g.phase !== "over") { g.phase = "over"; g.winner = -2; } fuiNotice(FG.olGone === "left" ? "對手離開了" : "連線中斷", bad + "。", false); return true; }
    const n = FG.net;
    if (n && n.waiting && g.phase !== "over") {
      if (!FUI.waitSince) FUI.waitSince = Date.now();
      if (Date.now() - FUI.waitSince > 8000) fuiNotice("對手沒有回應", "已經 8 秒沒有收到對手的操作，可能斷線了。可以再等一下，或回到選角。", true);
    } else { FUI.waitSince = 0; if ($("fxNotice").dataset.title === "對手沒有回應") fuiNoticeClose(); } // 對手恢復了：自動收起
    return false;
  }

  /* ---------- 對戰畫面：新版 HUD（單人直向／橫向）、兩人同機的血量數字 ---------- */
  function fuiRound(c, x, y, w, h, r) { c.beginPath(); if (c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h); }
  function fuiHud(c, g, L) {
    c.save();
    const top = L.land ? 0 : 0, H = L.land ? 110 : 150;
    c.fillStyle = "#121630"; c.fillRect(0, top, FW, H);
    const bw = L.land ? Math.min(420, FW * 0.3) : 270, bh = 30, by = L.land ? 52 : 58, edge = L.land ? 110 : 20;
    for (const i of [0, 1]) {
      const d = FG.mirror ? 1 - i : i, p = g.p[i], ratio = Math.max(0, p.hp / p.maxHp), x0 = d ? FW - edge - bw : edge;
      c.fillStyle = "#e8ebff"; c.font = canvasFont(900, 24); c.textBaseline = "alphabetic"; c.textAlign = d ? "right" : "left";
      c.fillText(`${g.cfg.f[i].r.name}${g.cfg.mode === "online" && i === FG.me ? "（你）" : ""}`, d ? FW - edge : edge, by - 10, bw);
      fuiRound(c, x0, by, bw, bh, 9); c.fillStyle = "#2a3050"; c.fill();
      c.save(); fuiRound(c, x0, by, bw, bh, 9); c.clip(); c.fillStyle = i ? "#2563eb" : "#d92a42";
      if (d) c.fillRect(x0 + bw * (1 - ratio), by, bw * ratio, bh); else c.fillRect(x0, by, bw * ratio, bh); c.restore();
      fuiRound(c, x0, by, bw, bh, 9); c.strokeStyle = "#1b2038"; c.lineWidth = 3; c.stroke();
      c.fillStyle = "#fff"; c.font = canvasFont(900, 20); c.textBaseline = "middle"; c.textAlign = d ? "right" : "left";
      c.fillText(`${Math.max(0, Math.ceil(p.hp))} / ${p.maxHp}`, d ? x0 + bw - 12 : x0 + 12, by + bh / 2 + 1);
      // 硬直值（細條）
      c.fillStyle = "#262b48"; c.fillRect(x0, by + bh + 4, bw, 5);
      const sv = Math.min(1, p.sv / FT.SV_MAX); c.fillStyle = sv > 0.7 ? "#ff8a3d" : "#ffd84a";
      if (d) c.fillRect(x0 + bw * (1 - sv), by + bh + 4, bw * sv, 5); else c.fillRect(x0, by + bh + 4, bw * sv, 5);
      if (g.cfg.mode !== "dummy") for (let n = 0; n < Math.ceil(g.cfg.rounds / 2); n++) {
        c.fillStyle = n < g.wins[i] ? "#ffc61a" : "#444a6e"; c.beginPath(); c.arc(d ? FW / 2 + 64 + n * 18 : FW / 2 - 64 - n * 18, by + bh + 22, 6, 0, Math.PI * 2); c.fill(); // 回合點靠中間（右側留給暫停鈕）
      }
    }
    // 計時圓：黃色外環
    const cy = by + bh / 2 - 8, R = L.land ? 40 : 46;
    c.fillStyle = "#1b2038"; c.beginPath(); c.arc(FW / 2, cy, R, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "#ffc61a"; c.lineWidth = 5; c.stroke();
    c.fillStyle = "#fff"; c.font = canvasFont(900, 36); c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText(g.cfg.secs > 0 && g.cfg.mode !== "dummy" ? String(Math.ceil(g.timeLeft)) : "∞", FW / 2, cy + 2);
    // 打木樁：傷害統計
    if (g.cfg.mode === "dummy" && !L.land) {
      const st = g.stats; c.textAlign = "left"; c.textBaseline = "alphabetic";
      c.fillStyle = "#a9b0d6"; c.font = canvasFont(700, 16); c.fillText("木樁傷害", 20, 118);
      c.fillStyle = "#fff"; c.font = canvasFont(900, 22); c.fillText(`這一串 ${st.lastCombo || 0}　最後一下 ${st.lastDmg || 0}　總共 ${st.total}`, 20, 142, FW - 140);
    }
    c.restore();
    // 戰場上方的模式膠囊
    const pill = g.cfg.mode === "dummy" ? "練習・打木樁" : g.cfg.mode === "cpu" ? `打電腦・${FUI_LEVEL[FG.set.level] || ""}` : g.cfg.mode === "online" ? "線上對戰" : "";
    if (pill) {
      c.save(); c.font = canvasFont(800, 20); const w = c.measureText(pill).width + 36, y = L.view.y + 16;
      fuiRound(c, FW / 2 - w / 2, y, w, 36, 18); c.fillStyle = "rgba(14,17,34,0.7)"; c.fill();
      c.fillStyle = "#fff"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(pill, FW / 2, y + 19); c.restore();
    }
  }
  // 兩人同機：只加雙方血量數字（畫在原本的中央血條上）
  function fuiHud2p(c, g, L) {
    const y = L.hud.y, h = L.hud.h, cy = y + h / 2, bw = 215, edge = 110;
    c.save(); c.font = canvasFont(900, 18); c.fillStyle = "#fff"; c.textBaseline = "middle";
    for (const i of [0, 1]) {
      const p = g.p[i], x0 = i ? FW - edge - bw : edge, txt = String(Math.max(0, Math.ceil(p.hp)));
      c.textAlign = i ? "right" : "left"; c.lineWidth = 4; c.strokeStyle = "rgba(0,0,0,0.6)";
      const tx = i ? x0 + bw - 8 : x0 + 8; c.strokeText(txt, tx, cy + 1); c.fillText(txt, tx, cy + 1);
    }
    c.restore();
  }
  /* 新版的操作提示與防禦環（單人直向；兩人同機不加）：畫在原本的按鈕之上 */
  function fuiControls(c, g, L, B, who) {
    if (L.pvp) return;
    const p = g.p[who];
    c.save(); c.globalAlpha = 1;
    // 防禦環（外圈＝防禦條；破防後灰色）
    const b = B.down, r = b.r + 5, ratio = Math.max(0, p.gauge) / FT.GAUGE_MAX;
    c.lineWidth = 6; c.strokeStyle = "rgba(255,255,255,0.15)"; c.beginPath(); c.arc(b.x, b.y, r, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = p.guardLock ? "#777c99" : ratio < 0.3 ? "#ff5060" : "#59a7ff"; c.lineCap = "round";
    c.beginPath(); c.arc(b.x, b.y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio); c.stroke();
    if (!L.land) {
      // 技能提示條（技能群上方）、移動提示（方向鍵下方）
      const tip = "技能：按住拖曳瞄準，放開出招", ty = L.ctrl.y + 16;
      c.font = canvasFont(700, 19); const w = c.measureText(tip).width + 30;
      fuiRound(c, 420 - w / 2, ty, w, 32, 16); c.fillStyle = "rgba(255,255,255,0.1)"; c.fill();
      c.fillStyle = "#e8ebff"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(tip, 420, ty + 17);
      const mv = B.left, my = mv.y + mv.h / 2 + 26;
      c.fillStyle = "#a9b0d6"; c.font = canvasFont(700, 18); c.textAlign = "left"; c.textBaseline = "top";
      c.fillText("按住左右移動，同方向", 22, my); c.fillText("連點兩下衝刺", 22, my + 24);
    }
    c.restore();
  }

  // 啟動（fuiInit／fuiBind）放在 js-19-fight-uipick.js 最後：要等選角面板（FXP）也定義好
