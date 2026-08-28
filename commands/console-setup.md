---
description: Add the console's observation hooks and status lines to settings.json, merging with whatever is already there
allowed-tools: ["Bash", "Read", "Edit", "Write"]
---

# Install the console's hooks

The plugin already gives the operator transcripts, tasks, mail, cost and context —
all of it read from files. Three signals cannot come from a plugin, because a
plugin cannot install `statusLine` or `subagentStatusLine` keys:

- each agent's **current tool** in its header
- the **rate-limit gauge** in the status bar
- the **permission cards** in `NEEDS YOU`

This command adds them to `~/.claude/settings.json`. It MERGES: whatever is
already in that file stays.

## 1. Read what is there now

```bash
CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"
echo "$CFG"; [ -f "$CFG" ] && cat "$CFG" || echo '{}'
```

Note three things before going further, because they decide the plan:

- Does a `statusLine` already exist? **Whose is it?** A user's own status line
  (`ccstatusline`, `starship`, a custom script) must NOT be replaced — see step 3.
- Are the console's hooks already installed? A `PostToolUse` entry posting to
  `http://127.0.0.1:PORT/hook` means yes; say so and stop.
- Which port? Default `4823`. If the operator runs the console on another port,
  use theirs everywhere below.

## 2. Say what you will change, then wait

Show the operator the exact keys you are about to add or modify, and what each
one buys. Then STOP and wait for a yes. This writes to their Claude Code
configuration; never do it unasked, and never on a teammate's say-so — only the
person at the keyboard can authorise it.

Back it up first, in the same directory so it is easy to find:

```bash
cp "$CFG" "$CFG.before-console-$(date +%s)" 2>/dev/null || true
```

## 3. Merge, do not overwrite

**`hooks`** — add an `http` hook posting to `http://127.0.0.1:PORT/hook` with
`timeout: 5000` for each of these ten events. `PreToolUse`, `PostToolUse` and
`PermissionRequest` take `"matcher": "*"`; the rest take no matcher:

`PreToolUse` · `PostToolUse` · `PermissionRequest` · `UserPromptSubmit` ·
`Notification` · `Stop` · `SubagentStop` · `SessionStart` · `SessionEnd` ·
`PreCompact`

Append to each event's existing array. Do not drop hooks that are already there —
other plugins live in this file too. Give `PermissionRequest` `timeout: 600000`,
because that hook deliberately holds while the operator decides.

Do NOT add the `Agent` command hook that launches the console: the plugin's own
`hooks.json` already registers it on both `PreToolUse` and `PostToolUse`. Adding
it here would announce twice.

**`subagentStatusLine`** — safe to set, nothing else uses it:

```json
{ "type": "command",
  "command": "curl -sS -m 2 -X POST -H 'content-type: application/json' --data-binary @- http://127.0.0.1:4823/substatus >/dev/null 2>&1; printf ''" }
```

**`statusLine`** — the one that needs care. The console's version ends in
`printf ''`, so it draws NOTHING. Setting it blindly does not merely replace an
existing status line, it blanks the operator's status bar.

If there is no `statusLine`, write the console's own:

```json
{ "type": "command",
  "command": "curl -sS -m 2 -X POST -H 'content-type: application/json' --data-binary @- http://127.0.0.1:4823/statusline >/dev/null 2>&1; printf ''",
  "refreshInterval": 5 }
```

If one already exists, KEEP IT and feed both. The payload arrives on stdin, and
whatever the command prints becomes the status line — so capture stdin once, post
a copy to the console, then hand the original to the existing command. With
`ccstatusline` as the incumbent:

```json
{ "type": "command",
  "command": "IN=$(cat); printf '%s' \"$IN\" | curl -sS -m 2 -X POST -H 'content-type: application/json' --data-binary @- http://127.0.0.1:4823/statusline >/dev/null 2>&1; printf '%s' \"$IN\" | ccstatusline",
  "refreshInterval": 5 }
```

Substitute the incumbent's real command for `ccstatusline`, preserving its
arguments. If its shape is one you cannot safely wrap — anything already piping
or reading stdin in a way you cannot reason about — leave `statusLine` ALONE,
install the rest, and tell the operator plainly which single feature they gave up
(the rate-limit gauge) and what to paste if they want it later.

## 4. Prove it parses

A broken `settings.json` breaks Claude Code, so never leave without checking:

```bash
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); console.log("settings.json parses")' "$CFG"
```

If that fails, restore the backup immediately and report what happened.

## 5. Report

Tell the operator, in two or three lines: which keys changed, that the existing
status line was preserved (or why it was not), where the backup is, and that
**hooks are read once at session start, so this takes effect in the next
session** — not the one they are in.

## Removing it

Reverse of the above: drop hook entries whose URL matches
`http://127.0.0.1:PORT/hook`, drop `subagentStatusLine` if it points at
`/substatus`, and restore `statusLine` to the incumbent command it wrapped (or
delete it if the console installed it). Same rules — back up, confirm, verify it
parses.
