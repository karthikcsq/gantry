# gantry

**Stay in the design loop while AI writes the code.**

gantry is a Claude Code / Codex skill that runs one primitive — collaborative pseudocode with a hard approval gate before any code is written — so the code stays comprehensible to its author (and onboarders) months later.

- **`/gantry`** — forward authorship on new code. You write detailed pseudocode (or ask the AI to draft it); the AI resolves references and surfaces edge cases inline; you explicitly approve; the AI translates the approved pseudocode into the body.
- **rebuild mode** — the same primitive in reverse on existing code. You write pseudocode of what you *think* a function does; the AI compares it to the real body; the mismatches are your mental-model gaps.
- **learn mode** — a short tutorial that teaches the workflow on one of your own functions.

The artifact (`.gantry/<slug>.md`) is the source of truth: what was decided, what edge cases were surfaced, what was accepted/edited/rejected and why, and the code as it was written at gantry-time.

---

## Install

gantry installs with no build step and no npm dependencies — it's a single skill folder backed by Node's standard library. Installation is just: clone the repo to a stable location, then symlink (or copy) the skill into your agent's skills directory.

### One-shot: paste this into Claude Code (or Codex)

Open your coding agent in any directory and paste the prompt below. It tells the agent to do the whole install end to end — clone the repo, run the installer, and confirm the skill is live.

```
Install the gantry skill for me, end to end:

1. Clone the repo to a stable, permanent location (NOT a temp dir — the
   installer symlinks from this checkout, so it must keep existing):
   git clone --depth 1 https://github.com/karthikcsq/gantry.git ~/.gantry-src
   (If ~/.gantry-src already exists, cd into it and `git pull` instead.)

2. Run the installer from that checkout:
   cd ~/.gantry-src && ./install.sh
   This auto-detects Claude Code and/or Codex and installs gantry at the
   user level (~/.claude/skills/gantry and ~/.codex/skills/gantry). It
   symlinks where the OS allows and copies otherwise.
   On Windows without bash, run the PowerShell installer instead:
   cd ~/.gantry-src; .\install.ps1
   (If neither runs, copy the folder ~/.gantry-src/skills/gantry to
   ~/.claude/skills/gantry by hand.)

3. Confirm: list ~/.claude/skills/gantry and verify SKILL.md is present.

4. Tell me the install succeeded and that I can now run /gantry. Mention
   that /gantry has three modes — forward authorship on new code, rebuild
   on existing code, and a learn tutorial — and offer to start the tutorial.

To update gantry later, `git pull` in ~/.gantry-src (link installs pick it
up automatically; copy installs need the installer re-run).
```

### Or run it yourself

**macOS / Linux / Git Bash / WSL:**

```bash
git clone --depth 1 https://github.com/karthikcsq/gantry.git ~/.gantry-src
cd ~/.gantry-src && ./install.sh
```

**Windows (PowerShell):**

```powershell
git clone --depth 1 https://github.com/karthikcsq/gantry.git $HOME\.gantry-src
cd $HOME\.gantry-src; .\install.ps1
```

Both installers detect your installed agents and install at the user level by default. The flags are identical in spirit:

| bash | PowerShell | effect |
| --- | --- | --- |
| `--project <path>` | `-Project <path>` | install into a project's `.claude/skills` & `.codex/skills` so teammates get it |
| `--claude` / `--codex` | `-Claude` / `-Codex` | force a single agent |
| `--no-claude` / `--no-codex` | `-NoClaude` / `-NoCodex` | skip one agent |

Link installs (symlink on Unix, directory junction on Windows) pick up `git pull` automatically — no admin or Windows developer mode required. Where the filesystem forbids links, the installer falls back to a plain copy, which needs the installer re-run after pulling updates.

The skill itself is cross-platform Node with no npm dependencies, so it runs the same under every agent and OS.

---

## Usage

Once installed, restart your agent so it picks up the new skill, then:

```
/gantry <optional-slug> <optional-source-hint>
```

- New function or feature → just `/gantry`, then describe what you're building.
- Auditing existing code → `/gantry <slug> path/to/file.ts` or a symbol name; gantry runs rebuild mode.
- First time → ask gantry to run the learn tutorial.

gantry will open the browser editor for drafting and reviewing docs as part of the workflow. You can also drive it directly from the cloned checkout:

```bash
cd ~/.gantry-src
npm run gantry:editor   # serve the editor
npm run gantry:lint     # lint a gantry doc
```

---

## License

MIT — see [LICENSE](LICENSE).
