# people-map-site: checks

The gate: `node scripts/quick-check.mjs` (runs by itself when a chat finishes, Stop hook). Test the tester: `node scripts/test-the-tester.mjs` (each planted break in `scripts/gate-breaks.mjs` must FAIL).
Rung = Lauren Tan's ladder: 1 impossible by design · 2 the build fails naming the fix · 3 a check catches it · 4 text only (chats skip it). Move rows up, never down.

| Rule or past bug | Enforced by | Rung | Proven to fail |
|---|---|---|---|
| The privacy policy says exactly what People Map asks Google for (6778e90: said read-only while the app wrote contacts; 2026-10-25: said "read your Google Calendar" while the app edits events since 2f446f4) | quick-check "privacy policy says what the app really asks Google for" (reads SCOPE in `people-map/lib/google.mjs`) | 3 | 2026-10-25: failed on the live page (calendar), and planted `policy-says-read-only` |
| Pages call it a private notebook, never a map of where people are (6b56cb2) | quick-check "pages call it a private notebook" | 3 | 2026-10-25 planted `home-page-locates-people` |
| Home links the privacy policy and terms (Google's sign-in screen needs both); no broken links; a contact address | quick-check "links" | 3 | 2026-10-25 planted `no-privacy-link` |
| No sideways scroll, spills, squashed text or console errors on the 3 pages | shared UI audit (1440 / 780 / 375) | 3 | its `--self-test` |
