#!/usr/bin/env bash
# gantry install — lands the gantry skill in supported coding agents.
#
# Currently supported:
#   - Claude Code  (target: $TARGET_ROOT/.claude/skills/gantry)
#   - Codex        (target: $TARGET_ROOT/.agents/skills/gantry)
#
# Default behavior: detect installed agents, install at user level via symlink.
# Falls back to copy if symlinks are not permitted (e.g., Windows without
# developer mode). After a copy install, re-run this script to pick up updates.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_SRC="$SCRIPT_DIR/skills/gantry"

SCOPE="user"          # user | project
PROJECT_PATH=""
INSTALL_CLAUDE=auto   # auto | yes | no
INSTALL_CODEX=auto

usage() {
  cat <<'EOF'
Usage: ./install.sh [options]

Scope:
  --user                Install at user level (default)
                          Claude: ~/.claude/skills/gantry
                          Codex:  ~/.agents/skills/gantry
  --project <path>      Install at project level under <path>/.claude/skills
                        and <path>/.agents/skills.

Agent selection:
  --claude              Force install for Claude Code
  --codex               Force install for Codex
  --no-claude           Skip Claude Code
  --no-codex            Skip Codex
  (default: install for every agent detected on this machine)

Other:
  -h, --help            Show this message.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --user) SCOPE="user"; shift ;;
    --project)
      SCOPE="project"
      [[ $# -lt 2 ]] && { echo "error: --project requires a path"; exit 1; }
      PROJECT_PATH="$2"
      shift 2
      ;;
    --claude) INSTALL_CLAUDE=yes; shift ;;
    --codex) INSTALL_CODEX=yes; shift ;;
    --no-claude) INSTALL_CLAUDE=no; shift ;;
    --no-codex) INSTALL_CODEX=no; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1"; usage; exit 1 ;;
  esac
done

if [[ ! -d "$SKILL_SRC" ]]; then
  echo "error: skill source not found at $SKILL_SRC"
  exit 1
fi

# Resolve target roots
if [[ "$SCOPE" == "user" ]]; then
  CLAUDE_ROOT="$HOME/.claude/skills"
  CODEX_ROOT="$HOME/.agents/skills"
else
  CLAUDE_ROOT="$PROJECT_PATH/.claude/skills"
  CODEX_ROOT="$PROJECT_PATH/.agents/skills"
fi

# Auto-detect agents if not explicitly set
detect_claude() {
  [[ -d "$HOME/.claude" ]] || command -v claude >/dev/null 2>&1
}
detect_codex() {
  [[ -d "$HOME/.codex" ]] || [[ -d "$HOME/.agents" ]] || command -v codex >/dev/null 2>&1
}

if [[ "$INSTALL_CLAUDE" == "auto" ]]; then
  if detect_claude; then INSTALL_CLAUDE=yes; else INSTALL_CLAUDE=no; fi
fi
if [[ "$INSTALL_CODEX" == "auto" ]]; then
  if detect_codex; then INSTALL_CODEX=yes; else INSTALL_CODEX=no; fi
fi

install_to() {
  local target_root="$1"
  local agent_name="$2"
  local target="$target_root/gantry"

  mkdir -p "$target_root"

  if [[ -e "$target" || -L "$target" ]]; then
    rm -rf "$target"
  fi

  # Prefer symlink so future pulls of this repo update the installed skill.
  # Fall back to copy if the platform doesn't allow symlinks (Windows without
  # developer mode, restricted filesystems).
  if ln -s "$SKILL_SRC" "$target" 2>/dev/null; then
    echo "  $agent_name: linked $target -> $SKILL_SRC"
  else
    cp -r "$SKILL_SRC" "$target"
    echo "  $agent_name: copied to $target"
    echo "    (symlink not permitted; re-run install.sh after pulling updates)"
  fi
}

echo "gantry install"
echo "  source: $SKILL_SRC"
echo "  scope:  $SCOPE${PROJECT_PATH:+ ($PROJECT_PATH)}"
echo

if [[ "$INSTALL_CLAUDE" == "yes" ]]; then
  install_to "$CLAUDE_ROOT" "Claude Code"
else
  echo "  Claude Code: skipped"
fi

if [[ "$INSTALL_CODEX" == "yes" ]]; then
  install_to "$CODEX_ROOT" "Codex"
else
  echo "  Codex: skipped"
fi

echo
echo "done."
