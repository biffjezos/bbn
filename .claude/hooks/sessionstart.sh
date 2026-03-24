#!/bin/bash
# SessionStart hook — fires at every session start (including after compaction).
# Outputs SESSION.md content directly into context so Claude cannot miss it.

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
SESSION_FILE="$REPO_ROOT/.claude/SESSION.md"

if [[ ! -f "$SESSION_FILE" ]]; then
  echo "⚠️  SESSION.md not found at $SESSION_FILE — create it before starting work."
  exit 0
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "SESSION STATE (from .claude/SESSION.md)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
cat "$SESSION_FILE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
