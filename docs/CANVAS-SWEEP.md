# Canvas sweep — every artboard against the code

*2026-09-05. Audit only; nothing in this file changes code. Written before acting, per the
operator's ask.*

**Sources.** The **live canvas** at
`https://claude.ai/design/p/acd1d00a-5b91-4942-ac4e-cb500cede543` (file `Octo Agent Console -
Canvas.dc.html`) — read both rendered (browser walk) and as source (via DesignSync `get_file`;
**the read capped at 256 KiB, so the file's tail was not text-verified** — rendered walks cover
what the cap cut). Code state from two fresh inventories (teammates chrome + views; workflow +
picker) plus this week's build sessions. Rulings cited are rows in `CONSOLE-DECISIONS.md`.

The canvas is **live and newer than the repo in places** — its design-chat sidebar shows edits
("Edited 4 files") that post-date the handoff bundle the repo was built from. Where canvas and
repo docs disagree below, the canvas is the newest voice by the project's own hierarchy.

---

## 1. The switcher, kind by kind (the question that prompted this sweep)

What the code offers, decided at `StatusBar.tsx:202` (`views={solo ? soloViews(hasSubagents) :
VIEW_IDS}`) with `solo` from `App.tsx:64` and workflow forking earlier at the mode switch:

| Session kind | Pills the code offers | Canvas authority |
|---|---|---|
| `solo`, no subagents | `stream` (one pill) | gap-fill — no artboard draws a bare session (decisions §"canvas does not answer") |
| `subagents` | `stream · trace` (+ both again in the solo footer) | §8 mocks, verified live 2026-09-05 (trace screenshot, turn 15) |
| `teammates` | `wall · overview · comms · tasks · rail · grid · usage` | `4a`, verified live 2026-09-05 (team wall screenshot) |
| `workflow` | `run · agents · script · journal · usage` (`Workflow.tsx:16`) | `6a` caption: "Views: run · agents · script · journal" + usage in the mock — **not re-rendered against a live run this pass** (no workflow session on this machine to open) |

**Why the pills can *look* wrong anyway — two real mechanisms, no code defect found:**

1. **Selection is server-global, not per-tab.** One console process holds one `current`; every
   open tab follows it. During this sweep, tab A selecting a session flipped tab B's whole
   chrome — with the dev pair up, `localhost:5173` and `:4824` are the *same* backend, so two
   tabs on "different" sessions silently fight, and the loser's switcher reads as the wrong
   kind's pills. If this bites, it deserves a design conversation (per-tab viewing vs. one
   console-one-subject), not a patch.
2. **`comms` needs a pair.** Not pill-related but adjacent: the seven team pills always render
   for teammates; nothing hides pills by roster shape except the solo fork.

One asymmetry to know when comparing with the canvas: mock `8a` draws the browser URL
`?view=trace` while its own highlighted pill is `stream` — the canvas contradicts itself there;
the app follows the pill.

---

## 2. Column by column, artboard by artboard

### sub-agents — 1 study (§8, plus `1c`'s ASCII cousin)

| Board | What it draws | Code state |
|---|---|---|
| `8a` trace | strip (SUBAGENTS · MAX DEPTH · TOKENS IN SUBAGENTS · SHOWN TO PARENT · SPEND · ratio note), `CALL/TOKENS` ruler, `main [parent turn]` lane, type-pill lanes, durations at bar end, `depth 3` text, selected-lane edge, detail panel (`open transcript` · `agent-*.jsonl`) | **done** (rulings 33/34), verified live. Two remainders: parent lane's TOKENS cell **blocked** (no turn-scoped billed-token source — ruling 33); axis draws the session's whole dispatch history while `8a` assumes one turn — **open question**, operator hasn't ruled (turn-scoping offered 2026-09-05) |
| §8 stream mock | `Task(type, name)`, no pill, `returned N words · X used · spawned M` / `running · X so far`, headerless body, footer `view stream·trace · N subagents · tokens · esc interrupts the turn` | **done** (rulings 32/34), solo-scoped after the team wall briefly lost its pills (32's scope note) |
| `8b` task row | `Task(name)` + type pill, `tokens · duration`, drawer with dimmed nested transcript, full-strength `⎿`, drawer footer `no reply channel…` + `trace/collapse` | **done**; team columns re-verified live after the regression fix |
| `8c` fan-out | one dispatch line, strip of state chips, "the only control with a call behind it kills" | built in an earlier pass; **not re-rendered this week** |

### teammates — 6 studies

| Board | What it draws | Code state |
|---|---|---|
| `1a` rail | orchestrator stream + scannable agent list, bordered detail-type badge, key legend | built (Rail.tsx matches inventory); not re-rendered this week |
| `1b` grid | 3×2 panes, per-pane header/meter, `+N more` overflow chip | built; not re-rendered this week |
| `1c` fan-out as terminal | ASCII octopus scrolling with the transcript | **decorative artboard — no code claim found either way; likely never built. Flag for a ruling** (build, or record a `deviation`) |
| `2a` column wall | full-height terminals, lead pinned left, sideways scroll | done (lead sticky/scroll per Wall inventory) |
| `2b` overview | full-bleed tiles, per-tile type/model/status/meter | built; not re-rendered this week |
| `3a` the wall | headers with portrait + type pill, one composer, needs-you strip, PANEL footer | **done**, re-verified live 2026-09-05 |
| `3b` tasks | progress strip + 4-step stepper ladder, column widths per ruling 10, `queued` word per ruling 11 | built per rulings; not re-rendered this week |
| `4a` seven views | the switcher, labels verbatim, chrome never moves | **done**, verified |
| `5b` drawer | pretty-printed JSON, four semantic tokens, own edge | built (ruling 9 token names); not re-rendered this week |
| `7a` leaving | chrome stays, body empties, picker is the way back | done (LeftSession/NoSessions per rulings 23) |
| `7b` confirm strip | "two verbs, never merged" — stop watching vs end session | done (WatchConfirm/StopConfirm exist; wording not re-checked against mock this pass) |

### workflow — 1 study

| Board | What it draws | Code state |
|---|---|---|
| `6a` run view | five views, workflow kind pill, phase grid, state glyph vocabulary, RUN TOTALS/LIMITS/NARRATION panels | built with documented refusals: budget bar absent (`WorkflowRun.tsx:368` — nothing on disk), phases only in terminal snapshots (ruling 31 splits live/finished), slot count formula-only. **Never rendered against a live run in this cycle** — no workflow session on this machine to open |

---

## 3. The picker — where the canvas moved ahead of the code

The canvas's picker mock (§2-adjacent, the SESSIONS panel) now draws, per extracted markup:

```
SESSIONS ON  [ repoName · repoPath ▾ ]              N
             └ 288px folder menu: one row per project directory, with session count
```

The code (`SessionPicker.tsx:390`) draws `SESSIONS IN THIS FOLDER · N` + search. **No folder
chip, no folder menu, no per-directory counts exist anywhere in the code** (confirmed by
inventory — `TeamSummary` carries no cwd field to even render one). The scoping *behavior*
matches (list is folder-scoped, commit `5256c83`); the *navigation between folders* is
canvas-only.

Consequence for the rulings file: decision 23's header note ("back to the design's `SESSIONS ON
THIS MACHINE`") and the code comment at `SessionPicker.tsx:382` both cite a canvas that has
since moved — the live canvas says `SESSIONS ON <folder chip>`. Reopen 23's header clause when
implementing.

Recent picker work not drawn on the canvas (gap-fills in good standing): search field, hide/✕
per row, `stop watching` on the current row, recency-stable ordering (no current-first pin),
short-id titles for unnamed sessions, kind pills on rows.

---

## 4. Everything currently missing or undecided, in priority order

1. **Folder chip + folder menu in the picker** (`SESSIONS ON [octo · ~/code/octo ▾]`) — the one
   whole feature the live canvas has that the code lacks. Needs: cwd/per-directory counts from
   the server (new field on `TeamSummary`), the chip, the 288px menu, scope-follows-current rule
   ("opening the picker never scopes away from what you're watching").
2. **Two tabs, one selection** — server-global `current` makes simultaneous tabs fight; at
   minimum document it, at best rule on per-tab viewing. This is the likeliest cause of "pills
   don't match the session kind I picked".
3. **Trace axis scope** — whole-history (current) vs current-turn (`8a`'s framing). Awaiting
   the operator's call; one-line change either way, plus a decisions row.
4. **`1c` ASCII fan-out** — no ruling, no code. Decide: build or record a deviation.
5. **Parent lane TOKENS cell** — stays empty until a turn-scoped billed-token figure exists on
   disk (ruling 33's `blocked` clause names the missing field).
6. **Workflow mode end-to-end render** — `6a` has never been through this cycle's
   render-and-compare loop; needs a machine with a real run (or a replayed snapshot fixture).
7. **Stale citations** — `CONSOLE-DECISIONS.md`'s "what outranks what" §1 still points at the
   local handoff directory for the canvas; the canvas now lives (and changes) at the Claude
   Design URL above. Update the pointer, and re-date decision 23's header clause per §3.
8. **Not text-verified**: the canvas file's final ~10% (256 KiB read cap) and the
   comms/messaging mocks (governed by `MESSAGING.md`, built in earlier passes) — rendered walks
   saw nothing contradicting the code there, but this sweep can't certify them.

## 5. Verified-good this cycle (no action)

Solo stream anatomy + footer (32/34) · solo trace furniture (33/34, incl. `main`) · team wall
pills and headers (32's scope note) · seven/two-pill switchers live · picker ordering + short
ids · `returnedWords` fold (counted pre-cap) · composer's no-live-team hint (8b's line, queueing
intact) · 1836 tests green at `3a61ce8`.
