const test = require("node:test");
const assert = require("node:assert");
const Room = require("../docs/room");

test("full round: join, lock, reveal, fill, save/restore", () => {
  const room = new Room("ABCD", "host");
  let changes = 0;
  room.onChange = () => changes++;
  assert.equal(room.handle("host", "join", {}).role, "host");
  assert.equal(room.handle("a", "join", { name: "Ann" }).ok, true);
  assert.equal(room.handle("b", "join", { name: "ann" }).ok, false); // name taken
  assert.equal(room.handle("b", "join", { name: "Bob" }).ok, true);
  assert.equal(room.handle("a", "host:next").ok, false); // not host

  room.handle("host", "host:deck", { text: "A - X - 1985\nB - Y - 1990\nC - Z - 2001\nD - W - 1972\nE - V - 1960" });
  assert.equal(room.handle("host", "host:next").ok, true);
  assert.equal(room.viewFor("a").song, null, "players must not see the song");
  const song = room.viewFor("host").song;

  assert.equal(room.handle("a", "player:lock", { title: song.title, artist: song.artist, year: String(song.year) }).ok, true);
  assert.equal(room.handle("a", "player:lock", { title: "again" }).ok, false);
  assert.equal(room.viewFor("b").players.find((p) => p.name === "Ann").answer, null, "others can't see answers yet");
  room.handle("b", "player:lock", { title: "nope", artist: "nobody", year: "1800" });
  assert.equal(room.handle("host", "host:reveal").ok, true);

  const a = room.viewFor("a").me;
  assert.ok(a.eligible.length >= 6);
  assert.equal(room.viewFor("b").me.eligible.length, 0);
  assert.equal(room.handle("b", "player:fill", { index: 0 }).ok, false);
  assert.equal(room.handle("a", "player:fill", { index: a.eligible[0] }).ok, true);
  assert.equal(room.handle("a", "player:fill", { index: a.eligible[1] }).ok, false); // one per round

  const bobId = room.viewFor("host").players.find((p) => p.name === "Bob").id;
  room.handle("host", "host:override", { playerId: bobId, field: "title" });
  assert.ok(room.viewFor("b").me.eligible.length > 0);

  const copy = new Room("ABCD", "host", JSON.parse(JSON.stringify(room.save())));
  assert.equal(copy.viewFor("a").me.board.filter((s) => s.filled).length, 1);
  assert.equal(copy.phase, "reveal");
  assert.ok(changes > 5);

  assert.equal(room.handle("host", "host:kick", { playerId: bobId }).ok, true);
  assert.equal(room.players.size, 1);
});
