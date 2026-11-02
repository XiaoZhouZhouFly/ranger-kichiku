  /* ---------- 錄影檔補上正確的總長度 ----------
     瀏覽器錄出的 MP4 是分段格式，檔頭總長度寫 0；WebM 則完全沒有總長度。
     播放器只好自己猜，才會出現「顯示 3 秒、實際播十幾秒」。這裡在錄完後把長度寫回檔頭。 */
  async function fixVideoDuration(blob, type, elapsedMs) {
    try {
      const buf = new Uint8Array(await blob.arrayBuffer());
      let out = null;
      if (type.includes("mp4")) { try { out = defragMp4(buf); } catch { out = null; } if (!out) out = fixMp4Duration(buf, elapsedMs); }
      else out = fixWebmDuration(buf, elapsedMs);
      return out ? new Blob([out], { type }) : blob;
    } catch { return blob; }
  }
  /* ---------- 分段式 MP4 → 一般 MP4 ----------
     瀏覽器錄出的 MP4 是分段式（moov 裡沒有樣本表，每段資料前面各有一個 moof）。
     iPhone／iPad 內建播放器讀這種檔案會把時間軸算錯，結尾一直停在最後一格。
     這裡不重新編碼，只把每一格的時間、大小、位置整理成一般 MP4 的樣本表，
     並把 moov 放在檔案開頭（faststart）。失敗就回傳 null，交給舊的補長度方式處理。 */
  function defragMp4(b) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const u32 = (o) => dv.getUint32(o), i32 = (o) => dv.getInt32(o);
    const typ = (o) => String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
    const kids = (start, end) => {
      const list = [];
      for (let o = start; o + 8 <= end;) {
        let size = u32(o), hdr = 8;
        if (size === 1) { size = Number(dv.getBigUint64(o + 8)); hdr = 16; }
        if (size === 0) size = end - o;
        if (size < 8 || o + size > end) break;
        list.push({ o, size, hdr, t: typ(o), end: o + size, body: o + hdr });
        o += size;
      }
      return list;
    };
    const find = (list, t) => list.find((x) => x.t === t);
    const sub = (box) => kids(box.body, box.end);
    const raw = (box) => b.subarray(box.o, box.end);

    const top = kids(0, b.length);
    const moov = find(top, "moov"), moofs = top.filter((x) => x.t === "moof");
    if (!moov || !moofs.length) return null;
    const mk = sub(moov), mvhd = find(mk, "mvhd"), mvex = find(mk, "mvex");
    if (!mvhd) return null;
    const movieTs = b[mvhd.body] === 1 ? u32(mvhd.body + 20) : u32(mvhd.body + 12);
    const trex = {};
    if (mvex) for (const x of sub(mvex)) if (x.t === "trex") trex[u32(x.body + 4)] = { dur: u32(x.body + 12), size: u32(x.body + 16), flags: u32(x.body + 20) };

    // 各軌道的固定資料
    const tracks = [];
    for (const t of mk.filter((x) => x.t === "trak")) {
      const tk = sub(t), tkhd = find(tk, "tkhd"), mdia = find(tk, "mdia");
      if (!tkhd || !mdia) return null;
      const md = sub(mdia), mdhd = find(md, "mdhd"), hdlr = find(md, "hdlr"), minf = find(md, "minf");
      if (!mdhd || !hdlr || !minf) return null;
      const mi = sub(minf), stbl = find(mi, "stbl"), stsd = stbl && find(sub(stbl), "stsd");
      if (!stsd) return null;
      tracks.push({
        id: b[tkhd.body] === 1 ? u32(tkhd.body + 20) : u32(tkhd.body + 12),
        ts: b[mdhd.body] === 1 ? u32(mdhd.body + 20) : u32(mdhd.body + 12),
        kind: typ(hdlr.body + 4), tkhd, mdhd, hdlr, minfOther: mi.filter((x) => x.t !== "stbl"), stsd,
        dts: [], size: [], off: [], flags: [], cto: [], cursor: null,
      });
    }
    const byId = {}; tracks.forEach((t) => (byId[t.id] = t));

    // 讀出每一段（moof）裡每一格的時間、大小、位置
    for (const moof of moofs) {
      let prevEnd = moof.o;
      for (const traf of sub(moof).filter((x) => x.t === "traf")) {
        const tf = sub(traf), tfhd = find(tf, "tfhd"); if (!tfhd) return null;
        const fl = u32(tfhd.body) & 0xffffff, tr = byId[u32(tfhd.body + 4)]; if (!tr) return null;
        const dflt = trex[tr.id] || { dur: 0, size: 0, flags: 0 };
        let p = tfhd.body + 8, base = moof.o;
        if (fl & 1) { base = Number(dv.getBigUint64(p)); p += 8; }
        if (fl & 2) p += 4;
        const defDur = fl & 8 ? u32(p) : dflt.dur; if (fl & 8) p += 4;
        const defSize = fl & 0x10 ? u32(p) : dflt.size; if (fl & 0x10) p += 4;
        const defFlags = fl & 0x20 ? u32(p) : dflt.flags;
        const tfdt = find(tf, "tfdt");
        if (tfdt) tr.cursor = b[tfdt.body] === 1 ? Number(dv.getBigUint64(tfdt.body + 4)) : u32(tfdt.body + 4);
        if (tr.cursor == null) tr.cursor = 0;
        let pos = prevEnd;
        for (const trun of tf.filter((x) => x.t === "trun")) {
          const v = b[trun.body], rf = u32(trun.body) & 0xffffff, n = u32(trun.body + 4);
          let q = trun.body + 8;
          if (rf & 1) { pos = base + i32(q); q += 4; }
          let first = null; if (rf & 4) { first = u32(q); q += 4; }
          for (let i = 0; i < n; i++) {
            const d = rf & 0x100 ? u32(q) : defDur; if (rf & 0x100) q += 4;
            const s = rf & 0x200 ? u32(q) : defSize; if (rf & 0x200) q += 4;
            let f = rf & 0x400 ? u32(q) : i === 0 && first != null ? first : defFlags; if (rf & 0x400) q += 4;
            let c = 0; if (rf & 0x800) { c = v === 1 ? i32(q) : u32(q); q += 4; }
            if (pos < 0 || pos + s > b.length) return null;
            tr.dts.push(tr.cursor); tr.size.push(s); tr.off.push(pos); tr.flags.push(f); tr.cto.push(c);
            tr.cursor += d; pos += s;
          }
        }
        prevEnd = pos;
      }
    }
    if (tracks.some((t) => !t.dts.length)) return null;

    // 小工具：組 box
    const enc = (s) => Uint8Array.from(s, (ch) => ch.charCodeAt(0));
    const cat = (parts) => { let n = 0; for (const x of parts) n += x.length; const out = new Uint8Array(n); let w = 0; for (const x of parts) { out.set(x, w); w += x.length; } return out; };
    const box = (type, ...parts) => { const body = cat(parts), h = new Uint8Array(8); new DataView(h.buffer).setUint32(0, body.length + 8); h.set(enc(type), 4); return cat([h, body]); };
    const u32s = (arr, vf = 0) => { const a = new Uint8Array(4 + arr.length * 4), d = new DataView(a.buffer); d.setUint32(0, vf); arr.forEach((x, i) => d.setUint32(4 + i * 4, x >>> 0)); return a; };
    const patchDur = (src, durOff0, durOff1, val) => {
      const c = src.slice(), d = new DataView(c.buffer);
      if (c[8] === 1) d.setBigUint64(8 + durOff1, BigInt(Math.round(val))); else d.setUint32(8 + durOff0, Math.min(0xffffffff, Math.round(val)));
      return c;
    };

    // 每格的長度：用下一格的時間相減；最後一格沿用前一格
    for (const t of tracks) {
      const n = t.dts.length, d0 = t.dts[0];
      t.start = d0; t.durs = [];
      for (let i = 0; i < n; i++) t.durs.push(i < n - 1 ? Math.max(1, t.dts[i + 1] - t.dts[i]) : (n > 1 ? t.durs[n - 2] : 1));
      t.mediaDur = t.durs.reduce((a, x) => a + x, 0);
      t.emptyMovie = Math.round(t.start / t.ts * movieTs);
      t.trackMovie = t.emptyMovie + Math.round(t.mediaDur / t.ts * movieTs);
    }
    const movieDur = Math.max(...tracks.map((t) => t.trackMovie));

    // 資料依時間順序交錯排進 mdat
    const order = [];
    tracks.forEach((t, ti) => t.dts.forEach((d, i) => order.push([d / t.ts, ti, i])));
    order.sort((a, c) => a[0] - c[0] || a[1] - c[1]);
    let mdatLen = 0; for (const [, ti, i] of order) mdatLen += tracks[ti].size[i];
    if (mdatLen + 8 > 0xffffffff) return null;

    const buildMoov = (chunkOffsets) => {
      const traks = tracks.map((t, ti) => {
        const rle = (arr) => { const out = []; for (const x of arr) { const l = out[out.length - 1]; if (l && l[1] === x) l[0]++; else out.push([1, x]); } return out; };
        const stts = rle(t.durs);
        const parts = [raw(t.stsd), box("stts", u32s([stts.length, ...stts.flat()]))];
        if (t.cto.some((c) => c !== 0)) { const ct = rle(t.cto); parts.push(box("ctts", u32s([ct.length, ...ct.flat()], t.cto.some((c) => c < 0) ? 0x01000000 : 0))); }
        if (t.kind === "vide") { const sync = []; t.flags.forEach((f, i) => { if (!(f & 0x10000)) sync.push(i + 1); }); if (sync.length && sync.length < t.flags.length) parts.push(box("stss", u32s([sync.length, ...sync]))); }
        parts.push(box("stsc", u32s([1, 1, 1, 1])));
        parts.push(box("stsz", u32s([0, t.size.length, ...t.size])));
        parts.push(box("stco", u32s([t.size.length, ...(chunkOffsets ? chunkOffsets[ti] : t.size.map(() => 0))])));
        const stbl = box("stbl", ...parts);
        const minf = box("minf", ...t.minfOther.map(raw), stbl);
        const mdia = box("mdia", patchDur(raw(t.mdhd), 16, 24, t.mediaDur), raw(t.hdlr), minf);
        const tkhd = patchDur(raw(t.tkhd), 20, 28, t.trackMovie);
        const edits = t.emptyMovie > 0 ? [[t.emptyMovie, -1], [t.trackMovie - t.emptyMovie, 0]] : [[t.trackMovie, 0]];
        const el = new Uint8Array(8 + edits.length * 12), ed = new DataView(el.buffer);
        ed.setUint32(4, edits.length);
        edits.forEach(([sd, mt], k) => { ed.setUint32(8 + k * 12, sd); ed.setInt32(12 + k * 12, mt); ed.setUint32(16 + k * 12, 0x00010000); });
        return box("trak", tkhd, box("edts", box("elst", el)), mdia);
      });
      const others = mk.filter((x) => x.t !== "mvhd" && x.t !== "trak" && x.t !== "mvex").map(raw);
      return box("moov", patchDur(raw(mvhd), 16, 24, movieDur), ...traks, ...others);
    };
    const ftyp = box("ftyp", enc("isom"), u32s([0x200]).subarray(4), enc("isomiso2avc1mp41"));
    const moovSize = buildMoov(null).length;
    let w = ftyp.length + moovSize + 8;
    const offsets = tracks.map(() => []);
    for (const [, ti, i] of order) { offsets[ti][i] = w; w += tracks[ti].size[i]; }
    const moovOut = buildMoov(offsets);
    if (moovOut.length !== moovSize) return null;
    const out = new Uint8Array(w), od = new DataView(out.buffer);
    out.set(ftyp, 0); out.set(moovOut, ftyp.length);
    let p = ftyp.length + moovSize;
    od.setUint32(p, mdatLen + 8); out.set(enc("mdat"), p + 4); p += 8;
    for (const [, ti, i] of order) { const t = tracks[ti]; out.set(b.subarray(t.off[i], t.off[i] + t.size[i]), p); p += t.size[i]; }
    return out;
  }
  function fixMp4Duration(b, elapsedMs) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const u32 = (o) => dv.getUint32(o), typ = (o) => String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
    const kids = (start, end) => {
      const list = [];
      for (let o = start; o + 8 <= end;) {
        let size = u32(o), hdr = 8;
        if (size === 1) { size = Number(dv.getBigUint64(o + 8)); hdr = 16; }
        if (size === 0) size = end - o;
        if (size < 8 || o + size > end) break;
        list.push({ o, size, hdr, t: typ(o) });
        o += size;
      }
      return list;
    };
    const top = kids(0, b.length);
    const moov = top.find((x) => x.t === "moov");
    if (!moov) return null;
    // 各軌道：timescale 與實際總長度（從每段 moof 的 tfdt + trun 加總）
    const tracks = {};
    const trex = {};
    const moovKids = kids(moov.o + 8, moov.o + moov.size);
    const mvhd = moovKids.find((x) => x.t === "mvhd");
    const mvex = moovKids.find((x) => x.t === "mvex");
    if (!mvhd) return null;
    const mvVer = b[mvhd.o + 8];
    const movieTs = mvVer === 1 ? u32(mvhd.o + 8 + 20) : u32(mvhd.o + 8 + 12);
    if (mvex) for (const x of kids(mvex.o + 8, mvex.o + mvex.size)) if (x.t === "trex") trex[u32(x.o + 12)] = u32(x.o + 20);
    const traks = moovKids.filter((x) => x.t === "trak").map((t) => {
      const tk = kids(t.o + 8, t.o + t.size);
      const tkhd = tk.find((x) => x.t === "tkhd"), mdia = tk.find((x) => x.t === "mdia");
      const mdhd = mdia && kids(mdia.o + 8, mdia.o + mdia.size).find((x) => x.t === "mdhd");
      const id = tkhd ? (b[tkhd.o + 8] === 1 ? u32(tkhd.o + 8 + 20) : u32(tkhd.o + 8 + 12)) : 0;
      const ts = mdhd ? (b[mdhd.o + 8] === 1 ? u32(mdhd.o + 8 + 20) : u32(mdhd.o + 8 + 12)) : 0;
      tracks[id] = { ts, end: 0 };
      return { tkhd, mdhd, id };
    });
    for (const moof of top.filter((x) => x.t === "moof")) {
      for (const traf of kids(moof.o + 8, moof.o + moof.size).filter((x) => x.t === "traf")) {
        const tk = kids(traf.o + 8, traf.o + traf.size);
        const tfhd = tk.find((x) => x.t === "tfhd"); if (!tfhd) continue;
        const fl = u32(tfhd.o + 8) & 0xffffff, id = u32(tfhd.o + 12);
        let p = tfhd.o + 16; if (fl & 1) p += 8; if (fl & 2) p += 4;
        const defDur = fl & 8 ? u32(p) : (trex[id] || 0);
        const tfdt = tk.find((x) => x.t === "tfdt");
        let t = tfdt ? (b[tfdt.o + 8] === 1 ? Number(dv.getBigUint64(tfdt.o + 12)) : u32(tfdt.o + 12)) : 0;
        for (const trun of tk.filter((x) => x.t === "trun")) {
          const tf = u32(trun.o + 8) & 0xffffff, n = u32(trun.o + 12);
          let q = trun.o + 16; if (tf & 1) q += 4; if (tf & 4) q += 4;
          const per = ((tf & 0x100) ? 4 : 0) + ((tf & 0x200) ? 4 : 0) + ((tf & 0x400) ? 4 : 0) + ((tf & 0x800) ? 4 : 0);
          for (let s = 0; s < n; s++) { t += (tf & 0x100) ? u32(q + s * per) : defDur; }
        }
        if (tracks[id]) tracks[id].end = Math.max(tracks[id].end, t);
      }
    }
    let sec = 0;
    for (const id in tracks) if (tracks[id].ts) sec = Math.max(sec, tracks[id].end / tracks[id].ts);
    if (!(sec > 0)) sec = elapsedMs / 1000;
    if (!(sec > 0)) return null;
    const setDur = (box, val, verOff, v0, v1) => {
      if (!box) return;
      const o = box.o + 8;
      if (b[o] === 1) dv.setBigUint64(o + v1, BigInt(Math.round(val))); else dv.setUint32(o + v0, Math.min(0xffffffff, Math.round(val)));
    };
    setDur(mvhd, sec * movieTs, 0, 16, 24);
    for (const t of traks) {
      const tr = tracks[t.id] || { ts: 0, end: 0 };
      const tsec = tr.ts && tr.end ? tr.end / tr.ts : sec;
      setDur(t.tkhd, tsec * movieTs, 0, 20, 28);
      if (t.mdhd && tr.ts) setDur(t.mdhd, tsec * tr.ts, 0, 16, 24);
    }
    if (!mvex || kids(mvex.o + 8, mvex.o + mvex.size).some((x) => x.t === "mehd")) return b;
    // 在 mvex 裡補上 mehd（分段影片的總長度），並更新 moov、mvex 的大小
    const mehd = new Uint8Array(16), mv = new DataView(mehd.buffer);
    mv.setUint32(0, 16); mehd.set([109, 101, 104, 100], 4); mv.setUint32(8, 0); mv.setUint32(12, Math.round(sec * movieTs));
    if (moov.hdr !== 8 || mvex.hdr !== 8) return b;
    const out = new Uint8Array(b.length + 16);
    const at = mvex.o + 8;
    out.set(b.subarray(0, at), 0); out.set(mehd, at); out.set(b.subarray(at), at + 16);
    const ov = new DataView(out.buffer);
    ov.setUint32(moov.o, moov.size + 16); ov.setUint32(mvex.o, mvex.size + 16);
    return out;
  }
  function fixWebmDuration(b, elapsedMs) {
    if (!(elapsedMs > 0)) return null;
    const vint = (o) => {
      const first = b[o]; let len = 1, mask = 0x80;
      while (len <= 8 && !(first & mask)) { len++; mask >>= 1; }
      if (len > 8) return null;
      let val = first & (mask - 1), unknown = val === mask - 1;
      for (let i = 1; i < len; i++) { val = val * 256 + b[o + i]; if (b[o + i] !== 255) unknown = false; }
      return { len, val, unknown };
    };
    const idAt = (o) => { const v = vint(o); if (!v) return null; let id = 0; for (let i = 0; i < v.len; i++) id = id * 256 + b[o + i]; return { id, len: v.len }; };
    // 找 Segment → Info
    let o = 0;
    while (o < b.length) {
      const id = idAt(o); if (!id) return null; const sz = vint(o + id.len); if (!sz) return null;
      const data = o + id.len + sz.len;
      if (id.id === 0x18538067) { o = data; break; }
      o = data + sz.val;
    }
    const segEnd = b.length;
    while (o < segEnd) {
      const id = idAt(o); if (!id) return null; const sz = vint(o + id.len); if (!sz) return null;
      const data = o + id.len + sz.len;
      if (id.id === 0x1549a966) {
        const infoEnd = data + sz.val;
        let scale = 1000000;
        for (let p = data; p < infoEnd;) {
          const cid = idAt(p), csz = vint(p + cid.len), cd = p + cid.len + csz.len;
          if (cid.id === 0x2ad7b1) { let v = 0; for (let i = 0; i < csz.val; i++) v = v * 256 + b[cd + i]; scale = v || scale; }
          if (cid.id === 0x4489) return null; // 已經有長度
          p = cd + csz.val;
        }
        const dur = new Uint8Array(11), dd = new DataView(dur.buffer);
        dur.set([0x44, 0x89, 0x88], 0); dd.setFloat64(3, elapsedMs * 1e6 / scale);
        const newSize = sz.val + 11;
        const head = new Uint8Array(id.len + 8);
        head.set(b.subarray(o, o + id.len), 0);
        head[id.len] = 0x01; let v = newSize; for (let i = 7; i >= 1; i--) { head[id.len + i] = v & 255; v = Math.floor(v / 256); }
        const out = new Uint8Array(b.length - (id.len + sz.len) + head.length + 11);
        let w = 0;
        out.set(b.subarray(0, o), w); w += o;
        out.set(head, w); w += head.length;
        out.set(b.subarray(data, infoEnd), w); w += infoEnd - data;
        out.set(dur, w); w += 11;
        out.set(b.subarray(infoEnd), w);
        return out;
      }
      if (sz.unknown) return null;
      o = data + sz.val;
    }
    return null;
  }
  /* ---------- 離線逐格輸出（WebCodecs） ----------
     不再「即時錄螢幕」：一格一格畫好、交給瀏覽器的編碼器，聲音也照幀數算好時間點離線合成，
     最後自己組成一般 MP4（H.264 + AAC，播放資訊在檔頭）。
     好處：手機卡頓也不會掉格、音效一定對齊、通常比即時錄更快，檔案長度一定正確。
     瀏覽器不支援（沒有 H.264／AAC 編碼器）或中途出錯時回傳 null，改用舊的即時錄影。 */
  const OFF_VCODECS = ["avc1.42E01F", "avc1.42E028", "avc1.42E032", "avc1.4D401F", "avc1.4D4028", "avc1.640028"];
  const OFF_SR = 48000;
  async function offlineSupport(w, h, fps) {
    if (!window.VideoEncoder || !window.VideoFrame || !window.AudioEncoder || !window.AudioData || !OAC) return null;
    let vcfg = null;
    for (const codec of OFF_VCODECS) {
      const c = { codec, width: w, height: h, bitrate: 6_000_000, framerate: fps, latencyMode: "quality", avc: { format: "avc" } };
      try { const r = await VideoEncoder.isConfigSupported(c); if (r && r.supported) { vcfg = c; break; } } catch {}
    }
    if (!vcfg) return null;
    // 聲音用 AAC（所有播放器都支援）；測試時可用 localStorage rk_encTest = "opus"
    let testOpus = false; try { testOpus = localStorage.getItem("rk_encTest") === "opus"; } catch {}
    const list = testOpus ? ["mp4a.40.2", "opus"] : ["mp4a.40.2"];
    let acfg = null;
    for (const codec of list) {
      const c = { codec, sampleRate: OFF_SR, numberOfChannels: 2, bitrate: 160_000 };
      try { const r = await AudioEncoder.isConfigSupported(c); if (r && r.supported) { acfg = c; break; } } catch {}
    }
    if (!acfg) return null;
    return { vcfg, acfg };
  }
  const toU8 = (x) => (x instanceof ArrayBuffer ? new Uint8Array(x.slice(0)) : new Uint8Array(x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength)));
  const yieldUi = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });

  // 聲音：照時間點把音效（含切斷上一個、變速）和背景音樂混成一段
  async function offlineAudio(events, seconds, bgmUrl, bgmStart) {
    const len = Math.max(1, Math.ceil(seconds * OFF_SR));
    const oc = new OAC(2, len, OFF_SR);
    const master = oc.createGain(); master.gain.value = SFX.vol; master.connect(oc.destination);
    const voices = {};
    for (const e of events) {
      if (!e.buf || e.t >= seconds) continue;
      const src = oc.createBufferSource(); src.buffer = e.buf;
      src.playbackRate.value = Math.max(0.5, Math.min(2, e.rate || 1));
      src.connect(master);
      if (e.choke && voices[e.choke]) { try { voices[e.choke].stop(e.t); } catch {} }
      src.start(e.t);
      if (e.choke) voices[e.choke] = src;
    }
    if (bgmUrl) {
      try {
        const ab = await (await fetch(bgmUrl)).arrayBuffer();
        const buf = await new Promise((ok, bad) => { const p = oc.decodeAudioData(ab, ok, bad); if (p && p.then) p.then(ok, bad); });
        const s = oc.createBufferSource(); s.buffer = buf; s.connect(oc.destination);
        s.start(0, Math.min(Math.max(0, bgmStart || 0), Math.max(0, buf.duration - 0.01)));
      } catch {}
    }
    return await oc.startRendering();
  }

  /* 組一般 MP4。tracks：[{ kind: "vide"|"soun", ts, entry（stsd 裡的樣本描述 box）, samples: [{ data, dur, key }], skip（聲音開頭要略過的樣本數）, w, h }] */
  function mp4Write(tracks) {
    const enc = (s) => Uint8Array.from(s, (ch) => ch.charCodeAt(0));
    const cat = (parts) => { let n = 0; for (const x of parts) n += x.length; const out = new Uint8Array(n); let w = 0; for (const x of parts) { out.set(x, w); w += x.length; } return out; };
    const box = (type, ...parts) => { const body = cat(parts), h = new Uint8Array(8); new DataView(h.buffer).setUint32(0, body.length + 8); h.set(enc(type), 4); return cat([h, body]); };
    const bytes = (n, fill) => { const a = new Uint8Array(n); fill && fill(new DataView(a.buffer)); return a; };
    const u32s = (arr, vf = 0) => bytes(4 + arr.length * 4, (d) => { d.setUint32(0, vf); arr.forEach((x, i) => d.setUint32(4 + i * 4, x >>> 0)); });
    const MTS = 1000;
    const matrix = bytes(36, (d) => { d.setUint32(0, 0x00010000); d.setUint32(16, 0x00010000); d.setUint32(32, 0x40000000); });
    for (const t of tracks) {
      t.mediaDur = t.samples.reduce((a, s) => a + s.dur, 0);
      t.showDur = Math.max(0, t.mediaDur - (t.skip || 0));
      t.movieDur = Math.round(t.showDur / t.ts * MTS);
    }
    const movieDur = Math.max(...tracks.map((t) => t.movieDur));
    const order = [];
    tracks.forEach((t, ti) => { let d = 0; t.samples.forEach((s, i) => { order.push([d / t.ts, ti, i]); d += s.dur; }); });
    order.sort((a, c) => a[0] - c[0] || a[1] - c[1]);
    let mdatLen = 0; for (const [, ti, i] of order) mdatLen += tracks[ti].samples[i].data.length;
    if (mdatLen + 8 > 0xffffffff) throw new Error("影片太大");
    const moovFor = (offsets) => {
      const traks = tracks.map((t, ti) => {
        const vid = t.kind === "vide";
        const tkhd = bytes(84, (d) => {
          d.setUint32(0, 0x00000003); d.setUint32(12, ti + 1); d.setUint32(20, t.movieDur);
          d.setUint16(36, vid ? 0 : 0x0100);
          matrix.forEach((v, i) => d.setUint8(40 + i, v));
          if (vid) { d.setUint32(76, t.w * 65536); d.setUint32(80, t.h * 65536); }
        });
        const edts = t.skip ? box("edts", box("elst", bytes(16, (d) => { d.setUint32(4, 1); d.setUint32(8, t.movieDur); d.setInt32(12, t.skip); }), bytes(4, (d) => d.setUint32(0, 0x00010000)))) : new Uint8Array(0);
        const mdhd = bytes(24, (d) => { d.setUint32(12, t.ts); d.setUint32(16, t.mediaDur); d.setUint16(20, 0x55c4); });
        const hdlr = cat([bytes(8, (d) => d.setUint32(4, 0)), enc(vid ? "vide" : "soun"), bytes(12), enc(vid ? "VideoHandler\0" : "SoundHandler\0")]);
        const xmhd = vid ? box("vmhd", bytes(12, (d) => d.setUint32(0, 1))) : box("smhd", bytes(8));
        const dinf = box("dinf", box("dref", u32s([1]), box("url ", u32s([], 1))));
        const rle = []; for (const s of t.samples) { const l = rle[rle.length - 1]; if (l && l[1] === s.dur) l[0]++; else rle.push([1, s.dur]); }
        const parts = [box("stsd", u32s([1]), t.entry), box("stts", u32s([rle.length, ...rle.flat()]))];
        if (vid) { const sync = []; t.samples.forEach((s, i) => { if (s.key) sync.push(i + 1); }); if (sync.length < t.samples.length) parts.push(box("stss", u32s([sync.length, ...sync]))); }
        parts.push(box("stsc", u32s([1, 1, 1, 1])), box("stsz", u32s([0, t.samples.length, ...t.samples.map((s) => s.data.length)])));
        parts.push(box("stco", u32s([t.samples.length, ...(offsets ? offsets[ti] : t.samples.map(() => 0))])));
        return box("trak", box("tkhd", tkhd), edts, box("mdia", box("mdhd", mdhd), box("hdlr", hdlr), box("minf", xmhd, dinf, box("stbl", ...parts))));
      });
      const mvhd = bytes(100, (d) => { d.setUint32(12, MTS); d.setUint32(16, movieDur); d.setUint32(20, 0x00010000); d.setUint16(24, 0x0100); matrix.forEach((v, i) => d.setUint8(36 + i, v)); d.setUint32(96, tracks.length + 1); });
      return box("moov", box("mvhd", mvhd), ...traks);
    };
    const ftyp = box("ftyp", enc("isom"), u32s([0x200]).subarray(4), enc("isomiso2avc1mp41"));
    const moovSize = moovFor(null).length;
    let w = ftyp.length + moovSize + 8;
    const offsets = tracks.map(() => []);
    for (const [, ti, i] of order) { offsets[ti][i] = w; w += tracks[ti].samples[i].data.length; }
    const moov = moovFor(offsets);
    const out = new Uint8Array(w);
    out.set(ftyp, 0); out.set(moov, ftyp.length);
    let p = ftyp.length + moov.length;
    new DataView(out.buffer).setUint32(p, mdatLen + 8); out.set(enc("mdat"), p + 4); p += 8;
    for (const [, ti, i] of order) { const d = tracks[ti].samples[i].data; out.set(d, p); p += d.length; }
    return out;
  }
  // 樣本描述：H.264（avcC）、AAC（esds）、Opus（dOps，測試用）
  function mp4VideoEntry(w, h, avcC) {
    const b = new Uint8Array(78), d = new DataView(b.buffer);
    d.setUint16(6, 1); d.setUint16(24, w); d.setUint16(26, h); d.setUint32(28, 0x00480000); d.setUint32(32, 0x00480000); d.setUint16(40, 1); d.setUint16(74, 0x0018); d.setInt16(76, -1);
    return mp4Box("avc1", b, mp4Box("avcC", avcC));
  }
  function mp4AudioEntry(type, sr, ch, inner) {
    const b = new Uint8Array(28), d = new DataView(b.buffer);
    d.setUint16(6, 1); d.setUint16(16, ch); d.setUint16(18, 16); d.setUint32(24, sr * 65536);
    return mp4Box(type, b, inner);
  }
  function mp4Box(type, ...parts) {
    let n = 8; for (const x of parts) n += x.length;
    const out = new Uint8Array(n), d = new DataView(out.buffer); d.setUint32(0, n);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    let w = 8; for (const x of parts) { out.set(x, w); w += x.length; }
    return out;
  }
  function aacAsc(sr, ch) {
    const idx = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350].indexOf(sr);
    return new Uint8Array([(2 << 3) | (idx >> 1), ((idx & 1) << 7) | (ch << 3)]);
  }
  function mp4Esds(asc, bitrate) {
    const desc = (tag, body) => { const out = new Uint8Array(2 + body.length); out[0] = tag; out[1] = body.length; out.set(body, 2); return out; };
    const dcd = new Uint8Array(13), d = new DataView(dcd.buffer);
    dcd[0] = 0x40; dcd[1] = 0x15; d.setUint32(5, bitrate); d.setUint32(9, bitrate);
    const dcdFull = desc(0x04, new Uint8Array([...dcd, ...desc(0x05, asc)]));
    const es = desc(0x03, new Uint8Array([0, 1, 0, ...dcdFull, ...desc(0x06, new Uint8Array([2]))]));
    return mp4Box("esds", new Uint8Array(4), es);
  }
  function mp4Dops(head, ch, sr) {
    // WebCodecs 給的是 OpusHead（小端序）；MP4 的 dOps 要大端序
    let pre = 0, rate = sr, gain = 0;
    if (head && head.length >= 19 && String.fromCharCode(...head.subarray(0, 8)) === "OpusHead") {
      const v = new DataView(head.buffer, head.byteOffset, head.byteLength);
      pre = v.getUint16(10, true); rate = v.getUint32(12, true); gain = v.getInt16(16, true);
    }
    const b = new Uint8Array(11), d = new DataView(b.buffer);
    d.setUint8(1, ch); d.setUint16(2, pre); d.setUint32(4, rate); d.setInt16(8, gain);
    return { box: mp4Box("dOps", b), pre };
  }

  /* AAC 編碼器會在開頭多塞一段暖身樣本（各裝置長度不同，約 1024～2112 個）。
     把開頭解碼回來，跟原始聲音比對位置，量出實際延遲，之後用編輯清單（elst）略過。
     量不到（安靜、解碼器不支援、相似度太低）就回傳 null。 */
  async function aacDelay(chunks, desc, pcm) {
    if (!window.AudioDecoder || !window.EncodedAudioChunk) return null;
    const src = pcm.getChannelData(0), sr = OFF_SR, W = Math.round(0.2 * sr);
    // 找前 60 秒內最大聲的一段當比對樣本（對戰開頭常是走位，沒有聲音）
    let best = -1, bestE = 0;
    for (let i = 0; i + W <= Math.min(src.length - 4096, 60 * sr); i += W / 4) { let e = 0; for (let j = i; j < i + W; j += 4) e += src[j] * src[j]; if (e > bestE) { bestE = e; best = i; } }
    if (best < 0 || bestE / (W / 4) < 1e-5) return null;
    const need = best + W + 4096;
    const out = []; let got = 0, err = false;
    const dec = new AudioDecoder({ output: (ad) => { const n = ad.numberOfFrames, b = new Float32Array(n); try { ad.copyTo(b, { planeIndex: 0, format: "f32-planar" }); out.push(b); got += n; } catch { err = true; } ad.close(); }, error: () => { err = true; } });
    try {
      dec.configure({ codec: "mp4a.40.2", sampleRate: sr, numberOfChannels: 2, description: desc });
      let fed = 0;
      for (const c of chunks) { if (fed > need + 4096) break; dec.decode(new EncodedAudioChunk({ type: "key", timestamp: Math.max(0, c.ts), duration: c.dur || 0, data: c.data })); fed += 1024; }
      await dec.flush();
    } catch { err = true; }
    try { dec.close(); } catch {}
    if (err || got < need) return null;
    const y = new Float32Array(got); let w = 0; for (const b of out) { y.set(b, w); w += b.length; }
    let nx = 0; for (let j = 0; j < W; j++) nx += src[best + j] * src[best + j];
    let bc = -1, lag = 0;
    for (let L = 0; L <= 4096; L++) {
      let dot = 0, ny = 0;
      for (let j = 0; j < W; j += 2) { const v = y[best + L + j]; dot += v * src[best + j]; ny += v * v; }
      const c = dot / Math.sqrt((nx / 2) * ny + 1e-12);
      if (c > bc) { bc = c; lag = L; }
    }
    return bc > 0.6 ? lag : null;
  }
  /* 主流程：draw(k) 畫第 k 格；events = [{ t 秒, buf, rate, choke }] */
  async function offlineExport({ canvas, len, fps, draw, events, bgmUrl, bgmStart, progress }) {
    const sup = await offlineSupport(canvas.width, canvas.height, fps);
    if (!sup) return null;
    try { await SFX.ready; } catch {}
    const seconds = len / fps;
    let failed = null;
    // 1. 畫面
    const vts = Math.round(fps * 1000), vdur = 1000;
    const vChunks = []; let avcC = null;
    const venc = new VideoEncoder({
      output: (chunk, meta) => {
        if (meta && meta.decoderConfig && meta.decoderConfig.description) avcC = toU8(meta.decoderConfig.description);
        const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
        vChunks.push({ ts: chunk.timestamp, key: chunk.type === "key", data });
      },
      error: (e) => { failed = e; },
    });
    venc.configure(sup.vcfg);
    const gop = Math.max(1, Math.round(fps * 2));
    for (let k = 0; k < len; k++) {
      if (failed) break;
      draw(k);
      const vf = new VideoFrame(canvas, { timestamp: Math.round(k * 1e6 / fps), duration: Math.round(1e6 / fps) });
      venc.encode(vf, { keyFrame: k % gop === 0 }); vf.close();
      while (venc.encodeQueueSize > 6 && !failed) await new Promise((r) => setTimeout(r, 1));
      if (k % 3 === 0) { progress(k / len * 0.9, k); await yieldUi(); }
    }
    if (!failed) await venc.flush().catch((e) => { failed = e; });
    try { venc.close(); } catch {}
    if (failed || !avcC || !vChunks.length) return null;
    vChunks.sort((a, b) => a.ts - b.ts);
    if (!vChunks[0].key) return null;
    // 2. 聲音
    progress(0.92, len - 1);
    const pcm = await offlineAudio(events, seconds, bgmUrl, bgmStart);
    const aChunks = []; let adesc = null;
    const aenc = new AudioEncoder({
      output: (chunk, meta) => {
        if (meta && meta.decoderConfig && meta.decoderConfig.description) adesc = toU8(meta.decoderConfig.description);
        const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
        aChunks.push({ ts: chunk.timestamp, dur: chunk.duration, data });
      },
      error: (e) => { failed = e; },
    });
    aenc.configure(sup.acfg);
    const ch0 = pcm.getChannelData(0), ch1 = pcm.numberOfChannels > 1 ? pcm.getChannelData(1) : ch0;
    const BLOCK = 4096;
    for (let i = 0; i < pcm.length && !failed; i += BLOCK) {
      const n = Math.min(BLOCK, pcm.length - i), buf = new Float32Array(n * 2);
      buf.set(ch0.subarray(i, i + n), 0); buf.set(ch1.subarray(i, i + n), n);
      const ad = new AudioData({ format: "f32-planar", sampleRate: OFF_SR, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(i * 1e6 / OFF_SR), data: buf });
      aenc.encode(ad); ad.close();
      if (aenc.encodeQueueSize > 20) await new Promise((r) => setTimeout(r, 1));
    }
    if (!failed) await aenc.flush().catch((e) => { failed = e; });
    try { aenc.close(); } catch {}
    if (failed || !aChunks.length) return null;
    aChunks.sort((a, b) => a.ts - b.ts);
    progress(0.97, len - 1);
    // 3. 組檔
    const aac = sup.acfg.codec.startsWith("mp4a");
    const frameLen = aac ? 1024 : 960;
    const aSamples = aChunks.map((c) => ({ data: c.data, dur: c.dur ? Math.max(1, Math.round(c.dur * OFF_SR / 1e6)) : frameLen }));
    let aEntry, skip = 0;
    if (aac) {
      aEntry = mp4AudioEntry("mp4a", OFF_SR, 2, mp4Esds(adesc && adesc.length >= 2 ? adesc : aacAsc(OFF_SR, 2), sup.acfg.bitrate));
      const asc = adesc && adesc.length >= 2 ? adesc : aacAsc(OFF_SR, 2);
      if (aChunks[0].ts < 0) skip = Math.round(-aChunks[0].ts * OFF_SR / 1e6); // 編碼器自己標示的暖身樣本
      const measured = await aacDelay(aChunks, asc, pcm).catch(() => null);
      if (measured != null) skip = measured; // 實際量到的延遲最準
    } else {
      const d = mp4Dops(adesc, 2, OFF_SR); aEntry = mp4AudioEntry("Opus", OFF_SR, 2, d.box); skip = d.pre;
    }
    // 聲音不比畫面長
    const want = Math.round(seconds * OFF_SR) + skip;
    let acc = 0; const aKeep = [];
    for (const s of aSamples) { if (acc + s.dur > want && aKeep.length) break; aKeep.push(s); acc += s.dur; }
    const file = mp4Write([
      { kind: "vide", ts: vts, w: canvas.width, h: canvas.height, entry: mp4VideoEntry(canvas.width, canvas.height, avcC), samples: vChunks.map((c, i) => ({ data: c.data, key: c.key, dur: i < vChunks.length - 1 ? Math.max(1, Math.round((vChunks[i + 1].ts - c.ts) * vts / 1e6)) : vdur })) },
      { kind: "soun", ts: OFF_SR, entry: aEntry, samples: aKeep, skip },
    ]);
    progress(1, len - 1);
    return new Blob([file], { type: "video/mp4" });
  }
  // 音效時間表 → 離線用的事件
  function pickMime() {
    if (!window.MediaRecorder) return null;
    const list = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4;codecs=avc1.42E01E", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
    return list.find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }) || "";
  }
  /* 共用錄影（單人、雙人都用）：先試離線逐格輸出（WebCodecs），不支援或失敗才改用即時錄影（MediaRecorder，錄完補上影片長度）。
     o.canvas／o.len（格數）／o.fps／o.draw(k)：畫第 k 格
     o.offEvents：逐格輸出用的音效 [{ t 秒, buf, rate, choke }]；o.live：即時錄影用的音效 { list, len, play }
     o.status：顯示進度的元素；o.badge：「錄製中」徽章；o.buttons：錄影時停用的按鈕；o.busy(on)：設定「錄影中」狀態
     o.onFrame(k)：顯示目前第幾格；o.fileBase：檔名（不含副檔名）；o.noSupport：瀏覽器不能錄影時的訊息 */
  async function recordCanvas(o) {
    const { canvas, len, fps, status, badge } = o;
    const lock = (on) => { o.busy(on); badge.hidden = !on; if (!on) badge.textContent = "● 錄製中"; o.buttons.forEach((b) => (b.disabled = on)); };
    const bgm = { bgmUrl: S.audioUrl, bgmStart: +$("audioStart").value || 0 };
    lock(true);
    let offBlob = null;
    try {
      status.textContent = "準備輸出…";
      offBlob = await offlineExport({
        canvas, len, fps, draw: o.draw, events: o.offEvents, ...bgm,
        progress: (f, k) => { const pc = Math.round(f * 100); status.textContent = `輸出中 ${pc}%（逐格輸出，不用等即時播放）`; badge.textContent = `● 輸出中 ${pc}%`; o.onFrame(k); },
      });
    } catch { offBlob = null; }
    lock(false);
    if (offBlob) { await offerFile(offBlob, o.fileBase + ".mp4", status); return; }
    // 即時錄影：照真實時間播放一次，邊播邊錄
    const mime = pickMime();
    if (mime === null || !canvas.captureStream) { status.textContent = o.noSupport; return; }
    const stream = canvas.captureStream(fps);
    const mix = await sfxBeginRecord(bgm.bgmUrl, bgm.bgmStart);
    if (mix.track) stream.addTrack(mix.track);
    let rec;
    try { rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 6_000_000 } : undefined); }
    catch { sfxEndRecord(mix); status.textContent = "無法啟動錄影。"; return; }
    const chunks = []; rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const done = new Promise((r) => (rec.onstop = r));
    lock(true);
    status.textContent = `錄製中…約 ${(len / fps).toFixed(1)} 秒`;
    o.draw(0); rec.start(250); const recT0 = performance.now();
    if (mix.audioEl) { try { await mix.audioEl.play(); } catch {} }
    const t0 = performance.now(), rst = {};
    await new Promise((resolve) => {
      const step = () => {
        const kf = (performance.now() - t0) / 1000 * fps, k = Math.floor(kf);
        if (k >= len) return resolve();
        o.draw(k);
        sfxRun(rst, o.live.list, kf, fps, o.live.len, o.live.play); o.onFrame(k);
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    await new Promise((r) => setTimeout(r, 150));
    rec.stop(); await done; const recMs = performance.now() - recT0;
    sfxEndRecord(mix);
    lock(false);
    const type = (rec.mimeType || mime || "video/webm").split(";")[0];
    const ext = type.includes("mp4") ? "mp4" : "webm";
    status.textContent = "整理影片中…";
    await offerFile(await fixVideoDuration(new Blob(chunks, { type }), type, recMs), `${o.fileBase}.${ext}`, status);
  }
