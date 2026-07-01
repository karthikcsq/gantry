#!/usr/bin/env bash
# gantry install — lands the gantry skills in supported coding agents.
#
# Currently supported:
#   - Claude Code      (target: $TARGET_ROOT/.claude/skills/{gantry,gantry-mode})
#   - Codex            (target: $TARGET_ROOT/.codex/skills/{gantry,gantry-mode})
#   - Generic agents   (target: $TARGET_ROOT/.agents/skills/{gantry,gantry-mode})
#
# Default behavior: detect installed agents, install at user level via symlink.
# Falls back to copy if symlinks are not permitted (e.g., Windows without
# developer mode). After a copy install, re-run this script to pick up updates.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_SRC="$SCRIPT_DIR/skills"
SKILL_NAMES=(gantry gantry-mode)

SCOPE="user"          # user | project
PROJECT_PATH=""
AGENTS_PATH=""
INSTALL_CLAUDE=auto   # auto | yes | no
INSTALL_CODEX=auto
INSTALL_AGENTS=auto

usage() {
  cat <<'EOF'
Usage: ./install.sh [options]

Scope:
  --user                Install at user level (default)
                          Claude: ~/.claude/skills/{gantry,gantry-mode}
                          Codex:  ~/.codex/skills/{gantry,gantry-mode}
                          Generic agents: ~/.agents/skills/{gantry,gantry-mode}
  --project <path>      Install at project level under <path>/.claude/skills
                        <path>/.codex/skills, and <path>/.agents/skills.
  --agents-path <path>  Install generic .agents support under this agents
                        directory, e.g. ~/.agents or /path/to/.agents.

Agent selection:
  --claude              Force install for Claude Code
  --codex               Force install for Codex
  --agents              Force install for generic .agents
  --no-claude           Skip Claude Code
  --no-codex            Skip Codex
  --no-agents           Skip generic .agents
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
    --agents-path)
      [[ $# -lt 2 ]] && { echo "error: --agents-path requires a path"; exit 1; }
      AGENTS_PATH="$2"
      shift 2
      ;;
    --claude) INSTALL_CLAUDE=yes; shift ;;
    --codex) INSTALL_CODEX=yes; shift ;;
    --agents) INSTALL_AGENTS=yes; shift ;;
    --no-claude) INSTALL_CLAUDE=no; shift ;;
    --no-codex) INSTALL_CODEX=no; shift ;;
    --no-agents) INSTALL_AGENTS=no; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1"; usage; exit 1 ;;
  esac
done

if [[ -n "$AGENTS_PATH" ]]; then
  INSTALL_AGENTS=yes
fi

for skill_name in "${SKILL_NAMES[@]}"; do
  if [[ ! -d "$SKILLS_SRC/$skill_name" ]]; then
    echo "error: skill source not found at $SKILLS_SRC/$skill_name"
    exit 1
  fi
done

path_from_windows_env() {
  local win_path="$1"
  if [[ -z "$win_path" ]]; then
    return 1
  fi

  if command -v cygpath >/dev/null 2>&1; then
    cygpath -u "$win_path"
    return 0
  fi

  if [[ "$win_path" =~ ^([A-Za-z]):\\(.*)$ ]]; then
    local drive="${BASH_REMATCH[1],,}"
    local rest="${BASH_REMATCH[2]//\\//}"
    echo "/mnt/$drive/$rest"
    return 0
  fi

  return 1
}

windows_path_from_unix() {
  local unix_path="$1"
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$unix_path"
    return 0
  fi

  if [[ "$unix_path" =~ ^/mnt/([A-Za-z])/(.*)$ ]]; then
    local drive="${BASH_REMATCH[1]^^}"
    local rest="${BASH_REMATCH[2]//\//\\}"
    echo "${drive}:\\${rest}"
    return 0
  fi

  return 1
}

resolve_user_home() {
  # When this script is run from WSL against a Windows checkout, $HOME points at
  # the Linux user (e.g. /home/name) while Claude/Codex load skills from the
  # Windows user home. Prefer the Windows home in that case.
  if [[ "$SCRIPT_DIR" =~ ^/mnt/([A-Za-z])/Users/([^/]+)/ ]]; then
    echo "/mnt/${BASH_REMATCH[1],,}/Users/${BASH_REMATCH[2]}"
    return
  fi

  if [[ -n "${USERPROFILE:-}" ]]; then
    if home_from_userprofile="$(path_from_windows_env "$USERPROFILE")"; then
      if [[ -d "$home_from_userprofile" ]]; then
        echo "$home_from_userprofile"
        return
      fi
    fi
  fi

  echo "$HOME"
}

USER_HOME="$(resolve_user_home)"

# Resolve target roots
if [[ "$SCOPE" == "user" ]]; then
  CLAUDE_ROOTS=("$USER_HOME/.claude/skills")
  CODEX_ROOTS=("$USER_HOME/.codex/skills")
else
  CLAUDE_ROOTS=("$PROJECT_PATH/.claude/skills")
  CODEX_ROOTS=("$PROJECT_PATH/.codex/skills")
fi

if [[ -n "$AGENTS_PATH" ]]; then
  AGENTS_ROOTS=("$AGENTS_PATH/skills")
elif [[ "$SCOPE" == "user" ]]; then
  AGENTS_ROOTS=("$USER_HOME/.agents/skills")
else
  AGENTS_ROOTS=("$PROJECT_PATH/.agents/skills")
fi

# Auto-detect agents if not explicitly set
detect_claude() {
  [[ -d "$USER_HOME/.claude" ]] || command -v claude >/dev/null 2>&1
}
detect_codex() {
  [[ -d "$USER_HOME/.codex" ]] || command -v codex >/dev/null 2>&1
}
detect_agents() {
  [[ -d "$USER_HOME/.agents" ]]
}

if [[ "$INSTALL_CLAUDE" == "auto" ]]; then
  if detect_claude; then INSTALL_CLAUDE=yes; else INSTALL_CLAUDE=no; fi
fi
if [[ "$INSTALL_CODEX" == "auto" ]]; then
  if detect_codex; then INSTALL_CODEX=yes; else INSTALL_CODEX=no; fi
fi
if [[ "$INSTALL_AGENTS" == "auto" ]]; then
  if detect_agents; then INSTALL_AGENTS=yes; else INSTALL_AGENTS=no; fi
fi

install_to() {
  local target_root="$1"
  local agent_name="$2"
  local skill_name="$3"
  local skill_src="$SKILLS_SRC/$skill_name"
  local target="$target_root/$skill_name"
  local source_real

  mkdir -p "$target_root"
  source_real="$(realpath "$skill_src")"

  if [[ -e "$target" || -L "$target" ]]; then
    if target_real="$(realpath "$target" 2>/dev/null)"; then
      if [[ "$target_real" == "$source_real" ]]; then
        if [[ "$target" =~ ^/mnt/[A-Za-z]/ ]] && command -v cmd.exe >/dev/null 2>&1; then
          if windows_target_has_payload "$target"; then
            echo "  $agent_name ($skill_name): already linked $target -> $skill_src"
            return
          fi
        else
          echo "  $agent_name ($skill_name): already linked $target -> $skill_src"
          return
        fi
      fi
    fi
    remove_target "$target"
  fi

  # Prefer symlink so future pulls of this repo update the installed skill.
  # Fall back to copy if the platform doesn't allow symlinks (Windows without
  # developer mode, restricted filesystems).
  if link_skill "$target" "$skill_src"; then
    echo "  $agent_name ($skill_name): linked $target -> $skill_src"
  else
    cp -r "$skill_src" "$target"
    echo "  $agent_name ($skill_name): copied to $target"
    echo "    (symlink not permitted; re-run install.sh after pulling updates)"
  fi
}

remove_target() {
  local target="$1"
  if [[ "$target" =~ ^/mnt/[A-Za-z]/ ]] && command -v cmd.exe >/dev/null 2>&1; then
    if target_win="$(windows_path_from_unix "$target")"; then
      cmd.exe /C rmdir /S /Q "$target_win" >/dev/null 2>&1 || cmd.exe /C del /F /Q "$target_win" >/dev/null 2>&1 || rm -rf "$target"
      return
    fi
  fi
  rm -rf "$target"
}

link_skill() {
  local target="$1"
  local skill_src="$2"
  # WSL symlinks/junctions into /mnt/c can be visible to WSL but unreadable to
  # Windows-native Claude/Codex. In that case prefer the copy fallback so the
  # complete skill payload is installed beside SKILL.md.
  if [[ "$target" =~ ^/mnt/[A-Za-z]/ ]]; then
    return 1
  fi

  ln -s "$skill_src" "$target" 2>/dev/null
}

windows_target_has_payload() {
  local target="$1"
  local target_win
  target_win="$(windows_path_from_unix "$target")" || return 1
  if command -v powershell.exe >/dev/null 2>&1; then
    powershell.exe -NoProfile -Command 'if (Test-Path -LiteralPath (Join-Path $args[0] "SKILL.md")) { exit 0 } else { exit 1 }' "$target_win" >/dev/null 2>&1
  else
    cmd.exe /C if exist "$target_win\\SKILL.md" exit /B 0 else exit /B 1 >/dev/null 2>&1
  fi
}

echo "gantry install"
echo "  source: $SKILLS_SRC"
echo "  scope:  $SCOPE${PROJECT_PATH:+ ($PROJECT_PATH)}"
echo

if [[ "$INSTALL_CLAUDE" == "yes" ]]; then
  for root in "${CLAUDE_ROOTS[@]}"; do
    for skill_name in "${SKILL_NAMES[@]}"; do
      install_to "$root" "Claude Code" "$skill_name"
    done
  done
else
  echo "  Claude Code: skipped"
fi

if [[ "$INSTALL_CODEX" == "yes" ]]; then
  for root in "${CODEX_ROOTS[@]}"; do
    for skill_name in "${SKILL_NAMES[@]}"; do
      install_to "$root" "Codex" "$skill_name"
    done
  done
else
  echo "  Codex: skipped"
fi

if [[ "$INSTALL_AGENTS" == "yes" ]]; then
  for root in "${AGENTS_ROOTS[@]}"; do
    for skill_name in "${SKILL_NAMES[@]}"; do
      install_to "$root" "Generic agents" "$skill_name"
    done
  done
else
  echo "  Generic agents: skipped"
fi

echo
echo "done."
