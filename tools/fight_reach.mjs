// 格鬥場判定距離量測：比較「攻擊動畫實際伸到多遠」和「目前的判定距離」（v7.4）。
// 用法：node tools/fight_reach.mjs <網站資料夾（含 data/、custom/）> [輸出資料夾，預設 tools/out] [--ids a,b]
// 不用開瀏覽器：直接讀動畫資料，照網站的算法（js-13 fItems/fBounds、js-18 fightStats）換算成場地單位。
// 產出 fight_reach.md（差距最大的排前面）、fight_reach.json。
import fs from "node:fs"; import path from "node:path"; import zlib from "node:zlib"; import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : d; };
const IDS = opt("--ids", ""); const SITE = path.resolve(args[0] || "."), OUT = path.resolve(args[1] || path.join(HERE, "out"));
fs.mkdirSync(OUT, { recursive: true });
const rd = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const both = (n, d) => Object.assign({}, rd(path.join(SITE, "data", n), d), rd(path.join(SITE, "custom", n), d));
const units = [...rd(path.join(SITE, "data/units.json"), []), ...rd(path.join(SITE, "custom/units.json"), [])];
const stats = both("stats.json", {}), proj = both("projectiles.json", {});
// 跟網站一樣的常數（js-18-fight-data.js FT、js-00 CLIPS）
const CH = 170, MELEE_RG = 200, RG_REACH = 0.6, REACH_MIN = 70, REACH_MAX = 150, DLINE_MIN = 150, DLINE_MAX = 560;
const IDLE = ["idle", "wait"], ATK = ["attack_all", "attack", "attack_a", "attack_b"];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function meta(id) {
  const c = path.join(SITE, "custom/units", id + ".json"); if (fs.existsSync(c)) return rd(c, null);
  const g = path.join(SITE, "data/units", id + ".json.gz");
  if (fs.existsSync(g)) { try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(g)).toString("utf8")); } catch {} }
  return rd(path.join(SITE, "data/units", id + ".json"), null);
}
// 一格裡每個部件的四個角（js-13 fItems 的矩陣乘法）
function corners(part, frame, minAlpha) {
  const out = [];
  for (const it of frame || []) {
    const def = part.images[it[1]], om = it[2], col = it[3];
    if (!def || !Array.isArray(om) || !Array.isArray(def.m)) continue;
    const a = (Array.isArray(col) && col.length > 3 ? col[3] : 255) / 255; if (a < minAlpha) continue;
    const sp = part.sprites[def.name]; if (!sp || !sp.rect || !sp.rect[2]) continue;
    const [m00, m01, m10, m11, m02, m12] = om, [i00, i01, i10, i11, i02, i12] = def.m;
    const A = m00 * i00 + m01 * i10, B = m00 * i01 + m01 * i11, C = m00 * i02 + m01 * i12 + m02, D = m10 * i00 + m11 * i10, E = m10 * i01 + m11 * i11, F = m10 * i02 + m11 * i12 + m12;
    for (const [px, py] of [[0, 0], [sp.rect[2], 0], [0, sp.rect[3]], [sp.rect[2], sp.rect[3]]]) out.push([A * px + B * py + C, D * px + E * py + F]);
  }
  return out;
}
function bounds(part, anim, minAlpha = 0.3) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const fr of part.animations[anim]?.frames || []) for (const [x, y] of corners(part, fr, minAlpha)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return isFinite(x0) ? { x0, x1, y0, y1 } : null;
}
/* 攻擊實際伸到多遠（穩健版）：每一格只算「跟身體連在一起」的部件——從身體中心往前，部件之間的空隙小於身高的 GAP 倍才算連著，
   飛出去的金幣、粒子、全螢幕特效不算；也不算高度在身體上下太遠的部件。取全部格裡最遠的那一格。 */
const GAP = 0.15;
function reachPx(part, anim, cx, y0, y1) {
  const h = y1 - y0, tol = h * GAP; let best = 0;
  for (const fr of part.animations[anim]?.frames || []) {
    const iv = [];
    const pts = corners(part, fr, 0.3);
    for (let i = 0; i < pts.length; i += 4) {
      const xs = pts.slice(i, i + 4).map((p) => p[0]), ys = pts.slice(i, i + 4).map((p) => p[1]);
      if (Math.max(...ys) < y0 - h * 0.5 || Math.min(...ys) > y1 + h * 0.2) continue; // 身體上下太遠
      iv.push([Math.min(...xs), Math.max(...xs)]);
    }
    iv.sort((a, b) => a[0] - b[0]);
    let cur = cx;
    for (const [a, b] of iv) { if (a <= cur + tol) cur = Math.max(cur, b); }
    best = Math.max(best, cur - cx);
  }
  return best;
}
const pick = (part, names) => names.find((n) => part.animations[n]?.frames?.length) || null;
const rows = [];
const list = IDS ? IDS.split(",") : units.filter((u) => u.name && !u.hidden && stats[u.id] && +((stats[u.id].hp || [0])[0]) > 1).map((u) => u.id);
for (const id of list) {
  const m = meta(id); if (!m || !m.parts) continue;
  const part = m.parts.body || m.parts[Object.keys(m.parts)[0]];
  const idle = pick(part, IDLE) || pick(part, ATK), atk = pick(part, ATK); if (!idle || !atk) continue;
  const lb = bounds(part, idle); if (!lb) continue;
  const ox = -(lb.x0 + lb.x1) / 2, h = lb.y1 - lb.y0, k = CH / h;                    // js-11 loadFighter：以身體中心站位、身高縮成 170
  const bw = clamp((lb.x1 - lb.x0) / h * CH, 56, 120);
  const front = reachPx(part, atk, -ox, lb.y0, lb.y1) * k;                         // 攻擊動作最遠伸到中心前方多少（場地單位，只算連著身體的部件）
  const raw = bounds(part, atk), rawFront = raw ? (raw.x1 + ox) * k : 0;
  const st = stats[id], rg = +((Array.isArray(st.rg) ? st.rg[0] : st.rg) || 150), pj = proj[id] && proj[id].n;
  const moving = pj && pj.v > 0 && pj.e, mode = pj ? String(pj.m || "NONE") : null;
  const kind = moving && mode === "LINEAR" ? "shot" : moving && mode === "CURVE" ? "lob" : rg < MELEE_RG ? "melee" : "dline";
  if (kind === "shot" || kind === "lob") continue;                                  // 會飛的投射物另外處理
  const hitFront = bw / 2 + (kind === "melee" ? clamp(rg * RG_REACH, REACH_MIN, REACH_MAX) : clamp(rg * RG_REACH, DLINE_MIN, DLINE_MAX));
  const u = units.find((x) => x.id === id);
  rows.push({ id, name: u ? u.name : id, kind, rg, visual: Math.round(front), raw: Math.round(rawFront), hit: Math.round(hitFront), gap: Math.round(front - hitFront), bw: Math.round(bw) });
}
rows.sort((a, b) => b.gap - a.gap);
fs.writeFileSync(path.join(OUT, "fight_reach.json"), JSON.stringify(rows, null, 1));
const short = rows.filter((r) => r.gap > 30), md = [`# 格鬥場判定距離量測`, ``, `${rows.length} 隻（近戰、瞬間直線；會飛的投射物不在內）。距離都從角色中心往前算，場地單位（身高 170）。`,
  `「畫面」＝攻擊動作最遠伸到哪；「判定」＝目前的判定前緣（身體半寬＋reach／range）。差距 > 30 的有 ${short.length} 隻（近戰 ${short.filter((r) => r.kind === "melee").length}、瞬間直線 ${short.filter((r) => r.kind === "dline").length}）；判定比畫面長 > 30 的有 ${rows.filter((r) => r.gap < -30).length} 隻。`, ``,
  `| 角色 | 種類 | 原始射程 | 畫面 | 判定 | 差距 |`, `| --- | --- | --- | --- | --- | --- |`, ...rows.map((r) => `| ${r.name}（${r.id}） | ${r.kind === "melee" ? "近戰" : "瞬間直線"} | ${r.rg} | ${r.visual} | ${r.hit} | ${r.gap > 0 ? "+" : ""}${r.gap} |`)];
fs.writeFileSync(path.join(OUT, "fight_reach.md"), md.join("\n"));
console.log(md.slice(0, 4).join("\n"));
