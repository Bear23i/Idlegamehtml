# Games in this repo

Each game is self-contained and needs no build step.

| Game | File | What it is |
| --- | --- | --- |
| **Voidbreaker** | `index.html` + `style.css` + `game.js` | 3D low-poly arcade survival shooter (Three.js) |
| **Tumblers** | `tumblers.html`, `tumblers-hosted.html` | Daily safe-cracking logic puzzle |
| **Abyss** | `abyss.html` | Idle deep-sea salvage game |

---

# Voidbreaker

A low-poly 3D arcade survival shooter. You pilot a pod in a walled arena, waves of
geometry come for you, and the run ends when your integrity hits zero.

## Launch it

```sh
npx serve .          # then open the printed URL, usually http://localhost:3000
# or: python3 -m http.server 8000
```

Opening `index.html` straight from the filesystem works too — Three.js comes from a
CDN (jsDelivr, falling back to unpkg), so the first load needs a connection. After
that the browser cache covers you. There is nothing to install and no build step.

## Rules

- **Survive waves.** Each wave sends a larger, nastier mix. Clear it and you get a
  wave bonus plus a small integrity top-up before the next one starts.
- **Every fifth wave is a Warden** — a boss with its own health bar that fires
  radial bullet patterns and, below half health, speeds up and calls in escorts.
- **Kill for score, collect orbs to bank more.** Dead enemies scatter gold orbs
  that magnetise to you when you get close. Orbs expire after ~15 seconds.
- **Chain kills to raise the multiplier.** Every 4 kills inside a 3.2-second window
  adds a tier, up to x8. Taking a hit resets the chain to zero.
- **Dash is your defence.** You are invulnerable for the whole dash, so dashing
  *through* a charging enemy is the correct answer. It has a ~1.2s cooldown.
- **Power-ups** drop occasionally, and always from a Warden: `RAPID` (double fire
  rate), `TRIPLE` (three-way spread) and `SHIELD` (absorbs one hit outright).
- **High score persists** in `localStorage`.

The hostiles: **grunts** (chase), **sprinters** (wind up, then lunge), **shooters**
(kite at range and lead their shots), **tanks** (slow, tough, split into two grunts
when destroyed) and the **Warden**.

## Controls

| Action | Keyboard / mouse | Touch |
| --- | --- | --- |
| Move | `WASD` or arrow keys | left stick |
| Aim | mouse | right stick |
| Fire | left click or `Space` | right stick (fires while held) |
| Dash | `Shift` or right click | `DASH` button |
| Pause | `P` or `Esc` | pause button, top right |
| Mute | `M` | note button, top right |
| Restart | `R` on the game-over screen | `RESTART` |

## How it's built

`game.js` is plain ES5-flavoured JavaScript in one IIFE — no modules, no bundler.

- **All geometry is procedural.** Cones, boxes, octahedra, dodecahedra and
  icosahedra with `flatShading`, plus a canvas-generated grid texture for the floor.
  No models, no image files, no audio files.
- **All sound is synthesized** with the Web Audio API — oscillators for shots and
  pickups, filtered noise bursts for impacts and explosions, through a compressor.
- **Everything is pooled**: bullets, enemies, pickups and spawn markers recycle
  their meshes, and 900 explosion particles live in a single `InstancedMesh`.
- **Hit detection is swept.** A bullet moving 62 units/second covers more ground per
  frame than its own radius, so bullets test the *segment* they travelled against
  each target rather than their end point — otherwise shots tunnel through enemies
  whenever a frame runs long.
- **The camera reframes for aspect ratio.** It pulls back on narrow screens so a
  phone in portrait sees the same width of arena a desktop does.
- **Quality adapts**: if the first few seconds average under 40fps, shadows switch
  off once and stay off.

---

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

### A worked example

Generated from a fixed example seed, not a live daily, so this spoils nothing.
Solution `4 5 6 4 3`, from these five clues:

1. Dial 2 is higher than dial 5
2. Dial 4 and dial 5 are consecutive numbers
3. Dial 1 and dial 4 add up to 8
4. Dial 3 and dial 4 add up to 10
5. Dial 1 and dial 2 are consecutive numbers

Clue 4 leaves three options for dials 3 and 4, since neither can exceed 6:
`(4,6)`, `(5,5)`, `(6,4)`. Clue 3 then fixes dial 1 in each case — `2`, `3`, `4`
respectively. Now clue 1 kills two of them: with dial 4 at 6, clue 2 forces dial 5
to 5, but clue 5 caps dial 2 at 3; with dial 4 at 5, dial 2 tops out at 4 and dial 5
starts at 4. Only the third survives, and it resolves to dial 5 = 3, dial 2 = 5.

Answer: `4 5 6 4 3`. Every step is elimination — nothing is guessed.

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

`abyss.html` is **Abyss**, an idle deep-sea salvage game — built before I understood
you didn't want an idle game. Left in place in case it's ever useful; ignore it
otherwise. Its notes are in the commit history. (It used to be `index.html`; that
slot now belongs to Voidbreaker so the repo has a playable landing page.)
