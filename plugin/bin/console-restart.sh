#!/bin/sh
# Bring the console back after an observation hook found nothing listening.
#
# CONTRACT: always exit 0, and never write to stdout or stderr. This runs from
# a hook on every event the console misses, and Claude Code renders anything a
# hook writes to stderr as a "<hook name> hook error" notice — the very notice
# routing observation through curl exists to remove. Printing here would put
# the connection refusal back on the operator's screen once per tool call.
#
# The caller invokes this on ANY failed POST, not only a refused connection, so
# every gate below has to hold for a server that is merely slow as well as one
# that is gone.
set -u

PORT="${OCTO_PORT:-4823}"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
# Never the cwd: the hook inherits the Claude session's cwd — the user's
# project, not this checkout. CLAUDE_PLUGIN_ROOT is set when we are installed
# as a plugin; otherwise this script sits in <root>/bin.
ROOT="${OCTO_ROOT:-${CLAUDE_PLUGIN_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}}"
HEALTH="http://127.0.0.1:$PORT/health"

# A POST can fail because the console is busy rather than absent — the event
# hooks allow it 5 seconds and the permission hook 600. Only a health check
# that also fails means there is nothing there to talk to.
curl -sf -m 1 "$HEALTH" >/dev/null 2>&1 && exit 0

# Never resurrect a console that was meant to stop. startIdleReaper() exits the
# server once no team has been live for the grace window, and Claude Code
# DELETES a team's directory when the session behind it ends — so with nothing
# live, a refused connection is the resting state, not a fault to repair.
# Without this gate the next tool call would restart the server, the reaper
# would exit it again, and the pair would trade the port back and forth for as
# long as the session lasted.
live=0
for cfg in "$CLAUDE_DIR"/teams/*/config.json; do
  [ -f "$cfg" ] || continue
  # Count members without a JSON parser: one "agentId" key per member. Ordinary
  # subagents never reach config.json, so >= 2 is a real team, same rule as
  # hasLiveTeam() and the launcher's PostToolUse gate.
  members=$(tr -d ' \n' < "$cfg" 2>/dev/null | grep -o '"agentId"' | wc -l | tr -d ' ')
  [ "${members:-0}" -ge 2 ] 2>/dev/null || continue
  live=1
  break
done
[ "$live" -eq 1 ] || exit 0

# A burst of tool calls puts every hook on this line at the same instant, so the
# spawn sits behind an atomic mkdir. A lock left behind by a killed hook would
# block every later restart, so one older than a minute is cleared rather than
# trusted.
lock="$CLAUDE_DIR/agent-teams-console/restarting"
mkdir -p "$CLAUDE_DIR/agent-teams-console" 2>/dev/null
[ -n "$(find "$lock" -maxdepth 0 -mmin +1 2>/dev/null)" ] && rmdir "$lock" 2>/dev/null
mkdir "$lock" 2>/dev/null || exit 0

# No --team flag: an unresolved team is never passed as a guess, because a
# server pinned to a team that does not exist shows an empty wall. With no name
# the server discovers the live team itself and follows the real one.
# Prefer the bundle (fast cold start), falling back to tsx so a fresh checkout
# still works without `npm run build`.
if [ -f "$ROOT/dist/server/index.js" ]; then
  nohup node "$ROOT/dist/server/index.js" --port "$PORT" \
    >>"$CLAUDE_DIR/agent-teams-console.log" 2>&1 &
else
  nohup npx --prefix "$ROOT/.." tsx "$ROOT/../src/server/index.ts" --port "$PORT" \
    >>"$CLAUDE_DIR/agent-teams-console.log" 2>&1 &
fi

# Hold the lock until it answers so a burst collapses into one spawn, then
# release it — the next miss has to be able to try again.
i=0
while [ "$i" -lt 15 ]; do
  curl -sf -m 1 "$HEALTH" >/dev/null 2>&1 && break
  sleep 0.1
  i=$((i + 1))
done
rmdir "$lock" 2>/dev/null
exit 0
