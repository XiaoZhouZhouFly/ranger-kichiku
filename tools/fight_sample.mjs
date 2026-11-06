// 格鬥場自動平衡抽樣（v7.4.1）：每天在 GitHub 上跑；每一場都保存原始紀錄（可用種子在網站重播），彙總在 data/balance/fight_samples.json。
// 用法：
//   抽樣：node tools/fight_sample.mjs sample <網站資料夾> --state data/balance/fight_samples.json --out delta.json [--minutes 50] [--shard 0/4] [--pages 2] [--new-per-day 8] [--opp 1000]
//   合併：node tools/fight_sample.mjs merge --state data/balance/fight_samples.json [--raw data/balance/raw] delta0.json delta1.json …
//         （寫原始紀錄 raw/<規則版本>/<日期>.json.gz、更新彙總；印出「新角色測完」的 id，一行一個，給工作流程寄通知）
// 規則：
// - 對手池＝網站的 __rk.fightPool()（可以上格鬥場、不是隱藏召喚物的角色）。
// - 每場只打一次，左右隨機（左方優勢由報告的模型當成整體參數估計，不用每組打兩場）。
// - 新角色（對手池裡、state.seen 沒有的）：跟 --opp 個「不同」的隨機對手各打一場；一天最多 --new-per-day 隻，其餘排隊。
//   第一次執行只記下全部角色，不當成新角色。其餘時間從對手池隨機配對。
// - 規則版本＝線上對戰同步檢查代碼；規則一變（例如調了數值），彙總作廢、重新累積；舊版本的原始紀錄資料夾刪除（git 歷史保留）。
// - 對戰只用網站本身的引擎（__rk.fightBout：一般對戰模式、normal AI 互打、60 秒、倒下就停）。
// 原始紀錄一筆：[左方在 pool 的序號, 右方序號, 種子, 結果(0 左勝／1 右勝／2 平手), 秒數×10, 有沒有人倒下(1/0), "每 5 秒雙方血量%：左,右;左,右;…"]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : d; };
const MODE = args.shift();
const STATE = opt("--state", "data/balance/fight_samples.json");
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10); // 台灣日期

if (MODE === "merge") merge(); else if (MODE === "sample") await sample(); else { console.error("用法見檔頭"); process.exit(1); }

async function sample() {
  const MIN = +opt("--minutes", 50), [SH, SHN] = opt("--shard", "0/1").split("/").map(Number), PAGES = +opt("--pages", 2);
  const NEW_PER_DAY = +opt("--new-per-day", 8), OPP = +opt("--opp", 1000), OUT = opt("--out", "delta.json");
  const SITE = path.resolve(args[0] || "."), state = readJson(STATE, {});
  const { chromium } = require("playwright");
  const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".gz": "application/gzip", ".css": "text/css" };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname); if (p.endsWith("/")) p += "index.html";
    const f = path.join(SITE, p); if (!f.startsWith(SITE)) { res.writeHead(403); return res.end(); }
    fs.readFile(f, (err, data) => { if (err) { res.writeHead(404); return res.end(); } res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" }); res.end(data); });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/index.html?app=fight`;
  const browser = await chromium.launch();
  const ready = (pg) => pg.waitForFunction(() => window.__rk && window.__rk.fight().ready, null, { timeout: 180000 });
  const open = async () => { const pg = await browser.newPage(); await pg.goto(url); await ready(pg); return pg; };
  const first = await open();
  const v = (await first.evaluate(() => window.__rk.fightSync())).code;
  const pool = await first.evaluate(() => window.__rk.fightPool());
  const types = await first.evaluate((p) => window.__rk.fightTypes(p), pool);
  const idx = new Map(pool.map((id, i) => [id, i]));
  const seen = new Set(state.seen || []), init = !state.seen;
  const pending = [...new Set([...(state.v === v ? state.pending || [] : []), ...(init ? [] : pool.filter((id) => !seen.has(id)))])].filter((id) => idx.has(id));
  const mine = pending.slice(0, NEW_PER_DAY).filter((_, i) => i % SHN === SH);
  // 亂數：每個分片、每天不同
  let s = (Date.now() / 864e5 | 0) * 97 + SH * 7919 + 1;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = () => pool[Math.floor(rnd() * pool.length)];
  const delta = { v, date: today(), pool, types, newN: OPP, errors: 0, recs: [], newIds: mine };
  // 工作清單：先新角色（不重複的對手、左右隨機），再隨機配對到時間用完
  const jobs = [];
  for (const id of mine) {
    const met = new Set(state.v === v && state.newMet && state.newMet[id] ? state.newMet[id] : []); // 之前已經打過的對手（沒打完、隔天繼續）
    const opps = pool.filter((o) => o !== id && !met.has(o));
    for (let i = opps.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [opps[i], opps[j]] = [opps[j], opps[i]]; }
    for (const o of opps.slice(0, Math.max(0, OPP - met.size))) jobs.push(rnd() < 0.5 ? [id, o] : [o, id]);
  }
  const end = Date.now() + MIN * 60e3;
  const work = async (pg) => {
    // 分頁當掉（記憶體不足等）就換一個新分頁繼續；每 300 場重新載入一次，把圖片等記憶體整個放掉
    let done = 0;
    while (Date.now() < end) {
      const [c0, c1] = jobs.shift() || (() => { let a = pick(), b = pick(); while (b === a) b = pick(); return [a, b]; })();
      const seed = Math.floor(rnd() * 1e9);
      try {
        const r = await pg.evaluate(([x, y, sd]) => window.__rk.fightBout(x, y, sd), [c0, c1, seed]);
        delta.recs.push([idx.get(c0), idx.get(c1), seed, r.win === -1 ? 2 : r.win, Math.round(r.t * 10), r.ko ? 1 : 0, r.hp5.map((h) => h.join(",")).join(";")]);
      } catch (e) {
        delta.errors++; if (delta.errors < 20) console.error("對戰失敗", c0, c1, String(e).slice(0, 200));
        if (/crash|closed|Target/i.test(String(e))) { try { await pg.close(); } catch {} pg = await open(); continue; }
      }
      try {
        if (++done % 300 === 0) { await pg.reload(); await ready(pg); }
        else if (done % 50 === 0) await pg.evaluate(() => window.__rk.fightCacheClear());
      } catch { try { await pg.close(); } catch {} pg = await open(); }
      if (delta.recs.length % 500 === 0) fs.writeFileSync(OUT, JSON.stringify(delta)); // 中途也存，被中斷時至少有部分結果
    }
  };
  const pages = [first, ...(await Promise.all(Array.from({ length: PAGES - 1 }, open)))];
  await Promise.all(pages.map(work));
  await browser.close(); server.close();
  fs.writeFileSync(OUT, JSON.stringify(delta));
  console.log(`分片 ${SH}/${SHN}：規則 ${v}，${delta.recs.length} 場、失敗 ${delta.errors}，新角色 ${mine.join(",") || "無"}`);
}

function merge() {
  const RAW = opt("--raw", path.join(path.dirname(STATE), "raw"));
  const state = readJson(STATE, {}), deltas = args.map((f) => readJson(f, null)).filter(Boolean);
  if (!deltas.length) { console.error("沒有抽樣結果"); return; }
  const v = deltas[0].v, date = deltas[0].date;
  if (state.v !== v) Object.assign(state, { v, since: date, chars: {}, newMet: {}, newDone: {}, week: { start: date, bouts: 0, newIds: [] } });
  state.chars ||= {}; state.newMet ||= {}; state.newDone ||= {}; state.week ||= { start: date, bouts: 0, newIds: [] };
  // 原始紀錄：同一天的所有分片合成一個檔，用 pool 的 id 存（各分片的 pool 相同；保險起見逐筆換成 id 再換回同一份 pool）
  const pool = deltas[0].pool, idx = new Map(pool.map((id, i) => [id, i])), recs = [];
  const add = (id, w, t) => { const x = (state.chars[id] ||= [0, 0, 0]); x[0]++; x[1] += w; x[2] += t; };
  const newSet = new Set(deltas.flatMap((d) => d.newIds));
  for (const d of deltas) {
    if (d.v !== v) continue;
    for (const r of d.recs) {
      const a = d.pool[r[0]], b = d.pool[r[1]]; if (!idx.has(a) || !idx.has(b)) continue;
      recs.push([idx.get(a), idx.get(b), ...r.slice(2)]);
      const wa = r[3] === 2 ? 0.5 : r[3] === 0 ? 1 : 0, t = r[4] / 10;
      add(a, wa, t); add(b, 1 - wa, t);
      for (const [me, op] of [[a, b], [b, a]]) if (newSet.has(me)) (state.newMet[me] ||= []).push(op);
    }
  }
  const dir = path.join(RAW, v); fs.mkdirSync(dir, { recursive: true });
  const rawFile = path.join(dir, `${date}.json.gz`), old = fs.existsSync(rawFile) ? JSON.parse(zlib.gunzipSync(fs.readFileSync(rawFile))) : null;
  const allRecs = old ? [...old.recs.map((r) => [idx.get(old.pool[r[0]]), idx.get(old.pool[r[1]]), ...r.slice(2)]).filter((r) => r[0] != null && r[1] != null), ...recs] : recs;
  fs.writeFileSync(rawFile, zlib.gzipSync(JSON.stringify({ v, date, pool, recs: allRecs })));
  // 規則改版後，舊版本的原始紀錄不再使用：從資料夾刪掉（git 歷史裡還找得到），避免 repo 一直變大
  for (const d of fs.readdirSync(RAW)) if (d !== v) fs.rmSync(path.join(RAW, d), { recursive: true, force: true });
  state.types = Object.assign(state.types || {}, ...deltas.map((d) => d.types || {}));
  state.week.bouts += recs.length;
  // 新角色：打滿 newN 個不同對手就算完成
  const NEW_N = deltas[0].newN || 1000, finished = [], init = !state.seen;
  for (const id of newSet) {
    const met = [...new Set(state.newMet[id] || [])]; state.newMet[id] = met;
    if (met.length >= NEW_N) { finished.push(id); state.newDone[id] = { date, n: met.length }; delete state.newMet[id]; }
  }
  state.pending = [...new Set([...(state.pending || []), ...(init ? [] : pool.filter((id) => !(state.seen || []).includes(id)))])].filter((id) => !finished.includes(id) && idx.has(id));
  state.seen = pool.slice().sort();
  state.week.newIds = [...new Set([...state.week.newIds, ...finished])];
  state.updated = date;
  fs.writeFileSync(STATE, JSON.stringify(state));
  for (const id of finished) console.log(id);
}
