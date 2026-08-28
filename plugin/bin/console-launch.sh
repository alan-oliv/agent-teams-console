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

# Resolve the team this session belongs to, in order of preference:
#   1. A team whose config.json already names this session as leadSessionId.
#   2. `/branch` gives the forked session a brand new id but never touches
#      config.json, so a forked session's real team is keyed on an ANCESTOR's
#      id. Walk forkedFrom.sessionId up from this session's own transcript,
#      retrying (1) at each ancestor, until one resolves or the chain runs out.
#   3. Neither found a team — this session is about to create its FIRST one
#      (or CLAUDE_DIR/projects is unreadable) — so fall back to the original
#      derivation: "session-" + first 8 of this session's own id.
# Entirely read-only: nothing below creates a directory.
find_team_for_session() {
  # $1: session id. On a match, prints the team dir name and returns 0.
  for cfg in "$CLAUDE_DIR"/teams/*/config.json; do
    [ -f "$cfg" ] || continue
    lead=$(sed -n 's/.*"leadSessionId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$cfg" 2>/dev/null | head -1)
    [ "$lead" = "$1" ] || continue
    basename "$(dirname "$cfg")"
    return 0
  done
  return 1
}

short=$(printf '%s' "$session" | cut -c1-8)
[ ${#short} -eq 8 ] || bail

# Same formula index.ts uses to turn a member's cwd into its project-dir slug
# (toDiscovered): every non-alnum byte becomes '-'. Unlike ROOT above, this
# cwd IS the one we want — the fork chain's transcripts live beside it.
slug=$(pwd | sed 's/[^a-zA-Z0-9]/-/g')
sid="$session"
visited=""
depth=0
team=""
while :; do
  if team=$(find_team_for_session "$sid"); then break; fi
  case " $visited " in *" $sid "*) break ;; esac
  visited="$visited $sid"
  depth=$((depth + 1))
  # 20 /branch hops is far beyond any real chain — a stop so a malformed
  # forkedFrom link can never loop this script forever.
  [ "$depth" -le 20 ] || break
  transcript="$CLAUDE_DIR/projects/$slug/$sid.jsonl"
  [ -f "$transcript" ] || break
  # Claude Code stamps forkedFrom.sessionId on every record of a branched
  # session, so the first line always carries it when there is one. Capped at
  # 64 KiB — the same bound src/server/ingest/files.ts's growForkChain uses
  # for this exact header — generous over any real line, bounded against one
  # that never closes.
  parent=$(head -c 65536 "$transcript" 2>/dev/null | sed -n '1{p;q;}' \
    | sed -n 's/.*"forkedFrom"[[:space:]]*:[[:space:]]*{[^}]*"sessionId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
  [ -n "$parent" ] || break
  sid="$parent"
done
[ -n "$team" ] || team="session-$short"

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
      nohup npx --prefix "$ROOT/.." tsx "$ROOT/../src/server/index.ts" --port "$PORT" --team "$team" \
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
# team across a PreToolUse/PostToolUse pair. The marker lives under the
# console's OWN state directory, never under teams/<team>: that path is the
# user's real team config, and at PreToolUse time the team may not exist at
# all yet (fires before the spawn that creates config.json) — writing a
# directory there for a team that may never exist would be a phantom entry
# in the user's real config. markerdir is ours alone, so it is always safe
# to create.
markerdir="$CLAUDE_DIR/agent-teams-console/announced"
marker="$markerdir/$team"
[ -f "$marker" ] && bail
mkdir -p "$markerdir" 2>/dev/null
: > "$marker" 2>/dev/null || bail

printf '{"systemMessage":"Agent teams console → http://127.0.0.1:%s/?team=%s"}\n' "$PORT" "$team"
exit 0
