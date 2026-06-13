---
name: gantry
description: Collaborative pseudocode authorship workflow. Engineer writes detailed pseudocode; AI surfaces references, substantive edge cases, and structural ripples; engineer explicitly approves; AI translates to body. Also handles drift-check on existing gantry docs and rebuild mode for existing code. Use when authoring a new function/feature, returning to extend an existing gantry doc, or auditing your mental model of existing code.
---

# gantry

Gantry is an authorship discipline. The engineer stays in the design loop while AI writes code, so the resulting code stays comprehensible to its author (and onboarders) months later. The skill governs a single primitive — collaborative pseudocode design with a hard approval gate before any code is written — and applies it in three directions based on the state of the working tree.

The artifact (`.gantry/<slug>.md`) is the source of truth. Six months from now, an engineer reading the doc must see: what was decided, what edge cases were surfaced, what was accepted/edited/rejected and why, and the code as it was written at gantry-time. This is the entire point of the workflow.

## Invocation

When invoked, gantry accepts up to two optional arguments: a slug and a source hint. Exact invocation syntax depends on the host agent (e.g., `/gantry <slug>` in Claude Code; `/skills gantry <slug>` or `$gantry <slug>` in Codex).

- **slug** — optional. If omitted, ask the engineer "what are you building?" and derive a slug from their one-liner.
- **source hint** — optional path or symbol (e.g., `src/vendor/search.ts` or `searchVendors`). Used in rebuild mode to point at existing code.

## Browser editor

Gantry includes an optional local browser editor for `.gantry/<slug>.md`. The markdown file remains the only durable source of truth; the editor is just a faster surface for editing pseudocode steps, approving/rejecting AI items, choosing A/B/C options, and attaching comments.

Launch it from the project root:

```bash
node path/to/skills/gantry/scripts/gantry-editor.mjs serve --slug <slug>
```

When running from this repository, the shorter form is:

```bash
node skills/gantry/scripts/gantry-editor.mjs serve --slug <slug>
```

The server prints a `http://127.0.0.1:<port>/` URL. Open that URL and save through the UI. If saving fails, the UI shows the server error and the markdown file is not updated.

Lint the Gantry markdown format:

```bash
node skills/gantry/scripts/gantry-editor.mjs lint --slug <slug>
```

Check the code-writing gate:

```bash
node skills/gantry/scripts/gantry-editor.mjs lint --slug <slug> --gate
```

If older Gantry docs contain checkbox annotations without stable ids, add ids before using the browser editor:

```bash
node skills/gantry/scripts/gantry-editor.mjs ids --slug <slug>
```

### Strict editable item format

Editable AI items live under `## Pseudocode`, immediately after the pseudocode step they apply to. Each item has a stable marker plus the human-readable checkbox line:

```markdown
1. Read the query from the request.
<!-- gantry:item id=gty-ref-query type=ref status=open mode=decision -->
- [ ] **ref:** should this use `searchParams` or the parsed body?
  - comment: confirm route shape
```

Choice items use `mode=choice` and options A/B/C:

```markdown
2. Search vendors by name.
<!-- gantry:item id=gty-edge-empty type=edge status=choice-b mode=choice -->
- [x] **edge:** [choice-b] what happens for an empty query?
  - A: return all vendors
  - B: return no vendors
  - C: throw validation error
  - comment: empty query should fail loudly
```

Valid item types are `ref`, `edge`, `ripple`, `update`, and `mismatch`. Valid statuses are `open`, `accept`, `reject`, `edit`, `choice-a`, `choice-b`, and `choice-c`. `open` items still block code writing.

## State inference (first thing the skill does)

When the slug is omitted, do not immediately create a new slug from the description. First search existing gantry docs for a plausible match, then derive a new slug only if none match.

On invocation, inspect the working tree and route to one of three modes:

If no slug was provided:

1. Ask the engineer for a one-sentence description of what they want to build or change.
2. Search existing `.gantry/*.md` docs before creating a new slug. Compare the description against each doc's filename slug, heading, `**Target:**` line, referenced files, and sidecar in-scope files when present.
3. If one or more docs plausibly match, pause and ask the engineer whether to continue one of those docs or create a new doc. Include the candidate path(s) and the short reason each matched. Never silently create a near-duplicate doc.
4. If no existing doc plausibly matches, derive a new slug from the one-liner and continue state inference below.

1. **Forward mode** — no `.gantry/<slug>.md` exists AND no matching source for the slug. Engineer is authoring something new.
2. **Continue mode** — `.gantry/<slug>.md` exists. Engineer is extending or revisiting an existing design.
3. **Rebuild mode** — source matching the slug exists but no `.gantry/<slug>.md`. Engineer is auditing or backfilling.

If the slug-to-source mapping is ambiguous (no hint, multiple fuzzy matches), confirm with the engineer in chat before routing. Never guess silently.

## Scaffolding (forward mode and rebuild mode)

When creating a new `.gantry/<slug>.md`, also create a sidecar `.gantry/<slug>.diff.md` for diff state. Record the current git HEAD as the baseline in the sidecar's frontmatter.

Main doc skeleton:

```markdown
# <slug>

**Target:** <one-line description>

## Pseudocode

<empty — engineer writes here>

## Code (as written <date> @ <commit>)

<empty until code-write phase>
```

Sidecar skeleton:

```markdown
---
baseline_commit: <git HEAD at invocation>
last_diff_check: <timestamp>
---

# Diff log

## Files in scope

<populated by triage as engineer makes code changes>

## Triaged irrelevant

<files AI judged not relevant to this feature; will be re-checked on new diffs>

## Reconciliation history

<chronological log of how engineer code changes affected the main doc>
```

## The flow (forward mode)

Forward mode is only allowed after the no-slug related-doc search has found no plausible existing doc, or after the engineer explicitly chose to create a new doc instead of continuing a candidate.

1. **Ask the target.** If no slug-derived one-liner, ask "what are you building?" — one sentence. Use it as the doc target and slug source.
2. **Scaffold.** Create main doc + sidecar. Record baseline.
3. **Engineer writes pseudocode.** Primary surface: the main doc, in their editor. Fallback: chat — if the engineer types pseudocode into chat, transcribe it into the main doc verbatim (no rewording).
4. **Engineer signals "ready"** (or similar). Now AI annotates.
5. **Annotate inline.** Walk the pseudocode step by step. Under each step that needs it, add `- [ ]` annotations of three types (rules in [annotation bar](#annotation-bar) below):
   - `**ref:**` — verify symbols and resolve ambiguity for references the engineer used.
   - `**edge:**` — substantive edge cases the pseudocode didn't address.
   - `**ripple:**` — structural changes elsewhere in the codebase needed to make this work.
6. **Iteration loop.** Engineer resolves annotations in-file or in chat (see [resolution](#resolution)). Every turn: run the diff script, reconcile against engineer code changes, surface uncertain triage in chat. Auto-revert resolved annotations whose context shifted.
7. **Approval gate.** Code-writing is blocked while any `- [ ]` remains in the main doc. When zero unresolved remain, engineer can say "write the code" (or equivalent).
8. **Translate to body.** Mechanically translate the now-resolved pseudocode into the actual source files. Do not introduce design decisions that weren't surfaced and approved.
9. **Snapshot.** Embed the as-written code into the main doc's `## Code` section, dated and pinned to the current commit. This is the historical record — it is *not* updated when source evolves.
10. **If mid-translation a gap appears** (something approved pseudocode doesn't specify but the implementation needs): stop. Add a fresh `- [ ]` to the affected step describing the gap. Surface in chat. Wait for resolution. Then resume.

## The flow (continue mode)

`.gantry/<slug>.md` already exists. Engineer is back.

1. **Drift check first.** Compare the as-written code snapshot in the main doc against current source for the referenced files. For each drifted region, add a `- [ ] **update:**` annotation against the affected pseudocode step: "source has changed since this was written — was this an intended design update (rewrite the pseudocode to match), unrelated (mark obsolete), or accidental drift (revert source)?"
2. **Engineer resolves drift annotations.** Same resolution mechanics as everything else.
3. **Once drift is resolved**, continue forward — engineer adds new pseudocode, AI annotates, gate, write, snapshot.

## The flow (rebuild mode)

Source for the slug exists but no `.gantry/<slug>.md`. Offer the engineer two sub-paths in chat:

- **(a) Write-blind.** Engineer writes pseudocode of what they *think* the function does, without looking at the source. AI compares to actual source and surfaces mismatches as `- [ ] **mismatch:**` annotations. This is the diagnostic mode — it finds mental-model gaps.
- **(b) AI-bootstrap.** AI reads the source and generates pseudocode as a starting point. Every generated step is `- [ ]` proposed. Engineer must resolve each — accept ("yes, this is what it should do"), edit ("the source has it wrong / unclear, here's what it should be"), or reject ("this exists but I don't know why"). This is the on-ramp for adopting gantry on an existing codebase.

After rebuild's initial pass completes, the doc is live — continue mode applies on future invocations.

## Annotation bar (this is load-bearing)

Annotations cost the engineer attention. Over-surfacing trains the engineer to skim and rubber-stamp, which collapses the approval gate. Surface only what passes the bar:

- **edge:** Surface only if the answer would change *observable system behavior* in a way a caller or user can see. Substantive branching: throw vs. return empty, parameterize vs. hardcode, error-on-invalid vs. silently-skip. Do NOT surface defensive nitpicks: whitespace handling, null-vs-empty when the answer is obviously "do the sane thing," length checks on data that's already validated upstream.
- **ripple:** Reserved for *structural expansion* — methods that don't exist yet and need adding, signatures that change and affect multiple call sites, new types or errors. Do NOT raise as a separate ripple anything that's a mechanical consequence of an already-stated decision (imports, trivial parameter threading, formatting). Those are handled automatically at code-write time.
- **ref:** Surface only when there's real ambiguity (two valid candidates the engineer might mean, or a symbol the engineer assumed exists that doesn't). Don't surface a `ref` to confirm a symbol AI can trivially verify.

If in doubt about whether to surface something, don't. Engineer pushback ("you missed X") is cheap; engineer skim-fatigue is fatal.

## Resolution

The engineer never types marker syntax. AI maintains markers on every turn.

**Three in-file resolution modes** (all use standard markdown checkbox so editors render them as clickable):

- **Accept** — engineer checks the box, nothing else.
  ```
  - [x] **ref:** use existing `sortByRating` in `utils/sort.ts`.
  ```
- **Reject** — engineer checks the box and adds reason after a dash.
  ```
  - [x] **edge:** category not in enum — throw or return empty?
    — rejected: enum is validated upstream, this can't happen.
  ```
- **Edit** — engineer checks the box and writes their version after a dash, OR rewrites the annotation prose directly. AI detects the diff.
  ```
  - [x] **edge:** `limit=20` is hardcoded — should this be a parameter?
    — yes, parameterize with default 20, clamped to max 100.
  ```

**Chat resolution** works in parallel: "approve 2.1, 4.1. reject 3.1 — validated upstream. edit 5.1: parameterize with default 20." AI applies the resolutions to the file.

**AI normalizes after each turn.** Reads the resolved annotations, infers intent from prose (accept if just `[x]`; reject if prose contradicts; edit if prose is a refinement), and rewrites each into a canonical resolved form with a type badge:

```
- [x] **edge:** [edit] `limit` is a parameter, default 20, clamped to 100.
- [x] **edge:** [reject] category-not-in-enum — validated upstream.
- [x] **ref:** [accept] use existing `sortByRating` in `utils/sort.ts`.
```

If AI is uncertain about intent (e.g., "yes but also do Y" — accept-with-augmentation or edit?), confirm once in chat before normalizing.

## Diff awareness (every turn)

The engineer is not frozen while AI annotates. They might edit source files, the main doc, or the pseudocode itself. AI must track this.

**On every turn**, before responding:

1. Run the diff script: compute `git diff` against the baseline commit and against the last-diff-check snapshot. Identify files changed since last turn.
2. Triage each new diff: relevant to this feature, or not? Use the slug + referenced files + prior in-scope set as signal. Files marked irrelevant stay in the "triaged irrelevant" list in the sidecar; re-check only if a new diff touches them.
3. For relevant diffs: reconcile against the main doc.
   - Edge cases the engineer already handled in source → mark obsolete.
   - Ripples the engineer already applied → mark done.
   - New substantive behavior in the engineer's code change → propose pseudocode updates in the main doc as `- [ ] **update:**` annotations anchored to the affected step.
   - Previously-resolved annotations whose underlying context has shifted → auto-revert to `- [ ]`. Note the auto-revert in chat with a one-line "why."
4. **Surface triage only when uncertain.** If AI is confident about relevance (either way), stay silent. If genuinely unsure, ask the engineer in chat: "I see you also changed `utils/format.ts:14`. Does that relate to vendor search, or unrelated?"

The sidecar accumulates this as chronological history. The main doc absorbs *design changes* (pseudocode updates) but stays focused on the design record, not the diff history.

## Completeness principle

The main doc is the design record. *Every* decision must appear there — regardless of channel.

- Engineer writes in file → already there.
- Engineer types in chat → AI transcribes into the file.
- Engineer changes source code → AI proposes a pseudocode update in the doc, anchored to the affected step. Engineer resolves; pseudocode is rewritten if accepted/edited, left alone if rejected (rejection means "that code change wasn't a design decision").

If a decision exists in the engineer's head or in the code but not in the doc, the workflow has failed.

## Targeted vs. rescan

Default: **targeted updates**. When the engineer raises a specific pushback ("you missed X in step 3"), respond to that specific thing. Don't regenerate other annotations or invalidate other resolutions.

Engineer can request a **rescan** ("rescan everything" or similar). Then re-read the whole doc and source, regenerate all annotations from scratch. Prior resolutions stay where the context is unchanged; reset to `- [ ]` where it shifted.

## Code-writing rules

When the engineer says "write the code" (or equivalent) and the gate is clear (zero `- [ ]`):

- Translate mechanically. The approved pseudocode is the spec.
- Mechanical consequences of accepted decisions (imports, simple parameter plumbing) are handled at this stage automatically — they were not separate ripples for a reason.
- If during translation a real gap appears: stop, add a fresh `- [ ]` to the affected step, surface in chat. Resume only after the gap is resolved.
- After translation: write the code into the actual source files, and embed the as-written code into the main doc's `## Code` section with the date and commit hash. Do not duplicate edits — the doc snapshot is historical.

Never introduce design decisions at code-write time that weren't surfaced and approved. If the implementation forces a choice not in the pseudocode, that's a mid-implementation gap — halt and surface it.

## What this skill does NOT do

- It does not invent edge cases AI didn't think of. Gantry forces engagement with the edge cases AI surfaces, but cannot generate cases beyond AI's own thinking. The engineer's own pseudocode is the input that pushes AI to think about cases beyond the obvious.
- It does not enforce hard gates (pre-commit hooks etc.) in v0. Soft enforcement only — this SKILL.md, used by Claude inside Claude Code.
- It does not normalize the engineer's pseudocode formatting. Engineer writes loose; AI parses what's there. If pseudocode patterns break parsing in practice, that's when a format-normalization pass gets designed.
- It does not generate documentation. The main doc is the artifact — it documents itself through the pseudocode, annotations, resolutions, and code snapshot.

## Implementation notes

- The diff script should be a single command (likely `git diff` against baseline + a summarizer) so Claude processes one chunk of output per turn, not a sprawl of tool calls.
- `.gantry/` is typically gitignored by default (skill-managed working state). Commit-mode (checking the directory in) is an opt-in for teams that want the artifacts shared.
- Slug-to-source fuzzy matching: use filename match, exported-symbol match, and prior in-scope files from sibling gantry docs as signal. When matches are ambiguous, ask the engineer.
