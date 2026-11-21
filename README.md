# Beatboard

An online music-guessing bingo party game. One person hosts and plays music on a speaker, everyone else guesses on their phone and races to fill a row on their bingo board.

## How a game works

1. **Host** opens the site and clicks **Create a game**. A 4-letter code appears (plus a join link).
2. **Players** open the site on their phones, enter the code and a name.
3. The host clicks **Start** / **Next song** and plays the song on their speaker. The host screen has quick “Play on Spotify / YouTube” links; the song name stays hidden unless the host taps *Show song*, so the host screen can be shown on a TV.
4. Each player types **title, artist and year** and taps **Lock in**. Locked answers can't be changed.
5. The host clicks **Reveal**. Answers are checked automatically (typo-tolerant). The host can **flip** any title/artist verdict by hand.
6. Every square your answer earns glows. **Tap one square per round** to fill it.
7. A full **row, column or diagonal** is Bingo. The game keeps going until the host ends it, so you can play for 2nd and 3rd place.

### Board squares

Each player gets a 4×4 board with the same 16 challenges in a random order:

| Square | You earn it when… |
| --- | --- |
| Title right / Artist right | that part of your answer is right |
| Title + artist | both are right |
| Perfect: all three | title, artist and exact year are right |
| Exact year / Year ±2 / Year ±5 | your year is that close |
| Right decade | your year is in the song's decade |
| Anything right | title or artist right, or year within ±2 |
| Oldie, 70s, 80s, 90s, 2000s, 2010s, 2020s song + decade | the song is from that era **and** you guessed its decade |

## Songs

A starter deck of 60 well-known songs (1958–2023) is built in. In the lobby the host can paste their own list, one song per line:

```
Wonderwall - Oasis - 1995
Song 2; Blur; 1997
```

The app only stores song facts; the host plays the music from their own source.

## How it runs (no server)

Beatboard is a static website, so it can be hosted on **GitHub Pages**. The game itself runs in the **host's browser**: players connect to the host directly over WebRTC using [PeerJS](https://peerjs.com). PeerJS's free public broker is only used to find each other.

- The host must keep their game page open. If the host refreshes, the game is restored from their browser storage and players reconnect automatically.
- Players who refresh or lose connection rejoin automatically.
- Some strict networks (corporate Wi-Fi, some mobile carriers) block peer-to-peer connections. If a player can't connect, switching between Wi-Fi and mobile data usually helps.

### Publish on GitHub Pages

In the repository go to **Settings → Pages**, set **Source** to *Deploy from a branch*, pick branch `main` and folder `/docs`, and save. The game appears at `https://<user>.github.io/<repo>/` a minute later.

### Run locally

```bash
npm start   # serves docs/ on http://localhost:8080
npm test
```

To use your own PeerJS server instead of the public one, add `?peerhost=<host>&peerport=<port>` to the URL (add `&peersecure=1` for https).

## Project layout

- `docs/`: the whole game (no build step)
  - `game.js`: rules, board squares, answer matching, bingo check
  - `room.js`: the game room that runs in the host's browser
  - `net.js`: peer-to-peer networking (PeerJS)
  - `app.js`: screens for home, host and players
  - `songs.js`: starter deck
  - `peerjs.min.js`: vendored PeerJS 1.5.4 (MIT)
- `test/`: unit tests for the rules and a full round through the room
