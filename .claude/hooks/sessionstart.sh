#!/bin/bash
# SessionStart hook — fires at every session start (including after compaction).
# Outputs SESSION.md, open tickets board, and AUDIT summary table into context.

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
SESSION_FILE="$REPO_ROOT/.claude/SESSION.md"
TICKETS_FILE="$REPO_ROOT/.claude/TICKETS.md"
AUDIT_FILE="$REPO_ROOT/.claude/AUDIT.md"

# ── SESSION STATE ─────────────────────────────────────────────────────────────
if [[ ! -f "$SESSION_FILE" ]]; then
  echo "⚠️  SESSION.md not found at $SESSION_FILE — create it before starting work."
  exit 0
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "SESSION STATE (from .claude/SESSION.md)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
cat "$SESSION_FILE"

# ── OPEN TICKETS BOARD ────────────────────────────────────────────────────────
if [[ -f "$TICKETS_FILE" ]]; then
  TMPBOARD=$(mktemp)

  CURRENT_TITLE=""
  while IFS= read -r line; do
    # Track most recent ## or ### heading as candidate title
    if [[ "$line" =~ ^#{2,3}[[:space:]](.+)$ ]]; then
      HEADING="${BASH_REMATCH[1]}"
      # Strip "T-XX — " or "T-XX " prefix
      CURRENT_TITLE=$(echo "$HEADING" | sed -E 's/^T-[0-9a-zA-Z]+[[:space:]]*[—\-]+[[:space:]]*//' \
                                       | sed -E 's/^T-[0-9a-zA-Z]+[[:space:]]*//')
    fi

    # Match TICKET metadata comment
    if [[ "$line" =~ ^\<\!--\ TICKET\ (.+)\ --\>$ ]]; then
      META="${BASH_REMATCH[1]}"

      ID=$(echo "$META"     | grep -oP 'id:\K\S+')
      STATUS=$(echo "$META" | grep -oP 'status:\K\S+')
      PRI=$(echo "$META"    | grep -oP 'priority:\K\S+')
      PHASE=$(echo "$META"  | grep -oP 'phase:\K\S+')

      # Skip done and closed
      [[ "$STATUS" == "done" || "$STATUS" == "closed" ]] && continue

      PHASE_SUFFIX=""
      [[ -n "$PHASE" ]] && PHASE_SUFFIX="  phase:$PHASE"

      printf "%-8s  %-12s  %-8s  %-46s%s\n" \
        "$ID" "$STATUS" "${PRI:--}" "$CURRENT_TITLE" "$PHASE_SUFFIX" >> "$TMPBOARD"
    fi
  done < "$TICKETS_FILE"

  if [[ -s "$TMPBOARD" ]]; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "OPEN TICKETS (from .claude/TICKETS.md)"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    printf "%-8s  %-12s  %-8s  %-46s%s\n" "ID" "STATUS" "PRI" "TITLE" "PHASE"
    printf "%-8s  %-12s  %-8s  %-46s\n"  "--------" "------------" "--------" "----------------------------------------------"
    cat "$TMPBOARD"
  fi
  rm -f "$TMPBOARD"
fi

# ── AUDIT SUMMARY TABLE ───────────────────────────────────────────────────────
if [[ -f "$AUDIT_FILE" ]]; then
  TABLE=$(awk '/^## Global Summary Table/{found=1} found{print} found && /^---/{exit}' "$AUDIT_FILE")

  if [[ -n "$TABLE" ]]; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "AUDIT SUMMARY (from .claude/AUDIT.md)"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "$TABLE"
  fi
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
