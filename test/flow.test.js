const test = require("node:test");
const assert = require("node:assert");
const { io } = require("socket.io-client");
const { server } = require("../src/server");

test("full round: create, join, lock, reveal, fill", async () => {
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}`;
  const mk = () => io(url, { transports: ["websocket"] });
  const call = (s, ev, d) => new Promise((r) => s.emit(ev, d, r));
  const host = mk(), ann = mk(), bob = mk();
  const last = new Map();
  for (const s of [host, ann, bob]) s.on("state", (st) => last.set(s, st));

  const { code } = await call(host, "host:create", { token: "h1" });
  assert.match(code, /^[A-Z]{4}$/);
  assert.equal((await call(ann, "join", { code, name: "Ann", token: "a1" })).ok, true);
  assert.equal((await call(bob, "join", { code: code.toLowerCase(), name: "ann", token: "b1" })).ok, false); // name taken
  assert.equal((await call(bob, "join", { code, name: "Bob", token: "b1" })).ok, true);
  assert.equal((await call(ann, "host:next")).ok, false); // not host

  await call(host, "host:deck", { text: "A - X - 1985\nB - Y - 1990\nC - Z - 2001\nD - W - 1972\nE - V - 1960" });
  assert.equal((await call(host, "host:next")).ok, true);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(last.get(ann).song, null, "players must not see the song");
  const song = last.get(host).song;
  assert.ok(song.title);

  assert.equal((await call(ann, "player:lock", { title: song.title, artist: song.artist, year: String(song.year) })).ok, true);
  assert.equal((await call(ann, "player:lock", { title: "again" })).ok, false);
  await call(bob, "player:lock", { title: "nope", artist: "nobody", year: "1800" });
  assert.equal((await call(host, "host:reveal")).ok, true);
  await new Promise((r) => setTimeout(r, 50));

  const a = last.get(ann).me;
  assert.ok(a.eligible.length >= 6, "a perfect answer earns many squares");
  assert.equal(last.get(bob).me.eligible.length, 0);
  assert.equal((await call(bob, "player:fill", { index: 0 })).ok, false);
  assert.equal((await call(ann, "player:fill", { index: a.eligible[0] })).ok, true);
  assert.equal((await call(ann, "player:fill", { index: a.eligible[1] })).ok, false); // one per round

  // host flips Bob's title to correct
  const bobId = last.get(host).players.find((p) => p.name === "Bob").id;
  await call(host, "host:override", { playerId: bobId, field: "title" });
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(last.get(bob).me.eligible.length > 0);

  // reconnect keeps the board
  bob.close();
  const bob2 = mk(); bob2.on("state", (st) => last.set(bob2, st));
  assert.equal((await call(bob2, "join", { code, token: "b1" })).ok, true);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(last.get(bob2).me.name, "Bob");

  for (const s of [host, ann, bob2]) s.close();
  await new Promise((r) => server.close(r));
});
