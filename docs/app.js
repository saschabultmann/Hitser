/* Beatboard: Bingokarte fürs Handy für Musik-Ratespiele am Tisch.
   Solo: nur die Karte. Tisch: per Code oder Link beitreten, Tipps einloggen, gemeinsam aufdecken. */
(() => {
  const Net = window.BBNet;
  const N = 5;
  const $app = document.getElementById("app");
  const $top = document.getElementById("topInfo");
  const params = new URLSearchParams(location.search);

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };
  let token = store.get("bb_token");
  if (!token) { token = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set("bb_token", token); }

  // ---------- die Karte (bleibt auf diesem Handy) ----------
  function freshCard() {
    const colors = [];
    for (let c = 1; c <= N; c++) for (let i = 0; i < N; i++) colors.push(c);
    for (let i = colors.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [colors[i], colors[j]] = [colors[j], colors[i]]; }
    return { colors, crossed: colors.map(() => false), lines: 0, draft: "", locked: false };
  }
  let card;
  try { card = JSON.parse(store.get("bb_card")); } catch {}
  if (!card || !Array.isArray(card.colors) || card.colors.length !== N * N) card = freshCard();
  const saveCard = () => store.set("bb_card", JSON.stringify(card));

  function winningLines() {
    const lines = [];
    for (let i = 0; i < N; i++) {
      const row = [], col = [];
      for (let j = 0; j < N; j++) { row.push(i * N + j); col.push(j * N + i); }
      lines.push(row, col);
    }
    lines.push([...Array(N)].map((_, i) => i * N + i), [...Array(N)].map((_, i) => i * N + (N - 1 - i)));
    return lines.filter((l) => l.every((i) => card.crossed[i]));
  }

  // ---------- Zustand ----------
  // Einladungslink: ?tisch=CODE (alte Links mit ?code=CODE gehen auch)
  const inviteCode = (params.get("tisch") || params.get("code") || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
  let mode = store.get("bb_mode") || "home"; // home | solo | table
  let table = null;
  let lastRound = null;
  let busy = false;
  let status = null;
  let confirmNew = 0;
  let invite = inviteCode.length === 4 ? inviteCode : null; // Einladung, die noch nicht angenommen ist

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function toast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2800);
  }
  function confetti() {
    const c = document.createElement("div"); c.className = "confetti";
    const colors = ["#33c47a", "#3fb5f0", "#b061e0", "#f2e24a", "#f2549c"];
    for (let i = 0; i < 80; i++) {
      const p = document.createElement("i");
      p.style.left = Math.random() * 100 + "vw"; p.style.background = colors[i % colors.length];
      p.style.animationDelay = Math.random() * 0.8 + "s"; c.appendChild(p);
    }
    document.body.appendChild(c); setTimeout(() => c.remove(), 3800);
  }
  async function send(ev, data) {
    const res = (await Net.request(ev, data || {})) || {};
    if (!res.ok && res.error) toast(res.error);
    return res;
  }
  function setMode(m) { mode = m; store.set("bb_mode", m); }
  const shareUrl = (code) => `${location.origin}${location.pathname}?tisch=${code}`;

  async function share(code) {
    const url = shareUrl(code);
    const text = `Komm an meinen Bingo-Tisch! Code: ${code}`;
    if (navigator.share) {
      try { await navigator.share({ title: "Beatboard", text, url }); return; } catch (e) { if (e && e.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(url); toast("Link kopiert. Schick ihn deinen Freunden!"); }
    catch { window.prompt("Diesen Link teilen:", url); }
  }

  // Bildschirm anlassen, solange man am Tisch sitzt (beim Gastgeber läuft dort der Tisch).
  let wakeLock = null;
  async function keepAwake() {
    if (mode !== "table" || !("wakeLock" in navigator) || wakeLock) return;
    try { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => (wakeLock = null)); } catch {}
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") keepAwake(); });

  // ---------- Anzeige ----------
  function render() {
    const a = document.activeElement;
    const focusId = a && a.id;
    const sel = a && a.selectionStart != null ? [a.selectionStart, a.selectionEnd] : null;
    if (mode === "solo") renderCard(false);
    else if (mode === "table" && table && table.me) renderCard(true);
    else if (invite) renderInvite();
    else renderHome();
    if (focusId) {
      const el = document.getElementById(focusId);
      if (el && !el.readOnly) { el.focus(); if (sel && el.setSelectionRange) try { el.setSelectionRange(...sel); } catch {} }
    }
    showStatus();
  }

  function renderInvite() {
    $top.textContent = "";
    $app.innerHTML = `
      <div class="panel">
        <h2>Du bist an Tisch <span style="color:var(--gold);letter-spacing:.12em">${esc(invite)}</span> eingeladen</h2>
        <p class="muted" style="margin-top:0">Gib deinen Namen ein und setz dich dazu.</p>
        <label for="name">Dein Name</label>
        <input id="name" maxlength="20" autocomplete="nickname" value="${esc(store.get("bb_name") || "")}" />
        <p></p>
        <button id="joinBtn" class="primary big" ${busy ? "disabled" : ""}>Beitreten</button>
      </div>
      <p class="center"><button id="otherBtn" class="ghost small">Lieber einen eigenen Tisch</button></p>`;
    const go = () => {
      const n = document.getElementById("name").value.trim();
      if (!n) return toast("Bitte gib deinen Namen ein.");
      store.set("bb_name", n);
      joinTable(invite, n);
    };
    document.getElementById("joinBtn").onclick = go;
    document.getElementById("name").onkeydown = (e) => { if (e.key === "Enter") go(); };
    document.getElementById("otherBtn").onclick = () => { invite = null; clearInviteFromUrl(); render(); };
  }

  function renderHome() {
    $top.textContent = "";
    $app.innerHTML = `
      <div class="panel">
        <h2>Deine Bingokarte aufs Handy</h2>
        <p class="muted" style="margin-top:0">Tipp aufschreiben, einloggen, Felder ankreuzen. Jeder am Tisch öffnet diese Seite auf seinem eigenen Handy, egal wo er ist.</p>
        <label for="name">Dein Name</label>
        <input id="name" maxlength="20" autocomplete="nickname" value="${esc(store.get("bb_name") || "")}" />
        <p></p>
        <button id="hostBtn" class="primary big" ${busy ? "disabled" : ""}>Tisch starten</button>
        <div class="or">oder einem Tisch beitreten</div>
        <div class="row">
          <input id="code" class="code-input" maxlength="4" autocomplete="off" placeholder="CODE" />
          <button id="joinBtn" class="alt" ${busy ? "disabled" : ""}>Beitreten</button>
        </div>
      </div>
      <p class="center"><button id="soloBtn" class="ghost">Nur die Karte, ohne Tisch</button></p>`;
    const name = () => { const n = document.getElementById("name").value.trim(); if (n) store.set("bb_name", n); return n; };
    document.getElementById("hostBtn").onclick = () => { const n = name(); if (!n) return toast("Bitte gib zuerst deinen Namen ein."); startTable(n); };
    document.getElementById("joinBtn").onclick = () => {
      const n = name(); const code = document.getElementById("code").value.trim().toUpperCase();
      if (!n) return toast("Bitte gib zuerst deinen Namen ein.");
      if (code.length !== 4) return toast("Bitte gib den 4-stelligen Code ein.");
      joinTable(code, n);
    };
    document.getElementById("code").onkeydown = (e) => { if (e.key === "Enter") document.getElementById("joinBtn").click(); };
    document.getElementById("soloBtn").onclick = () => { setMode("solo"); render(); };
  }

  function slateHtml(inTable) {
    const t = table, me = t && t.me;
    const locked = inTable ? me.locked : card.locked;
    const text = inTable && locked ? me.answer : card.draft;
    let buttons = "", hint = "";
    if (!inTable) {
      buttons = `<button id="lockBtn" class="${locked ? "ghost" : "primary"}">${locked ? "Entsperren" : "Einloggen"}</button><button id="wipeBtn" class="ghost">Wegwischen</button>`;
    } else if (!t.revealed) {
      const active = t.players.filter((p) => p.connected);
      const n = active.filter((p) => p.locked).length;
      buttons = locked ? `<button id="unlockBtn" class="ghost">Entsperren</button>` : `<button id="lockBtn" class="primary">Einloggen</button>`;
      if (t.isHost) buttons += `<button id="revealBtn" class="alt">Jetzt aufdecken</button>`;
      hint = `${n} von ${active.length} eingeloggt. Die Tipps werden gezeigt, sobald alle eingeloggt haben.`;
    } else {
      buttons = t.isHost ? `<button id="nextBtn" class="primary">Nächste Runde</button>` : "";
      hint = t.isHost ? "Lösung prüfen, Felder ankreuzen, dann die nächste Runde starten." : "Tipps aufgedeckt! Kreuz deine Felder an. Die nächste Runde startet der Gastgeber.";
    }
    return `<div class="panel" style="padding:12px">
      <div class="slate ${locked ? "locked" : ""}">
        <textarea id="answer" maxlength="120" placeholder="Schreib deinen Tipp …" aria-label="Dein Tipp" ${locked ? "readonly" : ""}>${esc(text)}</textarea>
        ${locked ? `<span class="badge">🔒</span>` : ""}
      </div>
      ${buttons ? `<div class="actions">${buttons}</div>` : ""}
      ${hint ? `<p class="hint">${hint}</p>` : ""}
    </div>`;
  }

  function gridHtml() {
    const lines = winningLines();
    const win = new Set(lines.flat());
    const n = card.crossed.filter(Boolean).length;
    return `
      ${lines.length ? `<div class="banner">🎉 Bingo!${lines.length > 1 ? ` ×${lines.length}` : ""}</div>` : ""}
      <div class="meta"><span>${n} von ${N * N} angekreuzt</span><span>Feld antippen zum Ankreuzen</span></div>
      <div id="grid" class="cgrid" aria-label="Bingokarte">${card.colors.map((c, i) =>
        `<div class="cell c${c} ${card.crossed[i] ? "x" : ""} ${win.has(i) ? "win" : ""}" data-i="${i}" role="button" aria-pressed="${card.crossed[i]}" aria-label="Feld ${i + 1}"></div>`).join("")}</div>`;
  }

  function tableHtml() {
    const t = table;
    return `<div class="panel">
      <h2>Am Tisch</h2>
      <ul class="people">${t.players.map((p) => {
        const ans = p.answer
          ? `<span class="ans ${t.revealed ? "shown" : ""}">${esc(p.answer)}</span>`
          : `<span class="ans">${p.locked ? "🔒 eingeloggt" : t.revealed ? "–" : "überlegt …"}</span>`;
        return `<li class="${p.connected ? "" : "off"}">
          <span class="who">${esc(p.name)}${p.id === t.me.id ? " (du)" : ""}</span>
          ${ans}
          <span class="score">${p.bingo ? `<span class="tag">BINGO</span>` : `${p.crossed}/25`}</span>
          ${t.isHost && !p.host ? `<button class="kick" data-kick="${p.id}" title="Vom Tisch entfernen">✕</button>` : ""}
        </li>`;
      }).join("")}</ul>
      <div class="share">
        <div class="muted">Freunde einladen: Code <b>${esc(t.code)}</b> oder Link</div>
        <button id="shareBtn" class="alt">Einladungslink teilen</button>
      </div>
    </div>`;
  }

  function renderCard(inTable) {
    if (inTable) {
      $top.innerHTML = `Tisch <b>${esc(table.code)}</b> · Runde ${table.round}`;
    } else {
      $top.textContent = "";
    }
    $app.innerHTML = `
      ${slateHtml(inTable)}
      ${gridHtml()}
      ${inTable ? tableHtml() : ""}
      <p class="center" style="margin-top:20px; display:flex; gap:10px; justify-content:center; flex-wrap:wrap">
        <button id="newBtn" class="ghost small">Neue Karte</button>
        <button id="leaveBtn" class="ghost small">${inTable ? "Tisch verlassen" : "Zurück"}</button>
      </p>
      ${inTable && table.isHost ? `<p class="hint">Lass diese Seite offen: Der Tisch läuft auf deinem Handy.</p>` : ""}`;

    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
    const answer = document.getElementById("answer");
    if (!answer.readOnly) answer.oninput = () => { card.draft = answer.value; saveCard(); };
    on("lockBtn", async () => {
      if (!card.draft.trim()) return toast("Schreib zuerst deinen Tipp.");
      if (!inTable) { card.locked = true; saveCard(); return render(); }
      await send("lock", { answer: card.draft });
    });
    if (!inTable && card.locked) on("lockBtn", () => { card.locked = false; saveCard(); render(); });
    on("unlockBtn", () => send("unlock"));
    on("wipeBtn", () => { card.draft = ""; card.locked = false; saveCard(); render(); document.getElementById("answer").focus(); });
    on("revealBtn", () => send("host:reveal"));
    on("nextBtn", () => send("host:next"));
    on("shareBtn", () => share(table.code));
    $app.querySelectorAll("[data-kick]").forEach((b) => (b.onclick = () => send("host:kick", { playerId: b.dataset.kick })));

    document.getElementById("grid").onclick = (e) => {
      const el = e.target.closest("[data-i]");
      if (!el) return;
      const i = Number(el.dataset.i);
      card.crossed[i] = !card.crossed[i];
      afterCardChange();
    };
    on("newBtn", () => {
      const b = document.getElementById("newBtn");
      if (Date.now() - confirmNew > 3000) { confirmNew = Date.now(); b.textContent = "Nochmal tippen für neue Karte"; return; }
      confirmNew = 0;
      const draft = card.draft, locked = card.locked;
      card = freshCard(); card.draft = draft; card.locked = locked;
      afterCardChange(); toast("Neue Karte!");
    });
    on("leaveBtn", () => {
      if (inTable) leaveTable(); else setMode("home");
      render();
    });
  }

  function afterCardChange() {
    const lines = winningLines().length;
    if (lines > card.lines) { confetti(); if (navigator.vibrate) navigator.vibrate([80, 60, 160]); }
    card.lines = lines;
    saveCard();
    render();
    if (mode === "table" && table) Net.request("progress", { crossed: card.crossed.filter(Boolean).length, bingo: lines > 0 });
  }

  // ---------- Verbindung zum Tisch ----------
  function setBusy(b, label) {
    busy = b;
    document.querySelectorAll("#joinBtn, #hostBtn").forEach((x) => (x.disabled = b));
    if (b && label) toast(label);
    if (!b) { clearTimeout(toast.t); document.getElementById("toast").hidden = true; }
  }
  const progress = () => ({ crossed: card.crossed.filter(Boolean).length, bingo: winningLines().length > 0 });
  function clearInviteFromUrl() {
    const q = new URLSearchParams(location.search);
    if (!q.has("tisch") && !q.has("code")) return;
    q.delete("tisch"); q.delete("code");
    const rest = q.toString();
    if (history.replaceState) history.replaceState(null, "", location.pathname + (rest ? "?" + rest : ""));
  }

  async function startTable(name, code) {
    setBusy(true, code ? "Dein Tisch wird wieder geöffnet …" : "Tisch wird gestartet …");
    let saved = null;
    if (code) { try { saved = JSON.parse(store.get("bb_room_" + code)); } catch {} }
    try {
      const res = await Net.host({ token, code, saved });
      store.set("bb_code", res.code); store.set("bb_role", "host"); setMode("table");
      await Net.request("join", { name, token });
      await Net.request("progress", progress());
      keepAwake();
    } catch (e) {
      if (code) forgetTable();
      setBusy(false); toast(e.message); render(); return;
    }
    setBusy(false);
  }

  async function joinTable(code, name) {
    setBusy(true, "Verbinde …");
    try {
      await Net.join(code);
      const res = await send("join", { name, token });
      if (!res.ok) { Net.leave(); setBusy(false); render(); return; }
      store.set("bb_code", code); store.set("bb_role", "player"); setMode("table");
      invite = null; clearInviteFromUrl();
      Net.request("progress", progress());
      keepAwake();
    } catch (e) {
      if (mode === "table") forgetTable();
      setBusy(false); toast(e.message); render(); return;
    }
    setBusy(false);
  }

  function forgetTable() {
    const code = store.get("bb_code");
    if (store.get("bb_role") === "host" && code) store.del("bb_room_" + code);
    store.del("bb_code"); store.del("bb_role");
    if (mode === "table") setMode("home");
    table = null; status = null; lastRound = null;
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  }
  function leaveTable() { Net.leave(); forgetTable(); }

  function showStatus() {
    let el = document.getElementById("status");
    if (!status) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement("div"); el.id = "status"; el.className = "status"; document.body.prepend(el); }
    el.textContent = status;
  }

  Net.on("state", (s) => {
    if (lastRound !== null && s.round !== lastRound) { card.draft = ""; card.locked = false; saveCard(); }
    lastRound = s.round;
    table = s;
    render();
  });
  Net.on("status", (msg) => { status = msg; showStatus(); });
  Net.on("reconnected", async () => {
    await Net.request("join", { token, name: store.get("bb_name") });
    Net.request("progress", progress());
  });
  Net.on("kicked", () => { Net.leave(); forgetTable(); toast("Du wurdest vom Tisch entfernt."); render(); });

  // Nach einem Neuladen weitermachen.
  const savedCode = store.get("bb_code");
  if (invite && invite === savedCode && mode === "table") { invite = null; clearInviteFromUrl(); }
  if (invite && mode === "solo") setMode("home");
  if (invite && mode === "table") { // Einladung zu einem anderen Tisch: alten verlassen
    if (store.get("bb_role") === "host") store.del("bb_room_" + savedCode);
    store.del("bb_code"); store.del("bb_role"); setMode("home");
  }
  render();
  if (mode === "table" && store.get("bb_code")) {
    if (store.get("bb_role") === "host") startTable(store.get("bb_name") || "Gastgeber", store.get("bb_code"));
    else joinTable(store.get("bb_code"), store.get("bb_name"));
  } else if (mode === "table") { setMode("home"); render(); }
  else if (invite && store.get("bb_name")) joinTable(invite, store.get("bb_name")); // Name bekannt: direkt rein
})();
