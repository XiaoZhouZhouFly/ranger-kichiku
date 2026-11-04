  /* ---------- 資料讀取 ---------- */
  async function fetchData(url, kind) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(r.status + " " + url);
    const out = kind === "json" ? await r.json() : await r.blob();
    markDirty();
    return out;
  }
  async function blobToImage(blob) {
    if (window.createImageBitmap) { try { return await createImageBitmap(blob); } catch {} }
    return await new Promise((res, rej) => {
      const img = new Image(); const url = URL.createObjectURL(blob);
      img.onload = () => { URL.revokeObjectURL(url); res(img); }; img.onerror = (e) => { URL.revokeObjectURL(url); rej(e); }; img.src = url;
    });
  }
  // 換角色時把舊的圖片還給系統，連續換很多隻角色記憶體也不會一直累積
  function freeImage(img) { try { if (img && img.close) img.close(); } catch {} }
  function freeCanvases(map) {
    if (!map) return;
    for (const c of map.values()) if (c && c.getContext) { c.width = 0; c.height = 0; }
    map.clear();
  }
  function freeBul(bul) { for (const k in bul || {}) { freeImage(bul[k].atlas); freeCanvases(bul[k].sprites); } }
  function freeFighter(f) { if (!f) return; freeImage(f.atlas); freeCanvases(f.sprites); freeBul(f.bul); }
  let pakoPromise = null;
  function loadPako() {
    if (window.pako) return Promise.resolve();
    if (!pakoPromise) pakoPromise = new Promise((res, rej) => {
      const sc = document.createElement("script");
      sc.src = "https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js";
      sc.onload = res; sc.onerror = () => rej(new Error("無法載入解壓縮元件"));
      document.head.appendChild(sc);
    });
    return pakoPromise;
  }
  async function fetchGzJson(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`找不到資料（${r.status}）`);
    const u8 = new Uint8Array(await r.arrayBuffer());
    if (!(u8[0] === 0x1f && u8[1] === 0x8b)) return JSON.parse(new TextDecoder().decode(u8));
    if (window.DecompressionStream) {
      const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream("gzip"));
      return JSON.parse(await new Response(stream).text());
    }
    await loadPako();
    return JSON.parse(window.pako.ungzip(u8, { to: "string" }));
  }

  async function loadIndex() {
    const note = $("modeNote");
    // 幾份索引同時下載；原始數值（stats.json）等第一次進雙人對戰才下載
    const get = (name, fb) => fetchData(LOCAL + name, "json").catch(() => fb);
    const getC = (name, fb) => fetchData(CUSTOM + name, "json").catch(() => fb);
    const [idx, skills, proj, st, cIdx, cSkills] = await Promise.all([get("units.json", []), get("skills.json", {}), get("projectiles.json", {}), get("sync_state.json", {}), getC("units.json", []), getC("skills.json", {})]);
    S.index = Array.isArray(idx) ? idx : []; S.skills = skills || {}; S.proj = proj || {};
    if (Array.isArray(cIdx)) for (const r of cIdx) if (r && r.id && !S.index.some((x) => x.id === r.id)) { customIds.add(r.id); S.index.push(r); }
    Object.assign(S.skills, cSkills || {});
    S.index.forEach((r) => { if (!r.name) r.name = r.id; });
    let when = "";
    try { if (st && st.synced_at) when = `・資料更新於 ${new Date(st.synced_at).toLocaleDateString("zh-TW")}`; } catch {}
    if (S.index.length) { note.textContent = `共 ${S.index.length} 隻角色${when}`; note.classList.remove("off"); }
    else { note.textContent = "還沒有角色資料。第一次同步完成後重新整理即可。"; note.classList.add("off"); }
  }
  let statsPromise = null;
  function ensureStats() {
    if (!statsPromise) statsPromise = Promise.all([
      fetchData(LOCAL + "stats.json", "json").catch(() => ({})),
      fetchData(CUSTOM + "stats.json", "json").catch(() => ({})),
    ]).then(([x, c]) => { S.stats = Object.assign({}, x && typeof x === "object" ? x : {}, c && typeof c === "object" ? c : {}); });
    return statsPromise;
  }
  /* 技能的完整效果清單（只有格鬥場用；單人、雙人不讀）。沒有這個檔（例如還沒同步過）時當作空的，格鬥場改看 stats.json 的傷害欄位 */
  let fxPromise = null;
  function ensureSkillFx() {
    if (!fxPromise) fxPromise = Promise.all([
      fetchData(LOCAL + "skill_fx.json", "json").catch(() => ({})),
      fetchData(CUSTOM + "skill_fx.json", "json").catch(() => ({})),
    ]).then(([x, c]) => { S.fx = Object.assign({}, x && typeof x === "object" ? x : {}, c && typeof c === "object" ? c : {}); });
    return fxPromise;
  }
  /* 角色的動畫資料（單人、雙人共用）：官方角色是壓縮檔 .json.gz（找不到才讀 .json），自製角色是 .json */
  async function loadUnitMeta(id) {
    const base = baseOf(id);
    let meta;
    if (customIds.has(id)) meta = await fetchData(`${base}units/${id}.json`, "json");
    else {
      try { meta = await fetchGzJson(`${base}units/${id}.json.gz`); }
      catch { meta = await fetchData(`${base}units/${id}.json`, "json"); }
    }
    meta.base = base;
    return meta;
  }
  // 本體以外的部件（投射物）圖片；讀不到的略過
  async function loadBullets(meta) {
    const bul = {};
    await Promise.all(Object.keys(meta.parts).filter((k) => k !== "body").map(async (k) => {
      try { bul[k] = { part: meta.parts[k], atlas: await blobToImage(await fetchData(meta.base + meta.parts[k].png, "blob")), sprites: new Map() }; } catch {}
    }));
    return bul;
  }
