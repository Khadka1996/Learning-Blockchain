# LinkedIn image card — design spec

Every LinkedIn post gets one designed image (PNG, 1080 × 1350, portrait — the size LinkedIn shows largest in the feed).

Build it as HTML → PNG (Playwright/Chromium screenshot, which is pre-installed) so it is crisp.

## Layout
- **Background:** deep navy `#0B1F3A` with a subtle grid or hexagon pattern at ~6% opacity.
- **Top-left:** small pill `DAY XX / 15` (white text on `#2563EB`), and `#LearningBlockchain` beside it in light grey.
- **Headline:** the day's single biggest idea in 6–10 words, 64–76 px, bold, white (e.g. "One digit changed. 53.5% of the hash flipped.").
- **Middle:** ONE visual that teaches — a mini diagram (blocks linked by hashes, a Merkle tree, an AMM curve, attacker → contract flow), a short code snippet in a dark rounded box with syntax colours, or a big stat number.
- **Bottom strip:** 3 tiny takeaways with → bullets, 26–30 px, `#CBD5E1`.
- **Footer:** `Manish Khadka · github.com/Khadka1996/Learning-Blockchain` at 22 px, plus a 15-segment progress bar (completed days filled `#22D3EE`).
- Fonts: Inter (headings/body) and JetBrains Mono (code). Generous padding (72 px). Max 45 words on the card.

## Morning vs evening
- **Morning card:** "concept" style — headline + diagram.
- **Evening card:** "recap / audit" style — headline about the lesson or bug found, before/after code or a findings mini-table, ✅ badge.

## Quality check
Render, open the PNG and look at it: nothing cut off, text readable on a phone, no overlap, colours consistent across days. Fix and re-render until it is clean.
