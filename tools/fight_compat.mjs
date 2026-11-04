// 格鬥場相容性報告：把全部角色跑一次網站裡的標準化（js-18-fight-norm.js 的 normAll），寫成報告。
// 用法：node tools/fight_compat.mjs <網站資料夾（含 index.html 與 data/）> [輸出資料夾，預設 tools/out]
// 產出：fight_compat.md（統計與問題清單）、fight_compat.json（每隻角色一列）
// 需要 playwright（跟 tests/healthcheck.mjs 一樣）。判斷邏輯只寫在網站裡，這支程式只負責開網頁、存檔。
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(process.argv[2] || ".");
const OUT = path.resolve(process.argv[3] || path.join(HERE, "out"));
fs.mkdirSync(OUT, { recursive: true });

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
const BASE = `http://127.0.0.1:${server.address().port}/index.html`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(BASE + "?app=fight");
await page.waitForFunction(() => window.__rk && window.__rk.fight().ready, null, { timeout: 120000 });
const { rows, summary: S } = await page.evaluate(() => window.__rk.fightCompat());
await browser.close(); server.close();

fs.writeFileSync(path.join(OUT, "fight_compat.json"), JSON.stringify({ summary: S, rows }, null, 0));

// ---------- 報告 ----------
const FORM = { melee: "近戰", dline: "瞬間直線", line: "直線投射物", lob: "拋物線", target: "指定位置打擊", self: "自身", buff: "輔助（暫時用加攻＋回血代替）" };
const SUP = { ok: "已支援", part: "部分支援", r2: "第二輪", b2: "第二批", none: "未規劃" };
const pct = (n, d) => `${n}（${((n / Math.max(1, d)) * 100).toFixed(1)}%）`;
const table = (head, body) => [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...body.map((r) => `| ${r.join(" | ")} |`)].join("\n");
const fit = rows.filter((x) => x.fit);
// 問題種類統計：同一種訊息（去掉角色特定的效果名稱）合併計數
const issueKinds = {};
for (const x of fit) for (const [lvl, where, msg] of x.issues) {
  const key = `${lvl}｜${where.replace(/\d/, "N")}｜${msg.startsWith("效果：") ? "有已支援的效果" : msg.endsWith(" 未支援") ? "有效果未支援" : msg}`;
  issueKinds[key] = (issueKinds[key] || 0) + 1;
}
const LV = { unsupported: "⚠ 未支援", guess: "？ 推測", info: "ⓘ 補充" };
const md = [
  `# 格鬥場相容性報告`,
  ``,
  `產生時間：${new Date().toISOString().slice(0, 16).replace("T", " ")}（UTC）。判斷規則：\`src/js-18-fight-norm.js\`。`,
  ``,
  `## 總覽`,
  table(["項目", "數量"], [
    ["全部單位（角色清單）", S.total],
    ["適合格鬥場", pct(S.fit, S.total)],
    ["　└ 完全沒有問題（只有補充說明）", pct(S.clean, S.fit)],
    ["　└ 有未支援的功能（有明確代替方式）", pct(S.withUnsupported, S.fit)],
    ["　└ 有推測的欄位", pct(S.withGuess, S.fit)],
  ]),
  ``,
  `### 不適合格鬥場的原因`,
  table(["原因", "數量"], Object.entries(S.unfitWhy).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v])),
  ``,
  `## 攻擊形式（只算適合的角色）`,
  table(["普攻形式", "數量"], Object.entries(S.atkForms).sort((a, b) => b[1] - a[1]).map(([k, v]) => [FORM[k] || k, pct(v, S.fit)])),
  ``,
  table(["技能形式", "數量"], Object.entries(S.skForms).sort((a, b) => b[1] - a[1]).map(([k, v]) => [FORM[k] || k, v])),
  ``,
  table(["技能數", "角色數"], Object.entries(S.skillCount).sort().map(([k, v]) => [k, pct(v, S.fit)])),
  ``,
  `## 技能效果（只算適合的角色，一個技能出現一次算一次）`,
  table(["代碼", "名稱", "次數", "狀態"], Object.entries(S.fx).map(([c, x]) => [c, x.label, x.n, SUP[x.sup] || x.sup])),
  ``,
  `## 問題種類（每個技能各算一次）`,
  table(["等級", "位置", "內容", "次數"], Object.entries(issueKinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => { const [l, w, m] = k.split("｜"); return [LV[l] || l, w.replace("N", "N"), m, n]; })),
  ``,
].join("\n");
fs.writeFileSync(path.join(OUT, "fight_compat.md"), md);
console.log(`全部 ${S.total}、適合 ${S.fit}、完全沒問題 ${S.clean}、有未支援 ${S.withUnsupported}、有推測 ${S.withGuess}`);
console.log(`報告：${path.join(OUT, "fight_compat.md")}`);
