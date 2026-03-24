#!/bin/bash
# verify.sh — Run after every commit, before pushing.
# Verifies that what Claude claimed to do is reflected in actual artifacts.
# Exit 0 = all checks passed. Exit 1 = discrepancies found (Claude must reconcile).

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
CLAUDE_DIR="$REPO_ROOT/.claude"
PASS=0
FAIL=0

echo "╔══════════════════════════════════════════════════════╗"
echo "║              ARTIFACT VERIFICATION REPORT            ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "Commit : $(git log -1 --format='%h %s')"
echo "Author : $(git log -1 --format='%an')"
echo "Time   : $(git log -1 --format='%ai')"
echo ""

# --- Files actually changed ---
echo "── Files changed in last commit ──────────────────────"
CHANGED_FILES=$(git diff HEAD~1 --name-only 2>/dev/null)
if [[ -z "$CHANGED_FILES" ]]; then
  # First commit or diff not available
  CHANGED_FILES=$(git show --name-only HEAD --format="" | tail -n +2)
fi
if [[ -n "$CHANGED_FILES" ]]; then
  echo "$CHANGED_FILES" | sed 's/^/  /'
else
  echo "  (no files changed)"
fi
echo ""

# --- Ticket stub verification ---
COMMIT_MSG=$(git log -1 --format='%s %b')
TICKET_REFS=$(echo "$COMMIT_MSG" | grep -oE 'T-[0-9]+' | sort -u)

if [[ -n "$TICKET_REFS" ]]; then
  echo "── Ticket refs in commit ─────────────────────────────"
  for ref in $TICKET_REFS; do
    found=0
    # Check individual ticket files (new structure)
    [[ -f "$CLAUDE_DIR/tickets/${ref}.md" ]] && found=1
    ls "$CLAUDE_DIR/tickets/${ref}-"*.md 2>/dev/null | grep -q . && found=1
    [[ -f "$CLAUDE_DIR/tickets/done/${ref}.md" ]] && found=1
    ls "$CLAUDE_DIR/tickets/done/${ref}-"*.md 2>/dev/null | grep -q . && found=1
    # Fallback: index files (also catches refs in legacy TICKETS_DONE.md)
    grep -q "$ref" "$CLAUDE_DIR/TICKETS.md" 2>/dev/null && found=1
    grep -q "$ref" "$CLAUDE_DIR/TICKETS_DONE.md" 2>/dev/null && found=1

    if [[ $found -eq 1 ]]; then
      echo "  ✅ $ref — stub found"
      ((PASS++))
    else
      echo "  ❌ $ref — NO STUB in tickets/ or TICKETS.md"
      ((FAIL++))
    fi
  done
  echo ""
fi

# --- Audit stub verification ---
AUDIT_REFS=$(echo "$COMMIT_MSG" | grep -oE '(SEC|MAINT|INFRA|UX|PERF)-[0-9]+(\.[0-9]+)?' | sort -u)

if [[ -n "$AUDIT_REFS" ]]; then
  echo "── Audit refs in commit ──────────────────────────────"
  for ref in $AUDIT_REFS; do
    PREFIX=$(echo "$ref" | grep -oE '^[A-Z]+')
    found=0
    case "$PREFIX" in
      SEC)   grep -q "$ref" "$CLAUDE_DIR/AUDIT_SECURITY.md" 2>/dev/null && found=1 ;;
      MAINT) grep -q "$ref" "$CLAUDE_DIR/AUDIT_MAINTAINABILITY.md" 2>/dev/null && found=1 ;;
      INFRA) grep -q "$ref" "$CLAUDE_DIR/AUDIT_INFRASTRUCTURE.md" 2>/dev/null && found=1 ;;
      UX)    grep -q "$ref" "$CLAUDE_DIR/AUDIT_USABILITY.md" 2>/dev/null && found=1 ;;
      PERF)  grep -q "$ref" "$CLAUDE_DIR/AUDIT_PERFORMANCE.md" 2>/dev/null && found=1 ;;
    esac
    grep -q "$ref" "$CLAUDE_DIR/AUDIT_DONE.md" 2>/dev/null && found=1
    grep -q "$ref" "$CLAUDE_DIR/AUDIT.md" 2>/dev/null && found=1

    if [[ $found -eq 1 ]]; then
      echo "  ✅ $ref — found in audit files"
      ((PASS++))
    else
      echo "  ❌ $ref — NOT FOUND in any audit file"
      ((FAIL++))
    fi
  done
  echo ""
fi

# --- SESSION.md freshness ---
echo "── SESSION.md ────────────────────────────────────────"
SESSION_FILE="$CLAUDE_DIR/SESSION.md"
if [[ -f "$SESSION_FILE" ]]; then
  LAST_MODIFIED=$(stat -c %Y "$SESSION_FILE" 2>/dev/null || stat -f %m "$SESSION_FILE" 2>/dev/null)
  NOW=$(date +%s)
  DIFF=$((NOW - LAST_MODIFIED))
  if [[ $DIFF -lt 600 ]]; then
    echo "  ✅ Updated $(( DIFF / 60 )) min ago"
    ((PASS++))
  else
    echo "  ⚠️  Last updated $(( DIFF / 60 )) min ago — update before pushing"
    ((FAIL++))
  fi
else
  echo "  ❌ SESSION.md missing"
  ((FAIL++))
fi
echo ""

# --- Audit log tail ---
echo "── Last 8 actions (session-audit.log) ───────────────"
LOG_FILE="$CLAUDE_DIR/session-audit.log"
if [[ -f "$LOG_FILE" ]]; then
  tail -8 "$LOG_FILE" | awk -F'\t' '{printf "  %-22s %-6s %s\n", $1, $2, $3}'
else
  echo "  (no audit log — PostToolUse hook may not be active)"
fi
echo ""

# --- Summary ---
echo "══════════════════════════════════════════════════════"
if [[ $FAIL -eq 0 ]]; then
  echo "  RESULT: ✅ All checks passed ($PASS passed, 0 failed)"
  echo "══════════════════════════════════════════════════════"
  exit 0
else
  echo "  RESULT: ❌ $FAIL check(s) failed — reconcile before pushing"
  echo "══════════════════════════════════════════════════════"
  exit 1
fi
