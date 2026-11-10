# Chess

A chess game against four computer opponents that runs from a single HTML file.
No install, no internet, no external files: double-click `chess-offline.html` and play.

## Get the offline file

1. Download [`chess-offline.html`](https://github.com/Tyler-h-o/chess-game/raw/main/chess-offline.html)
   (right-click the link and choose "Save link as"), or use **Code > Download ZIP** on GitHub and
   take the file out of the ZIP.
2. Double-click it. It opens in your browser from `file://` and never makes a network request.

`index.html` is the same file under a different name.

## How to play

- **Pick an opponent and a colour** (White, Black or Random) in the "New game" panel, then press
  **Start game**.
- **Move** by dragging a piece, or by clicking a piece and then clicking where it should go.
  Both work with a mouse and on a touch screen. Legal destinations are marked with dots.
- When a pawn reaches the last rank a picker asks which piece to promote to.
- The last move and a king in check are highlighted. The move list is on the right.
- **Resign** ends the game as a loss. Before you have made a move the button reads
  **Abort game** and nothing is recorded.
- If you close the page mid-game, it picks up where you left off the next time you open it.

Games end by checkmate, stalemate, threefold repetition, the fifty-move rule, insufficient
material, or resignation. The game claims repetition and fifty-move draws automatically.

## The bots

| Bot      | Label | How it plays                                                                 |
| -------- | ----- | ---------------------------------------------------------------------------- |
| Beginner | ~500  | Looks one move ahead, misjudges positions, plays a random move about 1 in 3. |
| Casual   | ~1000 | Looks two moves ahead and resolves captures; random move about 1 in 10.      |
| Club     | ~1500 | Looks three moves ahead; small errors; random move about 1 in 30.            |
| Expert   | ~2000 | Searches up to six moves deep for up to about 1.5 seconds; no deliberate errors. |

**The Elo numbers are approximate labels, not calibrated ratings.** They have not been measured
against rated players or other engines. What has been checked is the ordering: in bot-against-bot
matches each level reliably beats the one below it. Treat the numbers as "easy, medium, hard,
harder".

## Dashboard

The Dashboard tab shows your overall wins, draws and losses, win rate, record against each bot,
current streak, and an estimated rating with a history chart. Below that is a list of past games;
click one to step through it move by move (arrow keys work too) and copy its PGN.

Your **estimated rating** starts at 800 and changes after every finished game using the standard
Elo formula with K = 32 against the bot's label. Because the bot labels are approximate, so is
your rating.

### Where your data lives

Stats and games are saved in the browser's `localStorage`. For a page opened from `file://`,
browsers tie that storage to the file's location, so **moving or renaming the file, or switching
browsers, starts you from an empty history**. Use **Export JSON** on the Dashboard first, and
**Import JSON** afterwards; importing merges with what is already there. If the browser blocks
storage altogether the page says so and still works for the current session.

## Development

```
src/engine.js      rules, move generation, search and bot levels (one function: ChessCore)
src/app.js         user interface
src/style.css      styles
src/template.html  page skeleton with markers for the three files above
build.mjs          inlines src/ into index.html and chess-offline.html
tests/             perft, rules checks and bot-against-bot matches
```

Build (Node, no dependencies):

```
node build.mjs
```

Engine tests, either in Node:

```
node tests/engine-tests.js perft
node tests/engine-tests.js match 500 1000 20
```

or in a browser, by opening `tests/index.html?t=perft` or
`tests/index.html?t=match&a=500&b=1000&n=20`.

Engine notes: 0x88 board, pseudo-legal generation with a legality filter, Zobrist hashing,
negamax alpha-beta with quiescence, MVV-LVA, killer and history ordering, null-move pruning, a
typed-array transposition table, and a material plus piece-square evaluation with a tapered king
table. The bot runs in a Web Worker created from a Blob of `ChessCore.toString()`, which works on
`file://`; if the browser refuses, it runs on the main thread instead.

There are no runtime dependencies: no CDNs, fonts, images or network requests. The pieces are
inline SVG drawn for this project.
