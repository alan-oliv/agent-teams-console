# Agent Teams Console — design

**Date:** 2026-08-27
**Status:** approved, ready for implementation planning
**Build target:** `#4a` from `design_handoff_agent_teams_console/Octo Session Console.dc.html`

---

## 1. Purpose

A local web console for Claude Code **agent teams** (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`). One session is the team lead; teammates run in their own context windows and coordinate through a shared task list and per-agent mailboxes.

The console gives the operator what the in-terminal agent panel cannot: every teammate's transcript visible at once, per-agent context and cost, and one place for the things that need a human — plan approvals, permission prompts, failures.

It is both an **observer** (live mirror of team state) and a **control surface** (message a teammate, approve a plan, answer a permission prompt, interrupt, stop, respawn).

### Success criteria

0. The console is **not running** until a team exists. Spawning the first teammate starts it and surfaces its URL in the session; ordinary subagents never wake it.
1. With a real multi-teammate team running, the wall shows every teammate's live transcript, context meter, and cost, updating without manual refresh.
2. Typing in a column's composer and pressing `⌘⏎` delivers a message that the teammate actually receives.
3. A teammate's plan-approval request appears in the needs-you strip, and `approve` releases it.
4. All five views render at the design's fidelity and the chrome never moves between them.
5. The pure logic modules pass tests against captured real fixtures with no Claude Code running.

### Non-goals (v1)

- Out-of-process teammates (`backendType: "tmux" | "iterm2"`). No such teammate has ever run on the target machine, and their transcripts have no registry entry. In-process only.
- Multi-team or multi-session dashboards. One team, the one the lead session owns.
- Editing `config.json` or the task files directly. Those are observed state.
- Authentication. Binds to `127.0.0.1` only.

---

## 2. Verified data contract

Everything in this section was captured from real data on the target machine on 2026-08-27 (Claude Code 2.1.231), not inferred. Fixtures live in `fixtures/` (§8).

### 2.1 Team roster — `~/.claude/teams/<team>/config.json`

Team name is `session-` + first 8 chars of the lead session id. The directory is **deleted when the lead exits**.

```jsonc
{
  "name": "session-98b0b4a7",
  "createdAt": 1787798107581,
  "leadAgentId": "team-lead@session-98b0b4a7",
  "leadSessionId": "98b0b4a7-3206-455b-aaf6-a5a81ad1e283",
  "members": [
    { "agentId": "team-lead@session-98b0b4a7", "name": "team-lead",
      "agentType": "team-lead", "joinedAt": 1787798107581,
      "tmuxPaneId": "leader", "cwd": "...", "subscriptions": [],
      "backendType": "in-process" },
    { "agentId": "probe-alpha@session-98b0b4a7", "name": "probe-alpha",
      "color": "blue", "joinedAt": 1787843382976, "tmuxPaneId": "in-process",
      "subscriptions": [], "agentType": "general-purpose",
      "model": "claude-opus-5", "prompt": "<full spawn prompt>",
      "planModeRequired": false, "cwd": "...", "backendType": "in-process" }
  ]
}
```

Load-bearing details:

- `agentId` is `<name>@<team>`. The lead member carries **no** `color`, `model`, or `prompt`; teammates carry all three.
- `agentType` here is the raw `subagent_type` (`general-purpose`, `Explore`, `team-lead`) — **this is the source for the design's type badge.**
- `prompt` is the full spawn prompt. The design's `role` field is a one-line summary of it; prefer the sidecar's `description` (§2.2) and fall back to a truncated `prompt`.
- `subscriptions` is dead — written as `[]`, never read.
- Writes are guarded by `proper-lockfile` at `config.json.lock`. Readers take no lock; retry once on parse failure.

### 2.2 Agent sidecars — durable roster fallback

`~/.claude/projects/<slug>/<leadSessionId>/subagents/agent-a<name>-<16hex>.meta.json`

```json
{ "agentType": "probe-alpha", "description": "Spike probe alpha",
  "name": "probe-alpha", "spawnDepth": 0, "model": "claude-opus-5",
  "taskKind": "in_process_teammate", "teamName": "session-98b0b4a7",
  "color": "blue", "planModeRequired": false,
  "permissionMode": "bypassPermissions" }
```

> **Trap:** the sidecar's `agentType` is the teammate *name*, not the subagent type. Take the type badge from `config.json`; take `description` (the role line) and durability from here. Sidecars survive session exit; `config.json` does not.

The sibling `agent-a<name>-<16hex>.jsonl` is that teammate's transcript. Filter sidecars by `taskKind === "in_process_teammate" && teamName === <team>`, and join to `config.json` members on `name` — the only key the two namespaces share.

`<slug>` is the **lead session's startup cwd** with `[^a-zA-Z0-9]` → `-`, never the teammate's `cwd`.

### 2.3 Mailboxes — `~/.claude/teams/<team>/inboxes/<name>.json`

A JSON **array**, created lazily on first spawn. Keyed by bare agent name (`team-lead.json`), not `agentId`.

```json
[{ "from": "probe-alpha", "text": "probe-alpha reporting: I claimed task 1.",
   "summary": "probe-alpha claimed task 1",
   "timestamp": "2026-08-27T15:10:17.891Z", "color": "blue",
   "msgV": 1, "msg_id": "4a236089-...", "type": "message", "read": false }]
```

**This file is a pending queue, not a log.** Measured on the target machine: a delivered message is pruned and the file atomically rewritten **within ~100 ms**. Any polling design loses traffic.

Structured protocol frames ride inside `text` as a JSON string. Observed live: `task_assignment`, `idle_notification`. Full recognised set includes `permission_request`/`_response`, `plan_approval_request`/`_response`, `shutdown_request`/`_approved`/`_rejected`, `mode_set_request`, `task_completed`, `teammate_terminated`.

Writes use `proper-lockfile` at `<inbox>.json.lock` and `atomicWrite`, which has **two arms** — temp-file+rename (inode changes) *and* in-place `truncate(0)`+write (size drops to 0). A watcher must handle both.

### 2.4 Mailbox backfill — the lead transcript

Delivered messages are rendered into the recipient's transcript as:

```
<teammate-message teammate_id="probe-alpha" color="blue" summary="...">
body
</teammate-message>
```

Verified: all six spike messages recovered from the lead transcript with `from`, `color`, `summary`, and body, protocol frames included.

**Caveat:** every recovered frame shared one timestamp — the *delivery batch* time. The messages were sent 15:10:15–15:10:27 and delivered at 15:12:17, because delivery is gated on the recipient's turn boundary.

> **Merge rule:** the inbox watcher is primary (true send time); the transcript is backfill. Merge by `msg_id`; the watcher's `timestamp` always wins. Display **sent** time.

### 2.5 Tasks — `~/.claude/tasks/<team>/<n>.json`

```json
{ "id": "1", "subject": "...", "description": "...", "activeForm": "...",
  "owner": "probe-alpha", "status": "in_progress",
  "blocks": [], "blockedBy": [] }
```

- `status` on disk is only `pending | in_progress | completed`. The design's `plan approval`, `failed`, `blocked` are **UI-only** states derived from agent status and `blockedBy`.
- `owner` is the **bare agent name**, absent when unclaimed.
- `<n>` is a monotonic decimal string from `"1"`. A `.lock` sibling guards claims.
- With teams on, the directory is team-keyed; the session-keyed directory is renamed onto the team name at team init.

### 2.6 Transcripts

`~/.claude/projects/<slug>/<sessionId>.jsonl` (lead) and `.../subagents/agent-*.jsonl` (teammates).

- **Strictly append-only, stable inode.** Byte-offset tailing is safe. This is the opposite of the team/task/inbox JSON files.
- Writes are **message-granular**, not token-granular. Observed gaps: 3.6 s to 27.3 s. Transcript tailing alone can never be sub-second.
- `fs.watch(dir, {recursive: true})` on `~/.claude/projects` fires 0–1 ms before content is readable and auto-discovers new session and subagent files without re-arming. macOS reports `rename` (not `change`) for the first write to a new file — **a watcher handling only `change` misses agent transcripts entirely.**
- Line `type` values a parser must tolerate: `assistant`, `user`, `attachment`, `system`, `summary`, plus state lines `mode`, `permission-mode`, `custom-title`, `ai-title`, `agent-name`, `agent-setting`, `last-prompt`, `bridge-session`, `queue-operation`, `file-history-snapshot`.
- Teammate lines carry `isSidechain: true` and `agentId` = the `a<name>-<hex>` form.

Token usage lives **only** at `.message.usage` on `type === "assistant"`:

```json
{ "input_tokens": 2, "cache_creation_input_tokens": 43331,
  "cache_read_input_tokens": 0, "output_tokens": 1027,
  "output_tokens_details": { "thinking_tokens": 864 },
  "server_tool_use": { "web_search_requests": 0 },
  "cache_creation": { "ephemeral_1h_input_tokens": 43331,
                      "ephemeral_5m_input_tokens": 0 },
  "service_tier": "standard", "speed": "standard" }
```

Cost is **not** recorded per line. It must be computed.

### 2.7 Live transports

| Source | Carries | Latency |
|---|---|---|
| `type:"http"` hooks → `POST /hook` | 31 events, `agent_id` + `agent_type`, tool calls, prompts, `MessageDisplay` text | push, ~0 ms |
| `statusLine` command → `POST /statusline` | `cost.total_cost_usd`, `context_window.*`, `rate_limits.{five_hour,seven_day}` | event-driven + `refreshInterval` seconds |
| `subagentStatusLine` → `POST /substatus` | per-teammate `tokenCount`, `contextWindowSize`, `status`, `model` | on agent-panel render |
| `fs.watch` | everything, reconciling | 0–1 ms to event; content is message-granular |

Hooks carry **no token, context, or cost data** — that is what the two status lines are for. Both status lines are **interactive-only** (they do not run under `claude -p`), which is fine because agent teams are interactive-only too.

Hooks are **synchronous and block the agent turn**; the default timeout is **600 000 ms**. The console must answer immediately (`200 {}`) on every endpoint except the deliberate permission hold (§5.3), and every hook entry should set an explicit small `timeout`.

There is **no** way to attach a structured stream to an already-running session. `stream-json` and the Agent SDK only start new processes.

---

## 3. Architecture

```
Claude Code  (lead + teammates, one process, agent teams on)
   │
   ├─ http hooks ──────────► POST /hook         push, agent-attributed
   ├─ statusLine ─────────► POST /statusline    session cost / context / rate limits
   ├─ subagentStatusLine ─► POST /substatus     per-teammate tokens + window
   │
   └─ file writes ────────► fs.watch(~/.claude/{projects,teams,tasks,sessions})
                    ▼
            server (node + tsx, 127.0.0.1)
              ingest ─► append-only store ─► reduce ─► TeamState
                                                │
                     control plane              └──► SSE  GET /stream
                     └─► inbox writes, held permission responses
                    ▼
            web (vite + react + ts)
              five views · fixed chrome · view+focus in the URL
```

**One process observes and controls.** Vite serves the UI in dev and proxies `/api` and `/stream`; in production the server serves the built bundle.

### 3.1 Why an append-only store

`~/.claude/teams/<team>/` is deleted on lead exit and the inbox self-prunes in ~100 ms. Without its own log the console loses mailbox history and goes blank when the session ends. The store makes it a **recorder**: every observed event is appended, and `TeamState` is a fold over that log.

SQLite (`better-sqlite3`, WAL) with one `events` table: `(seq, ts, kind, agent, payload_json)`. Restart replays the log.

### 3.2 Module boundaries

```
src/
  shared/          pure, no I/O, fully unit-tested
    domain.ts      TeamState, Agent, Task, MailMessage, NeedsYouItem, TranscriptLine
    catalog.ts     model alias → canonical → { pricing tier, window, compactAt }
    usage.ts       dedupe, cost, context occupancy
    transcript.ts  JSONL line → TranscriptLine (marker + text + ts)
    mailbox.ts     inbox entry / <teammate-message> frame → MailMessage; protocol frames
    portrait.ts    12×12 grids, palette, agentType/name → portrait + skin
    status.ts      status enum → { glyph, label, colour }; task state derivation
  server/
    watch/tail.ts      append-only tailer: inode + offset + last-newline
    watch/jsonfile.ts  atomic-rewrite watcher: inode change + truncation
    ingest/hooks.ts    /hook, /statusline, /substatus
    ingest/files.ts    wires watchers to the store
    store.ts           append-only event log
    project.ts         fold(events) → TeamState
    control/mailbox.ts inbox writer under proper-lockfile
    control/permits.ts held PermissionRequest registry
    stream.ts          SSE: snapshot + deltas
    http.ts            routes
  web/
    App.tsx, chrome/{StatusBar,NeedsYou,Panel}.tsx
    views/{Wall,Overview,Tasks,Rail,Grid}.tsx
    components/{Portrait,ContextMeter,TranscriptFeed,Composer,StatusGlyph}.tsx
    theme.css          Nocturne tokens + the five non-token colours
fixtures/          real captured data (§8)
```

The `shared/` modules hold every piece of logic that can be silently wrong. They take plain data and return plain data, so they are tested without Claude Code running and reused by both sides.

---

## 4. Domain model

```ts
type AgentStatus = 'working' | 'idle' | 'plan_pending' | 'failed' | 'blocked';

interface Agent {
  name: string;              // bare name — the join key everywhere
  agentId: string;           // name@team
  isLead: boolean;
  agentType: string;         // from config.json — the badge
  model: string;             // canonical, resolved from the transcript
  role: string;              // sidecar description, else truncated prompt
  color?: string;
  status: AgentStatus;
  currentTool?: string;
  contextTokens: number;
  contextLimit: number;      // per-agent, from the resolved model
  compactAt: number;         // auto-compact trigger
  costUsd: number;
  startedAt: number;
  transcript: TranscriptLine[];
  unread: number;
  error?: string;            // e.g. "529 overloaded_error"
}

interface TeamState {
  teamName: string; leadSessionId: string;
  branch?: string; elapsedMs: number;
  totalTokens: number; totalCostUsd: number;
  rateLimits?: { fiveHourPct: number; sevenDayPct: number; resetsAt?: string };
  agents: Agent[]; tasks: Task[]; mail: MailMessage[];
  needsYou: NeedsYouItem[];
}
```

### 4.1 Token and cost math

**Dedupe by `message.id`, take the max `output_tokens`.** Naive per-line summation over-counts output by up to **2.63×** on a real transcript. (An earlier candidate rule — ccstatusline's `stop_reason` filter — was tested and rejected: 16 of 18 assistant lines on a teammate transcript have `stop_reason: null`, so it silently drops 5 of 8 complete messages.)

Cost, verified to six decimal places against a real `costUSD`:

```
cacheCreation = min(ephemeral_1h, total) * rate_1h
              + (total - min(ephemeral_1h, total)) * rate_5m      // NOT ephemeral_5m
cost = input*rate_in + output*rate_out + cache_read*rate_read
     + cacheCreation + web_search_requests * 0.01
```

Sum top-level `usage` only — never `usage.iterations`, which double-counts. `thinking_tokens` is a subset of `output_tokens`.

**Context occupancy** = last non-sidechain, non-error assistant line's `input_tokens + cache_read + cache_creation`. After a `{type:"system", subtype:"compact_boundary"}` record, recompute from the first line *after* the boundary, falling back to `compactMetadata.postTokens`.

### 4.2 Model resolution

`config.json` may record an **alias** — the spike captured `"model": "haiku"` verbatim. The transcript's `message.model` resolved it to `claude-haiku-4-5-20251001`.

Resolution order: transcript `message.model` → `subagentStatusLine.contextWindowSize` → `config.json` `model` through the alias table → default.

Then strip any `[1m]` suffix (case-insensitive) for pricing lookup, and normalise dated ids (`claude-haiku-4-5-20251001` → `claude-haiku-4-5`).

`catalog.json` is a **config file, not a constant** — Claude Code's own baked table is stale for Sonnet 5 ($3/$15 baked vs $2/$10 live), so the table must be correctable without a code change.

Current values: Opus 5 `5 / 6.25 / 10 / 0.50 / 25`, window 1 M. Sonnet 5 `2 / 2.50 / 4 / 0.20 / 10`, window 1 M. Haiku 4.5 `1 / 1.25 / 2 / 0.10 / 5`, window 200 k. (in / 5m-write / 1h-write / read / out, per MTok.)

### 4.3 Context meter

Per-agent window from the resolved model, with a tick at the auto-compact trigger:

```
compactAt = window − OUTPUT_RESERVE − COMPACT_HEADROOM      // 20_000 and 13_000
          → 1M   − 33_000 = 967_000   (96.7 %)
          → 200k − 33_000 = 167_000   (83.5 %)
```

Both constants live in `catalog.json` alongside the pricing, since they are read from Claude Code's compiled behaviour rather than a public contract. The `!` warn glyph fires relative to `compactAt`, not a fixed 75 %.

```
opus-5   ██░░░░░░░░░░░░█░   5%   53.1k / 1M     ≈$1.31
                        ↑ compact @ 967k
haiku    ████████████░░█░  78% ! 156k / 200k    ≈$0.22
```

### 4.4 Cost framing

The target account is Claude Max 20x (`billingType: stripe_subscription`), so dollars are notional list-price, not billed amounts. Per-agent and total dollars stay where the design puts them — they are the honest *relative* signal for which agent is expensive — labelled `≈$8.40 api-equiv`. The status bar additionally carries the real budget: `5h 41% · 7d 12%` from `statusLine.rate_limits`.

---

## 5. Control plane

All writes funnel through one module with a `--read-only` flag and a `claude --version` guard, because these are internal protocols.

### 5.1 Message a teammate

`POST /api/agents/:name/message` → take `proper-lockfile` on `inboxes/<name>.json.lock`, read, append `{from:"team-lead", text, summary, timestamp, color, msgV:1, msg_id:uuid, type:"message", read:false}`, atomic-write, release.

Teammates poll their inbox every 500 ms, so delivery is sub-second. Sending also wakes an idle teammate.

### 5.2 Plan approval

`POST /api/plans/:requestId/{approve,reject}` → same write path, `text` = `JSON.stringify({type:"plan_approval_response", requestId, approved, feedback, timestamp})`.

### 5.3 Permission prompts — the held hook

The `PermissionRequest` hook POST is **not answered immediately**. The server registers it in a pending map, pushes a needs-you card, and holds the HTTP response until the operator clicks — then replies with the decision. The 600 s default hook timeout makes this legitimate; the card shows a countdown and the server auto-denies with a clear reason at 90 % of the timeout rather than letting the agent hang.

This is the one place where a blocking hook is correct: the agent *should* wait for the human.

### 5.4 Lifecycle — the console exists only while a team does

The console is **not** an always-on daemon. It is armed by a hook and dies with the team.

```
setup  ─► installs a PostToolUse(matcher "Agent") *command* hook
                                        → bin/console-launch.sh
              │
lead spawns any agent ──► launcher reads the payload on stdin
              │            (fires AFTER the spawn tool returns, so the new
              │             member is already in config.json — no race)
              │
              ├─ derive team = "session-" + first 8 of payload.session_id
              │
              ├─ teams/<team>/config.json has < 2 members  ─► print {} , exit
              │     ordinary Agent-tool subagents and workflow fan-outs
              │     never start the console
              │
              └─ members >= 2  →  a team exists
                    ├─ probe 127.0.0.1:4823/health
                    ├─ if down: spawn the server detached, wait ≤1500 ms
                    └─ print {"systemMessage":
                          "Agent teams console → http://127.0.0.1:4823/?team=<team>"}
                       ─► Claude Code renders it to the operator as
                          {"type":"system","subtype":"informational",
                           "content":"PostToolUse:Agent says: Agent teams console → …"}
```

> **Why not `SubagentStart`** — the obvious choice, and it does not work. `SubagentStart` runs inside the *spawning agent's* context, and the hook-result generator filters yielded fields to a whitelist when an `agentContext` is present: `permissionBehavior, hookPermissionDecisionReason, updatedInput, preventContinuation, stopReason, impossible, hookSource, updatedToolOutput, updatedMCPToolOutput, blockingError`. `systemMessage` is not in it, so the message is silently stripped. Verified empirically: with a `SubagentStart` hook the message appeared **only** inside the raw `hook_response` envelope (visible solely under `--include-hook-events`) and never as a user-facing message. With `PostToolUse` matcher `Agent`, which runs in the lead's own context with no `agentContext`, it renders as an `informational` notice. Both runs are reproducible via `claude -p --settings <file> --output-format stream-json`.


**The gate is the member count, not `agent_type`.** The spike verified that named teammates are added to `config.json` `members[]` while ordinary Agent-tool subagents and workflow fan-outs are not — during the recon run, six workflow subagents were live and `members[]` still held only the lead. `agent_type === "teammate"` would also work but is the one field in this path that was read from the compiled binary rather than observed, so it is not load-bearing here.

Team derivation uses `session_id` from the hook's common base, which is always the **parent** session, and the verified rule `teamName = "session-" + sessionId.slice(0,8)`. It does not depend on the hook's `agent_id` format, which is unverified for teammates.

Announcement is **once per team, not once per teammate** — a `~/.claude/teams/<team>/.console-announced` marker guards it.

Shutdown has two independent paths so a crash never leaves a process behind:
- a `SessionEnd` hook POSTs `/api/shutdown`;
- the server self-exits after 10 minutes with no live team (no `~/.claude/teams/*/config.json` carrying more than one member).

Hard constraints on the launcher, because `PostToolUse` **blocks the turn**:
- its hook entry sets an explicit `timeout: 5000`;
- every error path still prints `{}` and exits `0` — a broken console must never fail a teammate spawn;
- it is a shell script, not a Node process, so the non-teammate path costs a process spawn and nothing more;
- the matcher is `Agent`, so it runs on every agent spawn including ordinary subagents — the member-count gate, not the matcher, is what distinguishes a team.

`TeammateIdle` (`{teammate_name, team_name}`) is also subscribed, for idle-state transitions. Note its `team_name` is marked `@deprecated` in the shipped schema — "sessions have a single implicit team" — so derive the team from the lead session id rather than trusting that field long-term.

### 5.5 Interrupt, stop, respawn

`shutdown_request` frames into the target's inbox for interrupt/stop. Respawn has no direct external path — it messages the lead's own inbox asking it to re-spawn the failed teammate, and the card says so plainly rather than pretending it is direct.

---

## 6. Views

Chrome is mounted once and never unmounts: status bar on top, needs-you strip and agent panel at the bottom. Only the body swaps. View and focused agent persist in the URL (`?view=wall&agent=probe-alpha`).

Per the resolved README/HTML conflict: **`#4a`'s DOM and CSS are the visual truth**, plus three README behaviours folded back — the current-tool row in wall columns, wall hover + click-to-focus, and the two-line mailbox footer. Branch/PR/diffstat are dropped; the switcher took that space.

Root: `#12141f`, JetBrains Mono, 12 px / 1.55.

### Status bar
`padding:9px 14px; gap:14px; background:var(--color-bg); border-bottom:1px solid var(--color-neutral-900); font-size:12.5px; align-items:center`
`TEAM` accent, 11 px, 700, `letter-spacing:.14em` · team name · `experimental` pill (`1px solid var(--color-accent-700)`, `var(--color-accent-300)`, 10 px, `padding:1px 6px`) · switcher (`gap:2px; margin-left:6px`; tab `padding:3px 9px 4px`, label 11.5 px, 2 px underline, hover `var(--color-neutral-900)`) · spacer · `tasks n/m` and `N windows` (neutral-600) · total tokens (neutral-500) · ASCII meter (accent-500, `letter-spacing:-.5px`) · elapsed · `≈$… api-equiv` · `5h …% · 7d …%`

### Wall (default)
`flex:1; display:flex; overflow-x:auto; overflow-y:hidden; gap:1px; background:var(--color-neutral-900)`. Lead column `position:sticky; left:0; z-index:2; background:#12141f; box-shadow:1px 0 0 var(--color-neutral-800), 8px 0 18px rgba(0,0,0,.5)`.

Column `width:366px; flex:none`:
- header `padding:9px 12px 8px; background:var(--color-bg); gap:11px; align-items:flex-start`, 24×24 portrait (`margin-top:3px`), meta column `gap:5px`
  - line 1 `gap:7px`: glyph 11 px · name 13 px/500 · type badge (`1px solid var(--color-neutral-800)`, neutral-500, 9.5 px, `padding:0 5px`) · spacer · model (neutral-700, 10.5 px)
  - line 2 `gap:7px`: status label · role (neutral-600, 11 px, ellipsis) · spacer · elapsed
  - line 3 `gap:8px`: 16-cell `█`/`░` meter (accent-600, 11.5 px, `letter-spacing:-.5px`) · pct · `!` (`#d99e5c`, `width:7px`) · `53.1k / 1M` · spacer · cost
- transcript `flex:1; overflow:hidden; padding:9px 12px; gap:1px; justify-content:flex-end`; line `gap:7px`, marker `width:9px` accent-600 11 px, text neutral-500 11.5 px `nowrap` ellipsis
- **current tool** — top hairline, `padding:7px 12px`, neutral-700, 10.5 px, ellipsised *(folded back from the README)*
- composer — top hairline, `background:var(--color-bg)`, `padding:8px 12px`: `❯` accent-600 · `message <name>` neutral-700 · spacer · `⌘⏎` neutral-800 10 px

Markers: `❯` prompt · `⏺` tool call · `⎿` result · `✓` success · `✗` failure · `+` diffstat · `!` finding · `▲` waiting · `○` idle.

### Overview
`flex:1; display:flex; gap:1px; background:var(--color-neutral-900)`; tile `flex:1; min-width:0`, hover `var(--color-bg)`. Header `padding:9px 10px 8px; gap:6px`; 24×24 portrait; name 12 px; type 9.5 px neutral-600; status row `justify-content:space-between; font-size:10px`; 4 px progress bar (`background:var(--color-neutral-900)`, fill accent-600). Transcript 10 px / marker 9.5 px accent-700. Footer `padding:6px 10px`, elapsed / cost, 9.5 px.

### Tasks
Left pane `flex:1`, right border hairline. Column header `padding:10px 16px 8px`, neutral-700, 10.5 px, `letter-spacing:.12em`: `TASK` 44 px · `DESCRIPTION` flex · `STATE` 92 px · `OWNER` 80 px · `DEPENDS ON` 88 px. Rows 11.5 px, `padding:7px 16px`, `border-bottom:1px solid #1b1d2b`, hover `var(--color-bg)`; description in **neutral-300**; state = glyph + label in the state colour. Footer: `~/.claude/tasks/<team>/` and "claiming is file-locked · completing a task unblocks its dependents".

Right pane `width:404px; background:var(--color-bg)`. `MAILBOX TRAFFIC` header. Entries bottom-anchored, `gap:9px`: meta line (ts neutral-800 · from accent-400 · `→` neutral-700 · to accent-400, 10.5 px) over body (neutral-500, 11.5 px, `text-wrap:pretty`). Footer is **two lines** (`gap:3px`): the inboxes path and "teammates message each other directly — the lead doesn't relay".

### Rail
Left `width:348px`: header `TEAM · N` / `click to attach`; rows `padding:8px 10px; border-radius:var(--radius-sm); border-left:2px solid <sel>`; footer `↑↓ select · ⏎ attach · esc interrupt`. Right: header `padding:10px 18px` with portrait, name 13 px, badge, status, role, spacer, meter, ctx, cost; transcript `padding:12px 18px`, marker `width:10px`, text **neutral-400**; composer `padding:11px 18px` with `❯` accent, blinking 7×15 px accent-400 caret, current tool right.

### Grid
`display:grid; grid-template-columns:repeat(3,1fr); grid-template-rows:repeat(2,1fr); gap:1px`. Pane header `padding:8px 11px`, name 12.5 px, model 10 px; row 2 meter 10.5 px, pct, elapsed. Transcript 11 px / marker 10 px accent-700. Footer = current tool, ellipsised.

### Needs-you strip
Top hairline, `background:var(--color-bg)`, `padding:9px 14px`. Label `NEEDS YOU · N` in `#d99e5c`, 10.5 px, `letter-spacing:.12em`.
- plan approval: `1px solid #6b4f2c`, `padding:6px 10px`; agent · reason in `#d99e5c`; detail neutral-500; `approve` (accent-outline, hover `var(--color-accent-900)`) and `reject with feedback` (neutral-outline).
- failure: neutral-outlined; agent · `failed` in `#c98d8d`; error text neutral-600; `respawn`.
- permission: same shape as plan approval, plus the hold countdown.

### Agent panel
Top hairline, `#12141f`, `padding:8px 14px`, 10.5 px. `PANEL` neutral-700 `letter-spacing:.12em`; chips (`1px solid var(--color-neutral-900)`, `padding:2px 7px`, hover `border-color:var(--color-accent-700)`) = glyph + name + context pct; dashed `N idle agents` chip beyond three idle; legend `↑↓ select · ⏎ open · esc interrupt · x stop · ⌃T tasks`.

### Statuses

| status | glyph | colour |
|---|---|---|
| working | `●` | `var(--color-accent-400)` |
| idle | `○` | `var(--color-neutral-600)` |
| plan approval | `▲` | `#d99e5c` |
| failed | `✗` | `#c98d8d` |
| blocked | `⊘` | `var(--color-neutral-600)` |

### Non-token colours
Exactly five, given explicit homes in `theme.css`: `#12141f` terminal ground · `#1b1d2b` row hairline · `#d99e5c` attention · `#6b4f2c` attention border · `#c98d8d` failure rose. Plus the twelve portrait skin hexes.

### Portraits

The six 12×12 grids and the palette map (`a` accent-400, `b` accent-700, `h` neutral-800, `k` neutral-900, `w` text, `e` failure rose, `s`/`S` per-agent skin pair) are lifted verbatim as data.

Rendered as **inline SVG**, one `<path>` per colour with `shape-rendering="crispEdges"`, memoised per `(portrait, skinIndex)` — not the prototype's ~1.6 KB box-shadow string, which it rebuilds every tick.

The prototype keys sprites off literal names (`lead`, `security`, …) that real teammates never have. Mapping:

1. lead → crown.
2. `agentType` keyword match: `security|review` → hard hat; `perf` → headphones; `test` → cap; `architect|plan` → hat + glasses; `repro|debug` → messy hair.
3. Otherwise a stable hash of `name` picks one of the six.

Skin index comes from the same hash, so a teammate always looks the same. Note the repro sprite bakes the failure rose into its shirt; status-driven recolouring is a separate concern and is **not** applied on top.

### Interaction

Horizontal scroll is the wall's primary navigation, lead sticky. `h`/`l` jump columns; click focuses. `⌘⏎` sends. `Esc` interrupts the focused teammate, `x` stops it — both per-agent. `⌃T` toggles the task drawer. Idle rows stay addressable; beyond three idle agents the surplus collapses into one `N idle agents` chip. Hover tints from the accent ramp; keyboard focus is `outline: 2px solid var(--color-accent); outline-offset: 2px`, no browser defaults.

The prototype uses bare `div`/`span` with `cursor:pointer` throughout. The rebuild uses real semantics: `role="tablist"` for the switcher, `<button>` for cards and chips, `role="listbox"` for the rail.

---

## 7. Error handling

- **Torn JSON read** — team/task/inbox files are atomically rewritten; catch parse failure, retry once after 20 ms, then skip. Never take the lock to read.
- **Watcher gaps** — macOS FSEvents can coalesce under heavy fan-out. A 5 s reconciliation stat-sweep re-reads any file whose mtime advanced without an event.
- **Hook endpoint** — always responds; never throws into the agent's turn. Held permission responses auto-deny at 90 % of timeout.
- **Team dir vanishes** (lead exited) — the console switches to a "session ended" state built from the store, rather than blanking.
- **Unknown model** — falls back to the Opus-5 tier and a 200 k window, and the UI marks the figure approximate rather than silently lying.
- **Control writes when `--read-only`** — return 409 with an explanatory body; the UI disables the controls rather than failing on click.

---

## 8. Fixtures and testing

The spike captured a real corpus, checked into `fixtures/`:

- `config-4-members.json` — lead + three teammates, two models, three colours
- `inbox-*.json` — plain messages and `task_assignment` / `idle_notification` protocol frames
- `task-{unclaimed,owned,completed}.json`
- `transcript-teammate-{opus,haiku}.jsonl` — real usage objects; the haiku one carries a **1.29×** naive-vs-deduped output discrepancy
- `lead-transcript-teammate-frames.jsonl` — the six recovered `<teammate-message>` frames
- `meta-sidecar-*.json`

Test layers:

1. **Pure unit** (`shared/`) against the fixtures — no Claude Code, no filesystem. The dedupe ratio, the cost formula against the known-good `costUSD`, alias resolution (`"haiku"` → `claude-haiku-4-5-20251001` → 200 k window), marker mapping, portrait determinism.
2. **Watcher integration** — a temp dir, synthetic append/rename/truncate sequences, asserting no lost or duplicated lines.
3. **Reducer** — replay a recorded event log, assert the resulting `TeamState`.
4. **Control-plane** — write to a temp inbox under lock, assert the exact on-disk shape.
5. **Manual acceptance** — the five success criteria in §1, against a real spawned team.

Test-first is the rule for §4.1 and §4.2 specifically: those are where a silent 2.63× error hides.

---

## 9. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Control plane writes an undocumented internal protocol | High | `--read-only` flag; version guard on `claude --version`; every schema is version-pinned to 2.1.231 in `catalog.json`; observer path has zero exposure |
| Mailbox drains in ~100 ms | Medium | `fs.watch` push (not polling) + append-only store + transcript backfill |
| Teammate hook `agent_id` format unconfirmed | Medium | Only Agent-tool subagents were observed carrying `agent_id`; teammate hooks are inferred. The file-watch path covers attribution independently, so this degrades rather than breaks |
| FSEvents coalescing under fan-out | Low | Reconciliation sweep (§7) |
| Post-compaction occupancy untested | Low | No `compact_boundary` exists locally; logic is written to spec and unit-tested with a synthetic fixture |
| Pricing table drifts | Low | `catalog.json` is user-editable config |

---

## 10. Resolved decisions

- **The server serves the built bundle in production.** One command (`npm start`) runs the console; `npm run dev` uses Vite with a proxy to `/api` and `/stream`.
- **Transcript retention:** the store keeps everything on disk; `TeamState` caps in-memory transcript at 2 000 lines per agent, which is well past what any view renders.
- **The repository is not a git repo.** `git init` is step zero, so the plan's checkpoints are commits.
- **Hook installation is explicit, never silent.** The console ships a `setup` command that prints the exact `settings.json` block and writes it only on confirmation, and an `uninstall` that removes it. It never edits `~/.claude/settings.json` as a side effect of starting.
- **The console is lifecycle-gated, not always-on** (§5.4). `setup` installs the `SubagentStart` launcher hook; the server starts on the first teammate spawn and exits with the team.
