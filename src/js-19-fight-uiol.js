  /* ---------- 格鬥場新版介面 C 段（v7.6）：線上對戰三步驟畫面 ----------
     規格：「格鬥場改版_圖檔與施作說明」§4.6（圖 06、07、10）。只有新版介面使用。
     只換「畫面」：開房、加入、準備、離開都還是去按原本的按鈕（fOnCreate／fOnJoin／fOnReady／fOnLeave），
     連線流程、房號格式（4 個英數字）、同步檢查都沒有改。原本的線上對戰區塊在新版裡藏起來（還在頁面上）。
     畫面：還沒進房＝模式卡＋「加入房間」卡（4 格房號）＋底部「建立房間」；
           進房後＝步驟條＋房號卡（複製連結、QR Code、離開）＋狀態＋雙方角色卡＋「遇到問題？」＋底部「我準備好了」。 */
  function fuiOlBind() {
    const boxes = [...document.querySelectorAll("#fxOlBoxes input")];
    const clean = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const fill = (s, from) => { [...s].slice(0, 4 - from).forEach((ch, k) => (boxes[from + k].value = ch)); boxes[Math.min(3, from + s.length)].focus(); };
    const join = () => { $("fOnCode").value = boxes.map((b) => b.value).join(""); $("fOnJoin").click(); };
    boxes.forEach((b, i) => {
      // 逐格自動跳下一格；一次進來好幾個字（輸入法、貼上）就往後填
      b.addEventListener("input", () => { const v = clean(b.value); if (v.length > 1) { b.value = ""; fill(v, i); } else { b.value = v; if (v && boxes[i + 1]) boxes[i + 1].focus(); } });
      b.addEventListener("keydown", (e) => { if (e.key === "Backspace" && !b.value && boxes[i - 1]) { boxes[i - 1].value = ""; boxes[i - 1].focus(); e.preventDefault(); } else if (e.key === "Enter") join(); });
      b.addEventListener("paste", (e) => { e.preventDefault(); boxes.forEach((x) => (x.value = "")); fill(clean((e.clipboardData || window.clipboardData).getData("text")).slice(0, 4), 0); });
      b.addEventListener("focus", () => b.select());
    });
    $("fxOlJoinBtn").onclick = join;
    $("fxOlMain").onclick = () => { const act = $("fxOlMain").dataset.act; $(act === "create" ? "fOnCreate" : act === "leave" ? "fOnLeave" : "fOnReady").click(); };
    $("fxOlLeave").onclick = () => $("fOnLeave").click();
    const copy = async (text, msgEl, ok) => { try { await navigator.clipboard.writeText(text); msgEl.textContent = ok; } catch { msgEl.textContent = text; } };
    $("fxOlCopy").onclick = () => copy(olShareUrl(), $("fxOlCopied"), "已複製連結，傳給朋友就能加入");
    $("fxOlQrBtn").onclick = () => { const q = $("fxOlQr"); q.hidden = !q.hidden; if (!q.hidden) q.innerHTML = $("fOnQr").innerHTML; };
    $("fxOlLog").onclick = () => copy(olReport(), $("fxOlLogMsg"), "已複製，貼給開發者即可");
    // 原本的訊息欄（建立失敗、加入失敗、載入失敗…）有變化就更新新版畫面
    const mo = new MutationObserver(() => fuiOl());
    for (const id of ["fOnStatus", "fOnReadyMsg", "fOnQr"]) mo.observe($(id), { childList: true, characterData: true, subtree: true });
  }
  function fuiOl() {
    if (!fuiOn() || !FG.set) return;
    const online = FG.set.mode === "online", inRoom = online && !!OL.code, box = $("fxSetup");
    box.classList.toggle("is-inroom", inRoom); box.classList.toggle("is-oljoin", online && !inRoom);
    $("fxOlRoom").hidden = !inRoom; $("fxOlJoin").hidden = !online || inRoom; $("fxOlBar").hidden = !online; $("fxOlHelp").hidden = !online;
    if (!online) return;
    const main = $("fxOlMain"), set = (act, text, sub, off) => { main.dataset.act = act; $("fxOlMainT").textContent = text; $("fxOlMainS").textContent = sub; main.disabled = !!off; };
    if (!inRoom) {
      const msg = $("fOnStatus").textContent, busy = /中…$/.test(msg), bad = /失敗/.test(msg);
      $("fxOlMsg").textContent = bad || busy ? msg : ""; $("fxOlMsg").classList.toggle("is-bad", bad);
      $("fxOlCopied").textContent = ""; $("fxOlQr").hidden = true;
      set("create", "建立房間", "建立後把房號或連結傳給朋友", busy);
      return;
    }
    const other = olOther(), mine = olMine(), connected = !!(OL.link && OL.link.ready), host = OL.side === 0;
    const closed = /關閉/.test(OL.status || ""), hashBad = !!(mine && other && mine.h && other.h && mine.h !== other.h);
    const step = !connected ? 0 : !(other && other.id && mine && mine.id) ? 1 : 2;
    document.querySelectorAll("#fxOlSteps li").forEach((li, k) => { li.classList.toggle("is-done", k < step); li.classList.toggle("is-now", k === step); if (k === step) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current"); });
    $("fxOlCode").textContent = OL.code;
    $("fxOlQrBtn").hidden = !$("fOnQr").innerHTML; if ($("fxOlQrBtn").hidden) $("fxOlQr").hidden = true;
    // 狀態：[文字, 顏色 ok／wait／bad]
    const st = closed ? ["房間已關閉（房主離開了）", "bad"] : hashBad ? ["雙方的角色資料不一樣，請兩邊都重新整理頁面", "bad"]
      : !connected ? [host ? (OL.room && OL.room.guest ? "對手已加入，連線中…" : "等待對手加入") : "連線中…", "wait"]
      : !other || !other.id ? ["對手已加入，正在選角色", "ok"] : other.ready && mine && mine.ready ? ["雙方都準備好了，開打！", "ok"] : other.ready ? ["對手已準備", "ok"] : ["對手已選好角色，還沒準備", "ok"];
    $("fxOlStatus").className = "fx-olstatus is-" + st[1]; $("fxOlStatusT").textContent = st[0];
    $("fxOlNote").textContent = connected && /轉送/.test(OL.status || "") ? "轉送模式：直連失敗，延遲會比較高" : !host && connected ? "回合數與秒數由房主決定" : "";
    if (closed) set("leave", "回到開房", "房間已經關閉", false);
    else if (!connected) set("ready", "我準備好了", host ? "等待對手加入…" : "連線中…", true);
    else if (!other || !other.id) set("ready", "我準備好了", "等待對手選角色…", true);
    else if (mine && mine.ready) set("ready", "取消準備", other.ready ? "雙方都準備好了，開打！" : "等對手按下準備", false);
    else set("ready", "我準備好了", other.ready ? "對手已準備，就等你了" : "雙方都按下就會開打", hashBad);
  }
