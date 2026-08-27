# Agent Teams Console — manual acceptance

Covers the five success criteria in `docs/superpowers/specs/2026-08-27-agent-teams-console-design.md` §1.
`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is already set in `~/.claude/settings.json`.

## 0. Bring the console up

```bash
cd /Users/alanoliv/code/agents-team-ui
npm install
npm run setup            # prints the hook + statusLine block, writes ~/.claude/settings.json on confirm
npm run dev              # vite on 5173, server on 127.0.0.1:4823
open http://127.0.0.1:5173/
```

`npm run setup` must be run once before the first acceptance pass and never as a
side effect of `npm run dev`. `npm run uninstall` removes the block afterwards.

## 1. Spawn a real team

In a second terminal:

```bash
cd /Users/alanoliv/code/agents-team-ui
claude
```

Give the lead this prompt verbatim — it reproduces the corpus in `fixtures/`:

> Spawn three in-process teammates on this team, then wait for all three to report.
> Create two tasks first: id 1 "SPIKE probe A — report your identity" and id 2
> "SPIKE probe B — report your identity".
>
> probe-alpha (general-purpose, opus): You are a throwaway probe for a 2-minute
> data-capture spike. Do EXACTLY these steps and nothing else. Do not read or write
> any project files. 1. Run: `sleep 10` 2. Call TaskList, then TaskUpdate on task id
> "1" setting owner to your own agent name and status to "in_progress". 3. Run:
> `sleep 15` 4. Call SendMessage with to="team-lead", summary="probe-alpha claimed
> task 1", message="probe-alpha reporting: I claimed task 1. This is spike traffic."
> 5. Run: `sleep 20` 6. Call TaskUpdate on task id "1" setting status to
> "completed". 7. Return the single line: `probe-alpha done`
>
> probe-bravo (Explore, opus): same shape, but task id "2", and at step 4 send
> to="probe-alpha" with summary="bravo greets alpha", then a second SendMessage
> to="team-lead" with summary="probe-bravo claimed task 2".
>
> probe-charlie (general-purpose, model haiku): 1. Run: `sleep 14` 2. Call
> SendMessage with to="team-lead", summary="probe-charlie alive",
> message="probe-charlie reporting: running on a different model so the console can
> prove per-agent model resolution." 3. Run: `sleep 30` 4. Return the single line:
> `probe-charlie done`

Confirm the team exists on disk:

```bash
TEAM=$(ls -t ~/.claude/teams | head -1); echo "$TEAM"
jq -r '.members[].name' ~/.claude/teams/"$TEAM"/config.json
```

Expected: `team-lead`, `probe-alpha`, `probe-bravo`, `probe-charlie`.

## 2. Criterion 1 — the wall is live

- [ ] The wall shows four columns; `team-lead` is leftmost.
- [ ] Scroll the wall right: the `team-lead` column stays pinned at x = 0 with its
      right-edge shadow over the scrolling columns.
- [ ] Each teammate column shows a moving transcript with no manual refresh, and
      the transcript is bottom-anchored (newest line at the bottom edge).
- [ ] `probe-charlie`'s context line reads `… / 200k`; the opus teammates read
      `… / 1M`. This proves per-agent model resolution from the transcript.
- [ ] Each column's cost reads `≈$…` and grows while the teammate works.
- [ ] Each column's current-tool row shows the live tool, e.g. `Bash(sleep 20)`,
      and goes blank when the teammate is idle.
- [ ] The status bar's `tasks n/m`, total tokens, ASCII meter, elapsed and
      `5h …% · 7d …%` all update without a refresh.

## 3. Criterion 2 — ⌘⏎ delivers a message

- [ ] Click into the `probe-alpha` column composer, type
      `acknowledge this console message in your final line`, press `⌘⏎`.
- [ ] The composer clears immediately.
- [ ] Within one second the message is on disk (teammates poll every 500 ms, so
      catching it requires a tight loop):

```bash
TEAM=$(ls -t ~/.claude/teams | head -1)
for i in $(seq 1 40); do
  jq -c '.[] | {from, text}' ~/.claude/teams/"$TEAM"/inboxes/probe-alpha.json 2>/dev/null
  sleep 0.05
done
```

- [ ] Expected at least one line with `"from":"team-lead"` and the text typed.
- [ ] The tasks view's MAILBOX TRAFFIC pane shows `team-lead → probe-alpha` with
      that body and the SENT clock time.
- [ ] `probe-alpha`'s transcript picks the message up and its reply mentions it.
      This is the end-to-end proof the teammate actually received it.

## 4. Criterion 3 — a plan approval releases

Spawn a fourth teammate with plan mode required:

> Spawn one more in-process teammate named `probe-plan` with planModeRequired
> true, and give it: "Write a plan (do not execute) for deleting
> `migrations/legacy/`. Present the plan for approval and stop."

- [ ] A card appears in the NEEDS YOU strip: `probe-plan · plan approval`, amber
      `#d99e5c` text inside a `#6b4f2c` border, with the plan summary ellipsised.
- [ ] `probe-plan`'s status glyph is `▲` and its status label reads
      `plan approval`.
- [ ] Click `approve`. The card disappears and `probe-plan` resumes within one
      turn boundary.
- [ ] Repeat with `reject with feedback`, entering `not this sprint` — the
      teammate's transcript shows the feedback.

## 5. Criterion 4 — five views, immovable chrome

Press `⌘1` … `⌘5` in turn, with focus outside the composer.

- [ ] `⌘1` wall · `⌘2` overview · `⌘3` tasks · `⌘4` rail · `⌘5` grid.
- [ ] The status bar, NEEDS YOU strip and PANEL footer do not move, resize or
      re-order between any two views. Screenshot the top 40 px and bottom 60 px in
      each view and compare.
- [ ] `⌃T` from the wall opens tasks; `⌃T` again returns to the wall.
- [ ] `h` and `l` move the focused wall column; the focused column is tinted.
- [ ] With focus in a composer, `x`, `h`, `l`, `⌘3` and `⌃T` all type or do
      nothing — none of them switch views or stop an agent.
- [ ] Overview: six tiles share the width with no horizontal scrollbar; each has a
      4 px progress bar matching its percent.
- [ ] Tasks: the table shows task 1 and 2 with their real owners; the left footer
      names `~/.claude/tasks/<team>/`; the right footer is two lines ending in
      "teammates message each other directly — the lead doesn't relay".
- [ ] Rail: `↑`/`↓` move the cursor, `⏎` attaches, and the right pane swaps to
      the attached teammate's transcript and composer.
- [ ] Grid: with seven agents, six panes render and a `+1 more` badge appears.
- [ ] The URL tracks the state: `?view=grid&agent=probe-bravo`. Reload — the same
      view and focused agent come back.

## 6. Criterion 5 — pure logic against fixtures, no Claude Code running

```bash
pkill -f 'claude' || true
cd /Users/alanoliv/code/agents-team-ui
npx vitest run
```

- [ ] Whole suite green with nothing running.
- [ ] `src/shared/**` tests read only `fixtures/` — confirm with
      `grep -rn "\.claude" src/shared || echo "no home-directory reads"`.

## 7. Session-ended behaviour

- [ ] Exit the lead (`/exit`). `~/.claude/teams/<team>/` disappears.
- [ ] The console does NOT blank: it shows the last projected state from the
      store and marks the session ended.
- [ ] Restart `npm run dev` — the store replays and the same final state renders.
