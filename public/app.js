/* Beatboard client: one page, three screens (home, host, player). */
(() => {
  const socket = io();
  const $app = document.getElementById("app");
  const $top = document.getElementById("topInfo");

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };
  let token = store.get("bb_token");
  if (!token) { token = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set("bb_token", token); }

  let state = null; // last state from the server
  let draft = { title: "", artist: "", year: "" };
  let draftRound = 0;
  let peek = false; // host: show the current song on screen
  let lastWinners = 0;
  const params = new URLSearchParams(location.search);

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function toast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2800);
  }
  function emit(ev, data) {
    return new Promise((resolve) => socket.emit(ev, data || {}, (res) => {
      if (res && !res.ok) toast(res.error);
      resolve(res || {});
    }));
  }
  function confetti() {
    const c = document.createElement("div"); c.className = "confetti";
    const colors = ["#ff5fa2", "#3ee0c4", "#ffd166", "#9b7bff"];
    for (let i = 0; i < 80; i++) {
      const p = document.createElement("i");
      p.style.left = Math.random() * 100 + "vw";
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = Math.random() * 0.8 + "s";
      c.appendChild(p);
    }
    document.body.appendChild(c); setTimeout(() => c.remove(), 3800);
  }

  // ---------- rendering ----------
  function render() {
    // Keep focus and cursor in inputs across re-renders.
    const a = document.activeElement;
    const focusId = a && a.id; const sel = a && a.selectionStart != null ? [a.selectionStart, a.selectionEnd] : null;
    if (!state) renderHome(); else if (state.isHost) renderHost(); else renderPlayer();
    if (focusId) { const el = document.getElementById(focusId); if (el) { el.focus(); if (sel && el.setSelectionRange) try { el.setSelectionRange(...sel); } catch {} } }
  }

  function renderHome() {
    $top.textContent = "";
    $app.innerHTML = `
      <section class="hero">
        <h1>Guess the song. Fill your board.</h1>
        <p class="muted">A party game for one room: the host plays music, everyone guesses on their phone.</p>
      </section>
      <div class="grid2">
        <div class="panel">
          <h2>Join a game</h2>
          <label for="code">Game code</label>
          <input id="code" class="code-input" maxlength="4" autocomplete="off" value="${esc(params.get("code") || "")}" />
          <label for="name">Your name</label>
          <input id="name" maxlength="20" autocomplete="nickname" value="${esc(store.get("bb_name") || "")}" />
          <p></p><button id="joinBtn" class="primary big">Join</button>
        </div>
        <div class="panel">
          <h2>Host a game</h2>
          <ol class="steps">
            <li>Create a game and share the code.</li>
            <li>Play each song on your speaker (Spotify, YouTube, records).</li>
            <li>Players type title, artist and year, then lock in.</li>
            <li>Reveal: correct guesses let players fill a square.</li>
            <li>First full row, column or diagonal shouts Bingo!</li>
          </ol>
          <button id="hostBtn" class="alt big">Create a game</button>
        </div>
      </div>`;
    document.getElementById("joinBtn").onclick = async () => {
      const code = document.getElementById("code").value.trim().toUpperCase();
      const name = document.getElementById("name").value.trim();
      if (code.length !== 4) return toast("Enter the 4-letter code.");
      if (!name) return toast("Enter your name.");
      store.set("bb_name", name);
      const res = await emit("join", { code, name, token });
      if (res.ok) store.set("bb_code", code);
    };
    document.getElementById("name").onkeydown = (e) => { if (e.key === "Enter") document.getElementById("joinBtn").click(); };
    document.getElementById("hostBtn").onclick = async () => {
      const res = await emit("host:create", { token });
      if (res.ok) store.set("bb_code", res.code);
    };
  }

  function playerChips(s) {
    if (!s.players.length) return `<p class="muted">Waiting for players to join…</p>`;
    return `<ul class="players">${s.players.map((p) => `
      <li class="chip ${p.connected ? "" : "off"} ${p.locked && s.phase === "playing" ? "locked" : ""} ${p.bingo ? "bingo" : ""}">
        ${esc(p.name)} <span class="muted">${p.filledCount}/16</span>
        ${s.phase === "playing" ? (p.locked ? "🔒" : "…") : ""}
        ${s.isHost && s.phase === "lobby" ? `<button data-kick="${p.id}" title="Remove">✕</button>` : ""}
      </li>`).join("")}</ul>`;
  }

  function songBlock(song, spinning) {
    return `<div class="song">
      <div class="vinyl ${spinning ? "spin" : ""}"></div>
      ${song ? `<div class="title">${esc(song.title)}</div><div class="artist">${esc(song.artist)}</div><div class="year">${esc(song.year)}</div>` : ""}
    </div>`;
  }

  function winnersBanner(s) {
    if (!s.winners.length) return "";
    return `<div class="banner">🎉 Bingo! ${s.winners.map(esc).join(", ")}</div>`;
  }

  function renderHost() {
    const s = state;
    $top.innerHTML = `Host · Round ${s.round}/${s.totalSongs}`;
    const joinUrl = `${location.origin}${location.pathname}?code=${s.code}`;
    const locked = s.players.filter((p) => p.locked).length;
    let main = "";
    if (s.phase === "lobby") {
      main = `
        <div class="panel">
          <h2>Songs</h2>
          <p class="muted">Using <b>${esc(s.deckName)}</b> (${s.totalSongs} songs). To use your own, paste one per line as <code>Title - Artist - Year</code>. Leave empty to go back to the starter deck.</p>
          <textarea id="deck" placeholder="Wonderwall - Oasis - 1995"></textarea>
          <p></p><button id="deckBtn" class="ghost">Use these songs</button>
        </div>
        <button id="nextBtn" class="primary big" ${s.players.length ? "" : "disabled"}>Start with the first song</button>`;
    } else if (s.phase === "playing") {
      const q = encodeURIComponent(`${s.song.title} ${s.song.artist}`);
      main = `
        <div class="panel center">
          <h2>Now playing: song ${s.round}</h2>
          ${songBlock(peek ? s.song : null, true)}
          <div class="row" style="justify-content:center">
            <button id="peekBtn" class="ghost">${peek ? "Hide song" : "Show song (host only)"}</button>
            <a href="https://open.spotify.com/search/${q}" target="_blank" rel="noopener">Play on Spotify</a>
            <a href="https://www.youtube.com/results?search_query=${q}" target="_blank" rel="noopener">Play on YouTube</a>
          </div>
          <p class="muted">${locked}/${s.players.length} players locked in</p>
          <button id="revealBtn" class="alt big">Reveal the answer</button>
        </div>`;
    } else if (s.phase === "reveal" || s.phase === "ended") {
      const rows = s.players.map((p) => {
        const a = p.answer, r = p.result;
        const mark = (v) => (v ? `<span class="ok">✓</span>` : `<span class="no">✗</span>`);
        const tog = (f) => s.phase === "reveal" && r ? `<button class="ghost toggle" data-ov="${p.id}" data-field="${f}" title="Flip this result">flip</button>` : "";
        if (!a) return `<tr><td>${esc(p.name)}</td><td colspan="3" class="muted">No answer</td><td>${p.filledThisRound ? "✓" : ""}</td></tr>`;
        return `<tr>
          <td>${esc(p.name)}</td>
          <td>${r ? mark(r.title) : ""} ${esc(a.title) || "<span class='muted'>–</span>"} ${tog("title")}</td>
          <td>${r ? mark(r.artist) : ""} ${esc(a.artist) || "<span class='muted'>–</span>"} ${tog("artist")}</td>
          <td>${esc(a.year) || "–"} ${r && r.yearDiff != null ? `<span class="muted">(${r.yearDiff === 0 ? "exact" : "off by " + r.yearDiff})</span>` : ""}</td>
          <td>${p.filledThisRound ? "✓" : ""}</td></tr>`;
      }).join("");
      main = `
        <div class="panel">
          ${s.song ? songBlock(s.song, false) : ""}
          <div class="table-wrap"><table>
            <tr><th>Player</th><th>Title</th><th>Artist</th><th>Year</th><th>Filled</th></tr>${rows}
          </table></div>
          <p class="muted">Typos are matched loosely. Use “flip” if you want to accept or reject an answer by hand.</p>
        </div>
        ${s.phase === "reveal" ? `<button id="nextBtn" class="primary big" ${s.round >= s.totalSongs ? "disabled" : ""}>Next song</button>` : `<div class="banner">Game over</div>`}`;
    }
    $app.innerHTML = `
      ${winnersBanner(s)}
      <div class="panel center">
        <div class="muted">Join at <a href="${esc(joinUrl)}">${esc(joinUrl)}</a> with code</div>
        <div class="code">${s.code}</div>
      </div>
      <div class="panel"><h2>Players (${s.players.length})</h2>${playerChips(s)}</div>
      ${main}
      ${s.phase !== "ended" && s.phase !== "lobby" ? `<p class="center"><button id="endBtn" class="ghost">End game</button></p>` : ""}`;

    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
    on("nextBtn", () => { peek = false; emit("host:next"); });
    on("revealBtn", () => emit("host:reveal"));
    on("peekBtn", () => { peek = !peek; render(); });
    on("endBtn", () => emit("host:end"));
    on("deckBtn", async () => {
      const res = await emit("host:deck", { text: document.getElementById("deck").value });
      if (res.ok) toast(`Loaded ${res.count} songs${res.errors.length ? `, skipped ${res.errors.length} lines` : ""}.`);
    });
    $app.querySelectorAll("[data-ov]").forEach((b) => (b.onclick = () => emit("host:override", { playerId: b.dataset.ov, field: b.dataset.field })));
    $app.querySelectorAll("[data-kick]").forEach((b) => (b.onclick = () => emit("host:kick", { playerId: b.dataset.kick })));
  }

  function boardHtml(me, squares) {
    return `<div class="board">${me.board.map((sq, i) => {
      const el = me.eligible.includes(i);
      return `<div class="sq ${sq.filled ? "filled" : ""} ${el ? "eligible" : ""}" ${el ? `data-fill="${i}" role="button" tabindex="0"` : ""}>${esc(squares[sq.key])}</div>`;
    }).join("")}</div>`;
  }

  function renderPlayer() {
    const s = state, me = s.me;
    if (!me) return renderHome();
    $top.innerHTML = `${esc(me.name)} · ${s.code}${s.round ? ` · Round ${s.round}` : ""}`;
    if (draftRound !== s.round) { draft = { title: "", artist: "", year: "" }; draftRound = s.round; }
    let top = "";
    if (s.phase === "lobby") {
      top = `<div class="panel center"><h2>You're in!</h2><p class="muted">Waiting for the host to start. ${s.players.length} player${s.players.length === 1 ? "" : "s"} here.</p></div>`;
    } else if (s.phase === "playing" && !me.locked) {
      top = `<div class="panel">
        <h2>Song ${s.round}: what is it?</h2>
        <label for="aTitle">Title</label><input id="aTitle" maxlength="80" autocomplete="off" value="${esc(draft.title)}" />
        <label for="aArtist">Artist</label><input id="aArtist" maxlength="80" autocomplete="off" value="${esc(draft.artist)}" />
        <label for="aYear">Year</label><input id="aYear" inputmode="numeric" maxlength="4" autocomplete="off" value="${esc(draft.year)}" />
        <p></p><button id="lockBtn" class="primary big">Lock in</button>
        <p class="muted center">You can't change your answer after locking in.</p>
      </div>`;
    } else if (s.phase === "playing") {
      const a = me.answer || {};
      top = `<div class="panel center"><h2>🔒 Locked in</h2>
        <p>${esc(a.title) || "–"} · ${esc(a.artist) || "–"} · ${esc(a.year) || "–"}</p>
        <p class="muted">Waiting for the reveal…</p></div>`;
    } else if (s.phase === "reveal") {
      const r = me.result;
      const mark = (v, t) => `<span class="${v ? "ok" : "no"}">${v ? "✓" : "✗"} ${t}</span>`;
      const msg = !r ? "You didn't lock in an answer this round."
        : me.filledThisRound ? "Square filled. Wait for the next song."
        : me.eligible.length ? "Tap a glowing square to fill it." : "No square this time. Next song coming up!";
      top = `<div class="panel">${songBlock(s.song, false)}
        ${r ? `<div class="result-line">${mark(r.title, "Title")}${mark(r.artist, "Artist")}${mark(r.yearDiff === 0, r.yearDiff == null ? "Year" : r.yearDiff === 0 ? "Year exact" : `Year off by ${r.yearDiff}`)}</div>` : ""}
        <p class="center"><b>${msg}</b></p></div>`;
    } else {
      top = `<div class="panel center"><h2>Game over</h2><p class="muted">Thanks for playing!</p>
        <button id="leaveBtn" class="ghost">Back to start</button></div>`;
    }
    $app.innerHTML = `${winnersBanner(s)}${me.bingo ? `<div class="banner">You have Bingo! 🎶</div>` : ""}${top}
      <div class="panel"><h2 class="center">Your board</h2>${boardHtml(me, s.squares)}</div>
      <div class="panel"><h2>Players</h2>${playerChips(s)}</div>`;

    const bind = (id, k) => { const el = document.getElementById(id); if (el) el.oninput = () => (draft[k] = el.value); };
    bind("aTitle", "title"); bind("aArtist", "artist"); bind("aYear", "year");
    const lock = document.getElementById("lockBtn");
    if (lock) lock.onclick = () => emit("player:lock", draft);
    $app.querySelectorAll("input").forEach((i) => (i.onkeydown = (e) => { if (e.key === "Enter" && lock) lock.click(); }));
    $app.querySelectorAll("[data-fill]").forEach((el) => {
      const go = async () => { const res = await emit("player:fill", { index: Number(el.dataset.fill) }); if (res.bingo && res.ok) confetti(); };
      el.onclick = go; el.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") go(); };
    });
    const leave = document.getElementById("leaveBtn");
    if (leave) leave.onclick = () => { store.del("bb_code"); state = null; render(); };
  }

  // ---------- socket wiring ----------
  socket.on("state", (s) => {
    if (s.winners.length > lastWinners && state) { if (!s.me || !s.me.bingo) toast(`Bingo for ${s.winners[s.winners.length - 1]}!`); }
    lastWinners = s.winners.length;
    state = s;
    if (history.replaceState && params.get("code")) history.replaceState(null, "", location.pathname);
    render();
  });
  socket.on("kicked", () => { store.del("bb_code"); state = null; toast("The host removed you from the game."); render(); });
  socket.on("connect", async () => {
    const code = store.get("bb_code");
    if (code && !(params.get("code") && params.get("code").toUpperCase() !== code)) {
      const res = await new Promise((r) => socket.emit("join", { code, token, name: store.get("bb_name") }, r));
      if (!res.ok) { store.del("bb_code"); state = null; render(); }
    }
  });
  render();
})();
