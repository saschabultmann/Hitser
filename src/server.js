const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const G = require("./game");

const app = express();
app.use(express.static(path.join(__dirname, "..", "public")));
app.get("/healthz", (_req, res) => res.send("ok"));
const server = http.createServer(app);
const io = new Server(server);

/** code -> room */
const rooms = new Map();
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O to avoid confusion

function newCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
  } while (rooms.has(code));
  return code;
}

const clean = (s, max) => String(s || "").trim().slice(0, max);

function createRoom(hostToken) {
  const room = {
    code: newCode(),
    hostToken,
    phase: "lobby", // lobby | playing | reveal | ended
    players: new Map(), // token -> player
    deck: G.shuffle(G.DEFAULT_SONGS),
    deckName: "Starter deck",
    round: 0,
    song: null,
    winners: [], // names in order of bingo
    sockets: new Set(),
    touched: Date.now(),
  };
  rooms.set(room.code, room);
  return room;
}

function publicPlayer(p, room, viewerToken) {
  const showAnswer = room.phase === "reveal" || room.phase === "ended" || viewerToken === p.token;
  return {
    id: p.id,
    name: p.name,
    connected: p.connected,
    locked: p.locked,
    bingo: p.bingo,
    filledCount: p.board.filter((s) => s.filled).length,
    answer: showAnswer ? p.answer : null,
    result: room.phase === "reveal" ? p.result : null,
    filledThisRound: p.filledThisRound,
  };
}

function viewFor(room, token) {
  const isHost = token === room.hostToken;
  const me = room.players.get(token);
  const revealSong = isHost || room.phase === "reveal" || room.phase === "ended";
  return {
    code: room.code,
    phase: room.phase,
    round: room.round,
    totalSongs: room.deck.length,
    deckName: room.deckName,
    isHost,
    song: room.song && revealSong ? room.song : null,
    winners: room.winners,
    players: [...room.players.values()].map((p) => publicPlayer(p, room, token)),
    squares: Object.fromEntries(G.SQUARES.map((s) => [s.key, s.label])),
    me: me
      ? {
          id: me.id,
          name: me.name,
          board: me.board,
          answer: me.answer,
          locked: me.locked,
          result: room.phase === "reveal" ? me.result : null,
          eligible: room.phase === "reveal" && !me.filledThisRound ? me.eligible : [],
          filledThisRound: me.filledThisRound,
          bingo: me.bingo,
        }
      : null,
  };
}

function broadcast(room) {
  room.touched = Date.now();
  for (const s of room.sockets) s.emit("state", viewFor(room, s.data.token));
}

function recompute(p, room) {
  p.eligible = p.result ? G.eligibleSquares(p.board, p.result, room.song) : [];
}

io.on("connection", (socket) => {
  const fail = (cb, msg) => typeof cb === "function" && cb({ ok: false, error: msg });
  const ok = (cb, extra) => typeof cb === "function" && cb({ ok: true, ...extra });

  function attach(room, token) {
    if (socket.data.room && socket.data.room !== room) socket.data.room.sockets.delete(socket);
    socket.data.room = room;
    socket.data.token = token;
    room.sockets.add(socket);
  }

  function hostRoom(cb) {
    const room = socket.data.room;
    if (!room || socket.data.token !== room.hostToken) { fail(cb, "Only the host can do that."); return null; }
    return room;
  }

  socket.on("host:create", ({ token } = {}, cb) => {
    if (!token) return fail(cb, "Missing token.");
    const room = createRoom(clean(token, 64));
    attach(room, room.hostToken);
    ok(cb, { code: room.code });
    broadcast(room);
  });

  // Join (or re-join after a refresh) as host or player.
  socket.on("join", ({ code, name, token } = {}, cb) => {
    const room = rooms.get(clean(code, 8).toUpperCase());
    token = clean(token, 64);
    if (!room) return fail(cb, "No game with that code.");
    if (!token) return fail(cb, "Missing token.");
    if (token === room.hostToken) {
      attach(room, token);
      ok(cb, { role: "host" });
      return broadcast(room);
    }
    let p = room.players.get(token);
    if (!p) {
      name = clean(name, 20);
      if (!name) return fail(cb, "Pick a name first.");
      if (room.phase === "ended") return fail(cb, "That game is over.");
      if (room.players.size >= 30) return fail(cb, "This game is full.");
      if ([...room.players.values()].some((x) => x.name.toLowerCase() === name.toLowerCase()))
        return fail(cb, "That name is taken in this game.");
      p = {
        id: Math.random().toString(36).slice(2, 10),
        token, name,
        board: G.makeBoard(),
        answer: null, locked: false, result: null, eligible: [],
        filledThisRound: false, bingo: false, connected: true,
      };
      room.players.set(token, p);
    }
    p.connected = true;
    attach(room, token);
    ok(cb, { role: "player" });
    broadcast(room);
  });

  socket.on("host:deck", ({ text } = {}, cb) => {
    const room = hostRoom(cb);
    if (!room) return;
    if (room.phase !== "lobby") return fail(cb, "You can only change songs before the game starts.");
    if (!String(text || "").trim()) {
      room.deck = G.shuffle(G.DEFAULT_SONGS);
      room.deckName = "Starter deck";
      ok(cb, { count: room.deck.length, errors: [] });
      return broadcast(room);
    }
    const { songs, errors } = G.parseSongList(String(text).slice(0, 100000));
    if (songs.length < 5) return fail(cb, `Need at least 5 songs. ${errors.slice(0, 3).join(" ")}`);
    room.deck = G.shuffle(songs);
    room.deckName = "Your songs";
    ok(cb, { count: songs.length, errors });
    broadcast(room);
  });

  socket.on("host:next", (_d, cb) => {
    const room = hostRoom(cb);
    if (!room) return;
    if (room.phase === "playing") return fail(cb, "Reveal the current song first.");
    if (room.phase === "ended") return fail(cb, "The game is over.");
    if (room.round >= room.deck.length) return fail(cb, "No songs left in the deck.");
    if (room.players.size === 0) return fail(cb, "Wait for at least one player.");
    room.song = room.deck[room.round];
    room.round += 1;
    room.phase = "playing";
    for (const p of room.players.values()) {
      Object.assign(p, { answer: null, locked: false, result: null, eligible: [], filledThisRound: false });
    }
    ok(cb);
    broadcast(room);
  });

  socket.on("player:lock", ({ title, artist, year } = {}, cb) => {
    const room = socket.data.room;
    const p = room && room.players.get(socket.data.token);
    if (!p) return fail(cb, "You're not in a game.");
    if (room.phase !== "playing") return fail(cb, "No song is playing right now.");
    if (p.locked) return fail(cb, "You already locked in.");
    const y = clean(year, 4);
    if (!clean(title, 1) && !clean(artist, 1) && !y) return fail(cb, "Enter at least one guess.");
    p.answer = { title: clean(title, 80), artist: clean(artist, 80), year: y };
    p.locked = true;
    ok(cb);
    broadcast(room);
  });

  socket.on("host:reveal", (_d, cb) => {
    const room = hostRoom(cb);
    if (!room) return;
    if (room.phase !== "playing") return fail(cb, "Nothing to reveal.");
    room.phase = "reveal";
    for (const p of room.players.values()) {
      p.result = p.answer ? G.checkAnswer(p.answer, room.song) : null;
      recompute(p, room);
    }
    ok(cb);
    broadcast(room);
  });

  // Host can correct the auto-check, e.g. accept a typo or a nickname.
  socket.on("host:override", ({ playerId, field } = {}, cb) => {
    const room = hostRoom(cb);
    if (!room) return;
    if (room.phase !== "reveal") return fail(cb, "Only after the reveal.");
    const p = [...room.players.values()].find((x) => x.id === playerId);
    if (!p || !p.result || !["title", "artist"].includes(field)) return fail(cb, "Can't change that.");
    p.result[field] = !p.result[field];
    recompute(p, room);
    ok(cb);
    broadcast(room);
  });

  socket.on("player:fill", ({ index } = {}, cb) => {
    const room = socket.data.room;
    const p = room && room.players.get(socket.data.token);
    if (!p) return fail(cb, "You're not in a game.");
    if (room.phase !== "reveal") return fail(cb, "You can fill a square after the reveal.");
    if (p.filledThisRound) return fail(cb, "One square per round.");
    if (!p.eligible.includes(index)) return fail(cb, "Your answer doesn't earn that square.");
    p.board[index].filled = true;
    p.filledThisRound = true;
    if (!p.bingo && G.hasBingo(p.board)) {
      p.bingo = true;
      room.winners.push(p.name);
    }
    recompute(p, room);
    ok(cb, { bingo: p.bingo });
    broadcast(room);
  });

  socket.on("host:end", (_d, cb) => {
    const room = hostRoom(cb);
    if (!room) return;
    room.phase = "ended";
    ok(cb);
    broadcast(room);
  });

  socket.on("host:kick", ({ playerId } = {}, cb) => {
    const room = hostRoom(cb);
    if (!room) return;
    for (const [t, p] of room.players) if (p.id === playerId) room.players.delete(t);
    for (const s of room.sockets) if (!room.players.has(s.data.token) && s.data.token !== room.hostToken) {
      s.emit("kicked");
      room.sockets.delete(s);
    }
    ok(cb);
    broadcast(room);
  });

  socket.on("disconnect", () => {
    const room = socket.data.room;
    if (!room) return;
    room.sockets.delete(socket);
    const p = room.players.get(socket.data.token);
    const stillHere = [...room.sockets].some((s) => s.data.token === socket.data.token);
    if (p && !stillHere) p.connected = false;
    broadcast(room);
  });
});

// Drop rooms idle for 6 hours.
setInterval(() => {
  const cutoff = Date.now() - 6 * 3600 * 1000;
  for (const [code, room] of rooms) if (room.touched < cutoff) rooms.delete(code);
}, 10 * 60 * 1000).unref();

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  server.listen(PORT, () => console.log(`Beatboard running on http://localhost:${PORT}`));
}
module.exports = { server, rooms };
