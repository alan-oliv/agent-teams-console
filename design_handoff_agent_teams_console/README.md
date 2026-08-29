# Handoff: Agent Teams web console (terminal wall)

## Overview
A browser UI for Claude Code **agent teams** (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`): one session acts as the team lead, teammates run in their own context windows, and they coordinate through a shared task list and per-agent mailboxes. The console gives the operator what the in-terminal agent panel can't: every teammate's transcript visible at once, per-agent context usage, and a single place for the things that need a human (plan approvals, permission prompts, failures).

Six views behind one switcher in the status bar (turn 4 in the HTML, `#4a` — build this one; other turns are explorations and studies):
- **wall** — teammate columns side by side, lead pinned left. The default.
- **overview** — the same wall condensed so every teammate fits without scrolling.
- **comms** — inter-agent conversation as a chat, with two kinds of room: an **everyone** room pinned at the top (the whole team's traffic in one group chat — the default) and the per-pair inbox threads below it under a `PAIRS` heading. See below.
- **tasks** — the shared task list, nothing else. Messages belong to comms.
- **rail** — teammate list on the left, one full transcript on the right (for reading one agent closely).
- **grid** — fixed 3x2 panes, tmux-style.

The chrome never moves between views: status bar on top, needs-you strip and agent panel at the bottom, only the body swaps. Selecting an agent in any view (overview tile, rail row, grid pane, panel chip) sets the focused teammate that `rail` shows. Persist the current view and the focused agent in the URL.

Each teammate carries a **12x12 pixel-art portrait** keyed to its role (24px rendered, 2px pixels): lead in a crown, security in a hard hat, perf in headphones, tests in a cap, architect in a hat and glasses, repro with messy hair. Skin tones vary across the team; hats and shirts come from the accent ramp, and a failed teammate's shirt uses the failure rose. In the prototype each portrait is one element whose box-shadow carries every pixel on a fixed 2px grid — reimplement however suits the codebase (sprite sheet or inline SVG is fine), but keep the 12x12 grid and the palette. To show a portrait smaller than 24px, scale the whole sprite with a transform; shrinking the pixel element without changing the offset step leaves sub-pixel gaps and the face renders as stripes.

Earlier reference views, still in the file:
- **Team wall** (`3a`) — lead pinned left, teammate columns scrolling horizontally, a "needs you" strip, and an agent-panel footer.
- **Coordination view** (`3b`) — the shared task list (states, owners, dependencies) beside the mailbox traffic between agents.

## About the design files
The files in this bundle are **design references created in HTML** — prototypes of the intended look and behaviour, not production code to lift. The task is to **recreate these designs in the target codebase's environment** (React, Vue, Svelte, whatever the app uses) with its existing patterns and component library. If no environment exists yet, pick the appropriate framework and build there. The prototype's data is fabricated: wire the real fields listed under *State* below.

## Fidelity
**High-fidelity.** Exact colours, type sizes, spacing, and copy are specified below and present in the HTML. Recreate the layout closely. All values come from the Nocturne design system tokens (`_ds/.../styles.css`); use the codebase's equivalents where they exist, otherwise the tokens as given.

---

## Screen 1 — Team wall (`3a`)

**Purpose:** monitor and steer a running team. The operator reads several transcripts in parallel, spots a teammate burning context or stuck, and answers approvals without leaving the view.

**Frame:** 1180 × 800 (design size), shown inside browser chrome in the mock; in the real app it fills the viewport.

**Layout — four rows, vertical flex:**

1. **Status bar** — **exactly one line, 40px tall.** `padding: 9px 14px`, `background: var(--color-bg)`, `border-bottom: 1px solid var(--color-neutral-900)`, `font-size: 12.5px`, `gap: 10px`, `flex-wrap: nowrap`. Every child is `flex: none; white-space: nowrap` except one `flex: 1` spacer — a shrinkable text span here wraps and doubles the bar's height, which is the single most common way to break this layout. If the metrics don't fit, drop them right-to-left (diffstat first, then combine elapsed and spend into one chip, then shed the token figure); never wrap, never let them bleed past the frame. Adding a switcher pill costs ~65px — re-measure the bar every time you add one.
   - `TEAM` wordmark: `var(--color-accent)`, 11px, weight 700, `letter-spacing: .14em`
   - **session dropdown** — the trigger shows the session name (`session-8f2a1c`, session-derived) with a caret; the goal appears next to it in `var(--color-neutral-600)` 10.5px, ellipsised, where the bar has room. 1px `var(--color-neutral-800)` border, `var(--radius-sm)`, hover border `var(--color-accent-700)` on `var(--color-accent-900)`. The menu is 432px wide, `var(--color-bg)`, 1px `var(--color-neutral-800)`, `var(--radius-md)`, `box-shadow: 0 18px 40px rgba(0,0,0,.6)`, header `SESSIONS ON THIS MACHINE · N`; each row = state glyph (`●` live / `○` idle / `✓` ended) · session name · branch · goal · agent count · state text, with `✓` on the current one. Picking a session switches the console; the others keep running. `⌘K` searches.
   - `experimental` pill: 1px `var(--color-accent-700)` border, `var(--color-accent-300)` text, 10px, `border-radius: var(--radius-sm)`, `padding: 1px 6px`
   - branch (`var(--color-accent-400)`), PR + diffstat (`var(--color-neutral-600)`)
   - right side: `tasks 3/11`, `6 context windows`, total tokens, an ASCII aggregate meter (`var(--color-accent-500)`, `letter-spacing: -.5px`), elapsed, spend
1b. **Config popover** — a `⚙` at the bar's right edge opens appearance settings: accent scheme (four hue-rotated ramps applied as `--color-accent*` overrides on the console root — never per component), line density, fade-older-output, agent portraits, motion, JSON line numbers. Reset link in its header; footer notes the settings are per machine. Every control must actually change the render — a decorative settings panel is worse than none.

2. **The wall** — `flex: 1`, `display: flex`, `overflow-x: auto`, `overflow-y: hidden`, `gap: 1px`, `background: var(--color-neutral-900)` (the gap reads as a 1px rule between columns). One column per agent, `flex: none`, default `width: 366px`.
   - **The lead column is `position: sticky; left: 0; z-index: 2`** with `box-shadow: 1px 0 0 var(--color-neutral-800), 8px 0 18px rgba(0,0,0,.5)` so it stays visible while teammates scroll. Put sticky on the column element itself, not on a `:first-child` stylesheet rule — a per-column width override otherwise wins and unpins it.
   - **Columns are resizable.** A 7px hit strip sits on each column's right edge (`position: absolute; right: -3px; height: 100%; cursor: col-resize; z-index: 4`) with a 1px line inside that is transparent at rest and `var(--color-accent-500)` while dragging. Drag adjusts that column only, clamped **232–720px**; double-click resets to 366. Width is per-column state, keyed by agent name, and persists across view switches.
   
   Column internals:
   - **Header** (`background: #161826`, `padding: 9px 12px 8px`, bottom hairline, `gap: 5px` column):
     - line 1: status glyph (colour per status, 11px) · agent name (13px, weight 500, `var(--color-text)`) · agent-type badge (`security-reviewer`, `team-lead`, …; 9.5px, 1px `var(--color-neutral-800)` border, `var(--color-neutral-500)`) · model, right-aligned (10.5px, `var(--color-neutral-700)`)
     - line 2: status label in the status colour · role/assignment (`var(--color-neutral-600)`, 11px, ellipsised) · elapsed, right
     - line 3: **context meter** — 16-cell ASCII bar (`█` filled / `░` empty, `var(--color-accent-600)`, 11.5px, `letter-spacing: -.5px`) · percent · `!` warning glyph (`#d99e5c`) past the threshold · `96.2k / 200k` · spend, right
   - **Transcript** — `flex: 1`, `padding: 9px 12px`, `gap: 1px`, **its own Y scroll**: `overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain`, holding the agent's full history back to its session preamble. Lines are bottom-anchored via `margin-top: auto` on the first child — **not** `justify-content: flex-end`, which makes a flex column unscrollable upward. Bottom-anchoring applies to streams only (transcript panes, mailbox); the task list and the rail's agent roster are top-aligned. On new output, auto-scroll to the bottom only when the user is already within 64px of it; if they've scrolled up to read, leave the position alone. Scrollbar is themed and always visible on a scrollable pane so the affordance reads: 9px wide, track `rgba(233,233,237,.035)`, thumb `var(--color-neutral-800)` with a 2px transparent border (`background-clip: content-box`), `var(--color-accent-700)` on pane hover; `scrollbar-width: thin`. Every pane in every view scrolls independently this way — wall columns, overview tiles, grid panes, the rail transcript, the rail's agent list, the task list, and the mailbox — but only the streams bottom-anchor.
   - **Line spacing and fade.** Lines sit 6px apart (7px in the rail, 4–5px in the condensed views) — tight leading makes a live stream unreadable. Each line carries its own opacity so the current command reads as current: newest 1, previous 0.72, recent history 0.5, older 0.38, and the whole ladder × 0.72 on an agent that is not working. Line text is `var(--color-neutral-300)`; the fade does the ranking, not a dim base colour. Each line: a 9px-wide marker column (`var(--color-accent-600)`, 11px) + text (`var(--color-neutral-500)`, 11.5px, `white-space: nowrap`, ellipsised). Markers: `❯` prompt, `⏺` tool call, `⎿` result/aside, `✓` success, `✗` failure, `+` diffstat, `!` finding, `▲` waiting, `○` queued/idle.
   - **Expandable rows.** A row whose output runs long collapses to one ellipsised line with a `▸` caret at its right edge; clicking opens the output as an **inset drawer** in the stream — `var(--color-bg)` ground, 1px `var(--color-neutral-900)` edge, `var(--radius-md)`, `var(--shadow-sm)`, caret flips to `▾`, divider under the header, body indented 16px past the glyph gutter, `copy` and `collapse` actions. Drawer bodies are **exempt from the stream's opacity fade**.
   - **JSON payload rows** get the same drawer with a formatted body instead of prose: pretty-printed at two-space indent on the terminal ground (`#12141f`, 1px `var(--color-neutral-900)`, `var(--radius-sm)`), a right-aligned line-number gutter in `var(--color-neutral-800)`, one span per token coloured from the JSON palette below, and `copy json` / `raw` actions. The pane is capped at `max-height: 210px` and **scrolls on its own without bottom-anchoring** — a JSON body reads top-down, so it must not carry the streams' `margin-top: auto` rule. The drawer header shows `N keys · N lines · N B`; derive all three from the payload, never hard-code them (they sit next to a line-number gutter that will contradict a stale figure).
   - **Current tool** — one line, top hairline, `var(--color-neutral-700)`, 10.5px, ellipsised.
   - **Message composer** — top hairline, `background: #161826`, `padding: 8px 12px`: `❯` (`var(--color-accent-600)`) + placeholder `message <name>` + `⌘⏎` hint. This is the direct-message channel to that teammate (equivalent to selecting the row and pressing Enter in the terminal).
3. **Needs-you strip** — top hairline, `background: #161826`, `padding: 9px 14px`. Label `NEEDS YOU · 2` in `#d99e5c`, 10.5px, `letter-spacing: .12em`. Then one card per item:
   - *plan approval*: 1px `#6b4f2c` border, `border-radius: var(--radius-sm)`, `padding: 6px 10px`; agent + reason, then `approve` (accent-outline) and `reject with feedback` (neutral outline) buttons, 10.5px.
   - *failure*: neutral-outlined card; agent, error text (`529 overloaded_error`), `respawn` button.
4. **Agent panel footer** — `padding: 8px 14px`, 10.5px. Label `PANEL`, then one chip per agent (status glyph + name + context percent, 1px `var(--color-neutral-900)` border, hover border `var(--color-accent-700)`), a dashed `1 idle agent` chip for collapsed idle rows, and the key legend `↑↓ select · ⏎ open · esc interrupt · x stop · ⌃T tasks`.

**Statuses** (glyph / label / colour):
- working — `●` / `working` / `var(--color-accent-400)`
- idle — `○` / `idle` / `var(--color-neutral-600)`
- plan approval pending — `▲` / `plan approval` / `#d99e5c`
- failed — `✗` / `failed` / `#c98d8d`
- blocked — `⊘` / `blocked` / `var(--color-neutral-600)`

## The comms view

**Purpose:** make agent-to-agent communication legible. In the wall it is invisible — a `SendMessage` call scrolls past in one column and its effect appears in another. This view shows the conversation itself.

**Left, thread list** (`width: 296px`). Header `THREADS` + unread count. The first row is the **everyone** room — a `⌗` glyph, "every message, one room", its own unread pill — separated from the pair rows by a hairline and a `PAIRS` label. Selecting it shows the whole team's traffic as one group chat with `to <agent>` / `to everyone` under each run, so the recipient is still legible in the merged stream. Each row is a **pair of inboxes**, not a channel: both agents' 12×12 portraits overlapped 14px apart, the pair name (`perf ⇄ security`), the topic beneath it, a state glyph (`●` live / `◆` unread, `#d99e5c` / `·` settled) and an unread pill (`var(--color-accent-600)` on `#161826` text). Selected row: `var(--color-accent-900)` with `box-shadow: inset 2px 0 0 var(--color-accent-500)`. Footer states the model: "a thread is two inboxes · the lead does not relay". Top-aligned, own scroll.

**Right, thread pane.** Header: pair name, topic, the task ids the exchange concerns, and a `show in wall` action that jumps to both agents' columns. Body is a two-sided chat, bottom-anchored with its own scroll:

- One bubble per message, `max-width: 78%`, with the sender's portrait at 22px on the bubble's outer edge. The first participant's messages sit left on `var(--color-bg)` with a `var(--color-neutral-900)` edge; the other's sit right on `var(--color-accent-900)` with a `var(--color-accent-700)` edge. Sender name in `var(--color-accent-400)` 10.5px + timestamp in `var(--color-neutral-800)`; body `var(--color-neutral-300)` 11.5px, `line-height: 1.6`, `text-wrap: pretty`.
- **Delivery state under each bubble** — this is the load-bearing part. A message lands in the recipient's inbox and is only read at that agent's next turn boundary, so show `read at turn 9` in `var(--color-neutral-700)` versus `delivered · unread 34s` in `#d99e5c`. Without it the chat implies instant delivery, which is wrong.
- A **composing indicator** (sender name + "composing a reply" + three pulsing 3px dots) when an agent's current turn contains an unsent `SendMessage`.
- **Composer**: the operator can join the thread — both agents see the message. Footer note: "a message wakes an idle recipient".

Source: `~/.claude/teams/{team}/inboxes/{agent}.json`. Group messages into threads by unordered participant pair, and keep the merged everyone stream as its own room. Every room must render its own messages — a header derived from the selected room over a hard-coded body is a visible contradiction. Room-dependent chrome (member count, composer hint) follows the room too. Per message: `ts`, `from`, `to`, `text`, `state` (`unread | read`), `readAtTurn`.

## Screen 2 — Coordination view (`3b`)

**Purpose:** answer "who claimed what, what's blocked, and who told whom" — the state the wall's transcripts don't surface.

**Frame:** 1180 × 660. Same status bar (subtitle `coordination`, `tasks 3/11 · 3 blocked`).

**Body:** two panes, `display: flex`.
- **Left, shared task list** (`flex: 1`, right border hairline). Column header row (10.5px, `var(--color-neutral-700)`, `letter-spacing: .12em`): `TASK` 44px · `DESCRIPTION` flex · `STATE` 92px · `OWNER` 80px · `DEPENDS ON` 88px. Rows: 11.5px, `padding: 7px 16px`, `border-bottom: 1px solid #1b1d2b`, hover `background: #161826`. Task ids `T-01`…, state cell = glyph + label in the state colour (`pending`, `in progress`, `completed`, `plan approval`, `failed`, `blocked`), owner = agent name or `unassigned`, dependencies as ids. Footer line: `~/.claude/tasks/session-8f2a1c/` and the note "claiming is file-locked · completing a task unblocks its dependents".
- **Right, mailbox traffic** (`width: 404px`, `background: #161826`). Header `MAILBOX TRAFFIC`. Entries bottom-anchored, `gap: 9px`: a meta line (timestamp `var(--color-neutral-800)` · `from` · `→` · `to`, agent names `var(--color-accent-400)`, 10.5px) over the message body (`var(--color-neutral-500)`, 11.5px, `text-wrap: pretty`). Footer: `~/.claude/teams/session-8f2a1c/inboxes/` and "teammates message each other directly — the lead doesn't relay".

---

## Interactions & behaviour

- **Horizontal scroll** is the primary navigation on the wall; the lead column is sticky. Provide `h`/`l` (or arrow) column jumps and a click-to-focus that widens a column.
- **Click a column** → focus it; the composer takes keystrokes for that teammate. `⌘⏎` sends. Sending a message wakes an idle teammate (and makes one that's waiting on an API retry retry immediately).
- **Esc** interrupts the focused teammate's current turn; **x** stops it. Both are per-agent, not global.
- **⌃T** toggles the task list (in `3a` it should open as a drawer; `3b` is the full view).
- **Idle rows**: an idle teammate stays addressable. Keep its row while any agent is working; once every agent is idle, collapse idle rows after 30s and reappear on the next turn. Beyond three idle agents, collapse the surplus into a single `N idle agents` chip that expands on click.
- **Plan approvals** arrive from teammates in plan mode. `approve` releases them to implement; `reject with feedback` returns them to plan mode with the operator's note, and they resubmit.
- **Permission prompts** from teammates are answered in the lead's session — route them into the same needs-you strip, never into the teammate column.
- **Failures**: when a teammate's turn ends on an API error, mark the row failed, show the error text, and offer respawn. Do not auto-retry silently.
- **Context warning**: past the threshold (default 75%) show the `!` glyph in `#d99e5c` and, near the limit, a "compaction in ~Nk tokens" note.
- **Live counters** tick once per second: tokens, context percent, elapsed, spend, and appended transcript lines. Transcripts append chronologically — newest last, bottom-anchored.
- **Hover** on any interactive element tints from the accent ramp; keyboard focus is `outline: 2px solid var(--color-accent); outline-offset: 2px`. No browser defaults.

## Shared state across views

The five views are one component reading one store, not five screens. Anything set anywhere applies everywhere: the picked session (and the branch, diffstat, task counts and agent roster that follow from it), the focused agent, per-column widths, and the context-warning threshold. When adding a control, put it in the shared chrome — never per-view.

## State

Per team: `teamName` (session-derived, `session-` + first 8 of session id), branch, PR/diffstat, elapsed, total spend, aggregate tokens, task counts.

Per agent: `name`, `agentType` (built-in or subagent definition; the lead is always `team-lead`), `model` (fixed at spawn), `status` (`working | idle | plan_pending | failed | blocked`), `role` (spawn prompt summary), `currentTool`, `contextTokens` / `contextLimit`, `elapsed`, `cost`, `transcript[] {marker, text}`, `unread`.

Per task: `id`, `description`, `state` (`pending | in_progress | completed` + UI-only `plan_pending | failed | blocked`), `owner`, `dependsOn[]`.

Per message: `ts`, `from`, `to`, `text`.

Per session (for the dropdown): `name`, `goal`, `branch`, `diffstat`, `agentCount`, `activity` ("4 working", "all idle", "ended 41m ago"), `state` (`live | idle | done`). Enumerate live sessions from `~/.claude/teams/`.

Sources: team config `~/.claude/teams/{team}/config.json` (members, agent ids, types — read-only, rewritten by Claude Code), task list `~/.claude/tasks/{team}/`, mailboxes `~/.claude/teams/{team}/inboxes/{agent}.json`. Treat all three as observed state; never hand-edit the config. Note the documented limits: one team per session, no nested teams, the lead is fixed, and in-process teammates don't survive `/resume`.

## Design tokens

From Nocturne (`_ds/nocturne-.../styles.css` in this bundle):
- Ground `--color-bg` `#161826`; the terminal ground is one step darker: `#12141f`; page behind the mocks `#0d0e17`; row hairline `#1b1d2b`
- Text `--color-text` `#e9e9ed`; muted `--color-neutral-400` `#b2b6ca`, `-500` `#9397ab`, `-600` `#75798c`, `-700` `#595d6c`, `-800` `#3f424d`, `-900` `#292b31`
- Accent `--color-accent` `#9184d9`; ramp `-300` `#d2cefd`, `-400` `#b5abfc`, `-500` `#968ae0`, `-600` `#796cbf`, `-700` `#5d5294`, `-900` `#2b2741`
- **JSON token palette** — a second deliberate extension, for syntax colouring inside an expanded JSON payload only: keys `#b5abfc` (`--color-accent-400`), strings `#9ec9a8`, numbers `#d99e5c`, booleans `#7fb4d9`, `null` `#c98d8d`, punctuation and indent guides `var(--color-neutral-600)`/`-800`. Nocturne is a mono palette, so the two new hues (`#9ec9a8`, `#7fb4d9`) are held at the accent's chroma level and never appear outside a JSON body. **If the target codebase already ships a syntax theme, use it instead** — this set exists only so an untokenised console has one.
- Semantic — a **deliberate extension** to Nocturne, which is a mono palette with no warn/fail role: attention `#d99e5c` (border `#6b4f2c`), failure `#c98d8d`. Both are low-chroma and share the accent's chroma level so they read as part of the system; use them **only** for status (plan approval pending, failed teammate, context past threshold), never decoratively. If the target codebase already has warn/error tokens, use those instead.
- Two grounds are not tokenised: the terminal ground `#12141f` (one step darker than `--color-bg`, so the terminal reads as inset) and the table row hairline `#1b1d2b`. Everything else comes from the tokens.
- Radii `--radius-sm` 4px, `--radius-md` 8px; spacing scale `--space-1..8` (2.8 / 5.6 / 8.4 / 11.2 / 16.8 / 22.4px)
- Elevation `--shadow-sm/md/lg`; card in the mocks: `0 0 0 1px #3f424d, 0 16px 40px rgba(0,0,0,.65)`
- Type: **JetBrains Mono** 10–13px for everything inside the terminal (11.5px transcript, 12.5px status bar, 13px agent name); **Inter** for the surrounding doc chrome only. Never below 10px.

## Assets
None. No icons, no images — every glyph is a Unicode character in the monospace font. The `browser-window.jsx` chrome in the bundle is mock framing only; do not ship it.

## Files
- `Octo Session Console.dc.html` — all five options. Turn 3 (`#3a`, `#3b`) is this spec; turns 1–2 are earlier explorations kept for reference.
- `support.js`, `browser-window.jsx` — runtime + mock browser chrome for the prototype.
- `_ds/nocturne-.../styles.css`, `_ds_bundle.js`, `readme.md` — the design system: tokens and component guidance.

Open the HTML file in a browser to see the live-ticking prototype.
