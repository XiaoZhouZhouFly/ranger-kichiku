  /* ---------- 格鬥場新版介面 B 段（v7.6）：選角面板＋技能預覽 ----------
     規格：「格鬥場改版_圖檔與施作說明」§5（圖 11–22）。只在新版介面打開時使用（點新版的角色卡）；原版的搜尋、角色庫照舊。
     直向＝底部面板；橫向＝全畫面左右分欄。點卡片先預覽，按「選這隻」才確定（選定走原本的 fightSetChar）。
     最近／收藏存這台裝置（fightRecent／fightFav）；兩人同機可以輪流選（玩家 1 → 玩家 2），可開「盲選」。 */
  const FXP = { side: 0, tab: "all", el: "", q: "", sort: "date", stars: new Set(), src: "", pick: null, shown: 60, pvpTurn: false, blind: false, hidden0: null, skill: 2, anim: 0 };
  const FXP_EL = { 火: "#ef4444", 水: "#3b82f6", 木: "#22c55e", 光: "#eab308", 暗: "#8b5cf6", 無: "#9ca3af" };
  const FXP_KIND = { melee: "近戰", shot: "投射物", lob: "拋物線", dline: "瞬間直線", rect: "定點", line: "直線", self: "自身", dash: "突進", buff: "輔助", front: "身前範圍" };
  const FXP_OP = { melee: "按下就放", dline: "按下就放", self: "按下就放", buff: "按下就放", shot: "按住選方向", line: "按住選方向", rect: "拖曳瞄準", lob: "拖曳瞄準", dash: "拖曳選落點", front: "左右選方向" };
  const FXP_HOW = {
    melee: "靠近對手按下就揮，打身前一小段距離。", shot: "朝面向射出投射物，按住可以轉向，放開才射。", line: "朝面向射出直線投射物，一路飛到打中或飛出場地。",
    dline: "按下立刻朝面向打出一道直線，不會飛行，前搖有虛線預告。", lob: "按住拖曳選落點，放開後拋出，弧線很高，快落地時才打得到。",
    rect: "按住拖曳到想打的位置，放開後先預告，再落下範圍攻擊。對站著不動的目標很好打。", dash: "按住左右拖曳選落點，衝過去才判定，衝的途中不會被打斷。",
    front: "打自己身前一段範圍，按住左右拖可以換方向。", self: "按下就套用在自己身上的效果。", buff: "暫時加攻擊並回一點血（原作效果還沒支援時的代替）。",
  };
  const FXP_FORM = { melee: "近戰", dline: "瞬間直線", line: "直線", lob: "拋物線", target: "定點", dash: "突進", self: "自身", buff: "輔助" }; // 標籤用短名
  const fxpGet = (k, d) => { try { return store.get(k, d); } catch { return d; } };
  const fxpSet = (k, v) => { try { store.set(k, v); } catch {} };
  const fxpStar = (r) => (r.custom || customIds.has(r.id) ? "自製" : (r.star || "").replace("終極進化", "終極 ").replace("超進化", "超進化 ") || "—");
  const fxpForms = (r) => { try { const N = normUnit(r, NORM_ALL_ANIMS); return { atk: N.atk.form, sk: N.sk.map((k) => (k.exists ? k.form : null)), issues: N.issues }; } catch { return null; } };

  function fxpEnsure() {
    if ($("fxPick")) return;
    const el = document.createElement("div"); el.id = "fxPick"; el.className = "fxp"; el.hidden = true;
    el.innerHTML = `<div class="fxp-dim" data-x="close"></div>
      <div class="fxp-sheet" role="dialog" aria-modal="true" aria-labelledby="fxpTitle">
        <div class="fxp-grab" aria-hidden="true"></div>
        <div class="fxp-head" id="fxpHead"><div><h2 id="fxpTitle">選擇角色</h2><p id="fxpSub"></p></div>
          <span class="fxp-steps" id="fxpSteps" hidden></span>
          <button class="fxp-x" type="button" data-x="close" aria-label="關閉">${fuiIcon('<path d="M6 6l12 12M18 6 6 18"/>')}</button></div>
        <div class="fxp-off" id="fxpOff" hidden>${fuiIcon(FUI_ICONS.alert, 18)}<span>連不上資料庫，只能從「最近」選</span><button type="button" data-x="retry">重試</button></div>
        <div class="fxp-pvp" id="fxpPvp" hidden><button type="button" class="fxp-mini" data-x="rand">隨機選</button><button type="button" class="fxp-mini" data-x="last">同上一場</button>
          <label class="fxp-blind"><input type="checkbox" id="fxpBlind"> 盲選</label></div>
        <div class="fxp-bar"><label class="fxp-q">${fuiIcon('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>', 20)}<input id="fxpQ" type="search" placeholder="搜尋角色名稱" autocomplete="off" aria-label="搜尋角色名稱"></label>
          <button class="fxp-filter" type="button" data-x="filter" aria-label="篩選">${fuiIcon('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>', 20)}<span>篩選</span><b id="fxpBadge" hidden></b></button></div>
        <div class="fxp-fpanel" id="fxpFilter" hidden></div>
        <div class="fxp-tabs" role="tablist" id="fxpTabs">${[["recent", "最近"], ["feat", "精選"], ["all", "全部"], ["fav", "收藏"]].map(([k, t]) => `<button type="button" role="tab" data-tab="${k}">${t}</button>`).join("")}</div>
        <div class="fxp-els" id="fxpEls"></div>
        <div class="fxp-sort"><span id="fxpCount"></span><button type="button" data-x="sort" id="fxpSortBtn"></button></div>
        <div class="fxp-grid" id="fxpGrid" role="list"></div>
        <div class="fxp-prev" id="fxpPrev"></div>
        <div class="fxp-detail" id="fxpDetail" hidden></div>
      </div>`;
    $("fStage").before(el);
    el.addEventListener("click", fxpClick);
    $("fxpQ").addEventListener("input", () => { clearTimeout(FXP.qt); FXP.qt = setTimeout(() => { FXP.q = $("fxpQ").value.trim(); FXP.shown = 60; fxpList(); }, 200); });
    $("fxpBlind").onchange = () => { FXP.blind = $("fxpBlind").checked; fxpSet("fightBlind", FXP.blind); };
    $("fxpGrid").addEventListener("scroll", () => { const g = $("fxpGrid"); if (g.scrollTop + g.clientHeight > g.scrollHeight - 300 && FXP.shown < FXP.list.length) { FXP.shown += 60; fxpList(true); } });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("fxPick").hidden) { e.stopPropagation(); if (!$("fxpDetail").hidden) fxpDetail(false); else fxpClose(); } }, true);
  }

  /* 打開：side＝0／1；兩人同機從玩家 1 開始輪流 */
  function fxpOpen(side) {
    fxpEnsure();
    const pvp = FG.set.mode === "pvp";
    FXP.pvpTurn = pvp; FXP.side = pvp ? 0 : side; FXP.blind = !!fxpGet("fightBlind", false); $("fxpBlind").checked = FXP.blind;
    FXP.tab = "all"; FXP.q = ""; $("fxpQ").value = ""; FXP.shown = 60; FXP.scrollY = window.scrollY;
    FXP.pick = S.index.find((x) => x.id === fightCardId(FXP.side)) || null;
    $("fxPick").hidden = false; document.body.classList.add("fxp-on");
    fxpHead(); fxpRender();
  }
  function fxpClose() {
    $("fxPick").hidden = true; document.body.classList.remove("fxp-on"); fxpDetail(false);
    if (FXP.hidden0) { FXP.hidden0 = null; fuiRefresh(); }
    window.scrollTo(0, FXP.scrollY || 0); // 選完回到原本的捲動位置
  }
  function fxpHead() {
    const pvp = FXP.pvpTurn, s = FXP.side, sheet = document.querySelector(".fxp-sheet");
    sheet.classList.toggle("is-p1", pvp && s === 0); sheet.classList.toggle("is-p2", pvp && s === 1);
    $("fxpTitle").textContent = pvp ? `玩家 ${s + 1} 選角` : `選擇${s ? "右方" : "左方"}角色`;
    $("fxpPvp").hidden = !pvp; $("fxpSteps").hidden = !pvp; $("fxpSteps").textContent = `${s + 1}／2`;
    $("fxpBlind").closest("label").hidden = s === 1;
  }
  // 目前分頁＋搜尋＋篩選後的清單
  function fxpPool() {
    const ready = FG.ready && S.index.length > 0, recent = fxpGet("fightRecent", []), fav = new Set(fxpGet("fightFav", []));
    let base = !ready ? [] : FXP.tab === "recent" ? recent.map((id) => S.index.find((r) => r.id === id)).filter(Boolean)
      : FXP.tab === "feat" ? FIGHT_ROSTER.map(([id]) => S.index.find((r) => r.id === id)).filter(Boolean)
      : FXP.tab === "fav" ? S.index.filter((r) => fav.has(r.id)) : S.index.filter((r) => !r.hidden);
    FXP.hiddenUnnamed = 0;
    base = base.filter((r) => { const named = r.name && r.name !== r.id; if (!named && !FXP.showUnnamed) { FXP.hiddenUnnamed++; return false; } return true; });
    const q = FXP.q.toLowerCase();
    let list = base.filter((r) => (!q || (r.name || "").toLowerCase().includes(q) || r.id.includes(q)) && (!FXP.el || r.element === FXP.el)
      && (!FXP.stars.size || FXP.stars.has(fxpStar(r).replace(/^.*?(\d+)\s*星$/, "$1"))) && (!FXP.src || (FXP.src === "custom") === !!(r.custom || customIds.has(r.id))));
    if (FXP.tab === "all") list.sort(FXP.sort === "name" ? (a, b) => a.name.localeCompare(b.name, "zh-Hant") : FXP.sort === "star" ? (a, b) => (parseInt(b.star) || 0) - (parseInt(a.star) || 0) : (a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    return { list, base };
  }
  function fxpRender() {
    const ready = FG.ready && S.index.length > 0, off = $("modeNote").classList.contains("off");
    $("fxpOff").hidden = !off;
    document.querySelector(".fxp-sheet").classList.toggle("is-loading", !ready);
    $("fxpQ").disabled = !ready; document.querySelectorAll("#fxpTabs button, .fxp-filter").forEach((b) => (b.disabled = !ready || (off && b.dataset.tab && b.dataset.tab !== "recent")));
    document.querySelectorAll("#fxpTabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === FXP.tab)));
    $("fxpEls").innerHTML = [["", "全部屬性"], ...Object.keys(FXP_EL).map((k) => [k, k])].map(([k, t]) =>
      `<button type="button" class="fxp-el" data-el="${k}" aria-pressed="${FXP.el === k}">${k ? `<i style="background:${FXP_EL[k]}"></i>` : ""}${t}</button>`).join("");
    const nf = FXP.stars.size + (FXP.src ? 1 : 0); $("fxpBadge").hidden = !nf; $("fxpBadge").textContent = nf;
    $("fxpSortBtn").textContent = { date: "最新登場", name: "名稱", star: "星數" }[FXP.sort] + " ▾"; $("fxpSortBtn").hidden = FXP.tab !== "all";
    fxpList(); fxpPrev();
  }
  function fxpList(append) {
    const grid = $("fxpGrid"), ready = FG.ready && S.index.length > 0;
    if (!ready) { grid.innerHTML = `<p class="fxp-msg">載入角色資料中，請稍候</p>` + '<div class="fxp-card is-skel"></div>'.repeat(9); $("fxpCount").textContent = ""; return; }
    const { list } = fxpPool(); FXP.list = list;
    $("fxpSub").textContent = FXP.pvpTurn ? (FXP.side ? "選好後就開始對戰" : "選好後把手機交給玩家 2") : `共 ${S.index.filter((r) => !r.hidden).length} 隻`;
    $("fxpCount").textContent = `${list.length} 隻`;
    if (!append) { grid.textContent = ""; grid.scrollTop = 0; }
    if (!list.length) { grid.innerHTML = fxpEmpty(); return; }
    const start = append ? grid.querySelectorAll(".fxp-card").length : 0;
    for (const r of list.slice(start, FXP.shown)) grid.appendChild(fxpCard(r));
  }
  function fxpEmpty() {
    if (FXP.tab === "recent" && !FXP.q) return `<div class="fxp-empty"><b>未偵測到最近使用角色</b><span>選過的角色會出現在這裡</span></div>`;
    if (FXP.tab === "fav" && !FXP.q) return `<div class="fxp-empty"><b>還沒有收藏的角色</b><span>預覽時按「選這隻」旁邊的星星加入收藏</span></div>`;
    const chips = [FXP.el && `<button type="button" class="fxp-chipx" data-x="rm-el">${FXP.el} ✕</button>`, ...[...FXP.stars].map((s) => `<button type="button" class="fxp-chipx" data-x="rm-star" data-v="${s}">${s} 星 ✕</button>`),
      FXP.src && `<button type="button" class="fxp-chipx" data-x="rm-src">${FXP.src === "custom" ? "自製" : "官方"} ✕</button>`].filter(Boolean);
    return `<div class="fxp-empty">${fuiIcon('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>', 44)}<b>${FXP.q ? `找不到「${escapeHtml(FXP.q)}」` : "沒有符合條件的角色"}</b><span>試試別的名字，或拿掉一些篩選條件</span>
      ${chips.length ? `<div class="fxp-chips">${chips.join("")}</div><button type="button" class="fxp-mini" data-x="clear">清除全部篩選</button>` : ""}
      ${FXP.hiddenUnnamed && !FXP.showUnnamed ? `<div class="fxp-tip">另有 ${FXP.hiddenUnnamed} 隻未命名的角色被隱藏 <button type="button" data-x="unnamed">顯示</button></div>` : ""}</div>`;
  }
  function fxpCard(r) {
    const c = fightCompatOf(r), b = document.createElement("button"), sel = FXP.pick && FXP.pick.id === r.id && !(FXP.blind && FXP.side === 1 && FXP.hidden0 === r.id);
    b.type = "button"; b.className = "fxp-card" + (c.lvl === "unfit" ? " is-lock" : "") + (sel ? " is-sel" : ""); b.dataset.id = r.id; b.setAttribute("role", "listitem");
    b.setAttribute("aria-pressed", String(!!sel));
    const sub = c.lvl === "unfit" ? '<span class="fxp-tag is-lock">🔒 不適用</span>' : c.lvl === "unsup" ? '<span class="fxp-tag is-unsup">⚠ 部分支援</span>'
      : `<span class="fxp-meta"><i style="background:${FXP_EL[r.element] || "#9ca3af"}"></i>${fxpStar(r)}${r.element ? "・" + r.element : ""}</span>`;
    b.setAttribute("aria-label", `${r.name}，${fxpStar(r)}，${r.element || "無"}屬性${c.lvl === "unfit" ? "，不適用" : c.lvl === "unsup" ? "，部分支援" : ""}${sel ? "，已選取" : ""}`);
    b.innerHTML = `<span class="fxp-ava"><img alt="" loading="lazy"></span><b>${escapeHtml(r.name)}</b>${sub}${sel ? `<span class="fxp-check">${fuiIcon('<path d="M5 12l5 5 9-10"/>', 16)}</span>` : ""}`;
    const img = b.querySelector("img"), urls = thumbUrls(r.id); let n = 0; img.onerror = () => { if (++n < urls.length) img.src = urls[n]; else img.remove(); }; img.src = urls[0];
    return b;
  }
  // 底部預覽列（直向）／右側預覽（橫向）
  async function fxpPrev() {
    const box = $("fxpPrev"), r = FXP.pick && !(FXP.blind && FXP.side === 1 && FXP.hidden0 === FXP.pick.id) ? FXP.pick : null;
    if (!r) { box.innerHTML = `<div class="fxp-pinfo is-empty">${FG.ready ? "先選一隻角色" : "資料載入完成後即可選角"}</div><div class="fxp-pact"><button class="fxp-go" type="button" disabled>${fxpGoText(null)}</button></div>`; return; }
    const c = fightCompatOf(r), F = fxpForms(r), fav = new Set(fxpGet("fightFav", [])).has(r.id);
    const tag = (s, form) => `<span class="fxp-sk">${s === 2 ? "普攻" : "技能" + (s + 1)} ${form ? FXP_FORM[form] || form : "沒有"}</span>`;
    box.innerHTML = `<button class="fxp-pinfo" type="button" data-x="detail" aria-label="看技能：${escapeHtml(r.name)}">
        <span class="fxp-ava"><img alt=""></span><span class="fxp-ptxt"><b>${escapeHtml(r.name)}</b><span class="fxp-pstats" id="fxpStats">血量 — 攻擊 — 速度 —</span>
        <span class="fxp-sks">${F ? tag(2, F.atk) + tag(0, F.sk[0]) + tag(1, F.sk[1]) : ""}</span></span><span class="fxp-more">${fuiIcon('<path d="M6 15l6-6 6 6"/>', 18)}看技能</span></button>
      <div class="fxp-pact"><button class="fxp-fav" type="button" data-x="fav" aria-pressed="${fav}" aria-label="${fav ? "取消收藏" : "加入收藏"}">${fuiIcon('<path d="M12 4l2.5 5 5.5.8-4 3.9.9 5.5L12 16.6 7.1 19.2l.9-5.5-4-3.9 5.5-.8z"' + (fav ? ' fill="currentColor"' : "") + "/>", 22)}</button>
        <button class="fxp-go" type="button" data-x="go" ${c.lvl === "unfit" ? "disabled" : ""}>${c.lvl === "unfit" ? "不適用，無法選" : fxpGoText(c)}</button></div>`;
    const img = box.querySelector("img"), urls = thumbUrls(r.id); let n = 0; img.onerror = () => { if (++n < urls.length) img.src = urls[n]; }; img.src = urls[0];
    try { const fs = fightStats(await fightLoad(r.id)); if (FXP.pick === r && $("fxpStats")) { box.querySelector(".fxp-sks").innerHTML = [2, 0, 1].map((s) => { const k = fightSlot(fs, s); return `<span class="fxp-sk">${s === 2 ? "普攻" : "技能" + (s + 1)} ${k ? FXP_KIND[k.kind] || k.kind : "沒有"}</span>`; }).join(""); $("fxpStats").textContent = `血量 ${Math.round(fs.hp)}　攻擊 ${Math.round(fs.atk.dmg)}　速度 ${Math.round(fs.walk)}`; FXP.fs = fs; FXP.fsId = r.id; if (!$("fxpDetail").hidden) fxpDetail(true); } } catch {}
  }
  const fxpGoText = (c) => (FXP.pvpTurn ? (FXP.side ? "確定，開始對戰" : "確定，換玩家 2") : c && c.lvl === "unsup" ? "仍要選這隻" : "選這隻");

  /* 技能詳情：普攻／技能 1／技能 2 分頁、示意動畫、四格數值、說明、支援狀態 */
  function fxpDetail(show) {
    const box = $("fxpDetail"); cancelAnimationFrame(FXP.anim);
    if (!show) { box.hidden = true; document.querySelector(".fxp-sheet").classList.remove("is-detail"); return; }
    const r = FXP.pick; if (!r) return;
    const fs = FXP.fsId === r.id ? FXP.fs : null, F = fxpForms(r), c = fightCompatOf(r);
    box.hidden = false; document.querySelector(".fxp-sheet").classList.add("is-detail");
    const slots = [[2, "普攻"], [0, "技能1"], [1, "技能2"]], where = { 2: "普攻", 0: "技能1", 1: "技能2" };
    const iss = (s, l) => (F ? F.issues.filter((x) => x.where === where[s] && x.lvl === l).map((x) => x.msg) : []);
    const k = fs ? fightSlot(fs, FXP.skill) : null, has = FXP.skill === 2 || (F && F.sk[FXP.skill]);
    const uns = iss(FXP.skill, "unsupported"), gs = iss(FXP.skill, "guess");
    const sk = FXP.skill < 2 && S.skills[r.id] && S.skills[r.id][FXP.skill];
    const kind = k ? k.kind : null, val = (v) => (v == null || v === "" ? "資料不足" : v);
    box.innerHTML = `<div class="fxp-dhead"><button type="button" class="fxp-back" data-x="back" aria-label="收合">${fuiIcon('<path d="M6 9l6 6 6-6"/>', 22)}<span>返回</span></button>
        <span class="fxp-ava"><img alt=""></span><span><b>${escapeHtml(r.name)}</b><small>${fxpStar(r)}${r.element ? "・" + r.element : ""}</small></span></div>
      <div class="fxp-dtabs">${slots.map(([s, t]) => { const u = iss(s, "unsupported").length, ex = s === 2 || (F && F.sk[s]); const kk = fs && fightSlot(fs, s), f = kk ? kk.kind : s === 2 ? F && F.atk : F && F.sk[s];
        return `<button type="button" data-skill="${s}" aria-pressed="${FXP.skill === s}" class="${u ? "is-unsup" : ""}" ${ex ? "" : "disabled"}><b>${t}</b><small>${!ex ? "沒有" : u ? "⚠ 部分支援" : (kk ? FXP_KIND[f] : FXP_FORM[f]) || f}</small></button>`; }).join("")}</div>
      ${has ? `<div class="fxp-demo"><span class="fxp-dlabel">示意動畫・自動循環</span><button type="button" class="fxp-replay" data-x="replay" aria-label="重播">${fuiIcon(FUI_ICONS.restart, 20)}</button><canvas id="fxpCanvas" width="640" height="240" aria-label="招式示意動畫"></canvas></div>
      ${uns.length ? `<div class="fxp-warn">${fuiIcon(FUI_ICONS.alert, 20)}<span>${escapeHtml(uns.join("；").replace(/（待做）/g, ""))}。對戰時照樣能出招，其他招式正常。</span></div>` : ""}
      <div class="fxp-cells"><span><small>類型</small><b>${val(kind && FXP_KIND[kind])}</b></span><span><small>傷害</small><b>${val(k && Math.round(k.dmg))}</b></span>
        <span><small>冷卻</small><b>${val(k && (+k.cd).toFixed(1) + " 秒")}</b></span><span><small>操作</small><b>${val(kind && FXP_OP[kind])}</b></span></div>
      <p class="fxp-how">${escapeHtml((kind && FXP_HOW[kind]) || "資料不足")}${sk && sk.name ? `<br><small>原作技能：${escapeHtml(sk.name)}</small>` : ""}</p>
      ${gs.length ? `<p class="fxp-guess">？ 部分數值為推測：${escapeHtml(gs.join("、"))}</p>` : ""}` : `<p class="fxp-how">這隻角色沒有這個技能。</p>`}
      ${c.lvl === "unsup" ? `<div class="fxp-status">${slots.map(([s, t]) => { const u = iss(s, "unsupported").length, ex = s === 2 || (F && F.sk[s]); return ex ? `<span class="${u ? "is-x" : "is-ok"}">${u ? "⚠" : "✓"} <b>${t}</b> ${u ? "部分效果還沒支援" : "可正常使用"}</span>` : ""; }).join("")}</div>` : ""}
      <div class="fxp-dact"><button class="fxp-go" type="button" data-x="go">${fxpGoText(c)}</button>${c.lvl === "unsup" ? '<button class="fxp-mini is-wide" type="button" data-x="back">回到列表，換一隻</button>' : ""}</div>`;
    const img = box.querySelector("img"), urls = thumbUrls(r.id); let n = 0; img.onerror = () => { if (++n < urls.length) img.src = urls[n]; }; img.src = urls[0];
    if (has) fxpDemo(kind || (FXP.skill === 2 ? F && { melee: "melee", line: "shot", lob: "lob", dline: "dline" }[F.atk] : "rect"));
  }
  // 示意動畫：依招式種類畫一段循環（角色＝圓、木樁＝方塊）；減少動態效果＝停在一格
  function fxpDemo(kind) {
    const cv = $("fxpCanvas"); if (!cv) return;
    const c = cv.getContext("2d"), W = cv.width, H = cv.height, gy = H - 50, ax = 120, bx = W - 140, T = 1.6;
    const still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t0 = performance.now();
    const frame = (now) => {
      const t = still ? 0.62 : ((now - t0) / 1000 % T) / T;
      c.clearRect(0, 0, W, H); c.fillStyle = "#222852"; c.fillRect(0, 0, W, H); c.fillStyle = "#3d3a52"; c.fillRect(0, gy, W, H - gy);
      c.fillStyle = "#c8a060"; c.fillRect(bx - 22, gy - 70, 44, 70); c.strokeStyle = "#1b2038"; c.lineWidth = 3; c.strokeRect(bx - 22, gy - 70, 44, 70);
      let x = ax; if (kind === "dash") x = ax + (bx - 70 - ax) * Math.min(1, t / 0.5);
      c.fillStyle = "#ffc61a"; c.beginPath(); c.arc(x, gy - 34, 30, 0, Math.PI * 2); c.fill(); c.stroke();
      c.strokeStyle = "#ff8fb0"; c.fillStyle = "rgba(255,143,176,.9)"; c.lineWidth = 5; c.setLineDash([]);
      const hit = (p) => { if (t > p) { c.fillStyle = "rgba(255,214,74," + (1 - (t - p) / (1 - p)) + ")"; c.beginPath(); c.arc(bx, gy - 40, 46, 0, Math.PI * 2); c.fill(); } };
      if (kind === "melee") { c.beginPath(); c.arc(ax + 30, gy - 34, 60, -1.2 + t * 2, -0.2 + t * 2); c.stroke(); }
      else if (kind === "lob") { c.setLineDash([10, 8]); c.strokeStyle = "rgba(255,255,255,.6)"; c.beginPath(); c.moveTo(ax, gy - 60); c.quadraticCurveTo((ax + bx) / 2, gy - 220, bx, gy - 10); c.stroke(); c.setLineDash([]);
        const u = Math.min(1, t / 0.7), px = ax + (bx - ax) * u, py = (1 - u) * (1 - u) * (gy - 60) + 2 * u * (1 - u) * (gy - 220) + u * u * (gy - 10); c.fillStyle = "#ff8fb0"; c.beginPath(); c.arc(px, py, 12, 0, Math.PI * 2); c.fill(); hit(0.7); }
      else if (kind === "rect") { c.strokeStyle = "#ffc61a"; c.setLineDash([10, 8]); c.beginPath(); c.ellipse(bx, gy - 2, 60, 14, 0, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
        if (t > 0.45) { const u = Math.min(1, (t - 0.45) / 0.2); c.fillStyle = "#ffc61a"; c.beginPath(); c.arc(bx, gy - 200 + 170 * u, 16, 0, Math.PI * 2); c.fill(); } hit(0.68); }
      else if (kind === "shot" || kind === "line") { const u = Math.min(1, t / 0.55); c.fillStyle = "#ff8fb0"; c.beginPath(); c.arc(ax + 40 + (bx - ax - 60) * u, gy - 40, 12, 0, Math.PI * 2); c.fill(); hit(0.55); }
      else if (kind === "dline") { if (t < 0.25) { c.setLineDash([8, 8]); c.strokeStyle = "rgba(255,255,255,.6)"; } else c.lineWidth = 10 * (1 - t); c.beginPath(); c.moveTo(ax + 30, gy - 40); c.lineTo(W - 20, gy - 40); c.stroke(); c.setLineDash([]); hit(0.28); }
      else if (kind === "dash") { if (t > 0.5) { c.beginPath(); c.arc(x + 30, gy - 34, 55, -1, 1); c.stroke(); } hit(0.55); }
      else if (kind === "front") { if (t > 0.3) { c.fillStyle = "rgba(255,143,176," + (1 - t) + ")"; c.fillRect(ax + 30, gy - 90, 220, 90); } }
      else { c.strokeStyle = kind === "buff" ? "#7dff9a" : "#9ad1ff"; c.beginPath(); c.arc(ax, gy - 34, 36 + 30 * t, 0, Math.PI * 2); c.stroke(); }
      if (!still && !$("fxpDetail").hidden) FXP.anim = requestAnimationFrame(frame);
    };
    FXP.anim = requestAnimationFrame(frame);
  }

  function fxpConfirm() {
    const r = FXP.pick; if (!r || fightCompatOf(r).lvl === "unfit") return;
    fxpSet("fightRecent", [r.id, ...fxpGet("fightRecent", []).filter((x) => x !== r.id)].slice(0, 20));
    if (FXP.pvpTurn && FXP.side === 0) {
      FXP.last0 = fightCardId(0); fightSetChar(0, r);
      if (FXP.blind) FXP.hidden0 = r.id;
      FXP.side = 1; FXP.pick = S.index.find((x) => x.id === fightCardId(1)) || null; FXP.q = ""; $("fxpQ").value = "";
      fxpDetail(false); fxpHead(); fxpRender(); fuiRefresh(); return;
    }
    const go = FXP.pvpTurn && FXP.side === 1;
    fightSetChar(FXP.side, r); fxpClose();
    if (go) fightStart(); // 兩人同機輪流選完：直接開打
  }
  function fxpFilterPanel() {
    const box = $("fxpFilter"); box.hidden = !box.hidden; if (box.hidden) return;
    const stars = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
    box.innerHTML = `<b>星數</b><div class="fxp-chips">${stars.map((s) => `<button type="button" class="fxp-el" data-star="${s}" aria-pressed="${FXP.stars.has(s)}">${s} 星</button>`).join("")}</div>
      <b>來源</b><div class="fxp-chips">${[["", "全部"], ["official", "官方"], ["custom", "自製"]].map(([k, t]) => `<button type="button" class="fxp-el" data-src="${k}" aria-pressed="${FXP.src === k}">${t}</button>`).join("")}</div>`;
  }
  function fxpClick(e) {
    const b = e.target.closest("button, [data-x], [data-tab]"); if (!b || b.disabled) return;
    const x = b.dataset.x;
    if (x === "close") return fxpClose();
    if (b.dataset.tab) { FXP.tab = b.dataset.tab; FXP.shown = 60; return fxpRender(); }
    if (b.dataset.el != null && b.classList.contains("fxp-el") && b.closest("#fxpEls")) { FXP.el = b.dataset.el; FXP.shown = 60; return fxpRender(); }
    if (b.dataset.star) { FXP.stars.has(b.dataset.star) ? FXP.stars.delete(b.dataset.star) : FXP.stars.add(b.dataset.star); fxpFilterPanel(); fxpFilterPanel(); return fxpRender(); }
    if (b.dataset.src != null && b.closest("#fxpFilter")) { FXP.src = b.dataset.src; fxpFilterPanel(); fxpFilterPanel(); return fxpRender(); }
    if (b.dataset.skill) { FXP.skill = +b.dataset.skill; return fxpDetail(true); }
    if (b.classList.contains("fxp-card")) {
      const r = S.index.find((y) => y.id === b.dataset.id); FXP.pick = r;
      if (fxpGet("fightPickTap", false) && fightCompatOf(r).lvl !== "unfit") return fxpConfirm(); // 設定「點一下直接選定」（D 段）
      $("fxpGrid").querySelectorAll(".fxp-card.is-sel").forEach((y) => { y.classList.remove("is-sel"); y.setAttribute("aria-pressed", "false"); const ck = y.querySelector(".fxp-check"); if (ck) ck.remove(); });
      if (fightCompatOf(r).lvl !== "unfit") { b.classList.add("is-sel"); b.setAttribute("aria-pressed", "true"); b.insertAdjacentHTML("beforeend", `<span class="fxp-check">${fuiIcon('<path d="M5 12l5 5 9-10"/>', 16)}</span>`); }
      FXP.skill = 2; return fxpPrev();
    }
    if (x === "go") return fxpConfirm();
    if (x === "detail") { FXP.skill = FXP.skill == null ? 2 : FXP.skill; return fxpDetail(true); }
    if (x === "back") return fxpDetail(false);
    if (x === "replay") return fxpDetail(true);
    if (x === "fav") { const r = FXP.pick, f = fxpGet("fightFav", []); fxpSet("fightFav", f.includes(r.id) ? f.filter((y) => y !== r.id) : [r.id, ...f]); fxpPrev(); if (FXP.tab === "fav") fxpList(); return; }
    if (x === "filter") return fxpFilterPanel();
    if (x === "sort") { FXP.sort = { date: "name", name: "star", star: "date" }[FXP.sort]; return fxpRender(); }
    if (x === "rand") { const pool = fightPool(fightCardId(1 - FXP.side)); FXP.pick = pool[Math.floor(Math.random() * pool.length)] || null; return fxpRender(); }
    if (x === "last") { const id = FXP.side ? FXP.prevPair && FXP.prevPair[1] : FXP.prevPair && FXP.prevPair[0]; FXP.pick = S.index.find((y) => y.id === (id || fightCardId(FXP.side))) || null; return fxpRender(); }
    if (x === "rm-el") { FXP.el = ""; return fxpRender(); }
    if (x === "rm-star") { FXP.stars.delete(b.dataset.v); return fxpRender(); }
    if (x === "rm-src") { FXP.src = ""; return fxpRender(); }
    if (x === "clear") { FXP.el = ""; FXP.stars.clear(); FXP.src = ""; FXP.q = ""; $("fxpQ").value = ""; return fxpRender(); }
    if (x === "unnamed") { FXP.showUnnamed = true; return fxpRender(); }
    if (x === "retry") return location.reload();
  }

  fuiInit(); fuiBind(); fuiOlBind(); // 新版介面啟動（A、B 段都定義好之後）
