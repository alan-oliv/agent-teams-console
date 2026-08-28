#!/bin/sh
# PostToolUse(Agent) launcher for the Agent Teams Console.
#
# CONTRACT: this runs inside a hook that BLOCKS the turn. It must
# always print valid JSON on stdout and always exit 0. A broken console must
# never fail a spawn.
#
# It wakes the console only when a real team exists — that is, when the team's
# config.json carries two or more members. Ordinary Agent-tool subagents and
# workflow fan-outs do not appear in members[], so they cost one shell spawn
# and nothing else.
set -u

PORT="${OCTO_PORT:-4823}"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
# Never the cwd: the hook inherits the Claude session's cwd — the user's
# project, not this checkout. CLAUDE_PLUGIN_ROOT is set when we are installed
# as a plugin; otherwise this script sits in <root>/bin.
ROOT="${OCTO_ROOT:-${CLAUDE_PLUGIN_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}}"
HEALTH="http://127.0.0.1:$PORT/health"

bail() { echo '{}'; exit 0; }

payload=$(cat 2>/dev/null) || bail
[ -n "$payload" ] || bail

session=$(printf '%s' "$payload" \
  | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
  | head -1)
[ -n "$session" ] || bail

# teamName = "session-" + first 8 of the lead session id
short=$(printf '%s' "$session" | cut -c1-8)
[ ${#short} -eq 8 ] || bail
team="session-$short"

config="$CLAUDE_DIR/teams/$team/config.json"
[ -f "$config" ] || bail

# Count members without a JSON parser: one "agentId" key per member.
members=$(tr -d ' \n' < "$config" 2>/dev/null | grep -o '"agentId"' | wc -l | tr -d ' ')
[ "${members:-0}" -ge 2 ] 2>/dev/null || bail

# Start the server if it is not already answering.
if ! curl -sf -m 1 "$HEALTH" >/dev/null 2>&1; then
  if [ "${OCTO_NO_SPAWN:-}" != "1" ]; then
    # Prefer the bundle (fast cold start). Fall back to tsx when it has not
    # been built, so a fresh checkout still works without `npm run build`.
    if [ -f "$ROOT/dist/server/index.js" ]; then
      nohup node "$ROOT/dist/server/index.js" --port "$PORT" --team "$team" \
        >>"$CLAUDE_DIR/agent-teams-console.log" 2>&1 &
    else
      nohup npx --prefix "$ROOT" tsx "$ROOT/src/server/index.ts" --port "$PORT" --team "$team" \
        >>"$CLAUDE_DIR/agent-teams-console.log" 2>&1 &
    fi
    i=0
    while [ "$i" -lt 15 ]; do
      curl -sf -m 1 "$HEALTH" >/dev/null 2>&1 && break
      sleep 0.1
      i=$((i + 1))
    done
  fi
fi

# Announce once per team, not once per teammate.
marker="$CLAUDE_DIR/teams/$team/.console-announced"
[ -f "$marker" ] && bail
: > "$marker" 2>/dev/null || bail

printf '{"systemMessage":"Agent teams console → http://127.0.0.1:%s/?team=%s"}\n' "$PORT" "$team"
exit 0
