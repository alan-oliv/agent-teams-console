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

## 2. Is there a live team to show?

A team is live only when its `config.json` lists two or more members. Ordinary
subagents never appear there, so an empty result means there is genuinely
nothing to display.

```bash
for c in "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/teams/*/config.json; do
  [ -f "$c" ] || continue
  n=$(grep -o '"agentId"' "$c" | wc -l | tr -d ' ')
  [ "$n" -ge 2 ] && echo "$(basename "$(dirname "$c")") $n"
done
```

If this prints nothing, report:

> Console stopped, and no team is live — it starts by itself the next time you
> spawn teammates.

Then stop. Do not start a server with nothing to show.

## 3. Start the installed build

```bash
nohup node "${CLAUDE_PLUGIN_ROOT}/dist/server/index.js" --port 4823 \
  >>"${CLAUDE_CONFIG_DIR:-$HOME/.claude}/agent-teams-console.log" 2>&1 &
sleep 2
curl -sf -m 2 http://127.0.0.1:4823/health
```

If `${CLAUDE_PLUGIN_ROOT}` came through unsubstituted, say so rather than
guessing a path — the plugin is not installed the way this command expects.

On success report:

> Console restarted: http://127.0.0.1:4823/?team=TEAM — N agents.

Use the `team` from the health response, and drop the `?team=` part if it is
empty. If the health check fails, print the last few lines of
`${CLAUDE_CONFIG_DIR:-$HOME/.claude}/agent-teams-console.log` and stop.

**One caveat worth stating when you report:** `${CLAUDE_PLUGIN_ROOT}` resolves to
the build this *session* loaded at startup. If the plugin was updated after the
session began, this still starts the older one — restart Claude Code to pick up
the new build.
