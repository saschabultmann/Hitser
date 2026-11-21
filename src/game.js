// Pure game logic for Beatboard. No sockets in here, so it can be unit tested.
const DEFAULT_SONGS = require("./songs");

const BOARD_SIZE = 4; // 4x4 board

// Every square is a small challenge. You may fill a square after a round
// if your locked-in answer meets its condition.
const decadeOf = (y) => Math.floor(y / 10) * 10;
const rightDecade = (r, s) => r.guessYear != null && decadeOf(r.guessYear) === decadeOf(s.year);
const SQUARES = [
  { key: "title", label: "Title right", test: (r) => r.title },
  { key: "artist", label: "Artist right", test: (r) => r.artist },
  { key: "both", label: "Title + artist", test: (r) => r.title && r.artist },
  { key: "perfect", label: "Perfect: all three", test: (r) => r.title && r.artist && r.yearDiff === 0 },
  { key: "exact", label: "Exact year", test: (r) => r.yearDiff === 0 },
  { key: "close2", label: "Year ±2", test: (r) => r.yearDiff != null && r.yearDiff <= 2 },
  { key: "close5", label: "Year ±5", test: (r) => r.yearDiff != null && r.yearDiff <= 5 },
  { key: "decade", label: "Right decade", test: rightDecade },
  { key: "any", label: "Anything right", test: (r) => r.title || r.artist || (r.yearDiff != null && r.yearDiff <= 2) },
  { key: "d60", label: "Oldie (before '70) + decade", test: (r, s) => s.year < 1970 && rightDecade(r, s) },
  { key: "d70", label: "70s song + decade", test: (r, s) => decadeOf(s.year) === 1970 && rightDecade(r, s) },
  { key: "d80", label: "80s song + decade", test: (r, s) => decadeOf(s.year) === 1980 && rightDecade(r, s) },
  { key: "d90", label: "90s song + decade", test: (r, s) => decadeOf(s.year) === 1990 && rightDecade(r, s) },
  { key: "d00", label: "2000s song + decade", test: (r, s) => decadeOf(s.year) === 2000 && rightDecade(r, s) },
  { key: "d10", label: "2010s song + decade", test: (r, s) => decadeOf(s.year) === 2010 && rightDecade(r, s) },
  { key: "d20", label: "2020s song + decade", test: (r, s) => s.year >= 2020 && rightDecade(r, s) },
];
const SQUARE_BY_KEY = Object.fromEntries(SQUARES.map((s) => [s.key, s]));

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeBoard() {
  return shuffle(SQUARES).slice(0, BOARD_SIZE * BOARD_SIZE).map((s) => ({ key: s.key, filled: false }));
}

// ---------- answer matching ----------
function normalize(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/\(.*?\)|\[.*?\]/g, " ") // drop (feat. x), [remix]
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/^\s*the\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a, b) {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

function fuzzyEqual(guess, truth) {
  const g = normalize(guess);
  const t = normalize(truth);
  if (!g || !t) return false;
  if (g === t) return true;
  const sim = 1 - levenshtein(g, t) / Math.max(g.length, t.length);
  return sim >= 0.8;
}

function matchTitle(guess, title) {
  if (fuzzyEqual(guess, title)) return true;
  // Accept the title without its bracketed part, e.g. "Satisfaction" for "(I Can't Get No) Satisfaction"
  const bare = String(title).replace(/\(.*?\)|\[.*?\]/g, "").trim();
  const inside = (String(title).match(/\((.*?)\)/) || [])[1];
  return fuzzyEqual(guess, bare) || (inside ? fuzzyEqual(guess, inside) : false);
}

function matchArtist(guess, artist) {
  if (fuzzyEqual(guess, artist)) return true;
  // "Mark Ronson ft. Bruno Mars": naming either main artist counts
  const parts = String(artist).split(/\s+(?:ft\.?|feat\.?|featuring|&|and|x|with)\s+|,\s*/i);
  return parts.length > 1 && parts.some((p) => fuzzyEqual(guess, p));
}

function checkAnswer(answer, song) {
  const y = parseInt(answer && answer.year, 10);
  const guessYear = Number.isFinite(y) ? y : null;
  return {
    title: matchTitle(answer && answer.title, song.title),
    artist: matchArtist(answer && answer.artist, song.artist),
    guessYear,
    yearDiff: guessYear == null ? null : Math.abs(guessYear - song.year),
  };
}

function eligibleSquares(board, result, song) {
  const out = [];
  board.forEach((sq, i) => {
    if (!sq.filled && SQUARE_BY_KEY[sq.key].test(result, song)) out.push(i);
  });
  return out;
}

function hasBingo(board) {
  const n = BOARD_SIZE;
  const f = (r, c) => board[r * n + c].filled;
  for (let i = 0; i < n; i++) {
    let row = true, col = true;
    for (let j = 0; j < n; j++) { row = row && f(i, j); col = col && f(j, i); }
    if (row || col) return true;
  }
  let d1 = true, d2 = true;
  for (let i = 0; i < n; i++) { d1 = d1 && f(i, i); d2 = d2 && f(i, n - 1 - i); }
  return d1 || d2;
}

// "Title - Artist - Year" per line (also accepts ; or tab separators)
function parseSongList(text) {
  const songs = [];
  const errors = [];
  String(text || "").split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    const parts = line.split(/\s+-\s+|;|\t/).map((p) => p.trim()).filter(Boolean);
    const year = parseInt(parts[parts.length - 1], 10);
    if (parts.length < 3 || !Number.isFinite(year)) {
      errors.push(`Line ${i + 1}: expected "Title - Artist - Year"`);
      return;
    }
    songs.push({ title: parts.slice(0, parts.length - 2).join(" - "), artist: parts[parts.length - 2], year });
  });
  return { songs, errors };
}

module.exports = {
  BOARD_SIZE, SQUARES, SQUARE_BY_KEY, DEFAULT_SONGS,
  shuffle, makeBoard, normalize, checkAnswer, eligibleSquares, hasBingo, parseSongList,
};
