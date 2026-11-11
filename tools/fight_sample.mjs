// 格鬥場自動平衡抽樣（v7.4.1）：每天在 GitHub 上跑；每一場都保存原始紀錄（可用種子在網站重播），彙總在 data/balance/fight_samples.json。
// 用法：
//   抽樣：node tools/fight_sample.mjs sample <網站資料夾> --state data/balance/fight_samples.json --out delta.json [--minutes 50] [--shard 0/4] [--pages 2] [--new-per-day 8] [--opp 1000]
//   合併：node tools/fight_sample.mjs merge --state data/balance/fight_samples.json [--raw data/balance/raw] delta0.json delta1.json …
//         （寫原始紀錄 raw/<網站版本>/<日期>.json.gz、更新彙總；印出「新角色測完」的 id，一行一個，給工作流程寄通知）
// 規則：
// - 對手池＝網站的 __rk.fightPool()（可以上格鬥場、不是隱藏召喚物的角色）。
// - 每場只打一次，左右隨機（左方優勢由報告的模型當成整體參數估計，不用每組打兩場）。
// - 新角色（對手池裡、state.seen 沒有的）：跟 --opp 個「不同」的隨機對手各打一場；一天最多 --new-per-day 隻，其餘排隊。
//   第一次執行只記下全部角色，不當成新角色。其餘時間從對手池隨機配對。
// - 規則版本＝線上對戰同步檢查代碼；規則一變（例如調了數值），彙總作廢、重新累積；舊規則的原始紀錄刪除（git 歷史保留）。
// - v7.5.2：原始紀錄依網站版本分資料夾（raw/v7.5.2/…）；第一次合併時一次性去掉 v7.5.1 以前的重複紀錄（見 cleanRaw）。
// - 對戰只用網站本身的引擎（__rk.fightBout：一般對戰模式、normal AI 互打、60 秒、倒下就停）。
// 原始紀錄一筆：[左方在 pool 的序號, 右方序號, 種子, 結果(0 左勝／1 右勝／2 平手), 秒數×10, 有沒有人倒下(1/0), "每 5 秒雙方血量%：左,右;左,右;…"]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mulberry32, sampleSeed } from "./fight_rng.mjs";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
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
  // 亂數：每次執行、每個分片不同（v7.5.2：改用 32 位元的 mulberry32，起點＝當下秒數＋分片，同一天重跑也不會重複；見 fight_rng.mjs）
  const rnd = mulberry32(sampleSeed(Math.floor(Date.now() / 1000), SH));
  const pick = () => pool[Math.floor(rnd() * pool.length)];
  // 網站版本（頁尾版本號，例如 v7.5.2）：原始紀錄依版本分資料夾存（v7.5.2）
  const ver = await first.evaluate(() => (document.getElementById("appVer") || {}).textContent || "");
  const delta = { v, ver: /^v[\d.]+$/.test(ver.trim()) ? ver.trim() : "unknown", date: today(), pool, types, newN: OPP, errors: 0, recs: [], newIds: mine };
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
  const ruleChanged = state.v !== v, ver = deltas[0].ver || "unknown";
  if (ruleChanged) Object.assign(state, { v, since: date, chars: {}, newMet: {}, newDone: {}, week: { start: date, bouts: 0, newIds: [] }, cleaned: { date, removed: 0, note: "規則改版，重新累積" } });
  state.chars ||= {}; state.newMet ||= {}; state.newDone ||= {}; state.week ||= { start: date, bouts: 0, newIds: [] };
  const cleanedNow = !state.cleaned && cleanRaw(RAW, state, date); // v7.5.2：一次性整理 v7.5.1 以前的重複紀錄
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
  // v7.5.2：原始紀錄依網站版本分資料夾 raw/<版本>/<日期>.json.gz（檔案裡的 v 仍是規則版本；統計只用規則版本相同的檔）
  const dir = path.join(RAW, ver); fs.mkdirSync(dir, { recursive: true });
  const rawFile = path.join(dir, `${date}.json.gz`), old = fs.existsSync(rawFile) ? JSON.parse(zlib.gunzipSync(fs.readFileSync(rawFile))) : null;
  const allRecs = old ? [...old.recs.map((r) => [idx.get(old.pool[r[0]]), idx.get(old.pool[r[1]]), ...r.slice(2)]).filter((r) => r[0] != null && r[1] != null), ...recs] : recs;
  fs.writeFileSync(rawFile, zlib.gzipSync(JSON.stringify({ v, date, pool, recs: allRecs })));
  // v7.5.2 自我檢查：同一天出現「左、右、種子都一樣」的對戰＝亂數又出問題了（正常應該幾乎是 0）；印在錯誤輸出，GitHub 會標成警告
  const dupN = allRecs.length - new Set(allRecs.map((r) => r[0] + "," + r[1] + "," + r[2])).size;
  if (dupN > allRecs.length * 0.01) console.error(`::warning::格鬥場抽樣 ${date}：${allRecs.length} 場裡有 ${dupN} 場完全重複（左、右、種子都相同），請檢查抽樣亂數`);
  // 規則改版後，舊規則的原始紀錄不再使用：刪掉（git 歷史裡還找得到），避免 repo 一直變大；刪空的版本資料夾也一起刪
  if (ruleChanged) for (const f of rawFiles(RAW)) if (readRaw(f).v !== v) fs.rmSync(f, { force: true });
  for (const d of fs.readdirSync(RAW)) { const p = path.join(RAW, d); if (fs.statSync(p).isDirectory() && !fs.readdirSync(p).length) fs.rmdirSync(p); }
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
  // 整理過舊紀錄的那一次：馬上重算分析檔（fight_analysis.json），不用等週一（不需要瀏覽器；輸出到錯誤輸出，不影響新角色清單）
  if (cleanedNow) {
    const r = spawnSync(process.execPath, [path.join(HERE, "fight_report.mjs"), "analyze", path.resolve(path.dirname(STATE), "..", ".."), "--state", STATE, "--raw", RAW], { encoding: "utf8" });
    console.error((r.stdout || "") + (r.stderr || ""));
  }
}

// ---------- 原始紀錄的小工具（v7.5.2） ----------
// raw/ 底下每個資料夾的 *.json.gz（依日期排序；同日期依資料夾名）
function rawFiles(RAW) {
  if (!fs.existsSync(RAW)) return [];
  return fs.readdirSync(RAW).filter((d) => fs.statSync(path.join(RAW, d)).isDirectory())
    .flatMap((d) => fs.readdirSync(path.join(RAW, d)).filter((f) => f.endsWith(".json.gz")).map((f) => ({ d, f, p: path.join(RAW, d, f) })))
    .sort((a, b) => a.f.localeCompare(b.f) || a.d.localeCompare(b.d)).map((x) => x.p);
}
function readRaw(p) { return JSON.parse(zlib.gunzipSync(fs.readFileSync(p))); }
/* 一次性整理（v7.5.2）：v7.4.1～v7.5.1 的抽樣亂數會繞圈，同一批對戰每天被記錄上百次。
   - 所有原始紀錄「左、右、種子」相同的只留第一次出現的那筆（同種子重播結果完全相同，刪掉的是一模一樣的副本）
   - 舊的資料夾（以規則版本命名，例如 raw/C944-FFC8/）搬到 raw/v7.5.1/（那些紀錄都是 v7.5.1 產生的）
   - 統計從這次開始重新累積、只用 v7.5.2 以後的資料夾（state.minVer；使用者決定）：舊紀錄去重複後留在 raw/v7.5.1/ 保存，不列入統計
   - 記在 state.cleaned（只做一次） */
function cleanRaw(RAW, state, date) {
  const seen = new Set(); let removed = 0;
  for (const p of rawFiles(RAW)) {
    const d = readRaw(p), before = d.recs.length;
    d.recs = d.recs.filter((r) => { const k = d.pool[r[0]] + "|" + d.pool[r[1]] + "|" + r[2]; if (seen.has(k)) return false; seen.add(k); return true; });
    removed += before - d.recs.length;
    const dirName = path.basename(path.dirname(p)), to = /^v[\d.]+$/.test(dirName) ? p : path.join(RAW, "v7.5.1", path.basename(p));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (to !== p && fs.existsSync(to)) { const o = readRaw(to); const idx = new Map(o.pool.map((id, i) => [id, i])); o.recs.push(...d.recs.map((r) => [idx.get(d.pool[r[0]]), idx.get(d.pool[r[1]]), ...r.slice(2)]).filter((r) => r[0] != null && r[1] != null)); fs.writeFileSync(to, zlib.gzipSync(JSON.stringify(o))); }
    else fs.writeFileSync(to, zlib.gzipSync(JSON.stringify(d)));
    if (to !== p) fs.rmSync(p, { force: true });
  }
  Object.assign(state, { minVer: "v7.5.2", since: date, chars: {}, prev: {}, week: { start: date, bouts: 0, newIds: [] }, cleaned: { date, removed } });
  console.error(`整理舊原始紀錄：去掉 ${removed} 筆完全重複的紀錄，舊資料夾搬到 raw/v7.5.1/（保存，不列入統計）；統計從 v7.5.2 重新累積`);
  return true;
}
