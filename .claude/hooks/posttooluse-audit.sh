#!/bin/bash
# PostToolUse audit hook — logs every file-modifying or shell action with timestamp.
# Output: .claude/session-audit.log (TSV: timestamp | tool | detail)
# Claude reads this log as part of verify.sh to confirm actual vs claimed actions.

input=$(cat)
tool_name=$(echo "$input" | jq -r '.tool_name // ""')
timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if [[ -z "$REPO_ROOT" ]]; then
  exit 0
fi

LOG_FILE="$REPO_ROOT/.claude/session-audit.log"

case "$tool_name" in
  Edit)
    file_path=$(echo "$input" | jq -r '.tool_input.file_path // "unknown"')
    printf '%s\tEdit\t%s\n' "$timestamp" "$file_path" >> "$LOG_FILE"
    ;;
  Write)
    file_path=$(echo "$input" | jq -r '.tool_input.file_path // "unknown"')
    printf '%s\tWrite\t%s\n' "$timestamp" "$file_path" >> "$LOG_FILE"
    ;;
  Bash)
    command=$(echo "$input" | jq -r '.tool_input.command // "unknown"' | head -c 120 | tr '\n' ' ')
    printf '%s\tBash\t%s\n' "$timestamp" "$command" >> "$LOG_FILE"
    ;;
  *)
    exit 0
    ;;
esac

exit 0
