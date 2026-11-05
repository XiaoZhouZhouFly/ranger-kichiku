// 格鬥場數值平衡檢查：角色兩兩用 AI 對打（左右各打一次 × 數個亂數種子），統計勝率、對戰秒數、剩餘體力，標出太強／太弱的角色。
// 用法：node tools/fight_balance.mjs <網站資料夾（含 index.html 與 data/）> [輸出資料夾，預設 tools/out] [--seeds 5] [--ids a,b,c] [--focus 角色id（只打這隻對其他每一隻）]
// 預設角色＝格鬥場測試名單（FIGHT_ROSTER）。產出：fight_balance.md、fight_balance.json
// 需要 playwright。對戰邏輯只寫在網站裡（__rk.fightBout），這支程式只負責排對戰、統計、存檔。
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : d; };
const SEEDS = +opt("--seeds", 5), IDS = opt("--ids", ""), FOCUS = opt("--focus", "");
const SITE = path.resolve(args[0] || "."), OUT = path.resolve(args[1] || path.join(HERE, "out"));
fs.mkdirSync(OUT, { recursive: true });
// 判斷標準：勝率超出這個範圍＝太強／太弱；平均對戰秒數太短／太長也列出
const WIN_HI = 0.65, WIN_LO = 0.35, T_LO = 12, T_HI = 45;

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".gz": "application/gzip", ".css": "text/css" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  const f = path.join(SITE, p);
  if (!f.startsWith(SITE)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" });
    res.end(data);
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${server.address().port}/index.html?app=fight`);
await page.waitForFunction(() => window.__rk && window.__rk.fight().ready, null, { timeout: 120000 });

const roster = await page.evaluate(() => window.__rk.fightRoster());
const ids = IDS ? IDS.split(",") : roster.map((x) => x.id);
if (FOCUS && !ids.includes(FOCUS)) ids.push(FOCUS);
const names = Object.fromEntries(roster.map((x) => [x.id, x.name]));
const stats = {};
for (const id of ids) stats[id] = await page.evaluate((x) => window.__rk.fightStatsOf(x), id);

const P = Object.fromEntries(ids.map((id) => [id, { n: 0, w: 0, t: 0, left: 0, vs: {} }]));
let done = 0; const total = FOCUS ? ids.length - 1 : (ids.length * (ids.length - 1)) / 2;
for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
  const a = ids[i], b = ids[j]; let wa = 0, n = 0;
  if (FOCUS && a !== FOCUS && b !== FOCUS) continue;
  for (let seed = 1; seed <= SEEDS; seed++) for (const swap of [false, true]) {
    const [c0, c1] = swap ? [b, a] : [a, b];
    const r = await page.evaluate(([x, y, s]) => window.__rk.fightBout(x, y, s), [c0, c1, seed]);
    const aSide = swap ? 1 : 0, aw = r.win === -1 ? 0.5 : r.win === aSide ? 1 : 0;
    wa += aw; n++;
    for (const [id, side, w] of [[a, aSide, aw], [b, 1 - aSide, 1 - aw]]) { const x = P[id]; x.n++; x.w += w; x.t += r.t; x.left += r.left[side]; }
  }
  P[a].vs[b] = wa / n; P[b].vs[a] = 1 - wa / n;
  if (++done % 25 === 0) console.log(`${done}／${total}`);
}
await browser.close(); server.close();

const rows = ids.map((id) => { const x = P[id]; return { id, name: names[id] || id, win: x.w / x.n, t: x.t / x.n, left: x.left / x.n, stats: stats[id], vs: x.vs }; }).sort((a, b) => b.win - a.win);
fs.writeFileSync(path.join(OUT, "fight_balance.json"), JSON.stringify({ seeds: SEEDS, rows }, null, 0));
const f2 = (x) => (x * 100).toFixed(0) + "%";
const flag = (r) => [r.win > WIN_HI ? "⚠ 太強" : r.win < WIN_LO ? "⚠ 太弱" : "", r.t < T_LO ? "打太快" : r.t > T_HI ? "打太久" : ""].filter(Boolean).join("、");
const sk = (s) => s.sk.map((k, i) => (k ? `${k[0]} ${k[1]}` : "—")).join("／");
const table = (head, body) => [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...body.map((r) => `| ${r.join(" | ")} |`)].join("\n");
const worst = rows.flatMap((r) => Object.entries(r.vs).filter(([, v]) => v >= 0.9).map(([o, v]) => [r.name, names[o] || o, f2(v)]));
const md = [
  `# 格鬥場數值平衡檢查`, ``,
  `產生時間：${new Date().toISOString().slice(0, 16).replace("T", " ")}（UTC）。${ids.length} 隻角色兩兩對打，左右各一次 × ${SEEDS} 個種子，AI 難度 normal，一場 60 秒。`,
  `標準：勝率 ${f2(WIN_LO)}～${f2(WIN_HI)}、平均 ${T_LO}～${T_HI} 秒。`, ``,
  table(["角色", "勝率", "平均秒數", "剩餘體力", "體力／減傷", "普攻", "技能 1／2", "攻／守倍率", "標記"],
    rows.map((r) => [r.name, f2(r.win), r.t.toFixed(1), f2(r.left), `${r.stats.hp}／${Math.round(r.stats.dr * 100)}%`, `${r.stats.atk[0]} ${r.stats.atk[1]}`, sk(r.stats), (r.stats.B ? `${r.stats.B.off}／${r.stats.B.dur}` : "手寫"), flag(r)])), ``,
  `## 一面倒的組合（勝率 ≥ 90%）`, worst.length ? table(["勝方", "敗方", "勝率"], worst) : "沒有", ``,
].join("\n");
fs.writeFileSync(path.join(OUT, "fight_balance.md"), md);
const flagged = rows.filter((r) => flag(r));
if (FOCUS) { const x = P[FOCUS]; console.log(`${FOCUS} 勝率 ${f2(x.w / x.n)}、平均 ${(x.t / x.n).toFixed(1)} 秒；最難打：${Object.entries(x.vs).sort((a, b) => a[1] - b[1]).slice(0, 5).map(([o, v]) => o + " " + f2(v)).join("、")}`); }
console.log(`完成：${ids.length} 隻，標記 ${flagged.length} 隻。報告：${path.join(OUT, "fight_balance.md")}`);
