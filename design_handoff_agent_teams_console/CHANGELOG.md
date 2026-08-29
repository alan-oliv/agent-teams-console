# Changelog

Read this if you already built an earlier version of this console — it lists what changed, so you can patch rather than rebuild. Newest first.

## One composer, @-routing, and the ingestion queue
Reworked against `MESSAGING.md` (now in this bundle — read it before touching messaging).

- **One composer, in the lead's column.** Every other column is read-only. A send is N direct inbox writes with no relay, so a composer per column implied a channel that does not exist.
- **@-routing, Slack-style.** At rest the composer is just a prompt and a hint: `message the lead · @ to reach a teammate`. No chip, no picker, no target control on screen — with no `@` the message goes to the lead, which is the common case. Typing `@` opens the teammate list above the composer and filters as you type; the header shows the live filter (`@pe`), the first row is the `⏎` default, and each row carries the agent's state (`idle · a message wakes it`, `failed · still reachable`). Picking one resolves the mention into a chip at the left of the input and the picker closes. Departed agents are absent from the list.
- The **arrives-as** stamping (`console` to the lead, `team-lead` to a teammate) is no longer shown. It is real but it is the engine's business, and putting it on every target made the composer read like documentation.
- **Enter sends** · ⇧⏎ newline. The hint reads `⏎` — naming the one key that used to do nothing was most of the old trap.
- **"everyone" → "all messages"** ("every inbox, merged"). There is no group inbox; the room folds the N copies of one send back into a line but still shows each line's real recipient.
- **Ingestion queue** surfaces as a per-agent badge in the column header — `2 in flight` in the warn colour, meaning written to that inbox but not yet pulled into a context window. Clicking it drains now (forces a turn boundary). Zero-count agents show nothing.

## Whole themes, not just accents
The config panel's first section swaps the entire theme; the accent swatches then pick among four accents belonging to that theme.

- Six themes, shown as a two-column grid of tiles that preview themselves (ground / accent / text stripes): **Nocturne** (dark blue-grey), **Organic** (light paper and clay), **Ember** (warm carbon), **Frost** (light cool grey), **Slate** (dark, zero hue — good for screenshots), **Phosphor** (near-black CRT glow). Each carries a terminal ground, a surface, text, a full neutral ramp, semantic warn/fail values and four accent ramps of its own.
- The neutral ramp is ordered **by use, not by lightness**: 900 is the quietest fill/hairline and 200 the strongest text. On a light theme those values run dark-to-light in the opposite direction, so the same markup reads correctly either way — this is what makes a light theme possible without touching a single component.
- Every colour inside the console now resolves through a variable on the console root: `--term` (terminal ground), `--color-bg`, `--color-text`, the neutral ramp, the accent ramp, plus `--warn`, `--warn-edge`, `--warn-tint`, `--fail` and `--on-accent` (text on an accent fill). No hard-coded hex survives in the console body. If you add a colour, add it as a theme variable or the light theme breaks silently.
- Theme rows preview themselves with a three-stripe swatch (ground / accent / text) so the choice is visible before it is applied.

## Config panel
A `⚙` at the far right of the status bar opens a 302px popover (`var(--color-bg)`, 1px `var(--color-neutral-800)`, `var(--radius-md)`, right-aligned under the button) with five live tweaks, all persisted per machine rather than per session:

- **accent scheme** — four 20px swatches (blurple, teal, amber, rose), each a full 7-step ramp at Nocturne's chroma level with the hue rotated. Applied by overriding `--color-accent*` custom properties on the console root, so every consumer follows without touching component code. The ground never changes.
- **line density** — compact / default / roomy (5 / 10 / 16px transcript line gap).
- **fade older output** — turns the per-line opacity ladder on or off.
- **agent portraits** — hides the 8-bit faces.
- **motion** — kills the cursor blink and the typing dots (accessibility, and a calmer wall).
- **JSON line numbers** — hides the gutter in expanded payloads.

The button costs ~30px of a status bar that was already full: the session id came out of the collapsed trigger in that frame and the goal's max-width dropped to 146px. Anything added to this bar has to be paid for.

## Messages live in comms only
The mailbox pane came out of the tasks view (and out of the 3b coordination frame); the task list now fills the frame in both. Comms gained an **everyone** room, pinned above the pair threads and selected by default, that carries the whole team's traffic as one group chat — so the merged feed the tasks pane used to hold has a proper home.

- Group-chat bubble language throughout: sender runs collapse, tail and avatar on the last bubble of a run, name label only when the speaker changes, `max-width: 64%`, operator's own messages right-aligned on the accent.
- Each pair thread carries its own messages. An earlier pass derived the header from the selected pair while the body stayed hard-coded to one exchange — header and bubbles then disagreed on screen.
- Member count and composer hint are room-aware (`6 members` / `2 inboxes`, "message the team — everyone sees it" / "join as the operator — both agents see it").

## Comms view — inter-agent chat
A sixth view. Agent-to-agent messaging was invisible in the wall: a `SendMessage` scrolled past in one column and its effect surfaced in another. The comms view shows the conversation directly — a thread list of inbox pairs on the left, a two-sided chat on the right.

- Each thread is **two inboxes**, not a channel; teammates message each other directly and the lead does not relay.
- Every bubble carries a **delivery state** (`read at turn 9` / `delivered · unread 34s`). A message sits in the recipient's inbox until its next turn boundary; a chat without this reads as instant delivery, which is wrong.
- Composing indicator, operator composer that joins the thread, and a `show in wall` jump to both agents' columns.
- **Regression this caused:** the sixth switcher pill (~65px) pushed the status bar past 1180px, bleeding the spend figure off-frame. The diffstat came out of that bar (it is in the session dropdown rows anyway) and elapsed + spend merged into one chip. Re-measure the bar whenever you add a pill.

## JSON payloads open formatted
A row carrying a JSON response (`{"success":true,…}`) collapses to one line like any other long row, but its drawer renders the payload pretty-printed and syntax-coloured rather than as prose.

- Two-space indent, right-aligned line-number gutter, one span per token from the JSON palette (keys accent-400, strings `#9ec9a8`, numbers `#d99e5c`, booleans `#7fb4d9`, `null` `#c98d8d`, punctuation neutral). Defer to the codebase's own syntax theme if it has one.
- Body sits on the terminal ground inside the lighter drawer, capped at 210px with **its own scroll that does not bottom-anchor** — JSON reads top-down.
- Header badge (`N keys · N lines · N B`) is derived from the payload. A hard-coded count sitting beside a live line-number gutter visibly contradicts it.
- `copy json` / `raw` actions in the footer.

## Expandable output rows
A stream row whose output runs long collapses to one ellipsised line with a `▸` caret at its right edge. Clicking it opens the output as an **inset drawer** inside the stream (turn 5, `#5b` in the HTML):

- The drawer sits on `var(--color-bg)` — one step lighter than the terminal ground — with a 1px `var(--color-neutral-900)` edge, `var(--radius-md)`, `var(--shadow-sm)`, `padding: 10px 12px 11px`, `margin: 4px 0`. Lighter ground plus an edge is what separates it from the stream; do not use a background tint alone.
- Header row inside the drawer keeps the row's glyph and text, caret flips to `▾`. A 1px `var(--color-neutral-900)` divider sits under it, then the body indented 16px so it aligns past the glyph gutter.
- Body paragraphs are `var(--color-neutral-300)`, `line-height: 1.65`, `gap: 11px`, `text-wrap: pretty` — and **exempt from the stream's opacity fade**: an open row's content always reads at full strength regardless of its age.
- Footer row: line count on the left, `copy` (neutral outline) and `collapse` (accent outline) on the right.
- Collapsed rows around it keep the normal fade ladder. Two alternatives were explored and dropped: a gutter-rule treatment that promoted the open row in place, and a side detail pane for very long output.

## Line spacing and per-line opacity
Transcripts were unreadable at 1px line gaps and a flat text colour.

- Gaps: 10px in wall columns, 11px in the rail, 7–8px in the condensed views, 18px between mailbox entries; task rows at 12px vertical padding.
- Each line carries its own opacity so the current command reads as current: newest 1, previous 0.72, recent 0.5, older 0.38, whole ladder × 0.72 on an agent that is not working.
- Line text moved up to `var(--color-neutral-300)` so the fade does the ranking rather than a dim base colour; glyph markers unified on `var(--color-accent-500)`.

## Per-panel vertical scroll
Every pane is its own scroll region, not a clipped tail. Transcripts hold the agent's full history back to its session preamble (`loaded CLAUDE.md`, `claimed my task`, …); the rail's agent list, the task list and the mailbox scroll too.

- Bottom-anchoring moved from `justify-content: flex-end` to `margin-top: auto` on the first child. `flex-end` in a flex column cannot be scrolled upward — the earlier build looked bottom-pinned but was unscrollable.
- **Scope that rule to streams only.** Bottom-anchoring belongs to the transcript panes and the mailbox; the task list and the rail's agent roster read top-down and must stay top-aligned. Applying it to every scroll pane put 90–170px of dead space above the first row and pushed later rows below the fold.
- Auto-scroll to newest fires only when the user is already within 64px of the bottom; scrolled-up panes stay put while output keeps arriving.
- Scrollbars are themed and visible on scrollable panes (9px, `rgba(233,233,237,.035)` track, `var(--color-neutral-800)` thumb with a 2px transparent border via `background-clip: content-box`, `var(--color-accent-700)` on pane hover). The affordance has to read — a pane that scrolls invisibly is a pane nobody scrolls.
- `overscroll-behavior: contain` on each pane so a pane hitting its end doesn't scroll the page.

## Resizable wall columns
Columns are `flex: none` at a default 366px with per-column widths in state, keyed by agent name and persisted across view switches.

- 7px hit strip on each column's right edge (`position: absolute; right: -3px; z-index: 4; cursor: col-resize`) containing a 1px line: transparent at rest, `var(--color-accent-500)` while dragging.
- Drag clamps 232–720px; double-click resets to 366.
- **Regression this caused:** the lead column's sticky pin came from a `.wall > div:first-child` stylesheet rule, which the per-column inline width override then beat, unpinning it. Sticky, `z-index` and the shadow edge now live on the column element itself. If you implement resizing, verify the pin still holds afterwards.

## Session dropdown
The session name in the status bar became a picker over the sessions on the machine.

- Menu: 432px, header `SESSIONS ON THIS MACHINE · N`, one row per session — state glyph (`●` live / `○` idle / `✓` ended) · name · branch · goal · agent count · activity text — with `✓` on the current one. `⌘K` searches.
- Branch, diffstat, roster and task counts are now **derived from the picked session**, not hard-coded. Switching updates every view; the other sessions keep running.
- The picker is in the shared chrome, so it appears in all five views by construction. That is the general rule now: a control added anywhere is added everywhere.

## One console, five views
The four separate frames (team wall, coordination, agent rail, tmux grid) were consolidated into one component with a view switcher in the status bar: **wall · overview · tasks · rail · grid**.

- Chrome is constant; only the body swaps. Selecting an agent in any view (overview tile, rail row, grid pane, panel chip) sets the focused agent the rail shows.
- The switcher is a flat pill with an inset 1px border, not a tab with an underline — a stacked label + underline is taller than the text row and pushed the bar to two lines.

## Status bar: one line, always
The bar overflowed 1180px by ~15px, so shrinkable text spans wrapped and it silently doubled in height.

- Every child is `flex: none; white-space: nowrap`; one `flex: 1` spacer. Gap tightened 14px → 10px.
- Labels shortened (`6 context windows` → `6 ctx`, `tasks 3/11` → `3/11 tasks`).
- In the 4a bar the goal echo, the `experimental` pill and one separator were dropped to make room for branch + diffstat. When space runs out, drop metrics right-to-left; never wrap.

## Agent portraits
Each teammate has a 12×12 pixel-art **face** keyed to its role, rendered at 24px (2px pixels): lead in a crown, security in a hard hat, perf in headphones, tests in a cap, architect in a hat and glasses, repro with messy hair. Skin tones vary across the team; hats and shirts come from the accent ramp, and a failed teammate's shirt uses the failure rose. An earlier pass used role *symbols* (shield, bolt, check) — those are gone.

## Rebuilt on the real agent-teams model
The first version modelled a generic orchestrator with numbered "arms". It now follows Claude Code agent teams: a fixed **team lead** plus named teammates with agent types (`security-reviewer`, `test-runner`, `architect`, `general-purpose`), each in its own context window; a **shared task list** with owners and dependencies; **direct mailboxes** between teammates (the lead does not relay); `idle` and `failed` as first-class states; **plan approvals** and teammate **permission prompts** routed to the operator, never into the teammate's own column.
