// Peer-to-peer networking with PeerJS (WebRTC). The host's browser holds the
// Room; players connect to it directly. PeerJS's free public broker is only
// used to find each other, so the game works on static hosting like GitHub Pages.
(function (root) {
  const PREFIX = "beatboard-table-v1-";
  const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const listeners = {};
  const emitLocal = (ev, x) => (listeners[ev] || []).forEach((fn) => fn(x));

  // Optional: ?peerhost=localhost&peerport=9000 to use your own PeerJS server.
  function peerOptions() {
    const q = new URLSearchParams(location.search);
    const host = q.get("peerhost");
    // STUN finds a direct route between phones on different networks; TURN relays
    // the (tiny) game messages when a direct route is blocked, e.g. on mobile data.
    const config = {
      iceServers: [
        { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
        { urls: "stun:stun.cloudflare.com:3478" },
        { urls: ["turn:eu-0.turn.peerjs.com:3478", "turn:us-0.turn.peerjs.com:3478"], username: "peerjs", credential: "peerjsp" },
      ],
      sdpSemantics: "unified-plan",
    };
    if (!host) return { debug: 0, config };
    return { host, port: Number(q.get("peerport") || 9000), path: q.get("peerpath") || "/", secure: q.get("peersecure") === "1", debug: 0, config };
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
            if (code) return reject(new Error("Dieser Tisch ist schon in einem anderen Tab oder auf einem anderen Gerät geöffnet."));
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
      let token = c.token;
      if (msg.ev === "join" && msg.data && msg.data.token) token = String(msg.data.token).slice(0, 64);
      if (!token) return c.send({ t: "res", id: msg.id, res: { ok: false, error: "Bitte zuerst beitreten." } });
      if (token === hostToken) return c.send({ t: "res", id: msg.id, res: { ok: false, error: "Nicht erlaubt." } });
      const res = room.handle(token, msg.ev, msg.data);
      if (res.ok && msg.ev === "join") c.token = token;
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
        const timer = setTimeout(() => { if (!opened) { c.close(); reject(new Error("Tisch nicht erreichbar. Stimmt der Code, und ist die Seite beim Gastgeber noch offen?")); } }, 12000);
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
          if (!conn) reject(new Error("Kein Tisch mit diesem Code. Ist die Seite beim Gastgeber noch offen?"));
          return;
        }
        if (!conn) reject(new Error(friendly(err)));
      });
    });
  }

  function scheduleReconnect() {
    if (mode !== "player" || retryTimer) return;
    emitLocal("status", "Verbindung zum Tisch verloren. Verbinde neu …");
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
    if (!conn || !conn.open) return Promise.resolve({ ok: false, error: "Gerade nicht mit dem Tisch verbunden." });
    const id = ++reqId;
    return new Promise((resolve) => {
      const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, error: "Der Tisch antwortet nicht. Bitte nochmal versuchen." }); }, 8000);
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
    if (t === "browser-incompatible") return "Dieser Browser unterstützt keine direkten Verbindungen (WebRTC).";
    if (t === "network" || t === "server-error" || t === "socket-error") return "Verbindungsserver nicht erreichbar. Bitte Internetverbindung prüfen.";
    return (err && err.message) || "Verbindungsproblem.";
  }

  root.BBNet = { host, join, request, leave, on: (ev, fn) => (listeners[ev] = listeners[ev] || []).push(fn) };
})(self);
