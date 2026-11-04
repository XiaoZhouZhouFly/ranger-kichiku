  /* ---------- 格鬥場：角色資料標準化（解讀層） ----------
     原始資料（stats.json、projectiles.json、skill_fx.json、動畫名稱）→ 一份統一格式 N。
     這裡只負責「這隻角色是什麼」：每個欄位的值、狀態、出處，普攻與技能的攻擊形式、效果清單、哪些還不支援。
     「換算成多少數字」在 js-18-fight-data.js 的 fightStats（只讀 N，不直接讀原始資料）。

     欄位狀態 st：ok 有值、zero 值是 0（保留 0，不會被換成預設值）、missing 沒有、bad 格式錯誤。
     guess＝true 表示用了預設值或從別的欄位推出來（會列進相容性問題）。
     問題等級 lvl：unfit 不適合格鬥場、unsupported 有功能還不支援（有明確的代替方式）、guess 推測、info 補充。 */

  // 攻擊形式（delivery）：普攻、技能共用的名稱
  const FORM_LABEL = { melee: "近戰", dline: "瞬間直線", line: "直線投射物", lob: "拋物線", target: "指定位置打擊", buff: "輔助" };
  // 形式 → 引擎的招式種類（引擎看 kind；普攻的直線投射物叫 shot）
  const FORM_KIND = { atk: { melee: "melee", dline: "dline", line: "shot", lob: "lob" }, sk: { target: "rect", line: "line", lob: "lob", buff: "buff" } };
  const FIELD_ST_LABEL = { ok: "有值", zero: "0", missing: "沒有", bad: "格式錯誤" };

  /* 技能效果代碼（skill_fx.json 的 c，去掉 SKILLEFF_）→ [名稱, 支援狀態]
     支援狀態：ok 已支援、part 部分支援、r2 第二輪（第一批效果）、b2 第二批、none 未規劃。沒列到的依字首判斷（fxInfo）。 */
  const FX_STATUS_LABEL = { ok: "已支援", part: "部分支援", r2: "未支援（第二輪）", b2: "未支援（第二批）", none: "未規劃" };
  const FX_INFO = {
    DMG: ["傷害", "ok"], DOT: ["持續傷害", "part"],
    STUN: ["暈眩", "r2"], KNOCKBACK: ["擊退", "r2"], HEAL: ["回血", "r2"], DOTHEAL: ["持續回血", "r2"], UNBEAT: ["無敵", "r2"], SILENCE: ["沉默", "r2"],
    "BUFF-ATK": ["攻擊增加", "r2"], "DEBUFF-ATK": ["攻擊降低", "r2"], "BUFF-SPEED": ["移速增加", "r2"], "DEBUFF-SPEED": ["移速降低", "r2"],
    SUMMON: ["召喚", "b2"], SUMMON_ENEMY: ["召喚對手複製體", "b2"], "BUFF-HP": ["體力增加", "b2"], "BUFF-ATKSPD": ["攻速增加", "b2"], "DEBUFF-ATKSPD": ["攻速降低", "b2"],
    "BUFF-NORMAL_DEF": ["物防增加", "b2"], "DEBUFF-NORMAL_DEF": ["物防降低", "b2"], "BUFF-SPECIAL_DEF": ["魔防增加", "b2"], "DEBUFF-SPECIAL_DEF": ["魔防降低", "b2"],
    MOVE_ENEMY1: ["拉動敵人", "b2"], MOVE_ENEMY2: ["拉動敵人", "b2"], MOVE_ATTACK: ["突進", "b2"], FEAR: ["恐懼", "b2"], TEMPT: ["魅惑", "b2"], POLYMORPH: ["變形", "b2"], BUBBLE: ["泡泡", "b2"],
  };
  // 增益／減益／清除後面接的能力名稱
  const FX_STAT = { ATK: "攻擊", HP: "體力", SPEED: "移速", ATKSPD: "攻速", NORMAL_DEF: "物防", SPECIAL_DEF: "魔防", SKILL_RESIST: "技能抗性", SKILL_AVOID_CHANCE: "技能閃避",
    SKILL_CHANCE: "技能發動率", ANTI_SK_AVOID_PROB: "技能命中", ANTI_AVOID_PROB: "命中", AVOID_CHANCE: "閃避", CRITICAL_CHANCE: "爆擊率", CRITICAL_POWER: "爆擊傷害",
    ATKRANGE: "攻擊距離", SKILLRANGE: "技能範圍", CHANGE_SPLASH: "攻擊變範圍", VAMPIRE: "吸血", UNBEAT: "無敵", ENEMY: "敵方增益", ALLY: "我方減益", DOTHEAL: "持續回血",
    POISON: "中毒", DEBUFF: "減益", SUMMON: "召喚物" };
  Object.assign(FX_INFO, { MIRROR_PHY: ["反射物理傷害", "b2"], MIRROR_MAG: ["反射魔法傷害", "b2"], CURSE_DEBUFF: ["詛咒", "b2"], SKILL_RESET: ["技能冷卻重置", "b2"],
    SCALE: ["縮放", "none"], THROW_ALLY: ["投擲隊友", "none"], CHANGE_ENEMY: ["改變敵人", "none"] });
  const FX_NOTE = { DMG: "傷害量目前固定，第三輪改用官方倍率", DOT: "目前以一次傷害代替" };
  function fxInfo(code) {
    if (FX_INFO[code]) return FX_INFO[code];
    const stat = (x) => FX_STAT[x] || x;
    if (code.startsWith("BUFF-")) return [stat(code.slice(5)) + "增加", "b2"];
    if (code.startsWith("DEBUFF-")) return [stat(code.slice(7)) + "降低", "b2"];
    if (/^CLEAN/.test(code)) return ["清除" + stat(code.replace(/^CLEAN(ING)?_/, "")), "b2"];
    if (code.startsWith("CHANGE_")) return ["屬性轉換", "none"];
    return [code || "（空白代碼）", "none"];
  }
  const FX_DAMAGE = new Set(["DMG", "DOT"]);
  const FX_SUMMON = new Set(["SUMMON", "SUMMON_ENEMY"]);

  // 一個數字欄位：陣列取第一個（1 級數值）；0 保留；沒有或格式錯誤時用 def 並標記 guess
  function normField(obj, key, def) {
    const raw = obj && obj[key] != null ? (Array.isArray(obj[key]) ? obj[key][0] : obj[key]) : undefined;
    if (raw === undefined) return { v: def, st: "missing", guess: def != null };
    const v = typeof raw === "number" ? raw : raw === "" ? NaN : +raw;
    if (!Number.isFinite(v)) return { v: def, st: "bad", guess: def != null, raw };
    return { v, st: v === 0 ? "zero" : "ok", guess: false };
  }
  // 動畫名稱 → 各動作用哪一段（跟單人、雙人同一張 CLIPS 表）
  function normClips(anims) {
    const out = {};
    for (const c of CLIPS) out[c.key] = c.names.find((n) => anims.has(n)) || null;
    return out;
  }
  // 有影格的動畫名稱
  const animNames = (part) => new Set(Object.keys(part.animations).filter((n) => part.animations[n]?.frames?.length));

  /* 原始飛行方式 → 攻擊形式。cfg＝projectiles.json 的 n／s1／s2，rg＝射程（遊戲單位）。
     回傳 { form, src, note }；note 有值時代表做了推測或代替（會列進問題）。 */
  const fMoving = (c) => !!(c && c.v > 0 && c.e);
  function normDelivery(cfg, rg, isAtk) {
    const m = cfg ? String(cfg.m || "NONE") : null;
    const near = (src, note) => ({ form: rg < FT.MELEE_RG ? "melee" : "dline", src, note }); // 普攻：沒有飛行過程時依射程分近戰／瞬間直線
    if (!cfg) return isAtk ? near("射程", "沒有投射物資料，依射程判斷") : { form: "target", src: "預設" };
    if ((m === "LINEAR" || m === "CURVE") && fMoving(cfg)) return { form: m === "LINEAR" ? "line" : "lob", src: m };
    if (m === "LINEAR" || m === "CURVE") return isAtk ? near(m, "投射物不會移動，當成直接命中") : { form: "target", src: m, note: "投射物不會移動，當成指定位置打擊" };
    if (m === "DIRECT" || m === "NONE") return isAtk ? near(m) : { form: "target", src: m };
    // RETURN、BEAM 或不認識的：明確代替並記錄（目前資料裡沒有）
    return { form: isAtk ? "line" : "target", src: m, note: `${m} 未支援，以${isAtk ? "直線投射物" : "指定位置打擊"}代替`, unsupported: true };
  }

  /* 一隻角色 → N
     r＝角色（id、name），anims＝有影格的動畫名稱（Set）。preset＝FIGHT_PRESET 的覆寫（有寫的部分不算問題）。 */
  function normUnit(r, anims) {
    const id = r.id, st = S.stats[id], pj = S.proj[id] || null, fxAll = (S.fx || {})[id] || null, pre = FIGHT_PRESET[id] || null;
    const N = { id, name: r.name || "", issues: [], f: {}, clips: normClips(anims), atk: null, sk: [], preset: !!pre };
    const issue = (lvl, where, msg) => N.issues.push({ lvl, where, msg });
    // 適不適合格鬥場
    if (!r.name) issue("unfit", "名稱", "沒有名稱（多半是頭目、NPC 或召喚物）");
    if (!st) issue("unfit", "數值", "stats.json 沒有這隻");
    // 基本數值：體力沒有就沒有（換算時用中位數並標推測），其他給預設值
    const FIELDS = [["hp", null, "體力"], ["pd", 0, "物防"], ["md", 0, "魔防"], ["rg", 150, "射程"], ["mv", 90, "移速"], ["ai", 1.2, "攻擊間隔"]];
    for (const [k, def, label] of FIELDS) {
      const x = (N.f[k] = Object.assign(normField(st, k, def), { label }));
      if (st && (x.st === "missing" || x.st === "bad")) issue("guess", label, `${FIELD_ST_LABEL[x.st]}${x.guess ? `，用預設值 ${def}` : ""}`);
    }
    if (st && N.f.hp.st !== "missing" && N.f.hp.v <= 1) issue("unfit", "體力", "佔位資料（體力 ≤ 1）");
    if (!N.clips.idle && !N.clips.attack) issue("unfit", "動作", "沒有待機也沒有攻擊動作");
    const rg = N.f.rg.v;

    // 普攻
    const d = normDelivery(pj && pj.n, rg, true);
    N.atk = { form: d.form, src: d.src, cfg: (pj && pj.n) || null, clip: N.clips.attack };
    if (pre && pre.atk) N.atk.form = { melee: "melee", shot: "line", lob: "lob", dline: "dline" }[pre.atk.kind] || N.atk.form;
    else if (d.note) issue(d.unsupported ? "unsupported" : "guess", "普攻", d.note);
    if (!N.atk.clip) issue("guess", "普攻", "沒有普攻動作（用待機動作代替）");

    // 技能
    for (const s of [0, 1]) {
      const where = `技能${s + 1}`, base = st && st.sk && st.sk[s], fxs = fxAll && fxAll[s], p = pre && pre.sk && pre.sk[s];
      if (!base && !fxs && !p) { N.sk.push({ s, exists: false, why: st ? "資料裡沒有這個技能" : "沒有數值資料" }); continue; }
      const k = { s, exists: true, clip: N.clips[s ? "skill2" : "skill1"], clipSub: false, fx: [], cfg: (pj && pj[s ? "s2" : "s1"]) || null };
      if (!k.clip) { k.clip = N.clips.attack; k.clipSub = true; issue("guess", where, "沒有技能動作（用普攻動作代替）"); }
      // 效果：優先用完整效果清單（skill_fx.json），沒有就用 stats.json 的傷害欄位
      if (fxs && Array.isArray(fxs.fx)) {
        k.fxSrc = "skill_fx";
        k.fx = fxs.fx.map((e) => { const [label, sup] = fxInfo(String(e.c || "")); return { c: String(e.c || ""), label, sup, dur: e.d && +e.d.seconds || 0, r: +e.r || 0 }; });
      } else if (base) {
        k.fxSrc = "stats";
        k.fx = (base.e || []).map((e) => (e.t === "dot" ? { c: "DOT", label: "持續傷害", sup: "part", dur: +e.d || 0, r: 0 } : { c: "DMG", label: "傷害", sup: "ok", dur: 0, r: 0 }));
        if (!p) issue("info", where, "沒有完整效果資料（只看傷害欄位）");
      }
      // 冷卻、作用範圍（左右各多少，遊戲單位）
      k.cd = normField(base, "cd", null); if (k.cd.st === "missing" && fxs && fxs.cd != null) k.cd = { v: +fxs.cd, st: "ok", guess: false };
      const fxR = Math.max(0, ...k.fx.map((e) => e.r));
      k.effectRange = base && +base.ar > 0 ? { v: +base.ar, st: "ok" } : fxR > 0 ? { v: fxR, st: "ok" } : { v: null, st: "missing" };
      // 攻擊形式：有傷害效果才看飛行方式；沒有傷害＝輔助（召喚另外標示）
      const damaging = k.fx.some((e) => FX_DAMAGE.has(e.c)), summon = k.fx.some((e) => FX_SUMMON.has(e.c));
      if (p) k.form = { rect: "target", line: "line", lob: "lob", buff: "buff" }[p.kind] || "target";
      else if (damaging) {
        const dd = normDelivery(k.cfg, rg, false); k.form = dd.form; k.src = dd.src;
        if (dd.note) issue(dd.unsupported ? "unsupported" : "guess", where, dd.note);
      } else if (summon) k.form = "target";
      else { k.form = "buff"; if (!p) issue("unsupported", where, "沒有傷害的技能：效果還沒支援，暫時用「加攻＋回血」代替"); }
      if (summon && !p) issue("unsupported", where, damaging ? "召喚未支援（第二批），目前只有傷害部分" : "召喚未支援（第二批），以指定位置打擊代替");
      if (!p && k.form === "target" && k.effectRange.st === "missing") issue("guess", where, "沒有作用範圍，用預設寬度");
      // 還沒支援的效果（傷害、召喚以外；召喚上面已經標過）
      const todo = k.fx.filter((e) => e.sup !== "ok" && !FX_SUMMON.has(e.c));
      if (todo.length && !p) issue(todo.every((e) => e.sup === "part") ? "info" : "unsupported", where, todo.map((e) => `${e.label}${e.sup === "part" ? "（" + FX_NOTE[e.c] + "）" : ""}`).filter((x, i, a) => a.indexOf(x) === i).join("、") + (todo.some((e) => e.sup !== "part") ? " 未支援" : ""));
      N.sk.push(k);
    }
    N.fit = !N.issues.some((x) => x.lvl === "unfit");
    return N;
  }

  // 選角畫面用的相容性說明（一行一項；沒有問題就寫「資料完整」）
  function normSummary(N) {
    const icon = { unfit: "⛔", unsupported: "⚠", guess: "？", info: "ⓘ" };
    const head = `普攻 ${FORM_LABEL[N.atk.form]}｜` + N.sk.map((k, s) => `技能${s + 1} ${k.exists ? FORM_LABEL[k.form] : "沒有"}`).join("｜");
    const rows = N.issues.map((x) => `${icon[x.lvl]} ${x.where}：${x.msg}`);
    return `相容性：${head}\n` + (rows.length ? rows.join("\n") : "✓ 資料完整") + (N.preset ? "\n✎ 自製角色（手寫數值）" : "");
  }

  /* 相容性報告：把全部角色跑一次標準化（只讀動畫的名稱，不載圖片）。
     回傳 { rows: [{ id, name, fit, atk, sk, issues }], summary }；tools/fight_compat.mjs 會把它寫成報告。 */
  async function normAll(onProgress) {
    await Promise.all([ensureStats(), ensureSkillFx()]);
    const rows = [], list = S.index.slice();
    let next = 0;
    const work = async () => {
      while (next < list.length) {
        const r = list[next++];
        let anims = new Set();
        try { const meta = await loadUnitMeta(r.id); const part = meta.parts.body || meta.parts[Object.keys(meta.parts)[0]]; anims = animNames(part); } catch {}
        const N = normUnit(r, anims);
        rows.push({ id: r.id, name: N.name, fit: N.fit, atk: N.atk.form, sk: N.sk.map((k) => (k.exists ? k.form : null)),
          fx: N.sk.map((k) => (k.exists ? k.fx.map((e) => e.c) : [])), issues: N.issues.map((x) => [x.lvl, x.where, x.msg]) });
        if (onProgress && rows.length % 200 === 0) onProgress(rows.length, list.length);
      }
    };
    await Promise.all(Array.from({ length: 8 }, work));
    rows.sort((a, b) => (a.id < b.id ? -1 : 1));
    // 統計
    const fit = rows.filter((x) => x.fit), count = (arr, key) => arr.reduce((m, x) => ((m[key(x)] = (m[key(x)] || 0) + 1), m), {});
    const lvl = (x, l) => x.issues.some((i) => i[0] === l);
    const fxCount = {};
    for (const x of fit) for (const list2 of x.fx) for (const c of list2) fxCount[c] = (fxCount[c] || 0) + 1;
    const summary = {
      total: rows.length, fit: fit.length,
      unfitWhy: count(rows.filter((x) => !x.fit), (x) => x.issues.filter((i) => i[0] === "unfit").map((i) => i[2]).join("＋")),
      clean: fit.filter((x) => !x.issues.some((i) => i[0] !== "info")).length,
      withUnsupported: fit.filter((x) => lvl(x, "unsupported")).length, withGuess: fit.filter((x) => lvl(x, "guess")).length,
      atkForms: count(fit, (x) => x.atk), skForms: count(fit.flatMap((x) => x.sk.filter(Boolean).map((f) => ({ f }))), (y) => y.f),
      skillCount: count(fit, (x) => x.sk.filter(Boolean).length),
      fx: Object.fromEntries(Object.entries(fxCount).sort((a, b) => b[1] - a[1]).map(([c, n]) => [c, { n, label: fxInfo(c)[0], sup: fxInfo(c)[1] }])),
    };
    return { rows, summary };
  }
