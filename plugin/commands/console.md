---
description: Restart the agent teams console on the installed build and print its URL
allowed-tools: ["Bash"]
---

# Agent teams console

Always replace the running server, then report the URL in one or two lines. Do
not read source files.

**Why it always restarts rather than reporting a healthy server as fine:** the
server is detached and outlives the session that started it, so `claude plugin
update` leaves the OLD build serving on 4823 indefinitely. A health check cannot
tell the two apart — it answers `ok` either way — so a console that looks fine is
routinely a release behind, missing exactly the feature you updated for. Killing
first is what makes `/console` mean "serving the build I have installed".

Restarting is cheap: the console rebuilds its whole screen from its own
append-only log, so transcripts, tasks, mail, permission cards and the status
line all come back.

## 1. Stop whatever is on 4823

```bash
pkill -f "agent-teams-console.*dist/server/index.js" 2>/dev/null
sleep 1
curl -sf -m 2 http://127.0.0.1:4823/health && echo "STILL UP" || echo "port clear"
```

If this prints `STILL UP`, something else holds the port. Say so and stop rather
than starting a second server against it.

## 2. Which team, if any, is live?

This decides what goes in the URL. It does **not** decide whether to start —
step 3 runs either way, so the console is up and waiting before the next team
exists rather than after it.

A team is live only when its `config.json` lists two or more members. Ordinary
subagents never appear there, so an empty result means no team yet.

```bash
for c in "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/teams/*/config.json; do
  [ -f "$c" ] || continue
  n=$(grep -o '"agentId"' "$c" | wc -l | tr -d ' ')
  [ "$n" -ge 2 ] && echo "$(basename "$(dirname "$c")") $n"
done
```

Nothing printed is a normal outcome, not a failure. Carry on to step 3.

## 3. Start the installed build

```bash
nohup node "${CLAUDE_PLUGIN_ROOT}/dist/server/index.js" --port 4823 \
  >>"${CLAUDE_CONFIG_DIR:-$HOME/.claude}/agent-teams-console.log" 2>&1 &
sleep 2
curl -sf -m 2 http://127.0.0.1:4823/health
```

If `${CLAUDE_PLUGIN_ROOT}` came through unsubstituted, say so rather than
guessing a path — the plugin is not installed the way this command expects.

On success, with a team:

> Console restarted: http://127.0.0.1:4823/?team=TEAM — N agents.

With no team, say so plainly and give the bare URL, because an empty wall would
otherwise read as a broken console:

> Console restarted: http://127.0.0.1:4823/ — no team yet, it binds to the next
> one you spawn.

Use the `team` from the health response, not from step 2, and drop the `?team=`
part when it is empty. If the health check fails, print the last few lines of
`${CLAUDE_CONFIG_DIR:-$HOME/.claude}/agent-teams-console.log` and stop.

**Say this too when there was no team:** a server with nothing to watch reaps
itself after its idle grace window, roughly ten minutes, so an unused console
will not be there later. That is the server's own lifecycle, not a crash — run
the command again, or just spawn a team and it starts itself.

**One caveat worth stating when you report:** `${CLAUDE_PLUGIN_ROOT}` resolves to
the build this *session* loaded at startup. If the plugin was updated after the
session began, this still starts the older one — restart Claude Code to pick up
the new build.
