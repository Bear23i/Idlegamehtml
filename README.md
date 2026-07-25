# Abyss

An idle deep-sea salvage game. One HTML file, no build step, no dependencies —
open `index.html` and it runs.

## Play it on your phone

Easiest options, cheapest first:

1. **AirDrop / email the file to yourself**, open it in Safari or Chrome. It works
   offline; the save lives in that browser's `localStorage`.
2. **Add to Home Screen** (Safari: Share → Add to Home Screen). It launches
   fullscreen with no browser chrome and looks like a real app.
3. **GitHub Pages** — in repo Settings → Pages, serve from the `main` branch root.
   You get a URL you can open on any device.

Careful: the save is per-browser. Clearing site data wipes it. There's a
**Copy save to clipboard** button on the Surface tab for moving between devices.

## The loop

You are lowering a salvage operation into the ocean, and everything gets better
the deeper you get.

- **Dredge** — tap for salvage. Early on this is most of your income; later it's
  a top-up while you wait.
- **Ballast** — buy pumps to sink faster. Depth is the real progress bar.
- **Depth** does three things: unlocks crew, unlocks research, and multiplies all
  production (`×1 + depth/400`).
- **Crew** — eight tiers of automation, from a free diver to whatever the Abyssal
  Maw is. Each costs 15% more per unit, and every 25 you own doubles that tier's
  output.
- **Research** — one-time permanent upgrades, gated by the deepest you have *ever*
  been. These survive prestige, so they're the spine of long-term progress.
- **Surface** — prestige. Trade the dive for pearls (`(depth/1000)^1.2 × 4`), which
  give +8% production and +3% descent each, forever. Costs you salvage, crew and
  ballast; keeps pearls and research.

**Pressure drag** is the thing that keeps it honest: effective descent is
`thrust / (1 + (depth/2000)^0.85)`. Without it, depth compounds and the whole game
falls over about three prestiges in — I simulated it and hit 1.2 million metres,
which is another way of saying "no game left".

Offline progress is credited at full rate, capped at 12 hours.

## Pacing

Simulated with a greedy buy-everything bot (a real player does better):

| | first crew unlock | first surface | after 45 min |
|---|---|---|---|
| Run 1 (fresh) | 1m 42s | 17m | 6.1 km deep, 35 pearls |
| Run 2 (10 pearls) | 21s | 3m 30s | 18 km deep, 129 pearls |
| Run 5 (200 pearls) | 1s | 10s | 98 km deep, 984 pearls |

Roughly a 4–8× jump per prestige, which is about where an idle game wants to sit.

## Tuning it

All the balance lives in two arrays at the top of the `<script>`: `GENERATORS` and
`UPGRADES`. Rates, costs, depth gates and flavour text are all there. The knobs
most worth touching:

- `drag()` — the exponent controls how hard late-game depth walls up.
- `pearlGain()` — prestige generosity.
- `pressureMult()` — how much depth itself is worth.
- generator `base` / `rate` — the classic cost-vs-output curve.

## Other directions, if this one doesn't grab you

Same single-file, phone-first shape — only the theme and the middle mechanic change:

- **Signal** — you run a radio telescope. "Depth" becomes distance in light-years,
  crew become dishes and arrays, and prestige is publishing a paper. Good excuse
  for a slowly-decoded alien message that reveals a line per prestige, which gives
  you actual narrative payoff instead of just bigger numbers.
- **Terrarium** — no numbers-go-up framing at all. You seed a jar; moss, then fungi,
  then insects. Ticks are slow (hours, not seconds), you check in twice a day, and
  the reward is that the jar *looks* different. Much better fit if you want
  something calm rather than compulsive.
- **Vending Empire** — one machine, then a route, then a city. Restocking and price
  setting instead of tapping, with demand that varies by location. The mechanic
  here is a light optimisation puzzle, not a tap target.
- **Dig Down** — the same skeleton as Abyss but you control *where*: a grid you
  reveal tile by tile, with ore veins and cave-ins. Adds real decisions and works
  well with a swipe interface.
- **Kiln** — crafting chains. Clay → pots → glazed pots → commissions. Idle games
  with a crafting tree feel very different to play: your bottleneck is an input you
  ran out of, not a number that isn't big enough yet.

Say the word and I'll build any of them out the same way.
