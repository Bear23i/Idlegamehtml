# Tumblers

A daily safe-cracking logic puzzle. One HTML file, no dependencies, no build step —
open `tumblers.html` and it runs, offline.

## Play it on your phone

1. **AirDrop / email the file to yourself** and open it in Safari or Chrome.
2. **Add to Home Screen** (Safari: Share → Add to Home Screen) — it launches
   fullscreen with no browser chrome and looks like a real app.
3. **GitHub Pages** — Settings → Pages, serve from `main`. Then it's a URL you can
   send to anyone, and everyone gets the same daily safe.

The save lives in that browser's `localStorage`, so clearing site data resets your
streak.

## How it works

Five dials, each hiding a number from 1 to 6. Below them is a set of clues, all
true. Set the dials and hit **Crack it**.

The design rule the whole thing is built on: **exactly one combination satisfies
every clue**. That is enforced by the generator, not hoped for — so the puzzle is
always solvable by pure deduction and never by luck. This is the main thing
separating it from Mastermind-style games, where your opening guesses are
necessarily blind.

- Everyone gets the same daily puzzle, seeded from the date.
- Tap a clue to cross it off and to highlight the dials it refers to.
- A **hint** locks one dial to its correct value; it's recorded on your result.
- Wrong attempts cost nothing but a tick on the counter — there's no lives system.
- Streak grows for each consecutive day you crack it.
- Three practice modes (4/5/6 dials) with unlimited puzzles, so you aren't done
  after two minutes.

Progress on the daily is saved as you go, so you can close it mid-solve.

### Today's puzzle, worked through

Solution `4 1 2 2 2`, from these five clues:

1. Dial 1 is even
2. Dial 4 and dial 5 show the same number
3. Dial 2 and dial 4 are consecutive numbers
4. Dial 2 and dial 3 add up to 3
5. Dial 1 and dial 5 add up to 6

From 4, dial 2 is 1 or 2. From 1 and 5, dial 1 is 2 (dial 5 = 4) or 4 (dial 5 = 2).
Take the first: dial 5 = 4, so dial 4 = 4 by clue 2, so dial 2 is 3 or 5 by clue 3 —
which contradicts clue 4. So dial 1 = 4, dial 5 = 2, dial 4 = 2, dial 2 = 1, dial 3 = 2.
No guessing anywhere.

## The generator

Everything interesting is in `buildPuzzle()`:

1. Seed a PRNG from the date, pick a random solution.
2. Build every clue that happens to be **true** for that solution — comparisons,
   parity, sums, differences, bounds, "exactly two dials are even", "no dial shows 4",
   and so on.
3. Shuffle them weighted, so bluntly revealing clues ("dial 3 shows 5") are rare.
4. Add clues one at a time, keeping only those that eliminate candidates, until
   exactly one combination survives out of all 7,776.
5. Prune backwards: drop any clue the remaining ones already imply. This is what
   makes the final set feel tight rather than padded.
6. Reject and retry if the result is too short or too long.

Verified over 920 generated boards across all three modes: **zero** failures and
**zero** non-unique puzzles. Generation takes ~10 ms for the daily, ~40 ms worst
case for 6 dials.

To make puzzles harder or easier, change `min`/`max` in `MODES` (clue count — fewer
clues means harder) or the weights in `candidateClues()`.

## Two builds

- `tumblers.html` — the phone build. Fixed full-viewport layout with safe-area
  insets, tuned for **Add to Home Screen** so it behaves like an installed app.
- `tumblers-hosted.html` — the web build. Same tested game logic, but laid out as a
  normal centred column so it also works on a desktop and can't collapse inside a
  hosting frame. This is the one published as a link.

Both share the identical generator and game logic; only the layout shell differs.

## Also in this repo

`index.html` is **Abyss**, an idle deep-sea salvage game — built before I understood
you didn't want an idle game. Left in place in case it's ever useful; ignore it
otherwise. Its notes are in the commit history.
