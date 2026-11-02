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
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 300000 }), p.click("#dRec")]);
  const f = path.join(OUT, "rec_duel.mp4"); await dl.saveAs(f);
  const info = mp4Info(fs.readFileSync(f));
  check(info.top.join(",") === "ftyp,moov,mdat", `檔案結構不是一般 MP4：${info.top.join(",")}`);
  const v = info.tracks.find((t) => t.kind === "vide");
  check(v && v.samples === len, `影片格數應為 ${len}，實際 ${v && v.samples}`);
  check(Math.abs(v.seconds - len / 30) < 0.05, `影片長度應為 ${(len / 30).toFixed(2)} 秒，實際 ${v.seconds}`);
  return `${v.samples} 格，${v.seconds.toFixed(2)} 秒`;
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
