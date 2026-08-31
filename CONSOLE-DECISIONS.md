# Console decisions

The design bundle (`agents-team-ui-docs/design/`: `README.md`, `CHANGELOG.md`, `MESSAGING.md`,
`Octo Session Console.dc.html`) contradicts itself in about twenty places, and this app picked
sides one site at a time. This file settles each one. It is the tie-breaker: where a design
document and this file disagree, this file wins, and a reopened question needs a new row here
rather than a change in a component.

**How these were decided**

1. The CHANGELOG's top entry (*Reconciled with the console at 0.6.5*) is the newest voice and
   usually governs.
2. The prototype — turn `4a` for team mode, `6a`/`7a` for the others — governs where prose is
   silent, and its build target is `4a`, not the earlier reference frames.
3. A measured argument (contrast, a width someone actually measured) beats an aesthetic one.
4. Standing rule 1 still holds: a control that names no runtime call does not ship.

Every ruling below has been applied to the console. Where a row describes what "the app" does,
that is the state at the time of the ruling — kept because it is the evidence, not a status.

## The rulings

| # | Conflict | Sources | Ruling | Why |
|---|---|---|---|---|
| 1 | Quiet-register colour and size | CHANGELOG `neutral-600` @ 10px (measured 2.69–2.80:1 against `-700`) · README `neutral-700` @ 10.5px · app split | **`--color-neutral-600` at 10px.** Scope in the note below. | Measured: `-700` on `--color-bg` is 2.69:1, `-600` is 4.09:1. Contrast beats taste. |
| 2 | What the `!` context warning reads | app 0.75 × `compactAt` (≈63% displayed on a 200k window) · README "past the threshold (default 75%)" · prototype `p = tok/200000; p >= warnAt/100` | **The displayed percent: `tokens / contextLimit >= 0.75`.** Formula in the note below. | README and the reference build agree, and a configurable "75%" that lights at 63% on screen is a setting the operator cannot verify. |
| 3 | Status-bar metric labels | README `tasks 3/11` + `6 context windows` · CHANGELOG `3/11 tasks` + `4 ctx` · prototype `4a` `3/11 tasks` + `4 ctx` · app splits the bullet (`tasks 3/11` + `4 windows`) | **`3/11 tasks` and `4 ctx`.** | Newest voice and the built screen agree, and the shortening was paid for by a measured overflow — the bar passed 1180px and silently doubled in height. |
| 4 | Transcript line gap | README 6 / 7 / 4–5px · CHANGELOG 10 / 11 / 7–8px · prototype density-driven | **Density-driven.** `compact 5 / default 10 / roomy 16` in wall and rail panes; condensed panes take `max(3, density − 3)` → 2 / 7 / 13. | Both fixed sets are snapshots of one density setting, and `line density` is a config control that must actually change the render. App is already right. |
| 5 | Glyph marker colour | README `--color-accent-600` · CHANGELOG + prototype + app `--color-accent-500` | **`--color-accent-500`.** | The CHANGELOG unified markers on `-500`; README's `-600` is the pre-unification value it never went back and fixed. App is already right. |
| 6 | Transcript line text colour | README says `--color-neutral-300` and `--color-neutral-500` in the same paragraph | **`--color-neutral-300`.** | `-500` is the flat base colour the per-line opacity ladder replaced — "the fade does the ranking, not a dim base colour". The `-500` half of the sentence is the leftover. App is already right. |
| 7a | Chat bubble grounds | README `--color-bg` / `neutral-900` edge vs `accent-900` / `accent-700` edge · prototype `neutral-900` / `neutral-800` edge vs `accent-700` / `accent-600` edge · app uses the prototype pair in the everyone room and the README pair in the pair thread | **One pair, both rooms.** Left speaker: `--color-neutral-900` fill, `--color-neutral-800` edge, `--color-neutral-200` text. Right speaker (the operator, or the second participant): `--color-accent-700` fill, `--color-accent-600` edge, `--color-text`. | `accent-900` with an inset `accent-500` is the *selected row* tint everywhere else in the console, so a bubble drawn on it reads as a selection. The prototype pair also measures 5.6:1 for its text. Same reasoning as `max-width: 64%` — one constant, consumed by both rooms, so they cannot drift. |
| 7b | Everyone-room label and subtitle | README "everyone" / "every message, one room" · CHANGELOG + prototype + app `all messages` / `every inbox, merged` | **`all messages` / `every inbox, merged`.** | There is no group inbox; the room is a view over every inbox, and the subtitle should say so rather than imply a room that exists. App is already right. |
| 7c | Recipient label under a room line | README `to <agent>` · prototype `→ <name>`, `to everyone` for a broadcast | **`→ <name>`, and `to everyone` only when the fold reached every other member.** | `→` is the routing arrow the mailbox meta line already uses; "everyone" is not a recipient an arrow can point at, because no such inbox exists. The mixed form is the point. App is already right. |
| 8 | Composer hint | README `⌘⏎` · MESSAGING §5 + CHANGELOG + prototype `⏎` | **`⏎`.** Enter sends, ⇧⏎ newlines, ⌘⏎ still sends but is not named. | Naming the one key that used to do nothing was most of the old trap. App is already right — recolour the glyph per ruling 1. |
| 9 | JSON boolean token | CHANGELOG diff-viewer entry `--json-bool` · README standing rule 2 + CHANGELOG 0.6.5 + app `--json-boolean` | **`--json-boolean`.** | The two newest voices agree and the app ships it; the `--json-bool` spelling predates both. The prototype's `--json-bool` is the same stale spelling. App is already right. |
| 10 | Task table column widths | README `STATE` 92px / `DEPENDS ON` 88px · CHANGELOG 118 / 76 (arrives with the stepper) · prototype `4a` and `3b` draw 118 / 76 | **`STATE` 118px, `DEPENDS ON` 76px**, `MODEL` 60px between `STATE` and `OWNER`, `DESCRIPTION` flex. | The four-cell stepper needs the width and the ids in `DEPENDS ON` do not; the prototype already draws the post-stepper widths. README's 92/88 predates the stepper. |
| 11 | The `·` cell state word | README (Screen 3) "queued for a slot" · CHANGELOG (turn-6 entry) "waiting" · prototype legend omits `·` entirely | **`queued`.** | The top CHANGELOG entry explicitly hands workflow mode to README's Screen 3 rewrite, which makes README the newest voice here; the prototype is silent, so prose decides. |
| 12 | `respawn` on the failure card | Standing rule 1 struck it · README Screen 1 still specifies it · app ships it, backed by `POST /api/agents/{name}/respawn` → a lead-inbox write (`src/server/http.ts:374`) | **Kept.** The card names what the call does — it asks the lead to respawn the teammate — and must never imply the console restarts a process. | Standing rule 1 removes controls with *no* call. This one has one. Rule 1 satisfied is rule 1 obeyed, not evaded. |
| 13 | `experimental` pill | README Screen 1 keeps it · CHANGELOG drops it from the 4a bar · prototype has it in `3a` only | **Dropped.** | It was traded for branch + diffstat when the bar ran out of room. README's Screen 1 documents `3a`, the earlier reference frame — it is not wrong, it is not about the screen being built. App is already right. |
| 14 | Session picker: trigger content, menu width | README trigger = session id + goal, menu 432px · CHANGELOG config-panel entry: the id came out and the goal capped at 146px · older CHANGELOG entry + app: 432px · prototype `4a`: goal alone at 146px, menu **520px** | **Trigger: the goal alone, capped at 146px, plus the optional in-world team chip and the caret — no session id. Menu: 520px.** | The gear cost the bar ~30px and the id is what paid for it; app already matches. The width follows the same entry: the reconcile turned each row into two lines, and 432px predates that. Measured below. |
| 15 | Marking every non-lead wall column `read-only` | README:118 (the One-composer rewrite) "Every other column is marked `read-only`" · the prototype draws no such marking · standing rule 4 says do not write what the prototype does not do | **Kept.** Every non-lead column and the rail's non-lead pane carry it. | Standing rule 4 guards against prose the reference build **contradicts**, not prose it **predates**. The prototype was drawn before the single-composer model existed, so its silence here is an absence, not a disagreement — and the newest voice governs. Without the marking, a column with no composer is indistinguishable from one whose composer failed to render. (Ruled by the team lead during the one-composer close-out; recorded so the next reader of rule 4 does not reopen it.) |
| 16 | The read receipt under a bubble (`read at turn 9`) | README:105 names `var(--color-neutral-700)` for it · ruling 1 says that register is neutral-600 · prototype: `stateCol: unread ? '#d99e5c' : 'var(--color-neutral-600)'` | **`--color-neutral-600` when read.** The unread branch keeps `--warn` — it is a semantic colour and stays. | Ruling 1 overrules the README here, and the prototype agrees with the ruling rather than the prose: it draws the settled receipt at neutral-600 and only the unread one at the attention colour. Recorded because README:105 states `-700` outright, so a reader finding this in the code needs to know it was overruled and not simply missed. |
| 17 | `PR` beside the diffstat | README Screen 1 bar `PR + diffstat` · README data model `PR/diffstat` per team · no source anywhere in the console | **Diffstat shipped, PR refused.** The picker row carries `+N −M` for what is uncommitted against `HEAD`, titled with that reading. Nothing names a PR. | Standing rule 3. `gh` is an optional install; a forge API needs a token, a network call and a per-forge client, which a local read-only console makes none of. `.git/config` yields the remote URL and the tracking branch — the repo, never the pull request — and `refs/remotes/*/pull/*` exists only if someone fetched that refspec by hand. A field with no source is blank for every operator, and nobody reports a blank. Diffstat is scoped to uncommitted work for the same rule: branch-against-base needs a base branch, which means guessing `main` or reading an `origin/HEAD` most clones never set. |
| 18 | What the workflow bar sheds first when it runs out of room | README:64 gives the TEAM bar a drop order (`diffstat first, then combine elapsed and spend, then shed the token figure`) · the design never states one for the workflow bar (`6a`) · the app shed nothing there at all, so the run's figures ran off the frame under 1094px | **`totals`, then `elapsed`, then `taskId`** — lower survives longer, as on the team bar. The mechanism moved into the shared `Bar` so both modes shed; each keeps its own order. | The team bar's precedent is that identity outlives figures (`branch` survives every readout), and the run's identity here is the task id: it names the piece of work the run belongs to and is the one metric not re-derivable from the view below. Elapsed sits where the team bar puts its elapsed-and-spend chip. The totals go first because the agents view carries them in full. Measured, not assumed: with all three shed the bar's remaining furniture still costs 741.48px, which is why the run trigger's cap is `min(236px, 26vw)` rather than a flat 236px — see ruling 19. |
| 19 | The run-picker trigger's width bound | The team trigger pins a flat `146px`, derived from `session-` + 8 hex · the run trigger shipped unbounded, because run names have no shape to derive from · the visual smoke-check then measured a 65-char run name at 610px, 87% of a 700px bar, with every view pill off the frame | **`min(236px, 26vw)`**, with the name ellipsised and the runId and caret never shrunk. | Two terms because one number cannot serve both ends: `236px` is what the 1180px design width can spare and keeps a typical name whole; `26vw` is the narrow end, where the bar's un-sheddable rest (padding, wordmark, the 146px team trigger, four pills, spacer, and the gear, which is chrome and never sheds) costs 741.48px and leaves the trigger at most 27.79% of a 700px frame. A max-width and never a flex-shrink — every child of this bar is `flex: none`, and one that could shrink would wrap and double its height. The identity survives the squeeze whole because a half-drawn runId identifies nothing. |
| 20 | Cast overflow: spares first, or real names first | `movie-themes.json` `overflowKeepsRealNames`: "leaves the extras under their real names. Draw from `spare` **only** if you need more named agents; never invent characters" · README:135 renders the same rule without the *only* — "draw from `spare` if you need more" · CHANGELOG:69 lists spare characters as first-class content of the database, beside the role mapping · the prototype casts nobody · app draws spares in roster order, then falls back to real names (`src/shared/cast.ts:95-98`) | **Spares first, then real names. App is already right.** An agent no free role slot matched takes the next unused `spare` in join order; when the spares run out, every remaining agent keeps its real name. A **vacant role slot is never filled** by an unmatched agent — it stays vacant. | Measured, and it is not close: across the eight teams in `~/.claude/teams` on this machine — 20 members, 8 leads — **zero** non-lead agents match a role slot, because the real types are `general-purpose`, `claude` or unset and none of the five patterns touch them. Real-names-first would therefore rename the lead and nobody else on every team this console has ever run, which is a themed console with no theme. On the prose: sentence 2's condition ("you need more named agents") is the same condition as sentence 1's, so the exception governs the case, and the floor sentence 1 guarantees is kept as the exhaustion path — extras really do end under their real names, once there are more of them than the film has spares. `never invent characters` is the clause with teeth and is untouched. And spares, not vacant seats, are what an unread role gets because **`spare` is the film's role-free pool**: `portraitFor` hashes a face for an agent it cannot place, so seating one in `security` would put "Arthur" on an agent drawn with a random portrait — a name promising a role the console never read. The join-order seeding of the cast (`src/web/App.tsx:213-225`) stays load-bearing under this ruling: spares are dealt positionally, so the roster order they are dealt from must be the append-only one. |

## The four that need more than a table cell

**1 — what the quiet register covers.** It is small, quiet *metadata text*: column-header rows,
footer notes, meta and hint lines, key legends, empty-state copy, timestamps, delivery receipts,
read-only markings, the composer's `⏎` glyph. All of it `--color-neutral-600`.

**The size is a floor, not a target.** 10px is the smallest this register may be drawn, and
anything below it — the 9.5px the contrast rule was written against — comes up to 10. Text
already at 10.5 or 11px stays there: the prototype draws this register at 10.5px in the wall,
the rail and the task table, and shrinking it would cost legibility in the name of a rule whose
entire purpose is legibility. Match the neighbours in the same pane rather than one global
number — the wall's read-only marking sits with the current-tool line at 10.5px, the rail's sits
in the composer's slot at 11px, the drawer's meta lines are 10px.

It does **not** cover `--color-neutral-700` used as a status or state colour — `done` in the
picker, `wait` in the workflow run view, `StopButton`'s rest state — or as a border, shadow or
gutter token. Those carry meaning from their own palette and a ramp step is per-theme already.
Recolouring them would be the mistake standing rule 2 warns about, in the other direction.

**2 — the threshold formula.** Two stages of one warning, both re-based on the displayed percent:

- `!` fires at `tokens / contextLimit >= 0.75`.
- the note fires at `tokens >= threshold + (compactAt − threshold) / 2` — halfway from the
  threshold to the trigger — and still reports the distance to `compactAt`, in tokens.

The note keeps its current shape and its own header row; only the base of the first stage moves.
No model in `catalog.json` inverts the two (`compactAt` is 83.5% of a 200k window and 96.7% of a
1M one), so the threshold always sits below the trigger.

**10 — where this lands.** `STATE` 118 / `DEPENDS ON` 76 applies to the 4a tasks view *and* the
3b coordination view, since the stepper is specified for both.

**14 — the measured part.** The picker row's second line is `name · branch … agents · state`,
and only `branch` can shrink — `name`, `agents` and `state` are all `nowrap` with no ellipsis.
At 10.5px JetBrains Mono, `session-8f2a1c` is ~88px, a 24-character branch ~151px, `4 agents`
~48px and `ended 41m ago` ~78px; with 24px of padding, a 19px glyph column and three 8px gaps
that is ~452px of content before the goal line is considered. 432px clips the branch on a
realistic repo; 520px leaves the slack the reconcile's two-line row needs.

## Already right — do not "fix" these back

- **No mailbox pane in the tasks view** (or in the 3b coordination frame). The task list fills
  the frame; messages live in comms, which gained the everyone room to hold the merged feed the
  mailbox pane used to carry.
- **The `7a` lifecycle is untouched.** `stop watching` is view-local, writes nothing to
  `~/.claude`, and needs no change to the idle reaper, `IDLE_GRACE_MS`, or the `SessionEnd` fast
  path. The reaper reads only the filesystem and keeps the process alive while any team has two
  or more members. The CHANGELOG's own correction says the earlier claim of a lifecycle change
  was wrong. "The server stays up" is a description, not a mandate — do not turn it into a
  process that never dies.
- Rulings 4, 5, 6, 7b, 7c, 8, 9 and 13 above: the app already matches. Listed so nobody reverts
  them to the README's older figure.
