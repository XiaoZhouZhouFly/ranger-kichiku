  /* ---------- 搜尋 ---------- */
  function thumbUrls(id) {
    const b = baseOf(id);
    return [`${b}res/${id}/${id}-thum-140.png`, `${b}res/${id}/${id}-thum.png`];
  }
  function renderResults(q) {
    const box = $("results");
    box.textContent = "";
    q = (q || "").trim();
    let list;
    if (!q) { box.innerHTML = `<p class="hint">輸入角色名稱開始搜尋。</p>`; return; }
    list = S.index.filter((r) => (r.name || "").includes(q) || r.id.includes(q.toLowerCase()));
    list.sort((a, b) => (b.name === q) - (a.name === q) || (a.name === a.id) - (b.name === b.id));
    if (!list.length) { box.innerHTML = `<p class="hint">找不到「${escapeHtml(q)}」。試試較短的關鍵字。</p>`; return; }
    for (const r of list.slice(0, 80)) box.appendChild(unitCard(r));
  }
  function unitCard(r, onPick, opts = {}) {
    const b = document.createElement("button");
    b.className = "r-card" + (S.unit && S.unit.id === r.id ? " active" : "");
    b.setAttribute("role", "listitem");
    b.title = `${r.name}（${r.id}）`;
    const th = document.createElement("div"); th.className = "thumb";
    const ph = document.createElement("span"); ph.className = "ph"; ph.textContent = (String(r.name || "?").replace(/\[.*?\]/g, "").trim() || "?").slice(-1);
    const urls = thumbUrls(r.id); let i = 0;
    const img = document.createElement("img"); img.alt = ""; img.loading = "lazy"; img.className = "lazy";
    img.onload = () => { img.classList.add("ok"); ph.remove(); };
    img.onerror = () => { if (++i < urls.length) img.src = urls[i]; };
    img.src = urls[0];
    th.append(ph, img);
    const nm = document.createElement("div"); nm.className = "nm"; nm.textContent = r.name;
    const mt = document.createElement("div"); mt.className = "meta"; mt.textContent = [r.star, r.element].filter(Boolean).join("・");
    b.append(th, nm, mt);
    b.addEventListener("click", () => { if (opts.select !== false) selectUnit(r); if (onPick) onPick(r); });
    return b;
  }

  /* ---------- 角色庫 ---------- */
  const ELEM_COLOR = { 火: "#ff5a3c", 水: "#2f8cff", 木: "#3cbf5a", 光: "#ffd23f", 暗: "#7a4cc2", 無: "#b9bfd3" };
  const LIB_PAGE = 60;
  const lib = { shown: LIB_PAGE, elem: "", built: false };
  function starKey(s) {
    const m = /(\d+)星/.exec(s || ""); const n = m ? +m[1] : 0;
    return n * 10 + (s.includes("超進化") ? 2 : s.includes("終極進化") ? 1 : 0);
  }
  function buildLibFilters() {
    if (lib.built) return; lib.built = true;
    const saved = store.get("lib", {});
    const fill = (sel, label, values) => {
      sel.textContent = "";
      const all = document.createElement("option"); all.value = ""; all.textContent = label; sel.appendChild(all);
      for (const v of values) { const o = document.createElement("option"); o.value = v; o.textContent = v; sel.appendChild(o); }
    };
    const stars = [...new Set(S.index.map((r) => r.star).filter(Boolean))].sort((a, b) => starKey(b) - starKey(a));
    const types = [...new Set(S.index.map((r) => r.type).filter(Boolean))];
    fill($("fStar"), "全部", stars); fill($("fType"), "全部", types);
    $("fStar").value = saved.star || ""; $("fType").value = saved.type || ""; $("fSort").value = saved.sort || "new";
    $("fNamed").checked = saved.named !== false;
    lib.elem = saved.elem || "";
    const eb = $("fElem"); eb.textContent = "";
    const elems = ["", ...["火", "水", "木", "光", "暗", "無"].filter((e) => S.index.some((r) => r.element === e))];
    for (const e of elems) {
      const c = chip("", lib.elem === e); c.dataset.elem = e;
      if (e) { const d = document.createElement("span"); d.className = "elem-dot"; d.style.background = ELEM_COLOR[e]; c.appendChild(d); }
      c.appendChild(document.createTextNode(e || "全部屬性"));
      c.onclick = () => { lib.elem = e; eb.querySelectorAll(".chip").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.elem === e))); resetLib(); };
      eb.appendChild(c);
    }
    ["fStar", "fType", "fSort", "fNamed", "libFeat"].forEach((id) => $(id).addEventListener("change", resetLib));
  }
  function libList() {
    if (lib.extra) return lib.extra(libListBase());
    return libListBase();
  }
  function libListBase() {
    const star = $("fStar").value, type = $("fType").value, sort = $("fSort").value, named = $("fNamed").checked;
    let list = S.index.filter((r) => (!star || r.star === star) && (!type || r.type === type) && (!lib.elem || r.element === lib.elem) && (!named || r.name !== r.id));
    const d = (r) => r.date || "0000";
    const cmp = {
      new: (a, b) => d(b).localeCompare(d(a)) || b.id.localeCompare(a.id),
      old: (a, b) => d(a).localeCompare(d(b)) || a.id.localeCompare(b.id),
      star: (a, b) => starKey(b.star) - starKey(a.star) || d(b).localeCompare(d(a)),
      name: (a, b) => a.name.localeCompare(b.name, "zh-Hant"),
    }[sort];
    return list.sort(cmp);
  }
  function renderLib() {
    const list = libList(), grid = $("libGrid");
    grid.textContent = "";
    $("libCount").textContent = `共 ${list.length} 隻`;
    if (!list.length) { grid.innerHTML = `<p class="hint">沒有符合條件的角色，試著放寬篩選。</p>`; }
    const pick = () => document.querySelector(".stage").scrollIntoView({ behavior: "smooth", block: "center" });
    for (const r of list.slice(0, lib.shown)) {
      const card = lib.onPick ? unitCard(r, (rr) => lib.onPick(rr), { select: false }) : unitCard(r, pick);
      if (lib.deco) lib.deco(r, card); // 格鬥場：相容性標示、不適合的變灰
      grid.appendChild(card);
    }
    $("libMore").hidden = list.length <= lib.shown;
    $("libMore").textContent = `顯示更多（還有 ${Math.max(0, list.length - lib.shown)} 隻）`;
    store.set("lib", { star: $("fStar").value, type: $("fType").value, sort: $("fSort").value, named: $("fNamed").checked, elem: lib.elem });
  }
  function resetLib() { lib.shown = LIB_PAGE; renderLib(); $("libGrid").scrollTop = 0; }
  function homeLib() {
    // 角色庫放回單人模式的搜尋區
    const libEl = $("library");
    if (libEl.parentElement !== $("results").parentElement) $("results").after(libEl);
    lib.onPick = null; lib.deco = null; lib.extra = null; $("libTitle").textContent = "角色庫"; $("libFeatBox").hidden = true;
  }
  // 把角色庫搬到 holder 底下當選角用。opt.deco(r, card)：加標示；opt.extra(list)：額外篩選；opt.featured：顯示「只看精選」
  function openLibPick(holder, title, onPick, opt = {}) {
    const libEl = $("library");
    homeLib();
    holder.appendChild(libEl);
    $("libTitle").textContent = title;
    lib.onPick = (r) => { onPick(r); libEl.hidden = true; homeLib(); };
    lib.deco = opt.deco || null; lib.extra = opt.extra || null; $("libFeatBox").hidden = !opt.featured;
    libEl.hidden = false;
    buildLibFilters(); resetLib();
    libEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function openLibFor(side) { openLibPick($("dLibHolder"), side === 0 ? "角色庫・選擇左方" : "角色庫・選擇右方", (r) => setFighter(side, r, true)); }
  function toggleLib(open) {
    homeLib();
    $("library").hidden = !open; $("results").hidden = open;
    $("libBtn").setAttribute("aria-expanded", String(open));
    $("libBtn").classList.toggle("primary", open); $("qBtn").classList.toggle("primary", !open);
    if (open) { buildLibFilters(); renderLib(); }
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

