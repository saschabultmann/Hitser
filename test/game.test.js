const test = require("node:test");
const assert = require("node:assert");
const G = require("../src/game");

const song = { title: "(I Can't Get No) Satisfaction", artist: "The Rolling Stones", year: 1965 };

test("fuzzy title and artist matching", () => {
  const r = G.checkAnswer({ title: "satisfaction", artist: "rolling stones", year: "1966" }, song);
  assert.equal(r.title, true);
  assert.equal(r.artist, true);
  assert.equal(r.yearDiff, 1);
  assert.equal(G.checkAnswer({ title: "Satisfacton", artist: "Beatles" }, song).title, true);
  assert.equal(G.checkAnswer({ title: "Yesterday", artist: "Beatles" }, song).artist, false);
  assert.equal(G.checkAnswer({ artist: "bruno mars" }, { title: "Uptown Funk", artist: "Mark Ronson ft. Bruno Mars", year: 2014 }).artist, true);
  assert.equal(G.checkAnswer({ artist: "simon and garfunkel" }, { title: "x", artist: "Simon & Garfunkel", year: 1970 }).artist, true);
});

test("eligible squares follow the answer", () => {
  const board = G.SQUARES.map((s) => ({ key: s.key, filled: false }));
  const r = G.checkAnswer({ title: "satisfaction", artist: "", year: "1965" }, song);
  const keys = G.eligibleSquares(board, r, song).map((i) => board[i].key).sort();
  assert.deepEqual(keys, ["any", "close2", "close5", "d60", "decade", "exact", "title"].sort());
});

test("bingo detection", () => {
  const board = G.makeBoard();
  assert.equal(board.length, 16);
  assert.equal(G.hasBingo(board), false);
  [0, 5, 10, 15].forEach((i) => (board[i].filled = true));
  assert.equal(G.hasBingo(board), true);
});

test("song list parsing", () => {
  const { songs, errors } = G.parseSongList("Wonderwall - Oasis - 1995\nbad line\nSong 2;Blur;1997");
  assert.equal(songs.length, 2);
  assert.equal(errors.length, 1);
  assert.deepEqual(songs[1], { title: "Song 2", artist: "Blur", year: 1997 });
});
