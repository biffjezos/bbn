#!/bin/bash
# SessionStart hook — fires at every session start (including after compaction).
# Outputs SESSION.md, open tickets board, and open audit items board into context.
# Both boards use the unified <!-- ITEM ... --> tag format.

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
SESSION_FILE="$REPO_ROOT/.claude/SESSION.md"
TICKETS_FILE="$REPO_ROOT/.claude/TICKETS.md"
CLAUDE_DIR="$REPO_ROOT/.claude"

# ── SESSION STATE ─────────────────────────────────────────────────────────────
if [[ ! -f "$SESSION_FILE" ]]; then
  echo "⚠️  SESSION.md not found at $SESSION_FILE — create it before starting work."
  exit 0
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "SESSION STATE (from .claude/SESSION.md)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
cat "$SESSION_FILE"

# ── SHARED ITEM PARSER ────────────────────────────────────────────────────────
# Usage: parse_items <file> <skip_statuses_colon_separated> <tmpfile> [show_phase]
# Reads <!-- ITEM ... --> tags from <file>, skips entries whose status is in the
# skip list, writes formatted rows to <tmpfile>.
parse_items() {
  local file="$1"
  local skip="$2"
  local tmpfile="$3"
  local show_phase="${4:-no}"
  local current_title=""

  [[ -f "$file" ]] || return

  while IFS= read -r line; do
    # Track nearest ## or ### heading as candidate title
    if [[ "$line" =~ ^#{2,3}[[:space:]](.+)$ ]]; then
      HEADING="${BASH_REMATCH[1]}"
      # Strip leading ID prefix (e.g. "T-08 — ", "SEC-1.1 ✅ ", "T-06b ")
      current_title=$(echo "$HEADING" \
        | sed -E 's/^[A-Z]+-[0-9]+[a-z]?(\.[0-9]+)?[[:space:]]*(✅[[:space:]]*)?([—\-]+[[:space:]]*)*//')
    fi

    if [[ "$line" =~ ^\<\!--\ ITEM\ (.+)\ --\>$ ]]; then
      local meta="${BASH_REMATCH[1]}"
      local id     status    priority  phase
      id=$(echo       "$meta" | grep -oP 'id:\K\S+')
      status=$(echo   "$meta" | grep -oP 'status:\K\S+')
      priority=$(echo "$meta" | grep -oP 'priority:\K\S+')
      phase=$(echo    "$meta" | grep -oP 'phase:\K\S+')

      # Skip if status is in the skip list
      IFS=':' read -ra skip_arr <<< "$skip"
      local skip_this=0
      for s in "${skip_arr[@]}"; do
        [[ "$status" == "$s" ]] && skip_this=1 && break
      done
      [[ $skip_this -eq 1 ]] && continue

      if [[ "$show_phase" == "yes" && -n "$phase" ]]; then
        printf "%-12s  %-12s  %-8s  %-46s  phase:%s\n" \
          "$id" "$status" "${priority:--}" "$current_title" "$phase" >> "$tmpfile"
      else
        printf "%-12s  %-12s  %-8s  %s\n" \
          "$id" "$status" "${priority:--}" "$current_title" >> "$tmpfile"
      fi
    fi
  done < "$file"
}

# ── OPEN TICKETS BOARD ────────────────────────────────────────────────────────
if [[ -f "$TICKETS_FILE" ]]; then
  TMPTICKETS=$(mktemp)
  parse_items "$TICKETS_FILE" "done:closed" "$TMPTICKETS" "yes"

  if [[ -s "$TMPTICKETS" ]]; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "OPEN TICKETS (from .claude/TICKETS.md)"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    printf "%-12s  %-12s  %-8s  %s\n" "ID" "STATUS" "PRI" "TITLE"
    printf "%-12s  %-12s  %-8s  %s\n" "------------" "------------" "--------" "----------------------------------------------"
    cat "$TMPTICKETS"
  fi
  rm -f "$TMPTICKETS"
fi

# ── OPEN AUDIT ITEMS BOARD ───────────────────────────────────────────────────
# All open audit items live in the single AUDIT.md (consolidated 2026-07-02).
TMPAUDIT=$(mktemp)
parse_items "$CLAUDE_DIR/AUDIT.md" "resolved:superseded" "$TMPAUDIT"

if [[ -s "$TMPAUDIT" ]]; then
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "OPEN AUDIT ITEMS (from .claude/AUDIT.md)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  printf "%-12s  %-12s  %-8s  %s\n" "ID" "STATUS" "PRI" "TITLE"
  printf "%-12s  %-12s  %-8s  %s\n" "------------" "------------" "--------" "------------------------------------------"
  cat "$TMPAUDIT"
fi
rm -f "$TMPAUDIT"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
