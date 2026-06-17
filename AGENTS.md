# gantry — Project Context

> Canonical project-context file for any coding agent (Claude Code, Codex) or human.
> `CLAUDE.md` references this file; keep this one authoritative and avoid duplicating it.

## What this project is

**gantry** is an OSS coding-agent skill package that keeps engineers in the design loop while AI writes code, so the code stays comprehensible to its author (and onboarders) months later. One primitive — collaborative pseudocode + AI surfaces edge cases + engineer approves + AI writes body — shipped as a single `/gantry` skill that inspects the working tree and routes to one of three modes:

1. **Forward mode** — no `.gantry/<slug>.md` and no matching source. Engineer is authoring something new: writes detailed pseudocode (or asks the AI to draft it); AI resolves references and surfaces edge cases inline; engineer explicitly approves; AI translates approved pseudocode into the body.
2. **Continue mode** — a `.gantry/<slug>.md` already exists. Engineer is extending or revisiting an existing design; the AI drift-checks the doc against the current code first, then authoring continues forward.
3. **Rebuild mode** — source matching the slug exists but no doc. Same primitive in reverse: engineer writes pseudocode of what they *think* a function does, AI compares to the actual body, and mismatches are mental-model gaps. Triggered reactively (bug, bloat, refactor).

There is **one skill** (`/gantry`); the mode is inferred from working-tree state, not selected by a separate command. No audit, no heatmap. The strategic pivot from the original audit-first design is captured in the CEO plan referenced below.

Audience: Learner-Builders (CS students, junior engineers, craft-driven solos) primary; senior engineers at 20-200 person startups secondary. Not enterprise, not vibe coders.

OSS, MIT, no revenue plan in v0. Distribution: Claude Code / Codex skill ecosystem (gstack/gsd-shaped).

## Latest plan / design doc

**ALWAYS READ THIS BEFORE TOUCHING THE CODE.** When the CEO plan and the prior design doc disagree, the CEO plan wins.

- **Latest CEO plan (authoritative):** `~/.gstack/projects/karthikcsq-gantry/ceo-plans/2026-05-20-gantry-pivot.md`
- **Prior design doc (historical, superseded):** `~/.gstack/projects/karthikcsq-gantry/karthikcsq-main-design-20260516-192047.md`

The CEO plan captures gantry's pivot on 2026-05-20: the heatmap-based audit is deleted; gantry is now an authorship-discipline workflow (one primitive, applied across forward/continue/rebuild modes). The prior design doc is kept for revision lineage but is no longer the source of truth — its audit-first framing has been replaced.

If multiple files exist in `ceo-plans/` or `*-design-*.md`, **the file with the latest timestamp in the filename is canonical for its type.** When types disagree, the more recent CEO plan wins.

## When new gstack artifacts are generated

When any gstack skill creates a new artifact in `~/.gstack/projects/karthikcsq-gantry/` (design doc, CEO review, eng review, design review, checkpoint, etc.), you MUST:

1. Update the "Latest plan / design doc" path above to point to the newest file.
2. If multiple artifact types exist (design + ceo-plan + eng-plan), list each with its latest path under separate headers, e.g.:
   - **Latest design doc:** `<path>`
   - **Latest CEO review:** `<path>`
   - **Latest eng plan:** `<path>`
3. Commit this AGENTS.md update alongside whatever generated the new artifact.

The convention: this AGENTS.md is the single discoverable entry point for any future agent (Claude Code, Codex) or human session. It must always point at the freshest artifacts.

**Quick check command** to find latest artifacts:
```bash
ls -t ~/.gstack/projects/karthikcsq-gantry/*.md 2>/dev/null | head -10
```

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool.

Key routing rules:
- Product ideas / brainstorming → invoke `/office-hours`
- Strategy / scope → invoke `/plan-ceo-review`
- Architecture → invoke `/plan-eng-review`
- Design system / plan review → invoke `/design-consultation` or `/plan-design-review`
- Full review pipeline → invoke `/autoplan`
- Bugs / errors → invoke `/investigate`
- QA / testing site behavior → invoke `/qa` or `/qa-only`
- Code review / diff check → invoke `/review`
- Visual polish → invoke `/design-review`
- Ship / deploy / PR → invoke `/ship` or `/land-and-deploy`
- Save progress → invoke `/context-save`
- Resume context → invoke `/context-restore`

## Project conventions (TBD — fill in as decided)

- Language: TypeScript (skills) — to match coding-agent skill conventions
- Runtime: Bun preferred, Node fallback
- License: MIT
- Distribution: Claude Code / Codex skill ecosystem
- `.gantry/` directory: skill-managed state in user repos (gitignored by default; commit-mode optional for team use)
