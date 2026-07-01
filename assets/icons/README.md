# Category chip icons

Custom full-colour PNG icons for the home-screen category chips
(`app/(tabs)/index.tsx`).

Drop files here, then register them in
[`src/constants/categoryIcons.ts`](../../src/constants/categoryIcons.ts).

## Conventions
- **Format:** PNG, transparent background, square.
- **Size:** chips render the icon at **16pt**, so ship ~3× for sharpness —
  **48×48 or 64×64**. Optionally add `name@2x.png` / `name@3x.png` variants and
  `require("…/name.png")` — Metro picks the right density automatically.
- **Colour:** drawn as-is (no tint). They do **not** recolour when a chip is
  active — only the chip background highlights.

## Expected filenames
One per category id: `all.png`, `jerk.png`, `seafood.png`, `patties.png`,
`ital.png`, `sweets.png`. A category with no PNG falls back to its current
vector icon, so you can add them one at a time.
