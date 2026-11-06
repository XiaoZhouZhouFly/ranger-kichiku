// Ranger 惡搞工坊：自動健檢
// 用法：node tests/healthcheck.mjs [網站資料夾，預設 .] [--update-baseline]
// 需要 playwright（npm i playwright，並執行 npx playwright install chromium）
// 結果：主控台表格；在 GitHub Actions 上另外寫進執行摘要；失敗的項目存截圖到 tests/out/。
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const SITE = path.resolve(args.find((a) => !a.startsWith("--")) || ".");
const UPDATE = args.includes("--update-baseline");
const OUT = path.join(HERE, "out");
const BASELINE = path.join(HERE, "baseline.json");
fs.mkdirSync(OUT, { recursive: true });

// ---------- 小型靜態伺服器 ----------
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".gz": "application/gzip", ".webmanifest": "application/manifest+json", ".css": "text/css", ".gif": "image/gif" };
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

// ---------- MP4 檢查（不需要 ffmpeg） ----------
function mp4Info(buf) {
  const b = new Uint8Array(buf), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const kids = (s, e) => { const out = []; for (let o = s; o + 8 <= e;) { let size = dv.getUint32(o), hdr = 8; if (size === 1) { size = Number(dv.getBigUint64(o + 8)); hdr = 16; } if (size === 0) size = e - o; if (size < 8 || o + size > e) break; out.push({ t: String.fromCharCode(...b.subarray(o + 4, o + 8)), o, end: o + size, body: o + hdr }); o += size; } return out; };
  const top = kids(0, b.length);
  const info = { top: top.map((x) => x.t), tracks: [] };
  const moov = top.find((x) => x.t === "moov"); if (!moov) return info;
  const find = (list, t) => list.find((x) => x.t === t);
  for (const trak of kids(moov.body, moov.end).filter((x) => x.t === "trak")) {
    const mdia = find(kids(trak.body, trak.end), "mdia"); if (!mdia) continue;
    const md = kids(mdia.body, mdia.end), mdhd = find(md, "mdhd"), hdlr = find(md, "hdlr"), minf = find(md, "minf");
    const ver = b[mdhd.body], ts = ver === 1 ? dv.getUint32(mdhd.body + 20) : dv.getUint32(mdhd.body + 12), dur = ver === 1 ? Number(dv.getBigUint64(mdhd.body + 24)) : dv.getUint32(mdhd.body + 16);
    const stbl = minf && find(kids(minf.body, minf.end), "stbl"), stsz = stbl && find(kids(stbl.body, stbl.end), "stsz");
    const stsd = stbl && find(kids(stbl.body, stbl.end), "stsd");
    info.tracks.push({ kind: String.fromCharCode(...b.subarray(hdlr.body + 8, hdlr.body + 12)), codec: stsd ? String.fromCharCode(...b.subarray(stsd.body + 12, stsd.body + 16)) : "", samples: stsz ? dv.getUint32(stsz.body + 8) : 0, seconds: ts ? dur / ts : 0 });
  }
  return info;
}
function wav(seconds = 0.3, freq = 880) {
  const sr = 22050, n = Math.round(sr * seconds), b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(8000 * Math.sin(2 * Math.PI * freq * i / sr)), 44 + i * 2);
  const f = path.join(OUT, "beep.wav"); fs.writeFileSync(f, b); return f;
}

// ---------- 測試框架 ----------
const results = [];
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}); // CHROME_PATH：選用，指定瀏覽器位置
async function newPage({ width = 1280, height = 900, opus = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, acceptDownloads: true });
  await ctx.addInitScript((o) => { try { if (o) localStorage.setItem("rk_encTest", "opus"); else localStorage.removeItem("rk_encTest"); } catch {} }, opus);
  const page = await ctx.newPage();
  page.errors = []; page.on("pageerror", (e) => page.errors.push(String(e)));
  return page;
}
const waitSingle = (page) => page.waitForFunction(() => window.__rk && window.__rk.single().ready, null, { timeout: 60000 });
const waitDuel = (page) => page.waitForFunction(() => window.__rk && window.__rk.duel().ready && window.__rk.duel().len > 1, null, { timeout: 90000 });
const nonBlank = (page, id) => page.evaluate((id) => { const c = document.getElementById(id), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4 * 97) if (d[i] < 235 || d[i + 1] < 235 || d[i + 2] < 235) n++; return n; }, id);
function check(cond, msg) { if (!cond) throw new Error(msg); }
// 不能逐格輸出時，說明是哪一個編碼器不支援
const codecWhy = (page) => page.evaluate(async () => {
  if (!window.VideoEncoder || !window.AudioEncoder) return "瀏覽器沒有 WebCodecs";
  const v = await VideoEncoder.isConfigSupported({ codec: "avc1.42E01F", width: 720, height: 720, bitrate: 6e6, framerate: 30 }).then((r) => r.supported, () => false);
  const a = await AudioEncoder.isConfigSupported({ codec: "opus", sampleRate: 48000, numberOfChannels: 2, bitrate: 160000 }).then((r) => r.supported, () => false);
  return `H.264 影片編碼${v ? "可用" : "不支援"}、Opus 聲音編碼${a ? "可用" : "不支援"}（${navigator.userAgent.match(/Chrome\/[\d.]+/) || ""}）`;
});
async function test(name, fn) {
  const t0 = Date.now(); let page = null;
  const track = async (opts) => (page = await newPage(opts));
  try {
    const r = await fn(track);
    if (page && page.errors.length) throw new Error("頁面錯誤：" + page.errors.slice(0, 2).join(" | "));
    const skip = typeof r === "string" && r.startsWith("skip");
    results.push({ name, ok: skip ? "skip" : true, note: skip ? "略過：" + (r.slice(5) || "這個環境不支援") : typeof r === "string" ? r : "", ms: Date.now() - t0 });
  } catch (e) {
    let shot = "";
    if (page) { try { shot = path.join(OUT, name.replace(/[^\w一-鿿]+/g, "_") + ".png"); await page.screenshot({ path: shot, fullPage: false }); } catch {} }
    results.push({ name, ok: false, note: String(e.message || e).slice(0, 300) + (shot ? `（截圖：${path.relative(process.cwd(), shot)}）` : ""), ms: Date.now() - t0 });
  }
  if (page) await page.context().close();
  const last = results[results.length - 1];
  console.log(`${last.ok === true ? "✅" : last.ok === "skip" ? "⏭️" : "❌"} ${name}${last.note ? "：" + last.note : ""}`);
}
const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, "utf8")) : { duel: {} };
const newBaseline = { duel: {} };

// ---------- 測試項目 ----------
await test("首頁載入與角色資料", async (open) => {
  const p = await open(); await p.goto(BASE); await waitSingle(p);
  const ix = await p.evaluate(() => window.__rk.index());
  check(ix.total > 2, `角色數量太少：${ix.total}`);
  check(ix.custom.includes("x001-cube") && ix.custom.includes("x002-orb"), "找不到自製角色");
  const ver = await p.textContent("#appVer");
  check(/^v\d/.test(ver), "頁尾沒有版本號");
  check(await nonBlank(p, "cv") > 0, "單人畫面是空白的");
  return `共 ${ix.total} 隻角色，${ver}`;
});

await test("單人：自製角色六個動作", async (open) => {
  const p = await open(); await p.goto(BASE + "?app=single&u=x001-cube&clip=idle"); await waitSingle(p);
  const n = await p.locator("#clips .chip").count();
  check(n >= 6, `動作只有 ${n} 個`);
  for (const anim of ["walk", "attack", "s_attack", "s2_attack", "knockback"]) {
    await p.evaluate((a) => document.querySelector(`#clips .chip[data-anim="${a}"]`).click(), anim);
    await p.waitForTimeout(150);
    check(await nonBlank(p, "cv") > 0, `${anim} 畫面是空白的`);
  }
});

await test("單人：惡搞與上一步／下一步", async (open) => {
  const p = await open(); await p.goto(BASE + "?app=single&u=x002-orb&clip=skill1"); await waitSingle(p);
  const s0 = await p.evaluate(() => window.__rk.single());
  await p.evaluate(() => document.querySelector("[data-preset=spam]").click()); await p.waitForTimeout(600);
  const s1 = await p.evaluate(() => window.__rk.single());
  check(s1.mode === "remix" && s1.histAt === s0.histAt + 1, `套預設後狀態不對：${JSON.stringify(s1)}`);
  await p.click("#undoBtn"); await p.waitForTimeout(200);
  const s2 = await p.evaluate(() => window.__rk.single());
  check(s2.segs === s0.segs && s2.histAt === s0.histAt, "上一步沒有還原");
  await p.click("#redoBtn"); await p.waitForTimeout(200);
  check((await p.evaluate(() => window.__rk.single())).segs === s1.segs, "下一步沒有重做");
});

await test("分享連結還原（單人惡搞）", async (open) => {
  const p = await open(); await p.goto(BASE + "?app=single&u=x001-cube&clip=skill1"); await waitSingle(p);
  await p.evaluate(() => document.querySelector("[data-preset=spam]").click()); await p.waitForTimeout(800);
  const a = await p.evaluate(() => window.__rk.single());
  const url = await p.evaluate(() => location.href);
  const p2 = await p.context().newPage(); await p2.goto(url); await p2.waitForFunction(() => window.__rk && window.__rk.single().ready, null, { timeout: 60000 }); await p2.waitForTimeout(500);
  const b = await p2.evaluate(() => window.__rk.single());
  check(a.unit === b.unit && a.mode === b.mode && a.timeline === b.timeline, `還原不一致：${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
});

await test("專案檔下載與開啟（雙人→從單人開啟）", async (open) => {
  const p = await open(); await p.goto(BASE + "?app=duel&type=raw&l=x001-cube&r=x002-orb&s=9"); await waitDuel(p);
  const a = await p.evaluate(() => window.__rk.duel());
  await p.locator(".duel-transport .share-btn").click(); await p.waitForTimeout(800);
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#shareFile")]);
  const f = path.join(OUT, "project.json"); await dl.saveAs(f); await p.keyboard.press("Escape");
  await p.goto(BASE + "?app=single&u=x002-orb"); await waitSingle(p);
  await p.locator(".transport .import-btn").first().click();
  await Promise.all([p.waitForNavigation({ timeout: 60000 }), p.setInputFiles("#importFile", f)]);
  await p.waitForFunction(() => window.__rk && window.__rk.duel().ready && window.__rk.duel().len > 1, null, { timeout: 90000 });
  const b = await p.evaluate(() => window.__rk.duel());
  check(a.a === b.a && a.b === b.b && a.kind === b.kind && a.len === b.len, `還原不一致：${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
});

// 對戰結果：只用自製角色比對（官方資料每天同步，數值可能變動，不適合當標準答案）
const DUELS = [
  { label: "經典對戰", q: "type=classic&l=x001-cube&r=x002-orb&s=1" },
  { label: "真距離對戰", q: "type=real&l=x001-cube&r=x002-orb&s=2" },
  { label: "原始數值（防禦公式）", q: "type=raw&l=x001-cube&r=x002-orb&s=3" },
  { label: "原始數值（血量 3 倍）", q: "type=raw&l=x002-orb&r=x001-cube&s=4&hp=3" },
  // 左方金手指：閃避 200%、技能抗性 150%（檢查 95% 上限：仍有 5% 普攻命中、技能傷害剩 5%）
  // 真距離：左方移動速度 300、右方 40
  { label: "真距離對戰（移動速度）", q: "l=x001-cube&r=x002-orb&type=real&m=trade&s=6&d=zq1bKLVayijY2MNAxMYitBQA" },
  { label: "原始數值（95% 上限）", q: "l=x001-cube&r=x002-orb&type=raw&m=trade&s=5&d=zq1ZKzlCyiq5WSklXsjIyMNBRKi5SsjI0NajVqa6NrQUA" },
];
for (const { label, q } of DUELS) {
  await test(`對戰結果：${label}`, async (open) => {
    const p = await open(); await p.goto(BASE + "?app=duel&" + q); await waitDuel(p);
    const d = await p.evaluate(() => window.__rk.duel());
    const got = { len: d.len, result: d.result, winner: d.winner, dealt: d.dealt };
    newBaseline.duel[q] = got;
    check(await nonBlank(p, "dcv") > 0, "對戰畫面是空白的");
    const want = baseline.duel[q];
    if (UPDATE || !want) return `已記錄標準結果：${JSON.stringify(got)}`;
    check(JSON.stringify(want) === JSON.stringify(got), `結果跟標準不同：應為 ${JSON.stringify(want)}，實際 ${JSON.stringify(got)}`);
  });
}

await test("真距離：移動速度設定", async (open) => {
  const p = await open(); await p.goto(BASE + "?app=duel&type=real&l=x001-cube&r=x002-orb&s=6"); await waitDuel(p);
  const d0 = await p.evaluate(() => window.__rk.duel());
  check(await p.locator("#rMove0").isVisible(), "看不到移動速度欄位");
  const def0 = await p.inputValue("#rMove0");
  await p.fill("#rMove0", "300"); await p.locator("#rMove0").dispatchEvent("change"); await p.waitForTimeout(500);
  const d1 = await p.evaluate(() => window.__rk.duel());
  check(d1.len !== d0.len || JSON.stringify(d1.dealt) !== JSON.stringify(d0.dealt), "改了移動速度，對戰結果卻沒變");
  await p.waitForTimeout(400);
  const url = await p.evaluate(() => location.href);
  check(url.includes("d="), "網址沒有記下移動速度");
  const p2 = await p.context().newPage(); await p2.goto(url);
  await p2.waitForFunction(() => window.__rk && window.__rk.duel().ready && window.__rk.duel().len > 1, null, { timeout: 90000 });
  const d2 = await p2.evaluate(() => window.__rk.duel());
  check(d2.len === d1.len && (await p2.inputValue("#rMove0")) === "300", `分享連結沒有還原移動速度：${JSON.stringify(d2)}`);
  await p2.click("#rRangeReset"); await p2.waitForTimeout(400);
  check((await p2.inputValue("#rMove0")) === def0 && (await p2.evaluate(() => window.__rk.duel())).len === d0.len, "恢復預設沒有還原移動速度");
  return `預設 ${def0} → 300：${(d0.len / 30).toFixed(1)} 秒 → ${(d1.len / 30).toFixed(1)} 秒`;
});

// 召喚：用官方角色（資料每天同步）。資料裡還沒有新版召喚格式時略過，不擋發布
const findSummonDuel = async (p, q, want) => {
  for (let s = 1; s <= 12; s++) {
    await p.goto(BASE + `?app=duel&type=raw&${q}&s=${s}&hp=3`); await waitDuel(p);
    const d = await p.evaluate(() => window.__rk.duel());
    if (want(d)) return { s, d };
  }
  return null;
};
await test("召喚：一次 2 隻（亡者歸來）", async (open) => {
  const p = await open(); await p.goto(BASE + "?app=single&u=x001-cube"); await waitSingle(p);
  await p.click("#appDuel"); await waitDuel(p);
  const sk = await p.evaluate(() => window.__rk.skill("u1241h-brown", 1));
  if (!sk || sk.sums.length < 2) return "skip:資料裡還沒有一次多隻的召喚（新版 sync.py 尚未同步）";
  check(sk.sums.every((x) => x === "u1241sk-brown"), `召喚物不是法老王的棺木：${sk.sums}`);
  const r = await findSummonDuel(p, "l=u1241h-brown&r=u010u-clara", (d) => d.summons.length >= 2);
  check(r, "12 場對戰裡都沒有召喚出 2 個棺木");
  const two = r.d.summons.filter((x) => x.side === 0);
  check(two.length >= 2 && two[0].k0 === two[1].k0, `應同時出現 2 個：${JSON.stringify(two)}`);
  return `種子 ${r.s}：同時召喚 ${two.length} 個棺木`;
});
await test("召喚：對手複製體與上限", async (open) => {
  const p = await open(); await p.goto(BASE + "?app=single&u=x001-cube"); await waitSingle(p);
  await p.click("#appDuel"); await waitDuel(p);
  const sk = await p.evaluate(() => window.__rk.skill("u1074u-cony", 1));
  if (!sk || !sk.cpy) return "skip:資料裡還沒有複製體（新版 sync.py 尚未同步）";
  const r = await findSummonDuel(p, "l=u1074u-cony&r=u1009e-sally", (d) => d.summons.some((x) => x.side === 0 && x.id.startsWith("copy:")));
  check(r, "12 場對戰裡都沒有出現對手的複製體");
  check(r.d.summons.find((x) => x.id.startsWith("copy:")).id === "copy:u1009e-sally", "複製體不是對手");
  await p.fill("#dSumCap", "1"); await p.locator("#dSumCap").dispatchEvent("change"); await p.waitForTimeout(400);
  const d1 = await p.evaluate(() => window.__rk.duel());
  for (const side of [0, 1]) {
    const list = d1.summons.filter((x) => x.side === side);
    for (const a of list) for (const b of list) if (a !== b) check(!(a.k0 < b.k1 && b.k0 < a.k1), `上限 1 時，同一邊同時出現 2 隻：${JSON.stringify([a, b])}`);
  }
  check(d1.sumCap === 1, "上限沒有生效");
  return `種子 ${r.s}：出現複製體；上限 1 時每邊同時最多 1 隻`;
});

await test("召喚物會被打倒（多打多規則）", async (open) => {
  const p = await open(); await p.goto(BASE + "?app=single&u=x001-cube"); await waitSingle(p);
  await p.click("#appDuel"); await waitDuel(p);
  const sk = await p.evaluate(() => window.__rk.skill("u1241h-brown", 1));
  if (!sk || sk.sums.length < 2) return "skip:資料裡還沒有新版召喚格式（新版 sync.py 尚未同步）";
  let hit = null, behind = 0;
  for (let s = 1; s <= 15 && !(hit && behind); s++) {
    await p.goto(BASE + `?app=duel&type=real&l=u1241h-brown&r=u010u-clara&s=${s}&hp=3`); await waitDuel(p);
    const d = await p.evaluate(() => window.__rk.duel());
    if (d.sumKilled > 0 && !hit) hit = { s, d };
    behind += d.mainHitWithSum || 0;
  }
  check(hit, "15 場真距離對戰裡，召喚物都沒有被打倒");
  // 召喚物擋在前面時，本人還是要吃得到技能（v4.12 修正：技能只打到召喚物）
  check(behind > 0, "召喚物在場時，本人完全沒被打中（技能範圍沒有波及召喚物後面的本人）");
  // 血量比例調高後，同一場召喚物不該再被打倒；設定要寫進網址
  await p.fill("#dSumHp", "1000"); await p.locator("#dSumHp").dispatchEvent("change");
  await p.fill("#dSumAtk", "20"); await p.locator("#dSumAtk").dispatchEvent("change"); await p.waitForTimeout(500);
  const d2 = await p.evaluate(() => window.__rk.duel());
  check(d2.sumKilled < hit.d.sumKilled, `血量比例 1000% 時召喚物還是一樣容易被打倒：${hit.d.sumKilled} → ${d2.sumKilled}`);
  const url = await p.evaluate(() => location.href);
  const p2 = await p.context().newPage(); await p2.goto(url);
  await p2.waitForFunction(() => window.__rk && window.__rk.duel().ready && window.__rk.duel().len > 1, null, { timeout: 90000 });
  const d3 = await p2.evaluate(() => window.__rk.duel());
  check(d3.sumHp === 1000 && d3.sumAtk === 20 && d3.len === d2.len, `分享連結沒有還原比例設定：${JSON.stringify({ sumHp: d3.sumHp, sumAtk: d3.sumAtk })}`);
  return `種子 ${hit.s}：召喚物被打 ${hit.d.sumHit} 下、被打倒 ${hit.d.sumKilled} 隻；召喚物在場時本人被打中 ${behind} 下；血量 1000% 時被打倒 ${d2.sumKilled} 隻`;
});

await test("重新對戰與全部恢復預設（三種類型）", async (open) => {
  const p = await open();
  const get = () => p.evaluate(() => { const d = window.__rk.duel(); return { kind: d.kind, mode: d.mode, seed: d.seed, moves: d.moves, len: d.len, dealt: d.dealt.join(",") }; });
  const out = [];
  for (const [kind, mode] of [["classic", "trade"], ["classic", "random"], ["real", "custom"], ["real", "random"], ["raw", "trade"]]) {
    await p.goto(BASE + `?app=duel&type=${kind}&l=x001-cube&r=x002-orb&s=5`); await waitDuel(p);
    if (kind !== "raw") { await p.click({ trade: "#dPresetTrade", random: "#dPresetRandom", custom: "#dPresetCustom" }[mode]); await p.waitForTimeout(300); }
    check(await p.isVisible("#rRerun") && await p.isVisible("#rResetAll"), `${kind}：對戰類型下面看不到重新對戰／全部恢復預設`);
    const a = await get(), seen = new Set([a.len + "|" + a.dealt]);
    for (let n = 0; n < 4; n++) {
      await p.click("#rRerun"); await p.waitForTimeout(300);
      const b = await get(); seen.add(b.len + "|" + b.dealt);
      check(b.kind === a.kind && b.mode === a.mode, `${kind}／${mode}：重新對戰改到了對戰類型或招式編排類型`);
      check(b.seed !== a.seed, `${kind}／${mode}：重新對戰沒有換種子`);
      if (mode !== "random") check(b.moves === a.moves, `${kind}／${mode}：重新對戰改到了招式順序`);
    }
    check(seen.size > 1, `${kind}／${mode}：按了 4 次重新對戰，結果都一樣`);
    out.push(`${kind}/${mode} ${seen.size} 種結果`);
  }
  // 全部恢復預設：原始數值還原血量倍率與攻擊距離；經典還原雙方距離
  await p.click("[data-kind=raw]"); await p.waitForTimeout(300);
  const before = await get();
  await p.click("[data-hpmul='5']"); await p.waitForTimeout(300);
  check((await get()).len !== before.len, "原始數值：血量倍率 ×5 沒有改變戰鬥長度");
  await p.click("#rResetAll"); await p.waitForTimeout(300);
  check((await get()).len === before.len, "原始數值：全部恢復預設沒有還原血量倍率");
  await p.click("[data-kind=classic]"); await p.waitForTimeout(300);
  await p.evaluate(() => { const s = document.getElementById("dDist"); s.value = 600; s.dispatchEvent(new Event("input")); });
  await p.click("#rResetAll"); await p.waitForTimeout(300);
  check((await p.inputValue("#dDist")) === "320", "經典：全部恢復預設沒有還原雙方距離");
  return out.join("、");
});

await test("雙人設定：分享連結、存檔、舊格式", async (open) => {
  const p = await open();
  const get = (pg) => pg.evaluate(() => { const d = window.__rk.duel(); return { len: d.len, result: d.result, dealt: d.dealt.join(","), st: d.settings }; });
  const reopen = async (url) => { const q = await p.context().newPage(); await q.goto(url); await waitDuel(q); const r = await get(q); await q.close(); return r; };
  // 1. 會影響結果的設定都要跟著分享連結走（v4.14 之前速度、投射物、重播、距離、時間上限會漏掉）
  await p.goto(BASE + "?app=duel&type=real&l=x001-cube&r=x002-orb&s=9"); await waitDuel(p);
  await p.evaluate(() => { const e = document.getElementById("dSpeed"); e.value = "1.5"; e.dispatchEvent(new Event("input", { bubbles: true })); });
  await p.click("#dProj"); await p.click("#dFinale");
  await p.fill("#rTime", "8"); await p.locator("#rTime").dispatchEvent("change"); await p.waitForTimeout(500);
  const a = await get(p), url = await p.evaluate(() => location.href);
  check(a.st.speed === 1.5 && a.st.projOn === false && a.st.finale === false && a.st.timeLimit === 8, `設定沒有生效：${JSON.stringify(a.st)}`);
  const b = await reopen(url);
  check(b.len === a.len && b.dealt === a.dealt && b.result === a.result, `分享連結打開的結果不同：${JSON.stringify([a, b].map((x) => [x.len, x.result, x.dealt]))}`);
  // 經典對戰的雙方距離
  await p.goto(BASE + "?app=duel&type=classic&l=x001-cube&r=x002-orb&s=2"); await waitDuel(p);
  await p.evaluate(() => { const e = document.getElementById("dDist"); e.value = "560"; e.dispatchEvent(new Event("input", { bubbles: true })); }); await p.waitForTimeout(500);
  const c = await get(p), d = await reopen(await p.evaluate(() => location.href));
  check(d.st.dist === 560 && d.len === c.len, `經典對戰的距離沒有跟著連結：${d.st.dist}`);
  // 2. 連結沒寫的設定用預設值，不能沿用開的人自己存的設定
  await p.goto(BASE + "?app=duel&type=raw&l=x001-cube&r=x002-orb&s=4"); await waitDuel(p);
  await p.click("[data-hpmul='5']"); await p.waitForTimeout(400);
  const e = await reopen(BASE + "?app=duel&type=raw&l=x001-cube&r=x002-orb&s=4");
  check(e.st.hpMul === 1, `連結沒有血量倍率，卻沿用了自己存的 ×${e.st.hpMul}`);
  // 3. 舊版存檔（kind＋raw、召喚上限 5）能正確轉換
  await p.evaluate(() => localStorage.setItem("rk_duel", JSON.stringify({ a: "x001-cube", b: "x002-orb", kind: "real", raw: true, sumCap: 5, hpMul: 3, seed: 7 })));
  await p.goto(BASE + "?app=duel"); await waitDuel(p);
  const f = await get(p);
  check(f.st.type === "raw" && f.st.sumCap === 3 && f.st.hpMul === 3 && f.st.seed === 7, `舊版存檔轉換錯誤：${JSON.stringify(f.st)}`);
  return `連結還原 ${a.len} 格、距離 ${d.st.dist}、舊存檔 → ${f.st.type}`;
});

await test("雙人播放：不自動播放、3 2 1 倒數、播完停住", async (open) => {
  const p = await open(); await p.goto(BASE + "?app=duel&type=raw&l=x001-cube&r=x002-orb&s=3"); await waitDuel(p);
  const st = () => p.evaluate(() => window.__rk.duel());
  await p.waitForTimeout(1200);
  let d = await st();
  check(d.state === "idle" && d.pos === 0, `開啟後不該自動播放：${d.state} 第 ${d.pos} 格`);
  check(await p.isVisible("#dStart"), "還沒開始時沒有黑幕與播放鈕");
  check(/ko@\d+/.test(d.sysSfx) && d.ko >= 0, `K.O. 沒有排入音效：${d.sysSfx}`);
  await p.click("#dStartBtn"); await p.waitForTimeout(1200);
  d = await st();
  check(d.state === "countdown" && d.pos === 0 && !(await p.isVisible("#dStart")), `按播放後應該先倒數：${d.state} 第 ${d.pos} 格`);
  await p.waitForTimeout(2600);
  d = await st();
  check(d.state === "playing" && d.pos > 0, `倒數完沒有開打：${d.state} 第 ${d.pos} 格`);
  await p.click("#dPlay"); const at = (await st()).pos; await p.waitForTimeout(500);
  d = await st(); check(d.state === "paused" && d.pos === at, "暫停後畫面還在走");
  await p.click("#dPlay"); await p.waitForTimeout(500);
  d = await st(); check(d.state === "playing" && d.pos > at, `暫停後再播放應該直接接著播（不倒數）：${d.state}`);
  // 改數值：回到還沒開始
  await p.click("[data-hpmul='5']"); await p.waitForTimeout(800);
  d = await st(); check(d.state === "idle" && d.pos === 0 && await p.isVisible("#dStart"), `改數值後應該停在開頭等按播放：${d.state} 第 ${d.pos} 格`);
  await p.click("#rRerun"); await p.waitForTimeout(800);
  d = await st(); check(d.state === "idle" && d.pos === 0, `重新對戰後應該停在開頭等按播放：${d.state}`);
  // 播完：停在最後一格，不重複
  await p.click("[data-hpmul='1']"); await p.waitForTimeout(300);
  await p.evaluate(() => { const s = document.getElementById("dscrub"); s.value = String(+s.max - 10); s.dispatchEvent(new Event("input", { bubbles: true })); });
  await p.click("#dPlay"); await p.waitForTimeout(2000);
  d = await st(); check(d.state === "ended" && d.pos === d.len - 1, `播完應該停在最後一格：${d.state} 第 ${d.pos}／${d.len - 1} 格`);
  return `K.O. 音效 ${d.sysSfx}`;
});

await test("格鬥場（測試版）：矩形、防禦條、硬直值倒地、連段遞減、直線方向、緩衝、決定性", async (open) => {
  const p = await open(); await p.goto(BASE + "?app=fight");
  await p.waitForFunction(() => window.__rk && window.__rk.fight().ready, null, { timeout: 60000 });
  const R = (spec) => p.evaluate((s) => window.__rk.fightRun(s), spec);
  const walkIn = [{ side: 0, from: 0, to: 60, mx: 1 }];
  // 矩形：放在對手位置命中；預告期間跳起來躲掉；兩種預告時間都能用
  for (const teleMode of ["dist", "sync"]) {
    const rect = await R({ c0: "x001-cube", c1: "x002-orb", steps: 120, teleMode, script: [{ side: 0, sk: [1, 5, 20, 0] }] });
    check(rect.log.hits === 1, `矩形技能（預告 ${teleMode}）放在對手位置應該命中 1 次，實際 ${rect.log.hits}`);
  }
  const dodge = await R({ c0: "x001-cube", c1: "x002-orb", steps: 120, script: [{ side: 0, sk: [1, 5, 20, 0] }, { side: 1, from: 40, jump: true }] });
  check(dodge.log.hits === 0, "對手在預告期間跳起來，矩形不該打到");
  // 防禦條：一直按著 5 秒破防；擋下攻擊不扣血
  const hold = await R({ c0: "x001-cube", c1: "x002-orb", steps: 320, script: [{ side: 1, from: 0, guard: true }] });
  check(hold.log.breaks === 1, `按住防禦 5 秒應該破防一次：${JSON.stringify(hold.log)}`);
  const block = await R({ c0: "x001-cube", c1: "x002-orb", steps: 150, script: [...walkIn, { side: 0, from: 70, atk: 30 }, { side: 1, from: 0, guard: true }] });
  check(block.log.guards > 0 && block.hp[1] === block.maxHp[1], `擋下攻擊不該扣血：${JSON.stringify(block.log)} 血 ${block.hp[1]}`);
  // 連打：傷害遞減（100、90、80…），硬直值滿了倒地、起身無敵
  const combo = await R({ c0: "x001-cube", c1: "x002-orb", steps: 400, script: [...walkIn, { side: 0, from: 60, to: 400, atk: 28, mx: 1 }] });
  check(combo.log.scale.slice(0, 3).join() === "1,0.9,0.8", `連段傷害應該遞減：${combo.log.scale.join()}`);
  check(combo.log.downs >= 1 && combo.log.inv >= 1, `硬直值滿了應該倒地、起身無敵：${JSON.stringify(combo.log)}`);
  // 直線：點一下朝面向射出、一路飛到打中；按住時轉身再放開就往反方向
  const shot = await R({ c0: "x002-orb", c1: "x001-cube", steps: 120, script: [{ side: 0, sk: [2, 5, 6, 0] }] });
  check(shot.log.hits === 1, `投射物普攻點一下應該命中：${JSON.stringify(shot.log)}`);
  const line = await R({ c0: "x002-orb", c1: "x001-cube", steps: 200, script: [{ side: 0, sk: [0, 5, 6, 0] }] });
  check(line.log.hits === 1, "直線技能點一下應該飛到對手身上");
  const turned = await R({ c0: "x002-orb", c1: "x001-cube", steps: 200, script: [{ side: 0, sk: [0, 5, 40, 0] }, { side: 0, from: 10, to: 20, mx: -1 }] });
  check(turned.log.hits === 0 && turned.face[0] === -1 && turned.x[0] === -220, `按住直線技能時 ◀ 只轉身不走路，放開往反方向射：命中 ${turned.log.hits}、x ${turned.x[0]}`);
  // v7.4：直線、矩形、拋物線都能左右拖（無視面向）：往後拖＝轉身往後出招；往前拖＝照舊
  const lineBack = await R({ c0: "x002-orb", c1: "x001-cube", steps: 200, script: [{ side: 0, sk: [0, 5, 40, -100] }] });
  check(lineBack.log.hits === 0 && lineBack.face[0] === -1, `直線技能往後拖 100：應該轉身往反方向射：命中 ${lineBack.log.hits}、面向 ${lineBack.face[0]}`);
  const lineFwd = await R({ c0: "x002-orb", c1: "x001-cube", steps: 200, script: [{ side: 0, sk: [0, 5, 40, 100] }] });
  check(lineFwd.log.hits === 1 && lineFwd.face[0] === 1, `直線技能往前拖：照舊往前射：命中 ${lineFwd.log.hits}、面向 ${lineFwd.face[0]}`);
  const rectBack = await R({ c0: "x001-cube", c1: "x002-orb", steps: 200, script: [{ side: 0, sk: [0, 5, 40, -400] }] });
  check(rectBack.log.hits === 0 && rectBack.face[0] === -1, `矩形技能往後拖：應該轉身打背後：命中 ${rectBack.log.hits}、面向 ${rectBack.face[0]}`);
  // v7.4：拋物線拋得高（重力 ×2）：站在路徑中段、不跳的人從底下穿過不會被打到；站在落點會被打到
  const lobUnder = await R({ c0: "x002-orb", c1: "x001-cube", steps: 800, script: [{ side: 1, from: 590, to: 620, mx: -1 }, { side: 0, sk: [1, 640, 680, 1000] }] });
  const lobLand = await R({ c0: "x002-orb", c1: "x001-cube", steps: 800, script: [{ side: 1, from: 590, to: 620, mx: -1 }, { side: 0, sk: [1, 640, 680, 0] }] });
  const lobN = (r) => r.log.hits + (r.log.fxhits || 0); // 圓圓法師的拋物線沒有傷害、只有效果（算 fxhit）
  check(lobN(lobUnder) === 0 && lobN(lobLand) === 1, `拋物線從頭上越過不該打到、丟在腳下要打到：越過 ${lobN(lobUnder)}、腳下 ${lobN(lobLand)}、位置 ${lobUnder.x}`);
  const lobBack = await R({ c0: "x002-orb", c1: "x001-cube", steps: 800, script: [{ side: 0, sk: [1, 640, 680, -1000] }] });
  check(lobBack.log.hits === 0 && lobBack.face[0] === -1, `拋物線技能往後拖：應該轉身往後丟：命中 ${lobBack.log.hits}、面向 ${lobBack.face[0]}`);
  // v7.5：判定跟著畫面的四條通則＋體型（需要每日同步量好的 data/fight_reach.json）
  const H = async (id) => (await p.evaluate((x) => window.__rk.fightStatsOf(x), id)).hit;
  const qs = await H("u1571e-qs"), hd = await H("u1573e-hd"), kk = await H("u1032u-kikyou"), rim = await H("u1146u-rimuru"), riza = await H("u415u-riza");
  check(qs.atk >= 500, `衝刺型：始皇帝的普攻要打到衝過去的地方（≥ 500）：${qs.atk}`);
  check(hd.atkHide && hd.atkBox && hd.sk[0].hide, `本人變成投射物：黑帝斯飛行中不畫本人、投射物有碰撞框：${JSON.stringify(hd)}`);
  check(kk.sk[1].ahead >= 600, `技能動作很長：巫女桔梗技能 2 應該是身前範圍、打到 600 以上：${JSON.stringify(kk.sk[1])}`);
  check(rim.scale > 1.3 && rim.scale < 2.2, `體型：利姆路（待機是史萊姆）不該被放大成巨大史萊姆：縮放 ${rim.scale}`);
  check(riza.atk > 0 && riza.scale > 0.5 && riza.scale < 1.5, `體型：莉莎（上游部件寬高是 0）要能正常顯示：普攻 ${riza.atk}、縮放 ${riza.scale}`);
  // v7.5.1：投射物照原始出發位置（庫拉麗絲不再在地上）；飛行中看不到的投射物改成直接命中（華美巫女兔兔）；招黃金貓莎莉不被光暈縮小
  const cla = await H("u1116h-claris"), cony = await p.evaluate(() => window.__rk.fightStatsOf("u1014u-cony")), cat = await H("u418u-sally");
  check(cla.atkSpawn && cla.atkSpawn[1] >= 30, `出發位置：庫拉麗絲的普攻要從身體高度出發：${JSON.stringify(cla.atkSpawn)}`);
  check(cony.hit.atkHitAnim && cony.atk[0] !== "shot", `看不見的投射物：華美巫女兔兔的普攻要改成直接命中：${JSON.stringify(cony.atk)}`);
  check(cat.scale > 0.6, `體型：招黃金貓莎莉不該被光暈縮得太小：縮放 ${cat.scale}`);
  // 輸入緩衝：普攻快結束時按技能，結束後自動接上
  const buf = await R({ c0: "x001-cube", c1: "x002-orb", steps: 40, trace: true, script: [{ side: 0, from: 0, to: 1, atk: 1 }, { side: 0, sk: [0, 30, 31, 0] }] });
  check(buf.trace[36][0][3] === "aim", `緩衝：普攻結束時應該接上技能，實際狀態 ${buf.trace[36][0][3]}`);
  const spec = { c0: "x001-cube", c1: "x002-orb", mode: "cpu", rounds: 3, secs: 30, steps: 4000, seed: 5, ai: ["hard", "normal"] };
  const a = await R(spec), b = await R(spec);
  check(JSON.stringify(a) === JSON.stringify(b), "同樣的輸入與種子，結果應該完全一樣");
  return `電腦對打 ${a.wins.join("：")}、命中 ${a.log.hits}、防禦 ${a.log.guards}、倒地 ${a.log.downs}`;
});

await test("格鬥場：選角（搜尋、角色庫、精選、隨機、交換、不適合的變灰、固定設定、按鈕圖標）", async (open) => {
  const p = await open(); await p.goto(BASE + "?app=fight");
  await p.waitForFunction(() => window.__rk && window.__rk.fight().ready, null, { timeout: 60000 });
  const set = () => p.evaluate(() => window.__rk.fight().set);
  // 搜尋 → 點卡片換上右方
  await p.fill("#fq1", "粉琪"); await p.waitForSelector("#fr1 .r-card");
  await p.locator("#fr1 .r-card:not(.locked)").first().click();
  check((await set()).c1 !== "x002-orb", "搜尋後點卡片應該換上右方");
  // 不適合的：灰色、點了不會換上、會顯示原因
  await p.fill("#fq0", "u1063hsk"); await p.waitForSelector("#fr0 .r-card.locked");
  const before = (await set()).c0; await p.locator("#fr0 .r-card.locked").first().click();
  check((await set()).c0 === before, "不適合的角色點了不應該換上");
  check(/體力/.test(await p.locator("#fr0 .r-card.locked .compat").first().textContent()), "不適合的角色點了應該顯示原因");
  // 角色庫＋精選
  await p.click("[data-flib-side='0']"); await p.check("#libFeat");
  const n = await p.textContent("#libCount");
  check(/共 3\d 隻/.test(n), `精選應該是測試名單（約 35 隻）：${n}`);
  await p.locator("#libGrid .r-card").nth(2).click();
  check(await p.locator("#library").isHidden(), "選好後角色庫應該收起");
  // 隨機只抽適合的；交換
  for (let k = 0; k < 5; k++) {
    await p.click("#fRandAll"); const s = await set();
    const lv = await p.evaluate((ids) => ids.map((id) => window.__rk.fightQuick(id).lvl), [s.c0, s.c1]);
    check(!lv.includes("unfit") && s.c0 !== s.c1, `隨機應該只抽適合的兩隻不同角色：${s.c0} ${s.c1} ${lv}`);
  }
  const s0 = await set(); await p.click("#fSwap"); const s1 = await set();
  check(s1.c0 === s0.c1 && s1.c1 === s0.c0, "交換應該對調左右");
  // 藏起來的設定：畫面上看不到
  check(await p.locator("#fOptBox").isHidden(), "按住招式、技能預告的設定應該藏起來");
  // 重點數值一行＋詳細折疊
  await p.evaluate(() => window.__rk.fightPick(0, "u1021e-pink")); await p.evaluate(() => window.__rk.fightPick(1, "x001-cube"));
  await p.waitForSelector("#fInfo0 .f-brief span");
  check(/❤/.test(await p.textContent("#fInfo0 .f-brief")) && (await p.locator("#fInfo0 details.f-detail").count()) === 1, "選角卡應該有重點數值與「詳細」");
  // 對戰中技能按鈕：有原作圖標就畫圖標，自製角色沒有圖標就用文字
  await p.click("#fStart"); await p.waitForFunction(() => window.__rk.fight().running);
  await p.waitForFunction(() => { const x = window.__rk.fightIcons(); return x[0] && x[0][0] === "img"; }, null, { timeout: 15000 });
  const icons = await p.evaluate(() => window.__rk.fightIcons());
  check(icons[0][0] === "img" && icons[0][1] === "none" && icons[1].every((x) => x === "text"), `技能按鈕圖標：${JSON.stringify(icons)}`);
  return `精選 ${n}，隨機 5 次都適合，技能圖標 ${JSON.stringify(icons)}`;
});

await test("格鬥場：線上對戰準備（同步檢查代碼穩定、延遲輸入、輸入整數化）", async (open) => {
  const p = await open(); await p.goto(BASE + "?app=fight");
  await p.waitForFunction(() => window.__rk && window.__rk.fight().ready, null, { timeout: 60000 });
  const a = await p.evaluate(() => window.__rk.fightSync()), b = await p.evaluate(() => window.__rk.fightSync());
  check(a.code === b.code && a.rows.every((x) => !x.skip), `同步檢查跑兩次代碼應該一樣：${a.code}／${b.code}`);
  const t = await p.evaluate(() => [window.__rk.fightNetTest(0), window.__rk.fightNetTest(3)]);
  check(t[0].seq.startsWith("J") && t[1].seq.startsWith("---J"), `延遲輸入：按下的跳應該在第 0／第 3 格才生效：${t[0].seq}／${t[1].seq}`);
  check(t[1].slow.endsWith("wait"), `假網路延遲時應該停下來等：${t[1].slow}`);
  check(t[1].aim[0] === 13 && t[1].aim[1] === null && t[1].aim[2] === -3, `拖曳距離應該取整數：${JSON.stringify(t[1].aim)}`);
  return `同步代碼 ${a.code}，延遲 ${t[1].seq}`;
});

await test("格鬥場：線上對戰（假資料庫、兩個分頁：開房、清過期房間、加入、直連、準備、同步、鏡像、再一場、斷線）", async (open) => {
  const A = await open({ width: 390, height: 844 });
  const ready = (q) => q.waitForFunction(() => window.__rk && window.__rk.fight().ready, null, { timeout: 60000 });
  await A.goto(BASE + "?app=fight&fakefb=1"); await ready(A);
  await A.click("[data-fmode='online']");
  await A.evaluate(() => { const r = document.getElementById("fRounds"), s = document.getElementById("fSecs"); r.value = "1"; r.dispatchEvent(new Event("change")); s.value = "20"; s.dispatchEvent(new Event("change")); });
  // v6.2：先放一間「3 小時前」的過期房間，開房時應該被清掉
  await A.evaluate(() => { localStorage.setItem("rk_fakefb:rooms/OLD1/host", JSON.stringify("x")); localStorage.setItem("rk_fakefb:rooms/OLD1/created", JSON.stringify(Date.now() - 3 * 3600 * 1000)); });
  await A.click("#fOnCreate"); await A.waitForFunction(() => window.__rk.fightOnline().code, null, { timeout: 20000 });
  const code = await A.evaluate(() => window.__rk.fightOnline().code);
  await A.waitForFunction(() => !localStorage.getItem("rk_fakefb:rooms/OLD1/created"), null, { timeout: 5000 }).catch(() => {});
  check(!(await A.evaluate(() => localStorage.getItem("rk_fakefb:rooms/OLD1/created"))), "開房時應該清掉過期房間");
  const B = await A.context().newPage(); await B.goto(BASE + `?app=fight&fakefb=1&room=${code}`); await ready(B);
  for (const q of [A, B]) await q.waitForSelector("#fOnReady:not([hidden])", { timeout: 30000 });
  const link = await A.evaluate(() => window.__rk.fightOnline().link);
  await A.click("#fOnReady"); await B.click("#fOnReady");
  for (const q of [A, B]) await q.waitForFunction(() => window.__rk.fight().running && window.__rk.fightNet().frame > 60, null, { timeout: 30000 });
  // v6.1 鏡像：加入者（右方）畫面左右對調，按「右」＝往對手（場上往左）走
  await B.waitForFunction(() => window.__rk.fightNet().phase === "fight", null, { timeout: 20000 });
  const bx0 = (await B.evaluate(() => window.__rk.fightNet().x))[1];
  await B.keyboard.down("d"); await B.waitForTimeout(500); await B.keyboard.up("d"); await B.waitForTimeout(300);
  const bx1 = (await B.evaluate(() => window.__rk.fightNet().x))[1];
  check(bx1 < bx0, `鏡像：加入者按右應該往對手走（場上 x 變小）：${bx0} → ${bx1}`);
  await A.keyboard.down("d"); await B.keyboard.down("a");
  for (let k = 0; k < 15; k++) { await A.keyboard.press("j"); await B.keyboard.press("j"); await A.waitForTimeout(150); }
  await A.keyboard.up("d"); await B.keyboard.up("a");
  await A.waitForFunction(() => window.__rk.fightNet().phase === "over", null, { timeout: 40000 });
  await B.waitForFunction(() => window.__rk.fightNet().phase === "over", null, { timeout: 10000 });
  const [na, nb] = await Promise.all([A, B].map((q) => q.evaluate(() => window.__rk.fightNet())));
  check(!na.desync && !nb.desync && JSON.stringify(na.hp) === JSON.stringify(nb.hp), `雙方結果應該一樣：A ${JSON.stringify(na.hp)}、B ${JSON.stringify(nb.hp)}、不同步 ${JSON.stringify(na.desync || nb.desync)}`);
  // 再一場：一方先按要等另一方
  await A.click("#fAgain"); await A.waitForTimeout(1000);
  check((await A.evaluate(() => window.__rk.fightNet().phase)) === "over", "只有一方按「再一場」時不應該開打");
  await B.click("#fAgain");
  await A.waitForFunction(() => window.__rk.fightNet().phase !== "over" && window.__rk.fightNet().frame > 30, null, { timeout: 20000 });
  await B.waitForFunction(() => window.__rk.fightNet().frame > 30, null, { timeout: 20000 });
  // 斷線
  await B.close(); await A.waitForFunction(() => /斷線/.test(document.getElementById("fOverText").textContent), null, { timeout: 15000 });
  return `房號 ${code}，${link}，結果 ${JSON.stringify(na.hp)}`;
});

await test("格鬥場：橫向、鏡頭、轉向（v7.0）", async (open) => {
  const p = await open({ width: 390, height: 844 });
  await p.goto(BASE + "?app=fight"); await p.waitForFunction(() => window.__rk && window.__rk.fight().ready, null, { timeout: 60000 });
  await p.click("#fStart"); await p.waitForFunction(() => window.__rk.fight().running);
  await p.waitForFunction(() => window.__rk.fight().phase === "fight", null, { timeout: 15000 }).catch(() => {});
  const v0 = await p.evaluate(() => window.__rk.fightView());
  check(!v0.land && v0.w === 720 && v0.camX !== null, `直向：畫布寬 720、鏡頭有運作：${JSON.stringify(v0)}`);
  // 按住往右走，再轉成橫向：按住的方向鍵要被放開（不會一直走）
  await p.keyboard.down("d"); await p.waitForTimeout(400);
  await p.setViewportSize({ width: 844, height: 390 }); await p.keyboard.up("d"); await p.waitForTimeout(900);
  const v1 = await p.evaluate(() => window.__rk.fightView());
  check(v1.land && v1.h === 720 && v1.w > 1000, `轉橫後應該是橫向版面：${JSON.stringify(v1)}`);
  const xa = (await p.evaluate(() => window.__rk.fightNet().x))[0]; await p.waitForTimeout(400);
  const xb = (await p.evaluate(() => window.__rk.fightNet().x))[0];
  check(xa === xb, `轉向後不應該自己一直走：${xa} → ${xb}`);
  // 鏡頭：兩人拉開時鏡頭會縮小（看得到更寬），把兩個人都放進畫面
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(600);
  await p.keyboard.down("a"); await p.waitForTimeout(2500); await p.keyboard.up("a"); await p.waitForTimeout(800);
  const v2 = await p.evaluate(() => window.__rk.fightView());
  check(v2.view > v0.view + 200, `兩人拉開，鏡頭應該縮小（看得更寬）：${v0.view} → ${v2.view}`);
  return `直向 ${v0.w}×${v0.h}、橫向 ${v1.w}×${v1.h}、鏡頭 ${v2.camX}`;
});

await test("格鬥場：角色資料解讀（攻擊形式、缺資料、不支援的標示）", async (open) => {
  const p = await open(); await p.goto(BASE + "?app=fight");
  await p.waitForFunction(() => window.__rk && window.__rk.fight().ready, null, { timeout: 60000 });
  const N = (id) => p.evaluate((x) => window.__rk.fightNorm(x), id);
  const R = (spec) => p.evaluate((s) => window.__rk.fightRun(s), spec);
  // 射程 800、直接命中的普攻＝瞬間直線（不是近戰），開場距離就打得到；起跳可以躲
  const sally = await N("u1028e-sally");
  check(sally.atk === "dline", `u1028e-sally 普攻應該是瞬間直線，實際 ${sally.atk}`);
  const hit = await R({ c0: "u1028e-sally", c1: "x001-cube", steps: 120, script: [{ side: 0, from: 5, to: 6, atk: 1 }] });
  check(hit.log.hits === 1, `瞬間直線從開場距離應該打得到：${JSON.stringify(hit.log)}`);
  // 拋物線普攻＝拋物線（不是直線）
  const cony = await N("u014e-cony");
  check(cony.atk === "lob", `u014e-cony 普攻應該是拋物線，實際 ${cony.atk}`);
  const lob = await R({ c0: "u014e-cony", c1: "x001-cube", steps: 150, script: [{ side: 0, sk: [2, 5, 6, 0] }] });
  check(lob.log.hits === 1, `拋物線普攻點一下應該落在對手位置：${JSON.stringify(lob.log)}`);
  // 沒有技能資料＝沒有技能（不是缺動作）
  const james = await N("u015e-james");
  check(james.sk[0] === null && james.sk[1] === null, `u015e-james 應該沒有技能：${james.sk}`);
  // 0 不會被換成預設值；佔位資料、沒有數值的單位標成不適合
  const F = (o, k, d) => p.evaluate(([o, k, d]) => window.__rk.fightField(o, k, d), [o, k, d]);
  const z = await F({ rg: [0] }, "rg", 150), miss = await F({}, "rg", 150), bad = await F({ rg: "abc" }, "rg", 150);
  check(z.v === 0 && z.st === "zero" && miss.st === "missing" && miss.guess && bad.st === "bad", `欄位狀態判斷錯誤：${JSON.stringify([z, miss, bad])}`);
  const leon = await p.evaluate(() => window.__rk.fightNormUnit({ id: "u001s-leonard", name: "測試" }, ["idle", "attack"]));
  check(!leon.fit, "體力 1 的佔位資料應該標成不適合格鬥場");
  const nostat = await p.evaluate(() => window.__rk.fightNormUnit({ id: "x-no-such-unit", name: "" }, []));
  check(!nostat.fit, "沒有數值的單位應該標成不適合");
  // 不認識的飛行方式：明確代替並標成不支援（不會默默變成別的）
  const unk = await p.evaluate(() => window.__rk.fightDelivery({ m: "BEAM", v: 30, e: 1 }, 300, true));
  check(unk.unsupported && unk.note.includes("BEAM"), `BEAM 應該標成不支援：${JSON.stringify(unk)}`);
  return `莎莉 瞬間直線、兔兔 拋物線、詹姆士 沒有技能`;
});

await test("格鬥場：技能效果（暈眩、擊退、沉默、持續傷害、護盾與穿透、回血、增減益）", async (open) => {
  const p = await open(); await p.goto(BASE + "?app=fight");
  await p.waitForFunction(() => window.__rk && window.__rk.fight().ready, null, { timeout: 60000 });
  const R = (spec) => p.evaluate((s) => window.__rk.fightRun(s), { trace: true, ...spec });
  const W = [{ side: 0, from: 0, to: 90, mx: 1 }] /* v7.4：身前範圍的技能要走近一點（原本 40 步，技能在第 50 步；改成 90 步、第 95 步） */, sk = (slot, at, side = 0) => ({ side, sk: [slot, at, at + 1, 0] });
  const has = (r, side, name) => r.trace.some((t) => t[side][7].split(",").includes(name));
  const st = (r, side, s) => r.trace.some((t) => t[side][3] === s);
  // 沒有效果資料（skill_fx.json 還沒同步）時，第一項檢查會看不到暈眩 → 跳過
  const stun = await R({ c0: "u006e-clark", c1: "x001-cube", steps: 300, script: [...W, sk(0, 95)] });
  if (!st(stun, 1, "stunfx")) return "skip:沒有技能效果資料（skill_fx.json 還沒同步）";
  const kb = await R({ c0: "u1003e-jessica", c1: "x001-cube", steps: 300, script: [...W, sk(0, 95)] });
  check(kb.log.downs >= 1, "擊退應該讓對手倒地");
  const si = await R({ c0: "u023e-sindy", c1: "x001-cube", steps: 300, script: [...W, sk(0, 95), sk(0, 175, 1), sk(0, 232, 1)] }); // v7.5.1：辛蒂的拋物線照原生曲線飛，沉默大約在第 158～217 步
  check(has(si, 1, "silence") && !["aim", "skill"].includes(si.trace[180][1][3]) && ["aim", "skill"].includes(si.trace[235][1][3]), "沉默期間不能用技能，結束後可以");
  const dot = await R({ c0: "u010e-clara", c1: "x001-cube", steps: 400, script: [sk(0, 50)] });
  const hp = dot.trace.map((t) => t[1][2]), drops = hp.filter((v, i) => i && v < hp[i - 1]).length;
  check(drops >= 5, `持續傷害應該分好幾次扣血，實際 ${drops} 次`);
  const sh = await R({ c0: "x001-cube", c1: "u003e-bella", steps: 200, script: [sk(0, 2, 1), { side: 0, from: 0, to: 60, mx: 1 }, { side: 0, from: 70, to: 200, atk: 30 }] });
  check(sh.hp[1] === sh.maxHp[1] && sh.trace.some((t) => t[1][8] > 0), "護盾應該先吸收傷害");
  const pierce = await R({ c0: "u1008h-brown", c1: "u003e-bella", steps: 200, script: [sk(0, 2, 1), { side: 0, from: 0, to: 40, mx: 1 }, sk(1, 62)] });
  check(pierce.hp[1] < pierce.maxHp[1], "解除無敵的技能傷害應該穿透護盾");
  const heal = await R({ c0: "x001-cube", c1: "u017e-james", steps: 260, script: [{ side: 0, from: 0, to: 60, mx: 1 }, { side: 0, from: 70, to: 71, atk: 1 }, sk(0, 150, 1)] });
  // v6.0.2：給自己的效果在前搖結束時才生效（這隻前搖 50 格），所以看出招後 110 格內有沒有回血
  check(Math.max(...heal.trace.slice(150, 260).map((t) => t[1][2])) > heal.trace[149][1][2], "回血技能應該回血（前搖結束時）");
  // v6.3：空中防禦（擋得下、扣兩倍防禦條、不被推、照樣往前飄）
  const gd = (air) => R({ c0: "x001-cube", c1: "u1028e-sally", steps: 90, script: [{ side: 1, from: 0, to: 300, atk: 30 }, { side: 0, from: 22, to: 90, guard: true }, ...(air ? [{ side: 0, from: 20, to: 21, jump: true }, { side: 0, from: 20, to: 90, mx: 1 }] : [])] });
  const [gG, gA] = [await gd(false), await gd(true)];
  check(gA.log.guards >= 1 && gA.hp[0] === gA.maxHp[0], `空中防禦應該擋得下：擋 ${gA.log.guards}、體力 ${gA.hp[0]}`);
  check(gA.gauge[0] < gG.gauge[0] && gA.x[0] > gG.x[0], `空中防禦應該扣比較多防禦條、不被推回去：防禦條 ${gA.gauge[0]}／${gG.gauge[0]}、位置 ${gA.x[0]}／${gG.x[0]}`);
  // v7.0：衝刺（速度 ×1.8、不能防禦）、直線投射物最多飛 900、擊飛撞牆最多推 800（到不了牆不暈眩）
  const walk = await R({ c0: "x001-cube", c1: "x002-orb", steps: 60, script: [{ side: 0, from: 0, to: 60, mx: -1 }] });
  const sprint = await R({ c0: "x001-cube", c1: "x002-orb", steps: 60, script: [{ side: 0, from: 0, to: 60, mx: -1, run: true }, { side: 0, from: 0, to: 60, guard: true }] });
  const dw = -220 - walk.x[0], ds = -220 - sprint.x[0];
  check(ds > dw * 1.6 && sprint.log.guards === 0 && sprint.state[0] !== "guard", `衝刺應該比走路快約 1.8 倍、衝刺中不能防禦：走 ${dw}、衝 ${ds}、狀態 ${sprint.state[0]}`);
  // 衝刺跳、衝刺中瞄準技能：照樣維持衝刺速度（實際遊戲固定「按住招式可移動」）
  const rj = await R({ c0: "x001-cube", c1: "x002-orb", steps: 60, holdMove: true, script: [{ side: 0, from: 0, to: 60, mx: -1, run: true }, { side: 0, from: 5, to: 6, jump: true }] });
  const ra = await R({ c0: "x001-cube", c1: "x002-orb", steps: 60, holdMove: true, script: [{ side: 0, from: 0, to: 60, mx: -1, run: true }, { side: 0, sk: [0, 5, 59, 0] }] });
  check(-220 - rj.x[0] > dw * 1.6 && -220 - ra.x[0] > dw * 1.6, `衝刺跳、衝刺中瞄準都要維持衝刺速度：走 ${dw}、衝刺跳 ${-220 - rj.x[0]}、瞄準 ${-220 - ra.x[0]}`);
  const far = await R({ c0: "x002-orb", c1: "x001-cube", steps: 240, script: [{ side: 1, from: 0, to: 240, mx: 1, run: true }, { side: 0, from: 100, to: 101, atk: 1 }] });
  check(far.log.hits === 0, `直線投射物最多飛 900，對手在 900 以外應該打不到：命中 ${far.log.hits}、距離 ${far.x[1] - far.x[0]}`);
  // v6.0.2：技能前搖被普攻打中不中斷（預告照樣打下來）；被暈眩打中會中斷（預告消失）
  const armor = await R({ c0: "x001-cube", c1: "x001-cube", steps: 160, script: [{ side: 0, from: 0, to: 40, mx: 1 }, { side: 1, from: 0, to: 40, mx: -1 }, sk(0, 60, 1), { side: 0, from: 62, to: 63, atk: 1 }] });
  check(armor.hp[1] < armor.maxHp[1] && armor.hp[0] < armor.maxHp[0], `前搖被普攻打中，技能應該照樣打中對手：${armor.hp}`);
  // v6.0.3：霸體期間硬直值累積加倍（普攻 25 → 50）
  check(Math.max(...armor.trace.map((t) => t[1][5])) >= 50, `霸體期間被普攻打中，硬直值應該加倍：最高 ${Math.max(...armor.trace.map((t) => t[1][5]))}`);
  const cut = await R({ c0: "u006e-clark", c1: "x001-cube", steps: 220, script: [{ side: 0, from: 0, to: 40, mx: 1 }, { side: 1, from: 0, to: 40, mx: -1 }, sk(0, 60, 0), sk(0, 85, 1)] }); // v7.4：克拉克的技能改成身前範圍（前搖結束才判定，沒有預告），對手晚一點出招才會在前搖中被暈
  check(cut.hp[0] === cut.maxHp[0], `前搖被暈眩打中，技能應該被打斷（預告消失）：${cut.hp}`);
  const buff = await R({ c0: "u023u-sindy", c1: "x001-cube", steps: 60, script: [sk(1, 5)] });
  check(has(buff, 0, "atkUp") && has(buff, 0, "spdUp"), "增益技能應該加上攻擊、移速增加");
  // v5.3：受傷增減、清除增益、反射、吸血、冷卻重置
  const vul = await R({ c0: "u010u-clara", c1: "x001-cube", steps: 400, script: [...W, sk(1, 95), sk(0, 200)] });
  const base = await R({ c0: "u010u-clara", c1: "x001-cube", steps: 400, script: [...W, sk(0, 200)] });
  check(vul.log.dmg[vul.log.dmg.length - 1] > base.log.dmg[0], `技能抗性降低後，下一招技能傷害應該變高：${vul.log.dmg} vs ${base.log.dmg}`);
  const clean = await R({ c0: "u032u-ron", c1: "u023u-sindy", steps: 300, script: [sk(1, 2, 1), { side: 0, from: 0, to: 40, mx: 1 }, sk(1, 60)] });
  check(has(clean, 1, "atkUp") && !clean.trace[150][1][7].includes("atkUp"), "清除敵方增益應該清掉對手的攻擊增加");
  const mir = await R({ c0: "x001-cube", c1: "u1001h-brown", steps: 200, script: [sk(1, 2, 1), { side: 0, from: 0, to: 60, mx: 1 }, { side: 0, from: 80, to: 200, atk: 30 }] });
  check(mir.hp[0] < mir.maxHp[0], "反射應該讓出手的人也受傷");
  // v6.0.2：重置是給自己的效果，前搖結束才生效
  const reset = await R({ c0: "u1084h-alice", c1: "x001-cube", steps: 200, script: [sk(1, 5), sk(0, 118)] });
  check(reset.cd[0][1] === 0, `技能冷卻重置應該讓另一個技能冷卻歸零：${reset.cd[0]}`);
  // v5.3 第 2 部分：突進、拉近、交換位置、泡泡、複製體
  // v6.4：將敵人召喚為隊友（對手複製體）要技能打中才出現；沒打中、被擋下都沒有
  const cpHit = await R({ c0: "u1004e-sally", c1: "x001-cube", steps: 200, script: [{ side: 0, sk: [0, 5, 40, 0] }] });
  const cpMiss = await R({ c0: "u1004e-sally", c1: "x001-cube", steps: 200, script: [{ side: 0, sk: [0, 5, 40, -400] }, { side: 1, from: 0, to: 200, mx: 1, run: true }] }); // v7.4：技能範圍照特效圖（很寬），要讓對手跑遠才會沒打中
  const cpGuard = await R({ c0: "u1004e-sally", c1: "x001-cube", steps: 200, script: [{ side: 0, sk: [0, 5, 40, 0] }, { side: 1, from: 0, to: 200, guard: true }] });
  check(cpHit.log.clones === 1 && !cpMiss.log.clones && !cpGuard.log.clones, `複製體：打中 ${cpHit.log.clones}、沒打中 ${cpMiss.log.clones}、被擋 ${cpGuard.log.clones}（應該是 1、0、0）`);
  const dash = await R({ c0: "u1216e-towa", c1: "x001-cube", steps: 250, script: [...W, sk(0, 95)] });
  check(dash.log.hits >= 1 && dash.x[0] > -38, `突進應該衝過去並打中：x ${dash.x[0]}、命中 ${dash.log.hits}`);
  const pull = await R({ c0: "u1013e-brown", c1: "x001-cube", steps: 250, script: [{ side: 0, from: 0, to: 40, mx: 1 }, sk(0, 50)] }); // 拉近要從遠處拉，不走太近
  check(pull.x[1] < 150, `拉動敵人應該把對手拉近：對手 x ${pull.x[1]}`);
  // v5.4：擊飛撞牆（對手滑到牆邊暈眩，自己跟上去）
  const wall = await R({ c0: "u1021e-pink", c1: "x001-cube", steps: 150, trace: true, script: [{ side: 0, mx: 1, from: 0, to: 50 }, { side: 0, sk: [0, 60, 80, 0] }] });
  const wEnd = wall.trace[wall.trace.length - 1];
  check(wEnd[1][0] > 300 && wall.trace.some((s) => s[1][3] === "stunfx") && wEnd[0][0] > 100, `擊飛撞牆：對手 x ${wEnd[1][0]}、自己 x ${wEnd[0][0]}`);
  const swap = await R({ c0: "u003u-bella", c1: "x001-cube", steps: 200, script: [...W, sk(1, 95)] });
  check(swap.x[0] > swap.x[1], `交換位置後左右應該對調：${swap.x}`);
  const bub = await R({ c0: "u1418e-moon", c1: "x001-cube", steps: 300, script: [...W, sk(0, 95)] });
  check(bub.trace.some((t) => t[1][3] === "bubble" && t[1][1] > 50), "泡泡應該讓對手浮起來");
  const copy = await R({ c0: "u1004e-sally", c1: "x001-cube", steps: 400, script: [...W, sk(0, 95)] });
  check(copy.log.hits >= 2, `複製體應該也會攻擊：命中 ${copy.log.hits}`);
  // v5.3.1：召喚物（會攻擊、會被打倒、擋投射物、被「清除召喚物」封鎖）、變形外觀
  const sum = await R({ c0: "u1009e-sally", c1: "x001-cube", steps: 800, script: [sk(0, 5), { side: 1, from: 60, to: 800, atk: 30 }] }); // v7.4：步數 500 → 800
  check(sum.log.summons >= 1 && sum.trace.some((t) => t[2].length) && !sum.trace[799][2].length, `召喚物應該出現、會被打倒：最多 ${sum.log.summons} 隻`);
  // v6.4：召喚技能要打中才召喚（瞄準旁邊打空、被防禦擋下都不會叫出來）
  const sumMiss = await R({ c0: "u1009e-sally", c1: "x001-cube", steps: 200, script: [{ side: 0, sk: [0, 5, 20, -400] }] });
  const sumGuard = await R({ c0: "u1009e-sally", c1: "x001-cube", steps: 200, script: [{ side: 0, sk: [0, 5, 20, 0] }, { side: 1, from: 0, to: 200, guard: true }] });
  check(!sumMiss.log.summons && !sumGuard.log.summons, `召喚技能打空／被擋應該叫不出召喚物：打空 ${sumMiss.log.summons}、被擋 ${sumGuard.log.summons}`);
  const atkBy = await R({ c0: "u1009e-sally", c1: "x001-cube", steps: 400, script: [sk(0, 5)] });
  check(atkBy.log.hits >= 3, `召喚物應該會攻擊：命中 ${atkBy.log.hits}`);
  const block = await R({ c0: "u1009e-sally", c1: "x002-orb", steps: 300, script: [sk(0, 5), sk(2, 90, 1), sk(2, 140, 1)] });
  check(block.hp[0] === block.maxHp[0], "召喚物應該擋下對手的投射物");
  const nos = await R({ c0: "u1009e-sally", c1: "u1016h-pegasus", steps: 300, script: [sk(1, 2, 1), sk(0, 10)] });
  check(!nos.log.summons, "對手有「清除召喚物」時應該叫不出召喚物");
  const polyForm = await p.evaluate(() => window.__rk.fightPolyForm("u376u-cony"));
  check(polyForm === "u376sk-cony", `造物神兔兔的變形外觀應該是 u376sk-cony：${polyForm}`);
  return "13＋5＋10 種效果、召喚、變形外觀都有作用";
});

await test("官方角色對戰可執行", async (open) => {
  const p = await open(); await p.goto(BASE + "?app=duel&type=raw"); await waitDuel(p);
  const d = await p.evaluate(() => window.__rk.duel());
  check(d.len > 30 && d.a && d.b, `對戰沒有正常產生：${JSON.stringify(d)}`);
  return `${d.a} vs ${d.b}，${d.result}`;
});

await test("錄影：逐格輸出（單人）", async (open) => {
  const p = await open({ opus: true }); await p.goto(BASE + "?app=single&u=x001-cube&clip=attack"); await waitSingle(p);
  if (!(await p.evaluate(() => window.__rk.offline(720, 720, 30)))) return "skip:" + (await codecWhy(p)); // 這個瀏覽器不能逐格輸出
  await p.click("[data-tab=out]");
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 120000 }), p.click("#recOrig")]);
  const f = path.join(OUT, "rec_single.mp4"); await dl.saveAs(f);
  const status = await p.textContent("#outStatus");
  const info = mp4Info(fs.readFileSync(f));
  check(info.top.join(",") === "ftyp,moov,mdat", `檔案結構不是一般 MP4：${info.top.join(",")}`);
  const v = info.tracks.find((t) => t.kind === "vide"), a = info.tracks.find((t) => t.kind === "soun");
  check(v && v.samples === 18, `影片格數應為 18，實際 ${v && v.samples}`);
  check(a && a.samples > 0, "沒有聲音軌");
  check(Math.abs(v.seconds - 0.6) < 0.02, `影片長度應為 0.6 秒，實際 ${v.seconds}`);
  return `${v.codec}＋${a.codec}，${v.samples} 格`;
});

await test("錄影：逐格輸出（雙人）", async (open) => {
  const p = await open({ opus: true }); await p.goto(BASE + "?app=duel&type=raw&l=x001-cube&r=x002-orb&s=3"); await waitDuel(p);
  if (!(await p.evaluate(() => window.__rk.offline(document.getElementById("dcv").width, document.getElementById("dcv").height, 30)))) return "skip:" + (await codecWhy(p));
  const len = (await p.evaluate(() => window.__rk.duel())).len;
  const out = [];
  // 按錄製後會問要不要包含開頭倒數：不含＝對戰長度，含＝多 3 秒（90 格）
  for (const [btn, extra, name] of [["#dRecNo", 0, "不含倒數"], ["#dRecCd", 90, "含倒數"]]) {
    await p.click("#dRec");
    check(await p.isVisible("#dRecAsk"), "按錄製後沒有詢問要不要包含倒數");
    const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 300000 }), p.click(btn)]);
    const f = path.join(OUT, `rec_duel_${extra}.mp4`); await dl.saveAs(f);
    const info = mp4Info(fs.readFileSync(f));
    check(info.top.join(",") === "ftyp,moov,mdat", `${name}：檔案結構不是一般 MP4：${info.top.join(",")}`);
    const v = info.tracks.find((t) => t.kind === "vide"), a = info.tracks.find((t) => t.kind === "soun");
    check(v && v.samples === len + extra, `${name}：影片格數應為 ${len + extra}，實際 ${v && v.samples}`);
    check(Math.abs(v.seconds - (len + extra) / 30) < 0.05, `${name}：影片長度應為 ${((len + extra) / 30).toFixed(2)} 秒，實際 ${v.seconds}`);
    check(a && a.samples > 0, `${name}：沒有聲音軌`);
    out.push(`${name} ${v.samples} 格`);
    await p.waitForTimeout(500);
  }
  return out.join("、");
});

await test("錄影：退回即時錄影", async (open) => {
  const p = await open(); await p.goto(BASE + "?app=single&u=x002-orb&clip=attack"); await waitSingle(p);
  await p.evaluate(() => { window.VideoEncoder = undefined; });
  if (!(await p.evaluate(() => !!window.MediaRecorder))) return "skip";
  await p.click("[data-tab=out]");
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 120000 }), p.click("#recOrig")]);
  const f = path.join(OUT, "rec_fallback" + path.extname(dl.suggestedFilename())); await dl.saveAs(f);
  const size = fs.statSync(f).size;
  check(size > 1000, `檔案太小：${size} bytes`);
  if (f.endsWith(".mp4")) { const info = mp4Info(fs.readFileSync(f)); check(info.top[1] === "moov", `MP4 沒有整理成一般格式：${info.top.join(",")}`); }
  return `${path.extname(f)}，${(size / 1024).toFixed(0)} KB`;
});

await test("上傳的音效重新整理後還在", async (open) => {
  const p = await open(); await p.goto(BASE + "?app=single&u=x001-cube"); await waitSingle(p);
  await p.click("[data-tab=out]");
  await p.locator("#sfxSingle .sfx-row select").first().selectOption("custom");
  await p.locator("#sfxSingle .sfx-row input[type=file]").first().setInputFiles(wav());
  await p.waitForTimeout(800);
  await p.reload(); await waitSingle(p); await p.waitForTimeout(800);
  const files = await p.evaluate(() => window.__rk.files());
  check(files.includes("sfx:single-atk"), `重新整理後找不到：${JSON.stringify(files)}`);
});

await test("回報資訊", async (open) => {
  const p = await open(); await p.goto(BASE + "?app=single&u=x001-cube"); await waitSingle(p);
  await p.click("#reportBtn");
  await p.waitForFunction(() => !document.getElementById("reportCopy").disabled, null, { timeout: 20000 });
  const text = await p.inputValue("#reportText");
  check(text.includes(await p.textContent("#appVer")) && text.includes("錄影方式") && text.includes("目前畫面：http"), "回報內容不完整");
});

await test("手機版面（400px）", async (open) => {
  const p = await open({ width: 400, height: 860 }); await p.goto(BASE + "?app=single&u=x001-cube"); await waitSingle(p);
  check(await p.evaluate(() => document.documentElement.scrollWidth) <= 400, "單人頁面出現橫向捲動");
  await p.click("#appDuel"); await waitDuel(p);
  check(await p.evaluate(() => document.documentElement.scrollWidth) <= 400, "雙人頁面出現橫向捲動");
  for (const sel of ["#dPlay", "#dRec", ".duel-transport .share-btn"]) check(await p.locator(sel).isVisible(), `${sel} 看不到`);
});

await test("搜尋引擎設定（noindex）", async (open) => {
  const p = await open(); await p.goto(BASE);
  const robots = await p.evaluate(() => { const m = document.querySelector('meta[name="robots"]'); return m ? m.content : ""; });
  check(robots.includes("noindex"), "網頁開頭沒有 noindex 設定，搜尋引擎會收錄");
});

// ---------- 結果 ----------
await browser.close(); server.close();
if (UPDATE || !fs.existsSync(BASELINE)) { fs.writeFileSync(BASELINE, JSON.stringify(newBaseline, null, 1) + "\n"); console.log(`已更新標準結果：${path.relative(process.cwd(), BASELINE)}`); }
const fail = results.filter((r) => r.ok === false), skip = results.filter((r) => r.ok === "skip");
const summary = [`## 自動健檢：${fail.length ? `❌ ${fail.length} 項失敗` : "✅ 全部通過"}（共 ${results.length} 項${skip.length ? `，略過 ${skip.length} 項` : ""}）`, "", "| 項目 | 結果 | 說明 | 秒 |", "| --- | --- | --- | --- |",
  ...results.map((r) => `| ${r.name} | ${r.ok === true ? "✅" : r.ok === "skip" ? "⏭️" : "❌"} | ${(r.note || "").replace(/\|/g, "/")} | ${(r.ms / 1000).toFixed(1)} |`)].join("\n");
console.log("\n" + summary);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
process.exit(fail.length ? 1 : 0);
