# Beatboard

Live: https://saschabultmann.github.io/Hitser/ (UI in German)

A bingo card on your phone for music-guessing games you play at the table. No paper cards, no pens: everyone opens the page, writes their guess, locks it in and crosses off squares.

The site has no songs in it. You play the music and decide who was right yourselves, exactly as you would with paper cards.

## How it works

1. One person enters their name and taps **Start a table**. They get a 4-letter code.
2. Tap **Einladungslink teilen** to send friends a link (`?tisch=CODE`) that joins the table directly; they only enter their name. Or they type the code and tap **Beitreten**. Friends can be anywhere, not just in the same Wi-Fi.
3. Each round, everyone writes a guess on their whiteboard and taps **Lock in**. You can unlock to change your mind until the guesses are revealed.
4. When everyone has locked in, all guesses appear on every phone. (The person who started the table can also tap **Reveal now**.)
5. Cross off squares by tapping them. Tap again to undo. A full row, column or diagonal is **Bingo**, and everyone at the table sees it.
6. The person who started the table taps **Next round**, which wipes everyone's guess.

Don't need the shared table? **Just the card, no table** gives you a card on its own, with the same whiteboard and lock.

Each card has 25 squares in 5 colours, shuffled. **New card** (tap twice) deals a fresh one. Your card, crosses and guess are saved on your phone, so a refresh doesn't lose anything.

## How it runs (no server)

Beatboard is a static website hosted on **GitHub Pages**. The table runs on the phone of the person who started it, and the other phones connect to it directly over WebRTC using [PeerJS](https://peerjs.com). PeerJS's free public broker is only used to find each other.

- The person who started the table should keep the page open. If they refresh, the table comes back and everyone reconnects automatically.
- Phones on different networks connect via STUN, and fall back to PeerJS's public TURN relay when a direct route is blocked. The screen is kept awake while you're at a table.
- Some strict networks (corporate Wi-Fi, some mobile carriers) block peer-to-peer connections. If a phone can't connect, switching between Wi-Fi and mobile data usually helps. Solo cards work offline.

### Publish on GitHub Pages

**Settings → Pages**: *Deploy from a branch*, branch `main`, folder `/docs`.

### Run locally

```bash
npm start   # serves docs/ on http://localhost:8080
npm test
```

To use your own PeerJS server instead of the public one, add `?peerhost=<host>&peerport=<port>` to the URL (add `&peersecure=1` for https).

## Project layout

- `docs/`: the whole site (no build step)
  - `app.js`: home screen, the card, the whiteboard and the table view
  - `room.js`: the table (players, lock-ins, reveal, rounds), runs on the starter's phone
  - `net.js`: peer-to-peer networking (PeerJS)
  - `peerjs.min.js`: vendored PeerJS 1.5.4 (MIT)
- `test/`: tests for the table logic
