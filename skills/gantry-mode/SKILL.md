---
name: gantry-mode
description: Configure Gantry guidance globally or for an active task. Use when the engineer invokes /gantry-mode, asks to change guidance mid-session, or wants guided, collaborative, or concise Gantry interactions.
---

# gantry-mode

Set the default interaction style used when Gantry creates a new task, or change an existing task immediately. This changes explanation depth and pseudocode chunking only; it never weakens Gantry's approval gate or design rigor.

Store configuration at `~/.gantry/config.json` (`$HOME/.gantry/config.json`, using the platform's real user-home directory). Use the bundled script for every read and write:

```text
node <absolute-path-to-this-skill>/scripts/gantry-mode.mjs [guided|collaborative|concise|reset] [slug] [--root <project-root>]
```

## Arguments

Accept a mode and an optional Gantry slug:

- no argument — report the current default and list the three valid levels.
- `guided`, `collaborative`, or `concise` — set the user-level default for future tasks.
- `<mode> <slug>` — update `.gantry/<slug>.diff.md` and apply the level to that task immediately without changing the default.
- `reset` — remove the global override and return the default to `collaborative`.
- `reset <slug>` — set that task to the current global default.

Treat values case-insensitively and normalize them to lowercase. For any other value, print the valid choices and stop without changing the file.

Run the script with no argument to report status. For a task-specific change, pass the repository root with `--root` and use the filename stem from `.gantry/<slug>.md`. Relay the script's output without embellishment. If it reports malformed configuration or sidecar frontmatter, stop; never repair or overwrite it automatically.

The script preserves unrelated global configuration keys and sidecar frontmatter.

## Output

Keep responses short:

```text
Gantry guidance: collaborative

guided — more teaching and smaller steps
collaborative — balanced pairing (default)
concise — terse, fluency-assuming context
```

The script reports the exact config path after a write.
