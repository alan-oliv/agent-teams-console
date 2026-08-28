---
description: Report whether the agent teams console is running, print its URL, and start it if a team is live
allowed-tools: ["Bash"]
---

# Agent teams console

Report the console's status in one or two lines. Run the steps in order and stop
at the first one that answers the question. Do not read source files.

## 1. Is it already answering?

```bash
curl -sf -m 2 http://127.0.0.1:4823/health
```

If this prints `{"ok":true,"team":"…","agents":N}`, the console is up. Report:

> Console is running: http://127.0.0.1:4823/?team=TEAM — N agents.

Use the `team` from the response. If `team` is empty, drop the `?team=` part and
say it has not bound to a team yet.

## 2. Nothing answered — is there a live team to show?

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

> Console is not running, and no team is live — it starts by itself the next
> time you spawn teammates.

Then stop.

## 3. A team is live but the server is down — start it

```bash
nohup node "${CLAUDE_PLUGIN_ROOT}/dist/server/index.js" --port 4823 \
  >>"${CLAUDE_CONFIG_DIR:-$HOME/.claude}/agent-teams-console.log" 2>&1 &
sleep 1
curl -sf -m 2 http://127.0.0.1:4823/health
```

If `${CLAUDE_PLUGIN_ROOT}` came through unsubstituted, say so rather than
guessing a path — the plugin is not installed the way this command expects.

On success, report the URL as in step 1, using the team name from step 2. If the
health check still fails, print the last few lines of
`${CLAUDE_CONFIG_DIR:-$HOME/.claude}/agent-teams-console.log` and stop.
