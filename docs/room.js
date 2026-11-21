// A table: everyone at the table joins by code, writes a guess and locks in.
// When everyone has locked in (or the host reveals), all guesses are shown.
// Runs in the host's browser; players reach it through net.js.
(function (root) {
  const clean = (s, max) => String(s == null ? "" : s).trim().slice(0, max);

  class Room {
    constructor(code, hostToken, saved) {
      this.code = code;
      this.hostToken = hostToken;
      this.round = 1;
      this.revealed = false;
      this.players = new Map(); // token -> player
      if (saved) this.load(saved);
      this.onChange = () => {};
    }

    save() {
      return { code: this.code, round: this.round, revealed: this.revealed, players: [...this.players.values()].map((p) => ({ ...p, connected: false })) };
    }
    load(s) {
      this.round = s.round || 1;
      this.revealed = !!s.revealed;
      this.players = new Map((s.players || []).map((p) => [p.token, p]));
    }
    changed() { this.onChange(); }

    setConnected(token, connected) {
      const p = this.players.get(token);
      if (p && p.connected !== connected) { p.connected = connected; this.checkAllLocked(); this.changed(); }
    }

    checkAllLocked() {
      const active = [...this.players.values()].filter((p) => p.connected || p.token === this.hostToken);
      if (!this.revealed && active.length > 0 && active.every((p) => p.locked)) this.revealed = true;
    }

    viewFor(token) {
      const me = this.players.get(token);
      return {
        code: this.code,
        round: this.round,
        revealed: this.revealed,
        isHost: token === this.hostToken,
        me: me ? { id: me.id, name: me.name, answer: me.answer, locked: me.locked } : null,
        players: [...this.players.values()].map((p) => ({
          id: p.id,
          name: p.name,
          host: p.token === this.hostToken,
          connected: p.connected || p.token === this.hostToken,
          locked: p.locked,
          answer: this.revealed || p.token === token ? p.answer : null,
          crossed: p.crossed,
          bingo: p.bingo,
        })),
      };
    }

    handle(token, ev, d) {
      d = d || {};
      const fail = (error) => ({ ok: false, error });
      const done = (extra) => { this.changed(); return { ok: true, ...extra }; };
      const isHost = token === this.hostToken;
      const p = this.players.get(token);
      if (ev.startsWith("host:") && !isHost) return fail("Das kann nur, wer den Tisch gestartet hat.");
      if (ev !== "join" && !p) return fail("Bitte zuerst dem Tisch beitreten.");

      switch (ev) {
        case "join": {
          if (p) { p.connected = true; if (d.name) p.name = clean(d.name, 20) || p.name; return done(); }
          const name = clean(d.name, 20);
          if (!name) return fail("Bitte zuerst deinen Namen eingeben.");
          if (this.players.size >= 30) return fail("Dieser Tisch ist voll.");
          if ([...this.players.values()].some((x) => x.name.toLowerCase() === name.toLowerCase())) return fail("Dieser Name ist an diesem Tisch schon vergeben.");
          this.players.set(token, {
            id: Math.random().toString(36).slice(2, 10), token, name,
            answer: "", locked: false, crossed: 0, bingo: false, connected: true,
          });
          return done();
        }
        case "lock": {
          if (this.revealed) return fail("Die Tipps sind schon aufgedeckt. Warte auf die nächste Runde.");
          const answer = clean(d.answer, 120);
          if (!answer) return fail("Schreib zuerst deinen Tipp.");
          p.answer = answer;
          p.locked = true;
          this.checkAllLocked();
          return done();
        }
        case "unlock": {
          if (this.revealed) return fail("Zu spät, die Tipps sind schon aufgedeckt.");
          p.locked = false;
          return done();
        }
        case "progress": {
          p.crossed = Math.max(0, Math.min(25, Number(d.crossed) || 0));
          p.bingo = !!d.bingo;
          return done();
        }
        case "host:reveal": {
          this.revealed = true;
          return done();
        }
        case "host:next": {
          this.round += 1;
          this.revealed = false;
          for (const x of this.players.values()) { x.answer = ""; x.locked = false; }
          return done();
        }
        case "host:kick": {
          for (const [t, x] of this.players) if (x.id === d.playerId && t !== this.hostToken) { this.players.delete(t); this.checkAllLocked(); return done(); }
          return fail("Diesen Spieler gibt es nicht.");
        }
        default:
          return fail("Unbekannte Aktion.");
      }
    }
  }

  if (typeof module !== "undefined" && module.exports) module.exports = Room; else root.BBRoom = Room;
})(typeof self !== "undefined" ? self : this);
