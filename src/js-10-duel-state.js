  /* ---------- 雙人對戰：狀態與設定表 ----------
     D 是雙人對戰唯一的狀態物件，分成兩種欄位：
       1. 設定（DUEL_SETTINGS 表裡的欄位）：使用者調的東西，會存進瀏覽器、專案檔，影響結果的會寫進分享連結。
       2. 執行中的資料：角色（f）、招式（moves）、計算結果（見 js-11 的 TIMELINE 說明）、播放位置等。
     新增一個設定只要在 DUEL_SETTINGS 加一筆，存檔、讀檔、分享連結、恢復預設、交換左右都會自動處理。 */
  const dcv = $("dcv");
  const dctx = dcv.getContext("2d");
  const DMG = { attack: 15, skill1: 30, skill2: 40 };
  const ACTION_LABEL = { move: "移動接近", attack: "一般攻擊", skill1: "技能1", skill2: "技能2" };

  /* 對戰類型：經典（照招式表演）、真距離（依距離模擬）、原始數值（依遊戲數值模擬） */
  const KINDS = {
    classic: { label: "經典對戰", sim: false, raw: false },
    real: { label: "真距離對戰", sim: true, raw: false },
    raw: { label: "原始數值對戰", sim: true, raw: true },
  };
  const isSim = () => KINDS[D.type].sim; // 真距離或原始數值（逐格模擬）
  const isRaw = () => KINDS[D.type].raw;

  /* 整理輸入值的小工具：空白或不是數字就回傳 undefined（由呼叫的地方改用預設值），超出範圍就夾到範圍內 */
  const num = (lo, hi, round) => (v) => {
    if (v === null || v === undefined || v === "" || typeof v === "boolean" || !isFinite(+v)) return undefined;
    const n = round ? Math.round(+v) : +v;
    return Math.max(lo, Math.min(hi, n));
  };
  const bool = (v) => (typeof v === "boolean" ? v : v === 0 || v === "0" ? false : v === 1 || v === "1" ? true : undefined);
  const pair = (one) => (v) => (Array.isArray(v) && v.length === 2 ? v.map((x) => { const y = one(x); return y === undefined ? null : y; }) : undefined);
  const optNum = (lo, hi) => (v) => (v === null || v === "" ? null : num(lo, hi)(v));
  const oneOf = (...list) => (v) => (list.includes(v) ? v : undefined);
  const objPair = (v) => (Array.isArray(v) && v.length === 2 ? v.map((x) => (x && typeof x === "object" && !Array.isArray(x) ? x : {})) : undefined);

  /* 設定表
     key：D 上的欄位名稱；def：預設值（陣列、物件用函式產生，避免共用同一份）
     clean：把存檔、網址、專案檔讀到的值整理成合法值（不合法就用預設）
     q／d：分享連結裡的位置——q＝一般網址參數名稱，d＝壓縮包 d 裡的代號；enc／dec 是網址格式和內部格式的轉換
     share(D)：要不要寫進分享連結（省略＝跟預設不同才寫）；always＝一定寫
     perSide：左右各一個值的陣列，交換左右時跟著交換
     reset：「全部恢復預設」會還原的對戰類型；label：按鈕說明裡的名稱
     ui：只影響畫面、不影響結果（不寫進分享連結） */
  const DEF_SUMCAP = 3;
  const DUEL_SETTINGS = [
    { key: "type", def: "classic", clean: oneOf("classic", "real", "raw"), q: "type", always: true },
    { key: "mode", def: "trade", clean: oneOf("trade", "random", "custom"), q: "m", always: true },
    { key: "seed", def: 1, clean: num(1, 1e9, true), q: "s", always: true },
    { key: "hpMul", label: "血量倍率", def: 1, clean: (v) => (+v > 0 ? Math.min(100000, +v) : undefined), q: "hp", share: (D) => isRaw() && D.hpMul !== 1, reset: ["raw"] },
    { key: "level", label: "雙方等級", def: () => [null, null], clean: pair(num(1, 1e6, true)), q: "lv", perSide: true, reset: ["raw"],
      share: (D) => isRaw() && !!(D.level[0] || D.level[1]), enc: (v) => v.map((x) => x || "").join(","), dec: (s) => String(s).split(",").slice(0, 2).concat([""]).slice(0, 2).map((x) => (+x > 0 ? +x : null)) },
    { key: "cheat", label: "金手指", def: () => [{}, {}], clean: objPair, d: "ch", perSide: true, reset: ["raw"], share: (D) => isRaw() && hasCheat(D.cheat) },
    { key: "range", label: "攻擊距離", def: () => [null, null], clean: pair(optNum(0, 1e6)), d: "rg", perSide: true, reset: ["real", "raw"] },
    { key: "mvs", label: "移動速度", def: () => [null, null], clean: pair(optNum(1, 2000)), d: "ms", perSide: true, reset: ["real", "raw"], share: (D) => isSim() && (D.mvs[0] != null || D.mvs[1] != null) },
    { key: "sumCap", def: DEF_SUMCAP, clean: num(1, 20, true), d: "sc" },
    { key: "sumAtk", def: null, clean: optNum(0, 1000), d: "sa" },
    { key: "sumHp", def: null, clean: optNum(1, 1000), d: "sh" },
    // v4.14 起寫進分享連結（會影響結果，之前漏掉，朋友打開會跟分享的人不同）
    { key: "dist", label: "雙方距離 320", def: 320, clean: num(120, 700), d: "di", share: (D) => !isSim() && D.dist !== 320, reset: ["classic"] },
    { key: "speed", label: "整體速度 1×", def: 1, clean: num(0.4, 2.5), d: "sp", reset: ["classic", "real", "raw"] },
    { key: "projOn", def: true, clean: bool, d: "pj", enc: (v) => (v ? 1 : 0) },
    { key: "finale", def: true, clean: bool, d: "fn", enc: (v) => (v ? 1 : 0) },
    { key: "timeLimit", label: "時間上限", def: 60, clean: num(5, 600), d: "tl", share: (D) => isSim() && D.timeLimit !== 60, reset: ["real", "raw"] },
    // 只影響畫面
    { key: "shake", def: true, clean: bool, ui: true },
    { key: "invert", def: false, clean: bool, ui: true },
    { key: "numbers", def: true, clean: bool, ui: true },
    { key: "bars", def: true, clean: bool, ui: true },
    { key: "ground", def: 8, clean: num(0, 45), ui: true },
  ];
  const SETTING = Object.fromEntries(DUEL_SETTINGS.map((s) => [s.key, s]));
  const settingDef = (s) => (typeof s.def === "function" ? s.def() : s.def);
  const sameVal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  const D = {
    f: [null, null], moves: [], sumCapSet: false, bgImg: null,
    pos: 0, playing: false, idle: true, cd: null, recording: false,
    clock: { abs: null, ref: null, st: null }, // 播放音效的時鐘（見 js-05）
  };
  for (const s of DUEL_SETTINGS) D[s.key] = settingDef(s);

  /* TIMELINE：對戰引擎（經典 compileOnce、真距離／原始數值 compileReal）的輸出。
     畫面（renderDuel）、音效（duelSfxList）、錄影只讀這些欄位；引擎本身不碰網頁畫面。
       len         總格數（含 K.O. 慢動作重播）      simLen   模擬了幾格（不含重播）
       timeMap     輸出第 k 格 → 模擬第幾格（null＝一對一）；replayFrom：重播從輸出第幾格開始（-1＝沒有）
       tracks[i]   第 i 方的動作片段 { anim, start, end, rate, loop }（經典）
       posKeys[i]  第 i 方的位置關鍵格 { k, x }（經典）  frames[i]：第 i 方每一格的狀態 { x, anim, idx, ... }（真距離）
       events      傷害數字、MISS、K.O. 等事件 { k, target, attacker, dmg, label, ko, ... }
       projs       投射物；summons：召喚物與複製體 { side, k0, k1, ... }；sfxEv：音效點 { k（模擬格）, side, kind }
       ko          K.O. 發生在模擬第幾格（-1＝沒有）；resultK／resultText／winner：結果
       finalStart／finalTarget：最後一擊的起點與挨打的一方；maxHp：雙方最大體力；cam：鏡頭範圍 */
  function resetTimeline() {
    Object.assign(D, {
      len: 1, simLen: 0, timeMap: null, replayFrom: -1, tracks: [[], []], posKeys: [[], []], frames: [[], []],
      events: [], projs: [], summons: [], sfxEv: [], ko: -1, resultK: -1, resultText: "", winner: -1,
      finalStart: 0, finalTarget: 1, maxHp: [100, 100], cam: null,
    });
  }
  resetTimeline();

  /* 讀入一包設定（來源：瀏覽器存檔、專案檔、分享連結解出來的物件）。
     沒有的欄位、不合法的值一律用預設值——同一個連結在任何人的瀏覽器都會得到同樣結果。 */
  function applyDuelSettings(obj) {
    obj = obj || {};
    for (const s of DUEL_SETTINGS) {
      const v = obj[s.key] === undefined ? undefined : s.clean(obj[s.key]);
      D[s.key] = v === undefined ? settingDef(s) : v;
    }
    D.sumCapSet = !!obj.sumCapSet;
  }
  /* 瀏覽器存檔／專案檔 → 設定物件（處理舊格式） */
  function settingsFromSaved(saved) {
    const o = Object.assign({}, saved || {});
    // v4.13 以前：對戰類型存成 kind（classic/real）＋ raw
    if (o.type === undefined && o.kind !== undefined) o.type = o.kind === "real" ? (o.raw ? "raw" : "real") : "classic";
    // v4.12：召喚上限預設 5→3；沒自己改過、還存著 5 的改成 3
    if (o.sumCap === 5 && !o.sumCapSet) delete o.sumCap;
    return o;
  }
  /* 分享連結 → 設定物件 */
  function settingsFromUrl(params, packed) {
    const o = {};
    for (const s of DUEL_SETTINGS) {
      let raw;
      if (s.q && params.get(s.q) != null && params.get(s.q) !== "") raw = params.get(s.q);
      else if (s.d && packed[s.d] !== undefined) raw = packed[s.d];
      if (raw === undefined) continue;
      o[s.key] = s.dec ? s.dec(raw) : raw;
    }
    if (o.sumCap !== undefined) o.sumCapSet = true;
    return o;
  }
  /* 目前設定 → 瀏覽器存檔／專案檔（欄位名稱沿用舊版，舊版網頁也讀得懂） */
  function settingsToSaved() {
    const o = {};
    for (const s of DUEL_SETTINGS) o[s.key] = D[s.key];
    o.kind = isSim() ? "real" : "classic"; o.raw = isRaw();
    o.sumCapSet = D.sumCapSet;
    return o;
  }
  /* 目前設定 → 分享連結：q 欄位寫進 params，d 欄位寫進壓縮包 */
  function settingsToUrl(params, packed) {
    for (const s of DUEL_SETTINGS) {
      if (s.ui) continue;
      const on = s.always || (s.share ? s.share(D) : !sameVal(D[s.key], settingDef(s)));
      if (!on) continue;
      const v = s.enc ? s.enc(D[s.key]) : D[s.key];
      if (s.q) params.set(s.q, String(v)); else packed[s.d] = v;
    }
  }
  /* 全部恢復預設：只還原目前對戰類型用得到的設定 */
  function resetDuelSettings(type) {
    const done = [];
    for (const s of DUEL_SETTINGS) if (s.reset && s.reset.includes(type)) { D[s.key] = settingDef(s); done.push(s.key); }
    return done;
  }
  // 隨機種子（1～n-1，不會是 0）
  const newSeed = (n) => Math.floor(Math.random() * n) || 1;
  /* 畫面上的設定欄位 ← D（讀檔、恢復預設之後呼叫）。真距離／原始數值面板由 renderRealPanel 處理。 */
  function syncDuelInputs() {
    $("dDist").value = D.dist; $("dDistOut").textContent = D.dist;
    $("dSpeed").value = D.speed; $("dSpeedOut").textContent = D.speed.toFixed(2) + "×";
    $("dProj").checked = D.projOn; $("dFinale").checked = D.finale;
    $("dShake").checked = D.shake; $("dInvert").checked = D.invert; $("dNumbers").checked = D.numbers; $("dBars").checked = D.bars;
    $("dGround").value = D.ground; $("dGroundOut").textContent = D.ground + "%";
    $("dSumCap").value = D.sumCap; $("dSumAtk").value = D.sumAtk ?? ""; $("dSumHp").value = D.sumHp ?? "";
  }
  /* 從輸入框改一個設定（side：左右各一個值的設定要改哪一邊）。值一樣用設定表整理。 */
  function setDuelSetting(key, v, side) {
    const s = SETTING[key];
    if (side == null) { const c = s.clean(v); D[key] = c === undefined ? settingDef(s) : c; }
    else { const c = s.clean(D[key].map((x, j) => (j === side ? v : x))); if (c) D[key] = c; }
    if (key === "sumCap") D.sumCapSet = true;
  }
  const resetLabels = (type) => DUEL_SETTINGS.filter((s) => s.reset && s.reset.includes(type)).map((s) => s.label).join("、");
  /* 交換左右 */
  function swapDuelSides() { for (const s of DUEL_SETTINGS) if (s.perSide) D[s.key] = D[s.key].slice().reverse(); }
