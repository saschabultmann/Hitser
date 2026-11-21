// Peer-to-peer networking with PeerJS (WebRTC). The host's browser holds the
// Room; players connect to it directly. PeerJS's free public broker is only
// used to find each other, so the game works on static hosting like GitHub Pages.
(function (root) {
  const PREFIX = "beatboard-v1-";
  const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const listeners = {};
  const emitLocal = (ev, x) => (listeners[ev] || []).forEach((fn) => fn(x));

  // Optional: ?peerhost=localhost&peerport=9000 to use your own PeerJS server.
  function peerOptions() {
    const q = new URLSearchParams(location.search);
    const host = q.get("peerhost");
    if (!host) return { debug: 0 };
    return { host, port: Number(q.get("peerport") || 9000), path: q.get("peerpath") || "/", secure: q.get("peersecure") === "1", debug: 0 };
  }
  const randomCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");

  let mode = null; // "host" | "player"
  let peer = null;
  let room = null;
  let hostToken = null;
  const conns = new Set(); // host: open player connections
  let conn = null; // player: connection to host
  let playerCode = null;
  let reqId = 0;
  const pending = new Map();
  let retryTimer = null;

  // ---------------- host ----------------
  function host({ token, code, saved }) {
    mode = "host";
    hostToken = token;
    return new Promise((resolve, reject) => {
      const tryCode = (c, attempts) => {
        const p = new root.Peer(PREFIX + c, peerOptions());
        p.on("open", () => {
          peer = p;
          room = new root.BBRoom(c, token, saved && saved.code === c ? saved : null);
          room.onChange = pushState;
          for (const pl of room.players.values()) pl.connected = false;
          resolve({ code: c });
          pushState();
        });
        p.on("connection", onPlayerConnection);
        p.on("disconnected", () => { if (!p.destroyed) setTimeout(() => p.reconnect(), 1500); });
        p.on("error", (err) => {
          if (err.type === "unavailable-id" && !peer) {
            p.destroy();
            if (code) return reject(new Error("This game is already open in another tab or device."));
            if (attempts < 5) return tryCode(randomCode(), attempts + 1);
          }
          if (!peer) reject(new Error(friendly(err)));
          else emitLocal("status", friendly(err));
        });
      };
      tryCode(code || randomCode(), 0);
    });
  }

  function onPlayerConnection(c) {
    c.on("open", () => conns.add(c));
    c.on("data", (msg) => {
      if (!msg || msg.t !== "req" || !room) return;
      if (msg.ev === "join" && msg.data && msg.data.token) c.token = String(msg.data.token).slice(0, 64);
      if (!c.token) return c.send({ t: "res", id: msg.id, res: { ok: false, error: "Join first." } });
      if (c.token === hostToken) return c.send({ t: "res", id: msg.id, res: { ok: false, error: "Not allowed." } });
      const res = room.handle(c.token, msg.ev, msg.data);
      c.send({ t: "res", id: msg.id, res });
      if (res.ok && msg.ev === "join") c.send({ t: "state", s: room.viewFor(c.token) });
    });
    c.on("close", () => {
      conns.delete(c);
      if (room && c.token && ![...conns].some((x) => x.token === c.token)) room.setConnected(c.token, false);
    });
  }

  function pushState() {
    if (!room) return;
    try { localStorage.setItem("bb_room_" + room.code, JSON.stringify(room.save())); } catch {}
    for (const c of conns) {
      if (!c.token) continue;
      if (!room.players.has(c.token)) { c.send({ t: "kicked" }); c.token = null; setTimeout(() => c.close(), 200); continue; }
      c.send({ t: "state", s: room.viewFor(c.token) });
    }
    emitLocal("state", room.viewFor(hostToken));
  }

  // ---------------- player ----------------
  function join(code) {
    mode = "player";
    playerCode = code;
    return new Promise((resolve, reject) => {
      const start = () => {
        const c = peer.connect(PREFIX + code, { reliable: true });
        let opened = false;
        const timer = setTimeout(() => { if (!opened) { c.close(); reject(new Error("Couldn't reach the host. Check the code, and that the host's page is open.")); } }, 12000);
        c.on("open", () => { opened = true; clearTimeout(timer); conn = c; resolve(); });
        c.on("data", onHostData);
        c.on("close", () => { if (conn === c) { conn = null; scheduleReconnect(); } });
      };
      if (peer && peer.open) return start();
      if (peer) peer.destroy();
      peer = new root.Peer(peerOptions());
      peer.on("open", start);
      peer.on("disconnected", () => { if (!peer.destroyed) setTimeout(() => peer.reconnect(), 1500); });
      peer.on("error", (err) => {
        if (err.type === "peer-unavailable") {
          if (!conn) reject(new Error("No game with that code. Is the host's page still open?"));
          return;
        }
        if (!conn) reject(new Error(friendly(err)));
      });
    });
  }

  function scheduleReconnect() {
    if (mode !== "player" || retryTimer) return;
    emitLocal("status", "Connection to the host lost. Reconnecting…");
    retryTimer = setTimeout(async () => {
      retryTimer = null;
      try {
        await join(playerCode);
        emitLocal("status", null);
        emitLocal("reconnected");
      } catch { scheduleReconnect(); }
    }, 3000);
  }

  function onHostData(msg) {
    if (!msg) return;
    if (msg.t === "res" && pending.has(msg.id)) { const { resolve, timer } = pending.get(msg.id); clearTimeout(timer); pending.delete(msg.id); resolve(msg.res); }
    else if (msg.t === "state") emitLocal("state", msg.s);
    else if (msg.t === "kicked") { mode = null; emitLocal("kicked"); }
  }

  // ---------------- shared ----------------
  function request(ev, data) {
    if (mode === "host" && room) return Promise.resolve(room.handle(hostToken, ev, data));
    if (!conn || !conn.open) return Promise.resolve({ ok: false, error: "Not connected to the host right now." });
    const id = ++reqId;
    return new Promise((resolve) => {
      const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, error: "The host didn't answer. Try again." }); }, 8000);
      pending.set(id, { resolve, timer });
      conn.send({ t: "req", id, ev, data });
    });
  }

  function leave() {
    mode = null; room = null; clearTimeout(retryTimer); retryTimer = null;
    if (conn) conn.close();
    conn = null;
    if (peer) peer.destroy();
    peer = null;
  }

  function friendly(err) {
    const t = err && err.type;
    if (t === "browser-incompatible") return "This browser doesn't support peer-to-peer connections.";
    if (t === "network" || t === "server-error" || t === "socket-error") return "Can't reach the matchmaking server. Check your internet connection.";
    return (err && err.message) || "Connection problem.";
  }

  root.BBNet = { host, join, request, leave, on: (ev, fn) => (listeners[ev] = listeners[ev] || []).push(fn) };
})(self);
