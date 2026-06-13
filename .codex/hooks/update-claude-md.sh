#!/usr/bin/env bash
# Auto-updates CLAUDE.md to point at the latest gstack design doc.
# Wired via PostToolUse hook in .claude/settings.local.json.
# Safe to call on every Write/Edit — bails early if path doesn't match.
#
# Behavior:
#   - If a pointer line (backtick-wrapped path to a *-design-*.md under our projects dir) exists ANYWHERE in CLAUDE.md, update it in place.
#     User can freely move it between sections, change surrounding markdown, etc. — the script finds it by pattern, not by line number.
#   - If no pointer exists, append a fresh `## Latest gstack artifacts` section to the end of CLAUDE.md.
#   - If user has multiple matching lines (e.g., kept historical examples), ALL are updated to the latest path. To keep history immutable, write history paths without backticks.

PROJECTS_DIR="$HOME/.gstack/projects/karthikcsq-gantry"
CLAUDE_MD="$HOME/CodingFiles/Gantry/gantry/CLAUDE.md"

file_path=$(jq -r '.tool_input.file_path // .tool_response.filePath // empty' 2>/dev/null)

case "$file_path" in
  *karthikcsq-gantry*) ;;
  *) exit 0 ;;
esac

newest=$(ls -t "$PROJECTS_DIR"/*-design-*.md 2>/dev/null | head -1)
[ -z "$newest" ] && exit 0
[ ! -f "$CLAUDE_MD" ] && exit 0

newest_basename=$(basename "$newest")
new_path_display="~/.gstack/projects/karthikcsq-gantry/$newest_basename"

# Pattern: backtick + projects-dir path + *-design-*.md + backtick
PATTERN='`~/\.gstack/projects/karthikcsq-gantry/[^`]+-design-[^`]+\.md`'

if grep -qE "$PATTERN" "$CLAUDE_MD"; then
  # Found existing pointer line(s) — update in place, preserving whatever surrounding context the user wrote.
  tmpfile=$(mktemp)
  sed -E "s|$PATTERN|\`$new_path_display\`|g" "$CLAUDE_MD" > "$tmpfile" && mv "$tmpfile" "$CLAUDE_MD"
else
  # No pointer found — user may have deleted it. Append a fresh section to end of file.
  {
    printf '\n'
    printf '## Latest gstack artifacts\n'
    printf '\n'
    printf 'Auto-managed by `.claude/hooks/update-claude-md.sh`. Move this line anywhere in CLAUDE.md and the hook will keep finding and updating it.\n'
    printf '\n'
    printf -- '- Latest design doc: `%s`\n' "$new_path_display"
  } >> "$CLAUDE_MD"
fi

exit 0
