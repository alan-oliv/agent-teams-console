Read `design/agent-teams-console/README.md` and open `Octo Session Console.dc.html` (same folder) in a browser — together they are the spec for a web console for Claude Code agent teams. Build the **turn-4 view** (`#4a` in the HTML): one console, five body views behind a switcher. Turns 1–3 are earlier explorations kept for reference; do not build them.

Recreate the design in this codebase's own stack and component patterns. The HTML is a design reference, not code to lift, and its data is fabricated — wire the real sources named in the README (`~/.claude/teams/`, `~/.claude/tasks/`).

Work in this order, and treat each step as done only when it holds at 1180px and at a narrow viewport:

1. **Shell first.** Status bar, needs-you strip, agent panel. These never move between views; only the body swaps. The status bar is exactly one 40px line — every child `flex: none; white-space: nowrap` with a single `flex: 1` spacer. Under-constrain one text span and it wraps to 58px; that is the most common way to break this layout.
2. **One store, five views.** wall · overview · tasks · rail · grid all read the same state: picked session, focused agent, per-column widths, context-warning threshold. Selecting an agent in any view sets the focused agent the rail shows. Persist view + focused agent in the URL. Never add per-view state.
3. **Session dropdown** in the status bar. Switching sessions swaps the roster, branch, diffstat and task counts everywhere at once; the other sessions keep running.
4. **The wall.** Horizontal scroll, one column per agent, lead column `position: sticky; left: 0` — put sticky on the column element, not a `:first-child` rule, or per-column width overrides unpin it. Columns drag-resizable from a 7px right-edge strip, clamped 232–720px, double-click resets to 366.
5. **Per-panel Y scroll.** Every transcript pane, the rail's agent list, the task list and the mailbox each scroll independently, holding full history. Bottom-anchor with `margin-top: auto` on the first child, not `justify-content: flex-end` — the latter makes a flex column unscrollable upward. Auto-scroll to newest only when the user is already within 64px of the bottom. Themed scrollbar per the README, visible on scrollable panes so the affordance reads.
6. **Expandable rows.** Long output collapses to one line with a `▸` caret; clicking opens it as an inset drawer on the lighter ground with its own edge, a divider under the header, and copy/collapse actions. The drawer's body is exempt from the stream's opacity fade.
7. **Line rhythm.** Lines sit ~10px apart, and each carries its own opacity (newest solid, history fading to 0.38, the whole ladder dimmer on a non-working agent). Tight leading and a flat text colour make a live stream unreadable — this is load-bearing, not polish.
8. **Agent portraits.** 12×12 pixel-art faces, one per role, 24px rendered. Sprite sheet or inline SVG is fine; keep the grid and the palette.

Colours, type sizes, spacing and copy are specified in the README — follow them, mapping to this codebase's tokens where equivalents exist. Read `CHANGELOG.md` in the same folder if you have already built an earlier version of this console; it lists what changed and why, so you can patch rather than rebuild.

Ask me before inventing screens, states or copy the README doesn't cover.
