#!/bin/sh
# Pre/PostToolUse(Agent) launcher for the Agent Teams Console.
#
# CONTRACT: PreToolUse BLOCKS the tool call, so this must never emit a
# permissionDecision and must always exit 0 — a broken console must never
# stop a teammate from spawning. On every path stdout is either `{}` or
# `{"systemMessage": ...}`, nothing else.
#
# PreToolUse fires before the teammate exists, so config.json cannot yet
# carry it — the member-count gate used to require a spawn that already
# happened. Instead this wakes on PreToolUse only when tool_input.name is a
# non-empty string, which the Agent tool sets only when routing to the
# teammate path (verified empirically: ordinary subagents and workflow
# fan-outs pass no name). PostToolUse keeps the old member-count gate as a
# safety net for when the Pre path fails to fire or fails to parse; the
# once-per-team marker file below makes sure only one of the two announces.
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

event=$(printf '%s' "$payload" \
  | sed -n 's/.*"hook_event_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
  | head -1)

session=$(printf '%s' "$payload" \
  | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
  | head -1)
[ -n "$session" ] || bail

# teamName = "session-" + first 8 of the lead session id
short=$(printf '%s' "$session" | cut -c1-8)
[ ${#short} -eq 8 ] || bail
team="session-$short"

case "$event" in
  PreToolUse)
    # tool_input is a nested object whose description/prompt fields can hold
    # arbitrary text (quotes, braces), so a sed scalar-match is not safe here.
    # node is already a hard dependency of this script (it runs the server
    # below), so ask it to parse — and fail closed to {} on any error, same
    # as an absent name.
    name=$(printf '%s' "$payload" | node -e '
      let raw = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (d) => { raw += d; });
      process.stdin.on("end", () => {
        try {
          const doc = JSON.parse(raw);
          const n = doc && doc.tool_input && doc.tool_input.name;
          if (typeof n === "string" && n.length > 0) process.stdout.write(n);
        } catch {
          // malformed JSON — print nothing, caller bails.
        }
      });
    ' 2>/dev/null)
    [ -n "$name" ] || bail
    ;;
  PostToolUse)
    config="$CLAUDE_DIR/teams/$team/config.json"
    [ -f "$config" ] || bail
    # Count members without a JSON parser: one "agentId" key per member.
    members=$(tr -d ' \n' < "$config" 2>/dev/null | grep -o '"agentId"' | wc -l | tr -d ' ')
    [ "${members:-0}" -ge 2 ] 2>/dev/null || bail
    ;;
  *)
    bail
    ;;
esac

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

# Announce once per team, not once per teammate, and not twice for the same
# team across a PreToolUse/PostToolUse pair. At PreToolUse time the team
# directory may not exist yet at all, so make sure it does before marking.
teamdir="$CLAUDE_DIR/teams/$team"
marker="$teamdir/.console-announced"
[ -f "$marker" ] && bail
mkdir -p "$teamdir" 2>/dev/null
: > "$marker" 2>/dev/null || bail

printf '{"systemMessage":"Agent teams console → http://127.0.0.1:%s/?team=%s"}\n' "$PORT" "$team"
exit 0
