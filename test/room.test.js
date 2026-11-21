const test = require("node:test");
const assert = require("node:assert");
const Room = require("../docs/room");

test("a table round: join, lock in, auto-reveal, next round", () => {
  const room = new Room("ABCD", "host");
  let changes = 0;
  room.onChange = () => changes++;
  assert.equal(room.handle("host", "join", { name: "Sascha" }).ok, true);
  assert.equal(room.handle("a", "join", { name: "sascha" }).ok, false, "name taken");
  assert.equal(room.handle("a", "join", { name: "Ann" }).ok, true);
  assert.equal(room.handle("b", "join", { name: "Bob" }).ok, true);
  assert.equal(room.handle("a", "host:next").ok, false, "only the host");
  assert.equal(room.handle("x", "lock", { answer: "hi" }).ok, false, "must join first");

  assert.equal(room.handle("a", "lock", { answer: "  " }).ok, false, "empty guess");
  assert.equal(room.handle("a", "lock", { answer: "Take On Me 1985" }).ok, true);
  assert.equal(room.viewFor("b").players.find((p) => p.name === "Ann").answer, null, "hidden from others");
  assert.equal(room.viewFor("a").players.find((p) => p.name === "Ann").answer, "Take On Me 1985", "visible to yourself");
  assert.equal(room.handle("a", "unlock").ok, true);
  room.handle("a", "lock", { answer: "Take On Me 1984" });
  room.handle("host", "lock", { answer: "1986" });
  assert.equal(room.revealed, false);
  room.handle("b", "lock", { answer: "1990" });
  assert.equal(room.revealed, true, "reveals when everyone locked in");
  assert.equal(room.viewFor("b").players.find((p) => p.name === "Ann").answer, "Take On Me 1984");
  assert.equal(room.handle("a", "unlock").ok, false, "too late");

  room.handle("a", "progress", { crossed: 5, bingo: true });
  assert.equal(room.viewFor("host").players.find((p) => p.name === "Ann").bingo, true);

  assert.equal(room.handle("host", "host:next").ok, true);
  assert.equal(room.round, 2);
  assert.equal(room.revealed, false);
  assert.ok(room.viewFor("a").players.every((p) => !p.locked && !p.answer));

  // a disconnected player doesn't block the reveal
  room.setConnected("b", false);
  room.handle("a", "lock", { answer: "x" });
  room.handle("host", "lock", { answer: "y" });
  assert.equal(room.revealed, true);

  const copy = new Room("ABCD", "host", JSON.parse(JSON.stringify(room.save())));
  assert.equal(copy.round, 2);
  assert.equal(copy.players.size, 3);

  const bobId = room.viewFor("host").players.find((p) => p.name === "Bob").id;
  assert.equal(room.handle("host", "host:kick", { playerId: bobId }).ok, true);
  assert.equal(room.players.size, 2);
  assert.ok(changes > 5);
});
