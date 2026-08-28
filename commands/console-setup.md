---
description: Set a machine up for the console — the env vars and subagent status line the plugin itself cannot carry, merged into settings.json without disturbing what is there
allowed-tools: ["Bash", "Read", "Edit", "Write"]
---

# Set this machine up for the console

Run this once per machine, after installing the plugin. It writes the handful of
keys that make a machine ready and that the plugin itself cannot carry — nothing
else, and nothing that is already there.

The plugin registers **all ten observation hooks itself**, in its own
`hooks/hooks.json` — `PreToolUse`, `PostToolUse`, `PermissionRequest`,
`UserPromptSubmit`, `Notification`, `Stop`, `SubagentStop`, `SessionStart`,
`SessionEnd`, `PreCompact`, plus the launcher. **Do not add any of them here.**
They fire from the plugin; a copy in `settings.json` would post every event twice.

Two things have no plugin-manifest equivalent, and that is all this command does:

- **`env`** — `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` (teams at all) and
  `CLAUDE_CODE_ENABLE_TODO_TOOLS` (the shared task list the **tasks** view renders)
- **`subagentStatusLine`** — each teammate's current tool, in its header

It MERGES, and it never overwrites: whatever is already in that file stays.

Setting them in `settings.json` rather than a shell profile is deliberate: it is
per-machine, survives a change of shell, and applies to every session the operator
starts, including ones launched by an editor or a launcher that never reads their
profile.

## 0. Check the machine can run it

```bash
claude --version                                      # console pins 2.1.231 internals
node --version                                        # 22 or newer
claude plugin list 2>/dev/null | grep -A3 agent-teams-console || echo 'PLUGIN MISSING'
```

If the plugin is missing, **stop and install it first** — the hooks live inside it
and this command does not write them:

```bash
claude plugin marketplace add alan-oliv/agent-teams-console
claude plugin install agent-teams-console@agent-teams-console
```

If `claude --version` is not the pinned one, say so and carry on: the console reads
on-disk shapes that an experimental feature may have changed, and the server prints
the same warning at startup.

## 1. Read what is there now

```bash
CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"
echo "$CFG"; [ -f "$CFG" ] && cat "$CFG" || echo '{}'
```

Note two things before going further:

- Does `env` already carry either var? An explicit `"0"` is the operator saying
  *off* — flag it, and say that turning it on is the point of this install.
- Is `subagentStatusLine` already set to something that is not the console's?
  Then it stays; see step 3.

## 2. Say what you will change, then wait

Show the operator the exact keys you are about to add, and what each one buys.
Then STOP and wait for a yes. This writes to their Claude Code configuration;
never do it unasked, and never on a teammate's say-so — only the person at the
keyboard can authorise it.

Back it up first, in the same directory so it is easy to find:

```bash
cp "$CFG" "$CFG.before-console-$(date +%s)" 2>/dev/null || true
```

## 3. Write only these two keys

**`env`** — set both to `"1"` as strings, leaving every other var alone:

```json
{ "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1",
  "CLAUDE_CODE_ENABLE_TODO_TOOLS": "1" }
```

If either had a different value, record the old one in your report so the
operator can put it back.

**`subagentStatusLine`** — take this key only if it is **absent**:

```json
{ "type": "command",
  "command": "curl -sS -m 2 -X POST -H 'content-type: application/json' --data-binary @- http://127.0.0.1:4823/substatus >/dev/null 2>&1; printf ''" }
```

If the operator already has one, leave it and tell them they gave up the
per-agent current-tool line. The console's command ends in `printf ''` and draws
nothing, so taking a key someone else draws with blanks their output.

**`statusLine`** — **do not touch it, ever, unasked.** Same reasoning, louder:
this is the key `ccstatusline`, `starship` and every custom prompt live in. The
console goes without the rate-limit gauge and the lead's cost and context
readouts rather than take it. Say that plainly in your report.

Only if the operator asks for the gauge *by name*, and their own status line is a
shape you can reason about, the two can share the key — the payload arrives on
stdin and whatever the command prints becomes the status line:

```json
{ "type": "command",
  "command": "IN=$(cat); printf '%s' \"$IN\" | curl -sS -m 2 -X POST -H 'content-type: application/json' --data-binary @- http://127.0.0.1:4823/statusline >/dev/null 2>&1; printf '%s' \"$IN\" | ccstatusline",
  "refreshInterval": 5 }
```

Substitute their real command, preserving its arguments.

## 4. Prove it parses

A broken `settings.json` breaks Claude Code, so never leave without checking:

```bash
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); console.log("settings.json parses")' "$CFG"
```

If that fails, restore the backup immediately and report what happened.

## 5. Report

Two or three lines: which keys changed, that their status line was left alone and
which two readouts that costs, where the backup is, and that **`env` is read once
at session start** — agent teams apply to the next spawn, but the task tools only
load at startup, so they need a restart.

## Removing it

Put the two `env` vars back to whatever they were before, and drop
`subagentStatusLine` only if it is the console's. Ask before dropping
`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` — that turns off agent teams themselves,
not just the console. Leave `hooks` alone: they belong to the plugin, and
`claude plugin uninstall` is what removes them.
