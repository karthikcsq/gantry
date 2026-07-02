# gantry

**Stay in the design loop while AI writes the code.**

gantry is a coding-agent skill package for Claude Code, Codex, and generic `.agents`-compatible hosts. It runs one primitive — collaborative pseudocode with a hard approval gate before any code is written — so the code stays comprehensible to its author (and onboarders) months later. On invocation it inspects the working tree and routes to one of three modes:

- **Forward mode** — authoring something new (no doc, no matching source). You write detailed pseudocode (or ask the AI to draft it); the AI resolves references and surfaces edge cases inline; you explicitly approve; the AI translates the approved pseudocode into the body.
- **Continue mode** — a `.gantry/<slug>.md` already exists. You're extending or revisiting an existing design; the AI drift-checks against the current code first, then you keep authoring.
- **Rebuild mode** — the source exists but no doc. The same primitive in reverse: you write pseudocode of what you *think* a function does, the AI compares it to the real body, and the mismatches are your mental-model gaps.

The artifact (`.gantry/<slug>.md`) is the source of truth: what was decided, what edge cases were surfaced, what was accepted/edited/rejected and why, and the code as it was written at gantry-time. The code-writing gate fails closed until the engineer has reviewed the current pseudocode and separately authorized implementation; a passing format check never counts as approval.

---

## Install

gantry installs with no build step and no npm dependencies — it is two skill folders (`gantry` and `gantry-mode`) backed by Node's standard library. Installation is just: clone the repo to a stable location, then symlink (or copy) the skills into your agent's skills directory.

### One-shot: paste this into your coding agent

Open your coding agent in any directory and paste the prompt below. It tells the agent to do the whole install end to end — clone the repo, run the installer, and confirm the skill is live.

```
Install the gantry skill for me, end to end:

1. Clone the repo to a stable, permanent location (NOT a temp dir — the
   installer symlinks from this checkout, so it must keep existing):
   git clone --depth 1 https://github.com/karthikcsq/gantry.git ~/.gantry-src
   (If ~/.gantry-src already exists, cd into it and `git pull` instead.)

2. Run the installer from that checkout:
   cd ~/.gantry-src && ./install.sh
   This auto-detects Claude Code, Codex, and generic .agents-compatible
   hosts and installs gantry plus gantry-mode at the user level
   (~/.claude/skills, ~/.codex/skills, and/or ~/.agents/skills). It symlinks
   where the OS allows and copies otherwise.
   If this agent uses a generic .agents directory and that directory does
   not exist yet, pass its intended agents directory explicitly:
   cd ~/.gantry-src && ./install.sh --agents-path ~/.agents
   On Windows without bash, run the PowerShell installer instead:
   cd ~/.gantry-src; .\install.ps1
   For a clean generic .agents install on Windows, pass:
   cd ~/.gantry-src; .\install.ps1 -AgentsPath $HOME\.agents
   (If neither runs, copy both ~/.gantry-src/skills/gantry and
   ~/.gantry-src/skills/gantry-mode to your agent's skills directory.)

3. Confirm: list your installed skills directory and verify both SKILL.md files
   are present, for example ~/.agents/skills/gantry/SKILL.md and
   ~/.agents/skills/gantry-mode/SKILL.md.

4. Tell me the install succeeded and that I can now run /gantry and
   /gantry-mode. Mention
   that /gantry routes to one of three modes based on the working tree —
   forward authorship on new code, continue on an existing gantry doc, and
   rebuild on existing code — and ask what I'd like to start with.

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

Both installers detect your installed agents and install at the user level by default. Generic `.agents` support is independent of Codex: use `--agents` / `-Agents` to force an install into the default `.agents/skills`, or `--agents-path <path>` / `-AgentsPath <path>` to point at a specific `.agents` directory when a clean machine does not have one yet. Use `--no-agents` / `-NoAgents` to skip it. The flags are identical in spirit:

| bash | PowerShell | effect |
| --- | --- | --- |
| `--project <path>` | `-Project <path>` | install into a project's `.claude/skills`, `.codex/skills`, and `.agents/skills` so teammates get it |
| `--agents-path <path>` | `-AgentsPath <path>` | install both skills under `<path>/skills` |
| `--claude` / `--codex` / `--agents` | `-Claude` / `-Codex` / `-Agents` | force a single agent target |
| `--no-claude` / `--no-codex` / `--no-agents` | `-NoClaude` / `-NoCodex` / `-NoAgents` | skip one agent target |

Link installs (symlink on Unix, directory junction on Windows) pick up `git pull` automatically — no admin or Windows developer mode required. Where the filesystem forbids links, the installer falls back to a plain copy, which needs the installer re-run after pulling updates.

The skill itself is cross-platform Node with no npm dependencies, so it runs the same under every agent and OS.

---

## Usage

Once installed, restart your agent so it picks up the new skill, then:

```
/gantry <optional-slug> <optional-source-hint>
```

- New function or feature → just `/gantry`, then describe what you're building (forward mode).
- Returning to an existing design → `/gantry <slug>`; gantry drift-checks the doc and continues (continue mode).
- Auditing existing code → `/gantry <slug> path/to/file.ts` or a symbol name; gantry runs rebuild mode.
- Not sure how it works → `/gantry help` prints a short guide to the three modes, the approval gate, and a typical first session.

Choose how much guidance Gantry provides when it creates future tasks:

```
/gantry-mode guided
/gantry-mode collaborative
/gantry-mode concise
```

`collaborative` is the default. `guided` explains unfamiliar terms, works in smaller pseudocode chunks, and says why each decision matters. `concise` assumes fluency and keeps context terse. Every level retains the same approval gate and completeness requirements.

The default is stored in `~/.gantry/config.json`. A new Gantry task snapshots it into `.gantry/<slug>.diff.md`, so changing the default does not unexpectedly rewrite the style of work already in progress. Run `/gantry-mode` with no argument to see the current default, or `/gantry-mode reset` to return to `collaborative`.

Switch an active task immediately by adding its slug:

```
/gantry-mode guided vendor-search
```

This updates `.gantry/vendor-search.diff.md` without changing your default. You can also say “use guided mode here” inside the active Gantry session.

gantry will open the browser editor for drafting and reviewing docs as part of the workflow. You can also drive it directly from the cloned checkout:

```bash
cd ~/.gantry-src
npm run gantry:editor   # serve the editor
npm run gantry:lint     # lint a gantry doc
```

---

## License

MIT — see [LICENSE](LICENSE).
