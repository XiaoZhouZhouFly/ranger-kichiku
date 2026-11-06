// 格鬥場自動平衡報告（v7.4.1）：讀原始紀錄 data/balance/raw/<規則版本>/*.json.gz，算統計、寫分析檔，產生 GitHub Issue 用的 Markdown。
// 用法：
//   週報：  node tools/fight_report.mjs weekly <網站資料夾> --out report.md     （更新 state 的 week／prev，寫 fight_suggest.json、fight_analysis.json）
//   新角色：node tools/fight_report.mjs new <網站資料夾> --out report.md id1 id2 …
//   只算分析檔：node tools/fight_report.mjs analyze <網站資料夾>
// 統計方法（技術文件 格鬥場規格 F-§10）：
// - 強度：Bradley-Terry 模型 P(左勝) ＝ σ(β左 − β右 ＋ h)，h＝整體左方優勢；平手算半勝；β 加常態先驗（λ＝1）讓樣本少的角色不會暴衝。
//   「預期勝率」E＝對整個對手池平均的 σ(β − β對手)（已扣掉抽到強弱對手的運氣、也扣掉左右）；95% 區間用 β ± 1.96／√(資訊量) 換算。
// - 原始勝率＝勝場（平手 0.5）÷ 場數，誤差用二項分布；每場對手不同、只打一次，可視為獨立。
// - 前中後期＝某個時間點「誰的血量 % 比較高」（領先 1、平 0.5、落後 0；那之前已經分出勝負就用結果）：
//   固定版 20／40／60 秒；平均時長版＝全部對戰平均秒數的 1/3、2/3、1（取最接近的 5 秒記錄點）。
// - 剋制殘差（實際 − 模型預測）：類型對類型、角色對類型；角色對某類型 ≥ 150 場且差 ≥ 15 個百分點＝「特化剋制點」。
//   （任兩隻角色平均碰不到一次，逐組殘差不下結論。）
// - 只有樣本 ≥ --min-n（預設 400）的角色列入排名與建議；建議值 m＝exp(−logit(E)÷4)，限制 0.8～1.25（攻擊與體力一起乘，估計值）。
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : d; };
const MODE = args.shift(), SITE = path.resolve(args.shift() || ".");
const BAL = path.join(SITE, "data/balance");
const STATE = opt("--state", path.join(BAL, "fight_samples.json")), SUGGEST = opt("--suggest", path.join(BAL, "fight_suggest.json"));
const ANALYSIS = opt("--analysis", path.join(BAL, "fight_analysis.json")), RAW = opt("--raw", path.join(BAL, "raw"));
const OUT = opt("--out", "report.md");
const WIN_LO = 0.35, WIN_HI = 0.65, MIN_N = +opt("--min-n", 400);
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const state = readJson(STATE, null);
if (!state || !state.v) { console.error("還沒有抽樣資料"); process.exit(1); }
const units = [...readJson(path.join(SITE, "data/units.json"), []), ...readJson(path.join(SITE, "custom/units.json"), [])];
const NAME = Object.fromEntries(units.map((u) => [u.id, u.name || u.id]));
const nm = (id) => NAME[id] || id;
const pct = (x) => (x * 100).toFixed(0) + "%";
const sig = (x) => 1 / (1 + Math.exp(-x));
const clampW = (w) => Math.max(0.02, Math.min(0.98, w));
const mult = (w) => Math.min(1.25, Math.max(0.8, Math.exp(-Math.log(clampW(w) / (1 - clampW(w))) / 4)));
const binCi = (w, n) => 1.96 * Math.sqrt((w * (1 - w) + 1 / (4 * n)) / n);
const table = (head, body) => [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...body.map((r) => `| ${r.join(" | ")} |`)].join("\n");
const ATK = { melee: "近戰", dline: "瞬間直線", line: "投射物", lob: "拋物線" };

// ---------- 讀原始紀錄（目前規則版本） ----------
function loadRaw() {
  const dir = path.join(RAW, state.v), ids = [], idx = new Map(), recs = [];
  const id = (x) => { if (!idx.has(x)) { idx.set(x, ids.length); ids.push(x); } return idx.get(x); };
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json.gz")).sort()) {
    const d = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, f))));
    for (const r of d.recs) recs.push({ a: id(d.pool[r[0]]), b: id(d.pool[r[1]]), res: r[3], t: r[4] / 10, ko: r[5], hp: r[6] ? r[6].split(";").map((x) => x.split(",").map(Number)) : [], date: d.date });
  }
  return { ids, idx, recs };
}

// ---------- 統計 ----------
function analyze() {
  const { ids, recs } = loadRaw(), N = ids.length;
  if (!recs.length) return null;
  const y = (r) => (r.res === 2 ? 0.5 : r.res === 0 ? 1 : 0);
  // Bradley-Terry（左方優勢 h），對角牛頓法
  const beta = new Float64Array(N), LAM = 1; let h = 0;
  const g = new Float64Array(N), H = new Float64Array(N);
  for (let it = 0; it < 200; it++) {
    g.fill(0); H.fill(LAM); let gh = 0, Hh = 1e-6;
    for (let i = 0; i < N; i++) g[i] = -LAM * beta[i];
    for (const r of recs) { const p = sig(beta[r.a] - beta[r.b] + h), e = y(r) - p, w = p * (1 - p); g[r.a] += e; g[r.b] -= e; H[r.a] += w; H[r.b] += w; gh += e; Hh += w; }
    let mx = 0;
    for (let i = 0; i < N; i++) { const d = Math.max(-1, Math.min(1, g[i] / H[i])); beta[i] += d; mx = Math.max(mx, Math.abs(d)); }
    h += Math.max(-0.5, Math.min(0.5, gh / Hh));
    const mean = beta.reduce((a, b) => a + b, 0) / N; for (let i = 0; i < N; i++) beta[i] -= mean;
    if (mx < 1e-4) break;
  }
  const expW = (b) => { let s = 0; for (let j = 0; j < N; j++) s += sig(b - beta[j]); return s / N; };
  // 每隻角色：場數、原始勝率、左右、平手、超時、時長、前中後期
  const C = ids.map(() => ({ n: 0, w: 0, nl: 0, wl: 0, tie: 0, to: 0, t: 0, ph: [[0, 0, 0], [0, 0, 0]], vt: {} }));
  const allT = recs.reduce((a, r) => a + r.t, 0) / recs.length;
  const cpFix = [3, 7, 11], cpAvg = [1, 2, 3].map((k) => Math.max(0, Math.min(11, Math.round((allT * k / 3) / 5) - 1)));
  const lead = (r, k) => { if (r.hp.length > k) { const [l, rr] = r.hp[k]; return l > rr ? 1 : l < rr ? 0 : 0.5; } return y(r); }; // 左方在第 k 個記錄點是否領先
  let tie = 0, to = 0, leftW = 0;
  const M = {}; // 類型矩陣：M[列][欄] = [場數, 列方勝場, 模型預測的列方勝場]
  const T = state.types || {};
  for (const r of recs) {
    const yl = y(r), pl = sig(beta[r.a] - beta[r.b] + h); leftW += yl; if (r.res === 2) tie++; if (!r.ko) to++;
    for (const [me, op, w, left, pw] of [[r.a, r.b, yl, true, pl], [r.b, r.a, 1 - yl, false, 1 - pl]]) {
      const c = C[me]; c.n++; c.w += w; c.t += r.t; if (left) { c.nl++; c.wl += w; } if (r.res === 2) c.tie++; if (!r.ko) c.to++;
      for (let k = 0; k < 3; k++) { const lf = lead(r, cpFix[k]), la = lead(r, cpAvg[k]); c.ph[0][k] += left ? lf : 1 - lf; c.ph[1][k] += left ? la : 1 - la; }
      const ta = (T[ids[me]] || ["?"])[0], tb = (T[ids[op]] || ["?"])[0], m = ((M[ta] ||= {})[tb] ||= [0, 0, 0]); m[0]++; m[1] += w; m[2] += pw;
      const v = (c.vt[tb] ||= [0, 0, 0]); v[0]++; v[1] += w; v[2] += pw; // 角色對某類型：[場數, 勝場, 模型預測勝場]
    }
  }
  const chars = {};
  ids.forEach((id, i) => {
    const c = C[i]; if (!c.n) return;
    const se = 1 / Math.sqrt(H[i]), E = expW(beta[i]);
    chars[id] = { n: c.n, w: +(c.w / c.n).toFixed(4), wl: c.nl ? +(c.wl / c.nl).toFixed(4) : null, wr: c.n - c.nl ? +((c.w - c.wl) / (c.n - c.nl)).toFixed(4) : null,
      tie: c.tie, to: c.to, t: +(c.t / c.n).toFixed(1), bt: +beta[i].toFixed(4), e: +E.toFixed(4), lo: +expW(beta[i] - 1.96 * se).toFixed(4), hi: +expW(beta[i] + 1.96 * se).toFixed(4),
      ph: c.ph.map((a) => a.map((x) => +(x / c.n).toFixed(4))), type: T[id] || null,
      vt: Object.fromEntries(Object.entries(c.vt).map(([k, v]) => [k, [v[0], +v[1].toFixed(1), +v[2].toFixed(1)]])) };
  });
  const out = { v: state.v, since: state.since, date: state.updated, bouts: recs.length, chars: Object.keys(chars).length, pool: (state.seen || []).length, minN: MIN_N,
    global: { leftWin: +(leftW / recs.length).toFixed(4), h: +h.toFixed(4), leftAdv: +(sig(h) - 0.5).toFixed(4), tie: +(tie / recs.length).toFixed(4), timeout: +(to / recs.length).toFixed(4), avgT: +allT.toFixed(1), cpFix: cpFix.map((k) => (k + 1) * 5), cpAvg: cpAvg.map((k) => (k + 1) * 5) },
    matrix: M, chars: chars };
  fs.writeFileSync(ANALYSIS, JSON.stringify(out));
  return out;
}

// 原因推測：開網站讀換算後的數值
async function reasons(ids) {
  if (!ids.length) return {};
  const { chromium } = require("playwright");
  const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".gz": "application/gzip", ".css": "text/css" };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname); if (p.endsWith("/")) p += "index.html";
    const f = path.join(SITE, p); if (!f.startsWith(SITE)) { res.writeHead(403); return res.end(); }
    fs.readFile(f, (err, data) => { if (err) { res.writeHead(404); return res.end(); } res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" }); res.end(data); });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch(), pg = await browser.newPage();
  await pg.goto(`http://127.0.0.1:${server.address().port}/index.html?app=fight`);
  await pg.waitForFunction(() => window.__rk && window.__rk.fight().ready, null, { timeout: 180000 });
  const out = {};
  for (const id of ids) {
    try {
      const s = await pg.evaluate((x) => window.__rk.fightStatsOf(x), id), why = [];
      if (s.B) { if (s.B.ctl >= 2) why.push(`控制效果 ${s.B.ctl} 個`); if (s.B.off >= 1.3) why.push("攻擊倍率高"); if (s.B.off <= 0.7) why.push("攻擊倍率低"); if (s.B.dur >= 1.3) why.push("耐久倍率高"); if (s.B.dur <= 0.7) why.push("耐久倍率低"); }
      else why.push("手寫數值");
      const dmg0 = s.sk.filter(Boolean).filter((k) => k[1] === 0).length; if (dmg0) why.push(`${dmg0} 個技能沒有傷害`);
      out[id] = { form: `普攻 ${s.atk[0]}／技能 ${s.sk.map((k) => (k ? k[0] : "—")).join("、")}`, why: why.join("、") || "—" };
    } catch { out[id] = { form: "—", why: "讀取失敗" }; }
  }
  await browser.close(); server.close();
  return out;
}
const typeTxt = (t) => (t ? (ATK[t[0]] || t[0]) + (t[1] ? "＋控制" : "") + (t[2] ? "＋召喚" : "") : "—");
const pp = (x) => (x >= 0 ? "+" : "−") + Math.abs(x * 100).toFixed(0);
// 類型矩陣：實際勝率（括號＝殘差：實際 − 模型預測，百分點；正＝比整體強弱推算的更會打這一類＝剋制）
const matrixMd = (A) => { const ks = Object.keys(ATK).filter((k) => A.matrix[k]);
  return table(["列 對 欄", ...ks.map((k) => ATK[k])], ks.map((a) => [ATK[a], ...ks.map((b) => { const m = (A.matrix[a] || {})[b]; return m && m[0] ? `${pct(m[1] / m[0])}（${pp((m[1] - m[2]) / m[0])}）` : "—"; })])); };
const RES_N = 150, RES_D = 0.15;
const counters = (A) => Object.entries(A.chars).flatMap(([id, c]) => Object.entries(c.vt || {}).filter(([, v]) => v[0] >= RES_N).map(([k, v]) => ({ id, k, n: v[0], w: v[1] / v[0], p: v[2] / v[0], d: (v[1] - v[2]) / v[0] })))
  .filter((x) => Math.abs(x.d) >= RES_D).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));

if (MODE === "analyze") { const A = analyze(); console.log(A ? `分析：${A.bouts} 場、${A.chars} 隻` : "沒有原始紀錄"); }
else if (MODE === "weekly") {
  const A = analyze(); if (!A) { console.error("沒有原始紀錄"); process.exit(1); }
  const rows = Object.entries(A.chars).map(([id, c]) => ({ id, name: nm(id), ...c })), ok = rows.filter((r) => r.n >= MIN_N);
  const strong = ok.filter((r) => r.e > WIN_HI).sort((a, b) => b.e - a.e), weak = ok.filter((r) => r.e < WIN_LO).sort((a, b) => a.e - b.e);
  const TOP = 20, R = await reasons([...strong.slice(0, TOP), ...weak.slice(0, TOP)].map((r) => r.id)), prev = state.prev || {};
  const show = (list) => table(["角色", "預期勝率", "95% 區間", "原始勝率", "場數", "上週", "類型", "形式", "原因推測", "建議 ×"],
    list.slice(0, TOP).map((r) => [r.name, pct(r.e), `${pct(r.lo)}～${pct(r.hi)}`, pct(r.w), r.n, prev[r.id] != null ? pct(prev[r.id]) : "—", typeTxt(r.type), (R[r.id] || {}).form || "—", (R[r.id] || {}).why || "—", mult(r.e).toFixed(2)]));
  const sw = ok.map((r) => ({ ...r, d: r.ph[1][0] - r.ph[1][2] }));
  const early = sw.slice().sort((a, b) => b.d - a.d).slice(0, 5), late = sw.slice().sort((a, b) => a.d - b.d).slice(0, 5);
  const phRow = (r) => [r.name, ...r.ph[1].map(pct), ...r.ph[0].map(pct), r.n];
  const G = A.global;
  const md = [
    `## 格鬥場平衡週報（${state.week.start} ～ ${A.date}）`, "",
    `- 規則版本（同步檢查代碼）\`${A.v}\`，從 ${A.since} 開始累積：共 ${A.bouts.toLocaleString()} 場（這週 ${state.week.bouts.toLocaleString()} 場）`,
    `- 樣本 ≥ ${MIN_N} 場、列入排名的角色 ${ok.length}／${A.pool} 隻（其餘樣本不足，先不下結論）`,
    `- 左方勝率 ${pct(G.leftWin)}（模型估計左方優勢 ${(G.leftAdv * 100).toFixed(1)} 個百分點，排名已扣除）；平手 ${(G.tie * 100).toFixed(1)}%、打滿 60 秒沒人倒下 ${(G.timeout * 100).toFixed(1)}%；平均 ${G.avgT} 秒`,
    `- 標準：預期勝率 ${pct(WIN_LO)}～${pct(WIN_HI)}（Bradley-Terry 模型，已扣除對手強弱與左右；電腦 normal 互打，不會左右拖曳）`,
    `- 這週新角色：${state.week.newIds.length ? state.week.newIds.map((id) => `${nm(id)}（${A.chars[id] ? pct(A.chars[id].e) : "—"}）`).join("、") : "沒有"}`, "",
    `### 太強（${strong.length} 隻${strong.length > TOP ? `，列最強的 ${TOP} 隻` : ""}）`, "", strong.length ? show(strong) : "沒有", "",
    `### 太弱（${weak.length} 隻${weak.length > TOP ? `，列最弱的 ${TOP} 隻` : ""}）`, "", weak.length ? show(weak) : "沒有", "",
    "### 類型對類型（列方對欄方的實際勝率；括號＝剋制殘差：實際減模型預測，百分點）", "", matrixMd(A), "",
    `殘差接近 0＝勝率只是反映角色整體強弱；正得多＝列方類型真的剋欄方。`, "",
    `### 特化剋制點（角色對某一類型 ≥ ${RES_N} 場、實際比預測差 ≥ ${RES_D * 100} 個百分點，列前 15）`, "",
    (() => { const L = counters(A).slice(0, 15); return L.length ? table(["角色", "對手類型", "實際勝率", "模型預測", "差距", "場數"], L.map((x) => [nm(x.id), ATK[x.k] || x.k, pct(x.w), pct(x.p), pp(x.d), x.n])) : "沒有（或樣本還不夠）"; })(), "",
    `### 前中後期（領先率；平均時長版切點 ${G.cpAvg.join("／")} 秒、固定版 20／40／60 秒）`, "",
    "前期強、後期弱：", "", ok.length ? table(["角色", "前（平均版）", "中", "後", "前（固定版）", "中", "後", "場數"], early.map(phRow)) : "樣本不足", "",
    "前期弱、後期強：", "", ok.length ? table(["角色", "前（平均版）", "中", "後", "前（固定版）", "中", "後", "場數"], late.map(phRow)) : "樣本不足", "",
    "「建議 ×」＝攻擊與體力一起乘上的倍數（估計值）。要套用請跟開發者說「套用」，網站不會自己改數值。完整名單在 `data/balance/fight_suggest.json`，全部統計在 `data/balance/fight_analysis.json`。",
  ].join("\n");
  fs.writeFileSync(OUT, md);
  fs.writeFileSync(SUGGEST, JSON.stringify({ v: A.v, date: A.date, minN: MIN_N, items: [...strong, ...weak].map((r) => ({ id: r.id, name: r.name, n: r.n, e: r.e, lo: r.lo, hi: r.hi, m: +mult(r.e).toFixed(2) })) }, null, 1));
  state.prev = Object.fromEntries(ok.map((r) => [r.id, r.e]));
  state.week = { start: A.date, bouts: 0, newIds: [] };
  fs.writeFileSync(STATE, JSON.stringify(state));
  console.log(`週報：太強 ${strong.length}、太弱 ${weak.length}`);
} else if (MODE === "new") {
  const A = analyze(); const ids = args.filter((id) => A && A.chars[id]);
  if (!ids.length) { console.error("沒有測完的新角色"); process.exit(1); }
  const R = await reasons(ids);
  const rows = ids.map((id) => { const c = A.chars[id], out = c.e > WIN_HI || c.e < WIN_LO;
    return [nm(id), `\`${id}\``, pct(c.e), `${pct(c.lo)}～${pct(c.hi)}`, `${pct(c.w)}（±${pct(binCi(c.w, c.n))}）`, c.n, typeTxt(c.type), (R[id] || {}).form || "—", out ? (c.e > WIN_HI ? "⚠ 太強" : "⚠ 太弱") : "正常", out ? mult(c.e).toFixed(2) : "—"]; });
  const md = [`## 新角色平衡測試（${A.date}）`, "", `每隻跟 ${state.newDone && state.newDone[ids[0]] ? state.newDone[ids[0]].n : 1000} 個不同的隨機對手各打一場、左右隨機（電腦 normal 互打、一般對戰模式、60 秒）。規則版本 \`${A.v}\`。預期勝率已扣除對手強弱與左右（Bradley-Terry）。`, "",
    table(["角色", "id", "預期勝率", "95% 區間", "原始勝率", "場數", "類型", "形式", "判定", "建議 ×"], rows), "",
    "「建議 ×」＝攻擊與體力一起乘上的倍數（估計值）。要套用請跟開發者說「套用」。"].join("\n");
  fs.writeFileSync(OUT, md);
  console.log(`新角色報告：${ids.length} 隻`);
} else { console.error("用法見檔頭"); process.exit(1); }
