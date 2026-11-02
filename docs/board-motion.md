# The board as a live report stream

Decided 2 November 2026 (Emel). Built in Phase 2. It adds to spec §7 and changes nothing the
spec asks for: the headline, sub-line, counts, latest report time and top failing forms all
stay, as text, on every card.

## What it is

Each system card carries a timeline of the last hour, oldest on the left, now on the right.

```
eFPS  ── Having problems ──

 worked  ○  ○ ○    ○  ○ ○   ○
 ───────────────────────────── now
 failed      ●  ●●  ● ●●● ●●

 60 min ago              now
 tap a moment → 2550Q · Submit fails or hangs
```

- **One dot per report.** "It worked" sits above the line, "It failed" below it.
- **It moves on its own.** The timeline slides slowly left as time passes; dots older than the
  window slide off the left edge. New reports from the 30-second poll drop in at the right.
- **The headline follows the balance.** When the state changes ("Working" to "Having
  problems"), the headline cross-fades and the card's accent changes with it.
- **Your own report lands in front of you.** After "Report my filing", your dot drops in
  marked "you", so the reader sees it counted.
- **A BIR advisory is a band.** When the state is `official_down`, a shaded band labelled
  "BIR advisory: unavailable" covers the advisory's span, and links to it.

## Interaction

- **Tap or click any point on the timeline** to see that five-minute slice: how many worked,
  how many failed, the forms named and the most common failure type.
- **Keyboard:** the timeline is one focusable control. Left and right arrows step through the
  twelve five-minute slices and the detail line updates; Escape clears it. Individual dots are
  not tab stops, because forty of them would be forty tab presses.
- On a phone the tap target is the whole slice column, not the dot.

## Rules it must keep

- **Status is never colour alone.** Above or below the line, hollow or filled, and the words in
  the headline all say the same thing. Someone who cannot tell the colours apart loses nothing.
- **The graphic never claims more than the data.** No placeholder dots, no simulated traffic,
  no animation that suggests activity when there is none. An empty hour is an empty line with
  "No reports in the last hour".
- **Reduced motion means still.** With `prefers-reduced-motion: reduce` the timeline redraws on
  each poll without sliding, dots appear without dropping, and the headline swaps without
  fading.
- **The report form never moves.** As on kataxpayer.com, nothing shifts while somebody is
  filling something in.
- **Screen readers get the text.** The SVG is labelled with the same sentence the card shows
  ("12 failed, 3 worked in the last hour"), and the slice detail is a live region.
- **360px wide**, no sideways scroll, and Lighthouse accessibility 90 or above, as Phase 2
  already requires.
- **Light.** SVG and CSS or the Web Animations API, no animation library, so a phone on a
  deadline night with weak signal still loads it fast.

## What it needs from the data

`GET /api/status` gains, per system, the reports in the window as bare points:

```json
{ "t": "2026-11-02T13:41:00Z", "outcome": "fail", "form": "2550Q", "failure": "submit_failed" }
```

- Time rounded **down to the minute**, so a point cannot be matched to a person's moment of
  submission.
- **No hash, no ID, nothing else.** Exactly the fields above.
- Capped at 300 points per system. Past that, the oldest are dropped from the drawing (never from
  the counts, which still come from `compute_status`).

This keeps the spec's rule: `anon` still has no access to `reports`; the server reads them
with the service-role key and hands out only these fields.
