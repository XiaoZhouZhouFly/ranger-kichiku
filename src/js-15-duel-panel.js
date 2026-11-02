  /* 真距離／原始數值設定面板 */
  function renderRealPanel() {
    const hasStats = !!(S.stats && Object.keys(S.stats).length);
    const wantRaw = isRaw();
    const real = isSim();
    $("rRerunHint").textContent = rerunHint(D.type);
    document.querySelectorAll("#dKinds .chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.kind === D.type)));
    $("realBox").hidden = !real;
    $("realLbl").textContent = wantRaw ? "原始數值設定" : "真距離設定";
    $("classicHint").hidden = real;
    $("rRawMissing").hidden = !(wantRaw && !hasStats);
    const zero = [0, 1].filter((i) => D.f[i] && hasStats && wantRaw && !(statAt((S.stats[D.f[i].r.id] || {}).hp, 1, 1) > 1)).map((i) => D.f[i].r.name);
    $("rZeroWarn").hidden = !zero.length;
    $("rZeroWarn").textContent = zero.length ? `「${zero.join("」「")}」在資料庫裡沒有自己的體力數值（多半是召喚物或主角），原始數值對戰會一碰就倒。可以用金手指自己填數值。` : "";
    $("rawBox").hidden = !(wantRaw && hasStats);
    $("rCompHint").hidden = wantRaw;
    $("movesBox").hidden = wantRaw;
    $("rTime").value = D.timeLimit;
    const hm = D.hpMul || 1;
    document.querySelectorAll("#rHpMul .chip").forEach((c) => c.setAttribute("aria-pressed", String(+c.dataset.hpmul === hm)));
    $("rHpMulIn").value = [1, 5, 10, 20].includes(hm) ? "" : hm;
    for (const i of [0, 1]) {
      if (!D.f[i]) continue;
      $(`rRange${i}`).value = rangeOf(i);
      $(`rRange${i}`).placeholder = defaultRange(i);
      $(`rMove${i}`).value = moveOf(i);
      $(`rMove${i}`).placeholder = defaultMove(i);
      $(`rMvName${i}`).textContent = D.f[i].r.name;
      const lim = levelLimits((S.stats[D.f[i].r.id] || {}).s || D.f[i].r.star);
      $(`rLv${i}`).max = lim.max;
      $(`rLv${i}`).value = Math.min(lim.max, D.level[i] || lim.max);
      $(`rLvMax${i}`).textContent = `／${lim.max}`;
      $(`rName${i}`).textContent = D.f[i].r.name;
    }
    if (wantRaw) renderCheat();
  }
  function renderCheat() {
    const box = $("cheatGrid"); if (!box || !D.f[0] || !D.f[1]) return;
    box.textContent = "";
    for (const i of [0, 1]) {
      const sv = rawStats(i);
      const col = document.createElement("div"); col.className = "cheat-col " + (i ? "is-b" : "is-a");
      const h = document.createElement("strong"); h.textContent = (i ? "右方・" : "左方・") + D.f[i].r.name + `（Lv ${sv.level}）`;
      col.appendChild(h);
      for (const [k, label] of CHEAT_FIELDS) {
        const l = document.createElement("label"); l.className = "field";
        l.textContent = label;
        const inp = document.createElement("input"); inp.type = "number"; inp.id = `ch${i}_${k}`; inp.step = "any";
        inp.value = Number.isInteger(sv[k]) ? sv[k] : +(+sv[k]).toFixed(2);
        if ((D.cheat[i] || {})[k] !== undefined) l.classList.add("changed");
        inp.onchange = () => {
          D.cheat[i] = D.cheat[i] || {};
          if (k === "rg") { D.range[i] = inp.value === "" ? null : +inp.value; delete D.cheat[i].rg; }
          else if (k === "mv") { D.mvs[i] = inp.value === "" ? null : Math.max(1, +inp.value); delete D.cheat[i].mv; }
          else D.cheat[i][k] = inp.value === "" ? undefined : +inp.value;
          realChanged();
        };
        l.appendChild(inp); col.appendChild(l);
      }
      // 技能：發動率、冷卻、傷害倍率
      const baseSk = (S.stats[D.f[i].r.id] || {}).sk || [];
      for (const sIdx of [0, 1]) {
        const base = baseSk[sIdx], eff = sv.sk[sIdx];
        const head = document.createElement("span"); head.className = "cheat-sk";
        const nm = (D.f[i].skills && D.f[i].skills[sIdx] && D.f[i].skills[sIdx].name) || "";
        head.textContent = `技能${sIdx + 1}` + (nm ? "・" + nm : "") + (base ? (eff.e.length ? "" : "（輔助）") : "：沒有這個技能");
        col.appendChild(head);
        if (!base) continue;
        const ovs = () => { D.cheat[i] = D.cheat[i] || {}; D.cheat[i].sk = D.cheat[i].sk || [{}, {}]; D.cheat[i].sk[sIdx] = D.cheat[i].sk[sIdx] || {}; return D.cheat[i].sk[sIdx]; };
        const cur = (((D.cheat[i] || {}).sk || [])[sIdx]) || {};
        const addField = (label, value, changed, onset) => {
          const l = document.createElement("label"); l.className = "field"; l.textContent = label;
          const inp = document.createElement("input"); inp.type = "number"; inp.step = "any"; inp.min = "0";
          inp.value = value === "" ? "" : +(+value).toFixed(2);
          if (changed) l.classList.add("changed");
          inp.onchange = () => { onset(inp.value === "" ? undefined : +inp.value); realChanged(); };
          l.appendChild(inp); col.appendChild(l);
        };
        addField("發動率 %", eff.r, cur.r !== undefined, (v) => { ovs().r = v; });
        addField("冷卻（秒）", eff.cd, cur.cd !== undefined, (v) => { ovs().cd = v; });
        const setC = (n, v) => { const o = ovs(); o.c = o.c || []; o.c[n] = v; };
        if (base.e.length) {
          base.e.forEach((x, n) => {
            const label = x.t === "dot" ? `持續傷害 %／秒（${x.d} 秒）` : `單擊倍率 %` + (base.e.length > 1 ? `（第 ${n + 1} 段）` : "");
            addField(label, eff.e[n].c * 100, cur.c && cur.c[n] !== undefined, (v) => setC(n, v));
          });
        } else {
          addField("單擊倍率 %（空白＝輔助）", cur.c && cur.c[0] > 0 ? cur.c[0] : "", cur.c && cur.c[0] !== undefined, (v) => setC(0, v));
        }
      }
      const mult = document.createElement("div"); mult.className = "cheat-mult";
      const lab = document.createElement("span"); lab.textContent = "體力／攻防 ×"; mult.appendChild(lab);
      for (const n of [10, 100, 1000]) {
        const b = document.createElement("button"); b.className = "btn small"; b.textContent = "×" + n;
        b.onclick = () => applyMult(i, n); mult.appendChild(b);
      }
      const ni = document.createElement("input"); ni.type = "number"; ni.min = "0"; ni.step = "any"; ni.placeholder = "自訂"; ni.id = `chMul${i}`; ni.setAttribute("aria-label", "自訂倍率");
      const go = document.createElement("button"); go.className = "btn small"; go.textContent = "套用";
      go.onclick = () => { if (+ni.value > 0) applyMult(i, +ni.value); };
      mult.append(ni, go); col.appendChild(mult);
      const reset = document.createElement("button"); reset.className = "btn small"; reset.textContent = "恢復資料庫數值";
      reset.onclick = () => { D.cheat[i] = {}; D.range[i] = null; D.mvs[i] = null; realChanged(); }; // 只還原這一邊
      col.appendChild(reset);
      box.appendChild(col);
    }
  }
  function applyMult(i, n) {
    const sv = rawStats(i);
    D.cheat[i] = D.cheat[i] || {};
    for (const k of STAT5) D.cheat[i][k] = Math.round(sv[k] * n);
    realChanged();
  }
  function realChanged() { compileDuel(); saveDuel(); renderRealPanel(); }
  function setKind(kind) {
    setDuelSetting("type", kind);
    realChanged(); renderMoves(); setDuelMode(D.mode, false);
  }


  document.querySelectorAll("#dKinds .chip").forEach((c) => (c.onclick = () => setKind(c.dataset.kind)));
  document.querySelectorAll("#rHpMul .chip").forEach((c) => (c.onclick = () => { D.hpMul = +c.dataset.hpmul; realChanged(); }));
  $("rHpMulIn").onchange = () => { setDuelSetting("hpMul", $("rHpMulIn").value); realChanged(); };
  $("rTime").onchange = () => { setDuelSetting("timeLimit", $("rTime").value); realChanged(); };
  for (const i of [0, 1]) {
    $(`rRange${i}`).onchange = () => { setDuelSetting("range", $(`rRange${i}`).value, i); realChanged(); };
    $(`rMove${i}`).onchange = () => { setDuelSetting("mvs", $(`rMove${i}`).value, i); realChanged(); };
    $(`rLv${i}`).onchange = () => {
      D.level[i] = Math.max(1, +$(`rLv${i}`).value || 1);
      if (D.cheat[i]) for (const k of STAT5) delete D.cheat[i][k]; // 換等級時，體力攻防改回依等級計算
      realChanged();
    };
  }
  for (const [id, key] of [["dSumCap", "sumCap"], ["dSumAtk", "sumAtk"], ["dSumHp", "sumHp"]]) {
    $(id).onchange = () => { setDuelSetting(key, $(id).value.trim()); syncDuelInputs(); realChanged(); };
  }
  $("rRangeReset").onclick = () => { D.range = settingDef(SETTING.range); D.mvs = settingDef(SETTING.mvs); realChanged(); };
  /* 對戰類型下方的兩顆按鈕：三種類型共用，依目前類型決定做什麼 */
  const RERUN_WHAT = {
    classic: "招式編排類型不變，換一組傷害浮動；隨機對打會再抽一套招式順序",
    real: "招式編排類型不變，重抽發動率、爆擊、閃避等機率；隨機對打會再抽一套招式順序",
    raw: "重抽發動率、爆擊、閃避等機率",
  };
  const rerunHint = (type) => `重新對戰：${RERUN_WHAT[type]}。全部恢復預設：${resetLabels(type)}。`;
  // 全部恢復預設：還原哪些設定由設定表的 reset 決定
  $("rResetAll").onclick = () => {
    resetDuelSettings(D.type);
    syncDuelInputs(); realChanged(); renderMoves();
    $("dStatus").textContent = `已恢復預設：${resetLabels(D.type)}。`;
  };
  $("rRerun").onclick = () => {
    // 原始數值不看招式編排；經典、真距離保留編排類型，隨機對打再抽一套順序，自定義與你來我往的招式不動
    if (!isRaw() && D.mode === "random") D.moves = presetRandomDuel();
    D.seed = newSeed(100000);
    realChanged(); renderMoves();
  };

