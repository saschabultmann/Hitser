// The game room. It runs inside the host's browser (no server needed).
// Players talk to it through net.js; the host calls it directly.
(function (root) {
  const G = typeof module !== "undefined" && module.exports ? require("./game") : root.BBGame;
  const clean = (s, max) => String(s == null ? "" : s).trim().slice(0, max);

  class Room {
    constructor(code, hostToken, saved) {
      this.code = code;
      this.hostToken = hostToken;
      this.phase = "lobby"; // lobby | playing | reveal | ended
      this.players = new Map(); // token -> player
      this.deck = G.shuffle(G.DEFAULT_SONGS);
      this.deckName = "Starter deck";
      this.round = 0;
      this.song = null;
      this.winners = [];
      if (saved) this.load(saved);
      this.onChange = () => {};
    }

    // ---- persistence (so the host can reload the page) ----
    save() {
      const { code, hostToken, phase, deck, deckName, round, song, winners } = this;
      const players = [...this.players.values()].map((p) => ({ ...p, connected: false }));
      return { code, hostToken, phase, deck, deckName, round, song, winners, players };
    }
    load(s) {
      Object.assign(this, { phase: s.phase, deck: s.deck, deckName: s.deckName, round: s.round, song: s.song, winners: s.winners });
      this.players = new Map(s.players.map((p) => [p.token, p]));
    }

    changed() { this.onChange(); }

    setConnected(token, connected) {
      const p = this.players.get(token);
      if (p && p.connected !== connected) { p.connected = connected; this.changed(); }
    }

    viewFor(token) {
      const isHost = token === this.hostToken;
      const me = this.players.get(token);
      const open = this.phase === "reveal" || this.phase === "ended";
      return {
        code: this.code,
        phase: this.phase,
        round: this.round,
        totalSongs: this.deck.length,
        deckName: this.deckName,
        isHost,
        song: this.song && (isHost || open) ? this.song : null,
        winners: this.winners,
        players: [...this.players.values()].map((p) => ({
          id: p.id,
          name: p.name,
          connected: p.connected,
          locked: p.locked,
          bingo: p.bingo,
          filledCount: p.board.filter((s) => s.filled).length,
          answer: open || token === p.token ? p.answer : null,
          result: this.phase === "reveal" ? p.result : null,
          filledThisRound: p.filledThisRound,
        })),
        squares: Object.fromEntries(G.SQUARES.map((s) => [s.key, s.label])),
        me: me
          ? {
              id: me.id, name: me.name, board: me.board, answer: me.answer, locked: me.locked,
              result: this.phase === "reveal" ? me.result : null,
              eligible: this.phase === "reveal" && !me.filledThisRound ? me.eligible : [],
              filledThisRound: me.filledThisRound, bingo: me.bingo,
            }
          : null,
      };
    }

    recompute(p) { p.eligible = p.result ? G.eligibleSquares(p.board, p.result, this.song) : []; }

    // Handle one request. Returns { ok, error?, ...extra }.
    handle(token, ev, d) {
      d = d || {};
      const fail = (error) => ({ ok: false, error });
      const isHost = token === this.hostToken;
      const p = this.players.get(token);
      const done = (extra) => { this.changed(); return { ok: true, ...extra }; };

      if (ev.startsWith("host:") && !isHost) return fail("Only the host can do that.");

      switch (ev) {
        case "join": {
          if (isHost) return done({ role: "host" });
          if (p) { p.connected = true; return done({ role: "player" }); }
          const name = clean(d.name, 20);
          if (!name) return fail("Pick a name first.");
          if (this.phase === "ended") return fail("That game is over.");
          if (this.players.size >= 30) return fail("This game is full.");
          if ([...this.players.values()].some((x) => x.name.toLowerCase() === name.toLowerCase()))
            return fail("That name is taken in this game.");
          this.players.set(token, {
            id: Math.random().toString(36).slice(2, 10), token, name,
            board: G.makeBoard(), answer: null, locked: false, result: null, eligible: [],
            filledThisRound: false, bingo: false, connected: true,
          });
          return done({ role: "player" });
        }
        case "host:deck": {
          if (this.phase !== "lobby") return fail("You can only change songs before the game starts.");
          const text = String(d.text || "");
          if (!text.trim()) {
            this.deck = G.shuffle(G.DEFAULT_SONGS); this.deckName = "Starter deck";
            return done({ count: this.deck.length, errors: [] });
          }
          const { songs, errors } = G.parseSongList(text.slice(0, 100000));
          if (songs.length < 5) return fail(`Need at least 5 songs. ${errors.slice(0, 3).join(" ")}`);
          this.deck = G.shuffle(songs); this.deckName = "Your songs";
          return done({ count: songs.length, errors });
        }
        case "host:next": {
          if (this.phase === "playing") return fail("Reveal the current song first.");
          if (this.phase === "ended") return fail("The game is over.");
          if (this.round >= this.deck.length) return fail("No songs left in the deck.");
          if (this.players.size === 0) return fail("Wait for at least one player.");
          this.song = this.deck[this.round];
          this.round += 1;
          this.phase = "playing";
          for (const x of this.players.values())
            Object.assign(x, { answer: null, locked: false, result: null, eligible: [], filledThisRound: false });
          return done();
        }
        case "player:lock": {
          if (!p) return fail("You're not in this game.");
          if (this.phase !== "playing") return fail("No song is playing right now.");
          if (p.locked) return fail("You already locked in.");
          const year = clean(d.year, 4);
          if (!clean(d.title, 1) && !clean(d.artist, 1) && !year) return fail("Enter at least one guess.");
          p.answer = { title: clean(d.title, 80), artist: clean(d.artist, 80), year };
          p.locked = true;
          return done();
        }
        case "host:reveal": {
          if (this.phase !== "playing") return fail("Nothing to reveal.");
          this.phase = "reveal";
          for (const x of this.players.values()) {
            x.result = x.answer ? G.checkAnswer(x.answer, this.song) : null;
            this.recompute(x);
          }
          return done();
        }
        case "host:override": {
          if (this.phase !== "reveal") return fail("Only after the reveal.");
          const x = [...this.players.values()].find((y) => y.id === d.playerId);
          if (!x || !x.result || !["title", "artist"].includes(d.field)) return fail("Can't change that.");
          x.result[d.field] = !x.result[d.field];
          this.recompute(x);
          return done();
        }
        case "player:fill": {
          if (!p) return fail("You're not in this game.");
          if (this.phase !== "reveal") return fail("You can fill a square after the reveal.");
          if (p.filledThisRound) return fail("One square per round.");
          if (!p.eligible.includes(d.index)) return fail("Your answer doesn't earn that square.");
          p.board[d.index].filled = true;
          p.filledThisRound = true;
          if (!p.bingo && G.hasBingo(p.board)) { p.bingo = true; this.winners.push(p.name); }
          this.recompute(p);
          return done({ bingo: p.bingo });
        }
        case "host:end": {
          this.phase = "ended";
          return done();
        }
        case "host:kick": {
          for (const [t, x] of this.players) if (x.id === d.playerId) { this.players.delete(t); return done({ kicked: t }); }
          return fail("No such player.");
        }
        default:
          return fail("Unknown action.");
      }
    }
  }

  if (typeof module !== "undefined" && module.exports) module.exports = Room; else root.BBRoom = Room;
})(typeof self !== "undefined" ? self : this);
