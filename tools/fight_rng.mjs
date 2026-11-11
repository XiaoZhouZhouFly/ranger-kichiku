// 格鬥場自動平衡抽樣用的亂數（v7.5.2）。fight_sample.mjs 用它決定「誰打誰、用什麼種子」；健檢用 rngSelfTest 確認不會提早循環。
// 為什麼獨立出來：v7.4.1～v7.5.1 用 (s × 1103515245 + 12345) % 2^31，乘法結果超過 2^53，浮點數掉尾數，
//   約 10,466 次就繞回同一個圈（四個分片、每一天都掉進同一圈），同一批約 3,500 場每天被重複記錄上百次。
// 現在用 mulberry32：全程 Math.imul／位元運算，都是 32 位元整數，中間值不會超過 2^53。
const fmix32 = (h) => { h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); return (h ^ (h >>> 16)) >>> 0; };

// 一次執行、一個分片的起始狀態。sec＝開始抽樣當下的秒數（Unix 時間），所以同一天手動重跑也會抽到不同的對戰；
// 時間與分片先打散再混合，相差 1 秒或不同分片的序列也不會只差一小段位移
export const sampleSeed = (sec, shard) => fmix32(fmix32(sec >>> 0) ^ Math.imul(shard + 1, 0x9e3779b9)) >>> 0;

// mulberry32：回傳 rnd()（0～1）；rnd.state() 是目前的內部狀態（測試用）
export function mulberry32(seed) {
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rnd.state = () => a;
  return rnd;
}

// 舊公式（只給自我測試當對照組：測試要能抓到它的問題，才證明測試有效）
function oldLcg(seed) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  rnd.state = () => s;
  return rnd;
}

// 排序後數相鄰相同的個數（＝重複幾個）
const dupCount = (arr) => { arr.sort(); let d = 0; for (let i = 1; i < arr.length; i++) if (arr[i] === arr[i - 1]) d++; return d; };

/* 自我測試：幾次執行（起點秒數 sec＋offs：相隔 1 秒的手動重跑、隔天的排程）× shards 個分片，每條序列實際跑 n 次。
   - 每條序列內：n 個狀態全部不同（沒有提早循環）
   - 所有序列合起來：狀態也全部不同（不同次執行、不同分片不會掉進同一段）
   - 照抽樣的用法組出「左、右、種子」：所有序列合起來沒有重複的對戰
   - 對照組：舊公式同樣跑 n 次，必須被抓到重複（否則測試本身沒有效） */
export function rngSelfTest({ n = 1e6, sec = 1762866000, offs = [0, 1, 86400], shards = 4, pool = 2271 } = {}) {
  const seqs = [], day = Math.floor(sec / 86400);
  for (const o of offs) for (let sh = 0; sh < shards; sh++) seqs.push([sec + o, sh]);
  const all = new Uint32Array(seqs.length * n), triples = Math.floor(n / 3), keys = new Float64Array(seqs.length * triples);
  let perSeqDup = 0, k = 0;
  seqs.forEach(([d, sh], j) => {
    const rnd = mulberry32(sampleSeed(d, sh)), mine = new Uint32Array(n);
    for (let i = 0; i < n; i++) { rnd(); mine[i] = rnd.state(); }
    all.set(mine, j * n); perSeqDup += dupCount(mine);
    const r2 = mulberry32(sampleSeed(d, sh));
    for (let i = 0; i < triples; i++) { const a = Math.floor(r2() * pool), b = Math.floor(r2() * pool), s = Math.floor(r2() * 1e9); keys[k++] = (a * pool + b) * 1e9 + s; }
  });
  const crossDup = dupCount(all), boutDup = dupCount(keys);
  // 對照組：舊公式（v7.4.1 的起始值寫法）
  const old = oldLcg(day * 97 + 1), oldStates = new Float64Array(n);
  for (let i = 0; i < n; i++) { old(); oldStates[i] = old.state(); }
  const oldDup = dupCount(oldStates);
  return { n, seqs: seqs.length, perSeqDup, crossDup, boutDup, bouts: keys.length, oldDup, ok: perSeqDup === 0 && crossDup === 0 && boutDup === 0 && oldDup > 0 };
}
