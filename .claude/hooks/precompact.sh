#!/bin/bash
# PreCompact hook — fires before automatic context compaction.
# If SESSION.md is stale (not updated in last 5 minutes), blocks compaction
# and asks Claude to update it first. Once updated, compaction proceeds.

input=$(cat)
trigger=$(echo "$input" | jq -r '.trigger // "auto"')

# Only intercept automatic compaction, not manual /compact
if [[ "$trigger" != "auto" ]]; then
  exit 0
fi

SESSION_FILE="$(git rev-parse --show-toplevel 2>/dev/null)/.claude/SESSION.md"

if [[ -f "$SESSION_FILE" ]]; then
  LAST_MODIFIED=$(stat -c %Y "$SESSION_FILE" 2>/dev/null || stat -f %m "$SESSION_FILE" 2>/dev/null)
  NOW=$(date +%s)
  DIFF=$((NOW - LAST_MODIFIED))
  if [[ $DIFF -lt 300 ]]; then
    # SESSION.md updated within last 5 minutes — safe to compact
    exit 0
  fi
fi

cat >&2 <<'EOF'
⚠️  AUTO-COMPACTION IMMINENT — context window is nearly full.

Before compaction proceeds:
1. Update .claude/SESSION.md with the complete current state:
   - What is in progress right now
   - Key decisions made this session (that aren't yet in TICKETS.md)
   - Handoff notes for the next session
2. Tell the owner: "Context compaction is about to happen. SESSION.md has been updated."

Once SESSION.md is saved, compaction will proceed automatically.
EOF

exit 2
