/* Beatboard: a phone bingo card for music-guessing games played at the table.
   Solo: just the card. Table: join by code, lock in guesses, reveal together. */
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

  // ---------- the card (always local to this phone) ----------
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

  // ---------- app state ----------
  let mode = store.get("bb_mode") || "home"; // home | solo | table
  let table = null; // state from the table host
  let lastRound = null;
  let busy = false;
  let status = null;
  let confirmNew = 0;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function toast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2600);
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

  // ---------- rendering ----------
  function render() {
    const a = document.activeElement;
    const focusId = a && a.id;
    const sel = a && a.selectionStart != null ? [a.selectionStart, a.selectionEnd] : null;
    if (mode === "solo") renderCard(false);
    else if (mode === "table" && table && table.me) renderCard(true);
    else renderHome();
    if (focusId) {
      const el = document.getElementById(focusId);
      if (el && !el.readOnly) { el.focus(); if (sel && el.setSelectionRange) try { el.setSelectionRange(...sel); } catch {} }
    }
    showStatus();
  }

  function renderHome() {
    $top.textContent = "";
    $app.innerHTML = `
      <div class="panel">
        <h2>Your bingo card, on your phone</h2>
        <p class="muted" style="margin-top:0">Write your guess, lock it in, and cross off squares. Everyone at the table opens this page on their own phone.</p>
        <label for="name">Your name</label>
        <input id="name" maxlength="20" autocomplete="nickname" value="${esc(store.get("bb_name") || "")}" />
        <p></p>
        <button id="hostBtn" class="primary big" ${busy ? "disabled" : ""}>Start a table</button>
        <div class="or">or join one</div>
        <div class="row">
          <input id="code" class="code-input" maxlength="4" autocomplete="off" placeholder="CODE" value="${esc(params.get("code") || "")}" />
          <button id="joinBtn" class="alt" ${busy ? "disabled" : ""}>Join</button>
        </div>
      </div>
      <p class="center"><button id="soloBtn" class="ghost">Just the card, no table</button></p>`;
    const name = () => { const n = document.getElementById("name").value.trim(); if (n) store.set("bb_name", n); return n; };
    document.getElementById("hostBtn").onclick = () => { const n = name(); if (!n) return toast("Enter your name first."); startTable(n); };
    document.getElementById("joinBtn").onclick = () => {
      const n = name(); const code = document.getElementById("code").value.trim().toUpperCase();
      if (!n) return toast("Enter your name first.");
      if (code.length !== 4) return toast("Enter the 4-letter code.");
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
      buttons = `<button id="lockBtn" class="${locked ? "ghost" : "primary"}">${locked ? "Unlock" : "Lock in"}</button><button id="wipeBtn" class="ghost">Wipe</button>`;
    } else if (!t.revealed) {
      const active = t.players.filter((p) => p.connected);
      const n = active.filter((p) => p.locked).length;
      buttons = locked ? `<button id="unlockBtn" class="ghost">Unlock</button>` : `<button id="lockBtn" class="primary">Lock in</button>`;
      if (t.isHost) buttons += `<button id="revealBtn" class="alt">Reveal now</button>`;
      hint = `${n} of ${active.length} locked in. Guesses show when everyone has locked in.`;
    } else {
      buttons = t.isHost ? `<button id="nextBtn" class="primary">Next round</button>` : "";
      hint = t.isHost ? "Check the answer, cross off your squares, then start the next round." : "Guesses revealed! Cross off your squares. The next round starts when the host taps Next round.";
    }
    return `<div class="panel" style="padding:12px">
      <div class="slate ${locked ? "locked" : ""}">
        <textarea id="answer" maxlength="120" placeholder="Write your guess…" aria-label="Your guess" ${locked ? "readonly" : ""}>${esc(text)}</textarea>
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
      <div class="meta"><span>${n} of ${N * N} crossed</span><span>Tap a square to cross it off</span></div>
      <div id="grid" class="cgrid" aria-label="Bingo card">${card.colors.map((c, i) =>
        `<div class="cell c${c} ${card.crossed[i] ? "x" : ""} ${win.has(i) ? "win" : ""}" data-i="${i}" role="button" aria-pressed="${card.crossed[i]}" aria-label="Square ${i + 1}"></div>`).join("")}</div>`;
  }

  function tableHtml() {
    const t = table;
    return `<div class="panel">
      <h2>At the table</h2>
      <ul class="people">${t.players.map((p) => {
        const ans = p.answer
          ? `<span class="ans ${t.revealed ? "shown" : ""}">${esc(p.answer)}</span>`
          : `<span class="ans">${p.locked ? "🔒 locked in" : t.revealed ? "–" : "thinking…"}</span>`;
        return `<li class="${p.connected ? "" : "off"}">
          <span class="who">${esc(p.name)}${p.id === t.me.id ? " (you)" : ""}</span>
          ${ans}
          <span class="score">${p.bingo ? `<span class="tag">BINGO</span>` : `${p.crossed}/25`}</span>
          ${t.isHost && !p.host ? `<button class="kick" data-kick="${p.id}" title="Remove from table">✕</button>` : ""}
        </li>`;
      }).join("")}</ul>
      <p class="hint">Others join with code <b>${esc(t.code)}</b> on this page.</p>
    </div>`;
  }

  function renderCard(inTable) {
    if (inTable) {
      $top.innerHTML = `Table <b>${esc(table.code)}</b> · Round ${table.round}`;
    } else {
      $top.textContent = "";
    }
    $app.innerHTML = `
      ${slateHtml(inTable)}
      ${gridHtml()}
      ${inTable ? tableHtml() : ""}
      <p class="center" style="margin-top:20px; display:flex; gap:10px; justify-content:center; flex-wrap:wrap">
        <button id="newBtn" class="ghost small">New card</button>
        <button id="leaveBtn" class="ghost small">${inTable ? "Leave table" : "Back"}</button>
      </p>
      ${inTable && table.isHost ? `<p class="hint">Keep this page open: the table runs on your phone.</p>` : ""}`;

    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
    const answer = document.getElementById("answer");
    if (!answer.readOnly) answer.oninput = () => { card.draft = answer.value; saveCard(); };
    on("lockBtn", async () => {
      if (!card.draft.trim()) return toast("Write a guess first.");
      if (!inTable) { card.locked = true; saveCard(); return render(); }
      await send("lock", { answer: card.draft });
    });
    on("unlockBtn", () => send("unlock"));
    on("wipeBtn", () => { card.draft = ""; card.locked = false; saveCard(); render(); document.getElementById("answer").focus(); });
    if (!inTable && card.locked) on("lockBtn", () => { card.locked = false; saveCard(); render(); });
    on("revealBtn", () => send("host:reveal"));
    on("nextBtn", () => send("host:next"));
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
      if (Date.now() - confirmNew > 3000) { confirmNew = Date.now(); b.textContent = "Tap again for a new card"; return; }
      confirmNew = 0;
      const draft = card.draft, locked = card.locked;
      card = freshCard(); card.draft = draft; card.locked = locked;
      afterCardChange(); toast("Fresh card!");
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

  // ---------- table networking ----------
  function setBusy(b, label) {
    busy = b;
    document.querySelectorAll("#joinBtn, #hostBtn").forEach((x) => (x.disabled = b));
    if (b && label) toast(label);
    if (!b) { clearTimeout(toast.t); document.getElementById("toast").hidden = true; }
  }
  const progress = () => ({ crossed: card.crossed.filter(Boolean).length, bingo: winningLines().length > 0 });

  async function startTable(name, code) {
    setBusy(true, code ? "Reopening your table…" : "Starting a table…");
    let saved = null;
    if (code) { try { saved = JSON.parse(store.get("bb_room_" + code)); } catch {} }
    try {
      const res = await Net.host({ token, code, saved });
      store.set("bb_code", res.code); store.set("bb_role", "host"); setMode("table");
      await Net.request("join", { name, token });
      await Net.request("progress", progress());
    } catch (e) {
      if (code) forgetTable();
      setBusy(false); toast(e.message); return;
    }
    setBusy(false);
  }

  async function joinTable(code, name) {
    setBusy(true, "Connecting…");
    try {
      await Net.join(code);
      const res = await send("join", { name, token });
      if (!res.ok) { Net.leave(); setBusy(false); render(); return; }
      store.set("bb_code", code); store.set("bb_role", "player"); setMode("table");
      Net.request("progress", progress());
    } catch (e) {
      if (!name || mode === "table") forgetTable();
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
    if (params.get("code") && history.replaceState) history.replaceState(null, "", location.pathname);
    render();
  });
  Net.on("status", (msg) => { status = msg; showStatus(); });
  Net.on("reconnected", async () => {
    await Net.request("join", { token, name: store.get("bb_name") });
    Net.request("progress", progress());
  });
  Net.on("kicked", () => { Net.leave(); forgetTable(); toast("You were removed from the table."); render(); });

  // Pick up where we left off after a refresh.
  const savedCode = store.get("bb_code");
  const linkCode = (params.get("code") || "").toUpperCase();
  if (linkCode && linkCode !== savedCode) { if (mode === "table") setMode("home"); }
  render();
  if (mode === "table" && savedCode && (!linkCode || linkCode === savedCode)) {
    if (store.get("bb_role") === "host") startTable(store.get("bb_name") || "Host", savedCode);
    else joinTable(savedCode, store.get("bb_name"));
  } else if (mode === "table") { setMode("home"); render(); }
})();
