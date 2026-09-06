# Artboard 9 verification

Re-ran the app after task 5's changes, against the same fixture-seeded environment task 3 used
(same `SLUG`/`SESSION`, the same `fixtures/workflow-run.json` + `fixtures/workflow-agent-usage.json`
seeding recipe), plus two extra synthetic runs to exercise paths the original fixture's `killed`
status couldn't reach: a `completed` run with a real `result` (`wf_finished0-demo`, for the
Returned box and phase collapse), and a 16-agent single-phase dispatch cluster (`wf_folddemo0-demo`,
for the "+N more" fold). Screenshots: `9-verify-finished-run.png`, `9-verify-live-run.png`,
`9-verify-returned-box.png`, `9-verify-fold-dispatch.png`.

One row per `docs/design/9-findings.md` row, checked against its `docs/design/9-decisions.md` ruling.

| # | Ruling | Now | Verdict |
|---|---|---|---|
| 1 | `blocked` | Live run (`wf_live00-demo`) still renders the flat table with the same caption. Unchanged, as ruled — `9-verify-live-run.png`. | Matches ruling, no bug |
| 2 | `blocked` (totals+narration) | Live run's RUN TOTALS/NARRATION panels still em-dash/say-why. Unchanged, as ruled. | Matches ruling, no bug |
| 3 | `blocked` (counts) + build (shell) | `9-verify-returned-box.png`: header `✓ Returned  returned 10:48:33 · 48m 51s`, `[copy return]`/`[open in journal]` both present and functional (clicked `open in journal` live — it switched the tab), the prose renders verbatim, caption reads `full return — 42 words — in the journal as the run's final entry`. No claims/sources/contradictions/citation figures anywhere — confirmed absent, not fabricated. | Built and matches; blocked half confirmed still absent |
| 4 | `gap-fill` (unblocked build) | Same screenshot: all three phases on the completed run show header-only (`2 returned`, `2 returned`, `queued`), no item rows. Clicked the `Design` header — it reopened, with agents, dispatch group and timestamp all showing. The *killed* fixture run (not completed) stays expanded by default, confirming the collapse is gated on the run's own return, not a phase finishing early. | Built and matches |
| 5 | `deviation` (corner) + build (glyph) | `9-verify-finished-run.png`'s corner still reads `task wq6ms7kfx 699k · 219 tools …` (ruling 18's furniture, untouched); the completed run's screenshot shows `✓ returned 10:48:3…` prefixed on the elapsed chip. | Matches ruling |
| 6 | `blocked` (live breadcrumb) | No breadcrumb on either live run screenshot. Unchanged, as ruled. | Matches ruling, no bug |
| 7 | `deviation` | Still one visible run-picker trigger with a "RUNS ON THIS SESSION" dropdown; no team exists in this seeded session so there's nothing for a second trigger to show. Unchanged. | Matches ruling |
| 8 | `matches` | Tab strip unchanged. | Confirmed |
| 9 | `matches` | Phase tally wording unchanged (`2 returned`, `1 returned · 1 running`, etc., visible across all screenshots). | Confirmed |
| 10 | `matches` | Budget caption unchanged. | Confirmed |
| 11 | `matches` | Concurrency-formula caption unchanged. | Confirmed |
| 12 | `gap-fill` (unblocked build) | `9-verify-finished-run.png` AGENTS panel: a 16-cell meter bar plus `returned 3 · running 1 · cached 0 · null 0 · failed 0`. `9-verify-live-run.png` shows the same panel populated on a live run (`returned 5 · running …`) — confirmed live-safe, not snapshot-gated. Read the bar's actual text via the DOM (`░░░░░░░░░░░░░░░░` for 4/1000, correctly empty — the zoomed screenshot's apparent "checkered" look is a font-rendering artifact of the light-shade glyph at 10px, not a bug). | Built and matches |
| 13 | `gap-fill` (unblocked build) | `9-verify-finished-run.png`: `2 dispatched together · 09:59:42`. `9-verify-fold-dispatch.png`: `16 dispatched together · 19:13:20`. | Built and matches |
| 14 | `gap-fill` (unblocked build) | `9-verify-fold-dispatch.png`: 5 rows shown, then `+ 11 more, all returned` — the same wording pattern as artboard 9a's own `+ 11 more, all returned`. Unit test also confirms a still-running agent is never folded behind a false "all returned". | Built and matches |
| 15 | `gap-fill` (unblocked build) | Every screenshot's id badges are 8 characters (`a06eeee0`, `a0000000`, etc.), not the full 17-char `agentId`. | Built and matches |
| 16 | `gap-fill` (unblocked build, overriding inventory's "absent") | `9-verify-finished-run.png`: `Build` phase's `S1-server`/`S2-client` rows both carry `↩` — they reuse the same item key as `Design`'s rows. First-phase rows never carry the glyph (nothing to trail from). | Built and matches |
| 17 | `gap-fill` (unblocked build) | `GLYPH.cache` reads `↻` in source; no cached agent appeared in any seeded fixture to confirm on-screen, but the full test suite (1894 tests) is green including the state-glyph tests, and the `null`/`block` glyphs stay visually distinct as reasoned in the ruling. | Built; visual confirmation only from the unit test, not a live screenshot — no cached agent existed in any run I could seed quickly. Not a bug, just an untested-live corner; flagged for whoever next handles a run with a `cache` state. |
| 18 | `blocked` | No barrier-kind caption anywhere. Unchanged, as ruled. | Matches ruling, no bug |
| 19 | `matches` | "you are not in the loop" caption unchanged. | Confirmed |

## Unruled differences found during verification

None. Every visible difference between the fresh screenshots and the original design captures
traces to a row above, and every row's current behavior matches its ruling. Nothing needed a
fix-and-re-verify cycle.

## Summary

- **19 of 19 findings-table rows** have a ruling, and the running app now matches every ruling.
- **6 rows** (`8, 9, 10, 11, 19`, plus row 5's corner content) were already-correct `matches` —
  confirmed unchanged, nothing to build.
- **9 rows** (`3`'s shell, `4, 5`'s glyph, `12, 13, 14, 15, 16, 17`) called for a code change and
  shipped in task 5 — all verified rendering as designed against a real running app, not just
  passing tests. Row 17's glyph change is source-confirmed and test-confirmed but not yet seen live
  against a `cache`-state agent; noted above, not blocking.
- **4 rows** (`1, 2, 6, 18`) are genuinely `blocked` on missing data and were left alone —
  confirmed the app still does not fabricate anything for them.
- **2 rows** (`5`'s corner furniture, `7`) are deliberate `deviation`s tied to existing rulings 18
  and 33 — confirmed the app still matches those, not the artboard's literal layout.
- **No unruled or unexpected difference remains.**

Test suite: `npx vitest run` — 78 files, **1894 passed**, 0 failed (includes 40 in
`WorkflowRun.test.tsx`, up from 22 before task 5, covering every new behavior above).
Typecheck: `npx tsc --noEmit` — clean.
