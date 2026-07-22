---
name: gantry
description: Collaborative pseudocode authorship workflow. Engineer writes detailed pseudocode, or explicitly asks AI to draft proposed pseudocode; AI surfaces references, substantive edge cases, useful feature additions, and structural ripples; engineer explicitly approves; AI translates to body. Also handles drift-check on existing gantry docs and rebuild mode for existing code. Use when authoring a new function/feature, returning to extend an existing gantry doc, or auditing your mental model of existing code.
argument-hint: "[slug] [source-file-or-symbol] | help"
---

# gantry

Gantry is an authorship discipline. The engineer stays in the design loop while AI writes code, so the resulting code stays comprehensible to its author (and onboarders) months later. The skill governs a single primitive — collaborative pseudocode design with a hard approval gate before any code is written — and applies it in three directions based on the state of the working tree.

The artifact (`.gantry/<slug>.md`) is the source of truth. Six months from now, an engineer reading the doc must see: what was decided, what edge cases were surfaced, what was accepted/edited/rejected and why, and the code as it was written at gantry-time. This is the entire point of the workflow.

## Non-negotiable interaction boundary

Invoking Gantry—whether the engineer requested it or the agent chose it proactively—never grants permission to implement. Gantry must visibly pause for engineer review.

- A feature request, acceptance criteria, or follow-up clarification is **input to drafting**, not engineer-authored pseudocode. Any pseudocode wording synthesized, expanded, reordered, or invented by AI is AI-authored and must use `author=ai status=open`.
- Plain unmarked pseudocode is `author=user` only when the engineer actually wrote those steps as pseudocode in chat or in the editor. Never relabel an AI synthesis as user-authored because it was derived from the engineer's request.
- Tool output is not human approval. A successful lint, a clear structural gate, a saved file, silence, or the agent's own assessment can never approve pseudocode or authorize implementation.
- The agent may set `pseudocode=approved` only after the engineer reviews the current pseudocode and explicitly endorses it. The agent may set `implementation=authorized` only after the design is stable, the agent has paused and invited implementation, and the engineer then explicitly says to write/implement the current design.
- Approval cannot be prospective. “Build this,” “make this,” or permission given before the engineer sees the current Gantry design does not authorize the later code-writing phase.
- After drafting or annotating, **STOP and yield the turn**. Do not continue through review, approval, and implementation in one agent turn.

## Invocation

When invoked, gantry accepts up to two optional arguments: a slug and a source hint. Exact invocation syntax depends on the host agent (e.g., `/gantry <slug>` in Claude Code; `/skills gantry <slug>` or `$gantry <slug>` in Codex).

- **slug** — optional. If omitted, ask the engineer "what are you building?" and derive a slug from their one-liner.
- **source hint** — optional path or symbol (e.g., `src/vendor/search.ts` or `searchVendors`). Used in rebuild mode to point at existing code.
- **draft request** — optional natural-language ask such as "draft pseudocode for me" or "start with an AI draft." Only honored when explicit; otherwise the engineer writes first.
- **help** — reserved. If the only argument is `help`, `--help`, or `-h`, or the engineer asks how to use gantry (e.g. "how does gantry work?", "teach me gantry"), do **not** create a slug or route to a mode. Run [Help mode](#help-mode) instead.

## Guidance level

Gantry adapts its interaction style without changing its rigor. Resolve the guidance level at the start of every invocation:

1. If the active `.gantry/<slug>.diff.md` sidecar has `guidance`, use it.
2. Otherwise read `guidance` from `~/.gantry/config.json`.
3. If neither contains a valid value, use `collaborative`. If the global config is malformed or is not a JSON object, mention it once and leave the file untouched.
4. When scaffolding a new sidecar, or opening an existing sidecar without `guidance`, write the resolved value into its frontmatter. This snapshots the task's interaction style; later global changes affect new tasks, not existing ones.

Valid levels:

- **`guided`** — Explain unfamiliar terms and references in plain language, work through pseudocode in smaller coherent chunks, and state why each surfaced decision matters. Do not assume that familiarity with one tool implies general technical fluency.
- **`collaborative`** — Use the balanced workflow described in this skill: enough context to make decisions confidently without turning each annotation into a lesson. This is the default.
- **`concise`** — Assume fluency, preserve terse engineer-authored wording, and include only the context needed to resolve material decisions. Do not omit a substantive decision merely to stay brief.

**Guidance shapes the doc, not the chat.** Each level controls how much explanation lands in the durable artifact — the plain-language text of a given, the rationale trailing a choice item or fork, the "why it matters" appended to a surfaced decision (as trailing content on the item line, never a comment — see [Presenting is not resolving](#presenting-is-not-resolving)). `guided` means `.gantry/<slug>.md` carries more teaching; it does **not** mean narrating the design back in chat. The engineer reads and resolves in the editor, so the explanation has to live in the doc where it lasts, not in a chat turn that scrolls away. `concise` likewise trims the in-doc explanation; it never moves a decision out of the doc to save space.

An engineer may change the active task's level at any time by asking Gantry directly, or by running `/gantry-mode <level> <slug>`. Applying a new level means: update the sidecar, then re-render the doc's unresolved givens, forks, and open items in the new style — deepening or trimming their in-doc explanation. It does **not** mean re-walking the existing design in chat. After a switch, keep the chat turn to a short pointer (e.g. "raised to guided — expanded the rationale on the open decisions; resolve them in the editor"). `/gantry-mode <level>` without a slug configures the user-level default for future tasks.

**Invariant across every level:** keep the same annotation bar, active approval gate, completeness principle, and prohibition on unapproved design decisions. Guidance controls explanation and chunking—not safety, scope, or who approves.

## Help mode

Triggered by `/gantry help` (or `--help`/`-h`, or a plain "how do I use gantry?"). Do not scaffold, do not infer a mode, do not touch the working tree. Print the guide below to chat verbatim (adjust only the invocation syntax to the host agent), then stop and ask what the engineer wants to build. This is a teaching response, not a workflow turn.

---

**gantry — stay in the design loop while AI writes the code.**

You design in pseudocode, gantry surfaces what you missed, you approve, *then* it writes the body. The `.gantry/<slug>.md` doc is the lasting record of what was decided and why.

**Start by just running `/gantry`** — describe what you're building in one sentence and gantry picks the right mode from your working tree:

- **Forward** — new code (no doc, no source yet). You write pseudocode (or ask "draft it for me"); gantry surfaces refs, edge cases, feature gaps, and ripples inline; you approve; it translates to code.
- **Continue** — `/gantry <slug>` when a doc already exists. Gantry drift-checks the doc against current source first, then you keep authoring.
- **Rebuild** — `/gantry <slug> path/to/file.ts` (or a symbol) when source exists but no doc. You write pseudocode of what you *think* the code does; gantry flags the mismatches — those are your mental-model gaps.

**The one rule:** no code is written until every decision is resolved, reflected in the current pseudocode, and a stabilization pass finds no new downstream decisions. Clear that gate, then say "write the code."

**Choose your guidance:** `/gantry-mode guided`, `/gantry-mode collaborative`, or `/gantry-mode concise` sets the default for new tasks. Add the current slug to switch this task immediately, such as `/gantry-mode guided vendor-search`. Every level keeps the same approval gate.

**Resolving what gantry surfaces** — in the browser editor (gantry opens it for you) or in chat:
- *accept* — it's right, check it off.
- *reject* — "won't happen, validated upstream" (give the reason).
- *edit* — "actually, parameterize it, default 20."

**Typical first session:**
1. `/gantry` → "I'm building vendor search."
2. Write rough pseudocode in the editor (or ask gantry to draft it).
3. Say "ready" → gantry annotates edge cases and refs.
4. Resolve each annotation; gantry rewrites the affected steps and follows their ripples until the design stabilizes.
5. Say "write the code" → gantry implements and snapshots the code into the doc.

Run `/gantry` whenever you want to start. What would you like to build?

---

## Browser editor

Gantry includes an optional local browser editor for `.gantry/<slug>.md`. The markdown file remains the only durable source of truth; the editor is just a faster surface for editing pseudocode steps, approving/rejecting AI items, choosing A/B/C options, and attaching comments.

The editor presents the doc's steps, forks, and gate items as one list and lets the engineer resolve each unresolved one. A brand-new doc with nothing written yet opens to a single freeform field for writing the initial pseudocode, saved verbatim; once it has steps, it presents the list.

Before running any editor, lint, or ids command, locate the editor script and use its absolute path. Check these locations in order:

1. Project-local development checkout: `skills/gantry/scripts/gantry-editor.mjs`
2. Generic agent global install: `~/.agents/skills/gantry/scripts/gantry-editor.mjs`
3. Codex global install: `~/.codex/skills/gantry/scripts/gantry-editor.mjs`
4. Claude Code global install: `~/.claude/skills/gantry/scripts/gantry-editor.mjs`

Then run it with the current repository as `--root`, so the globally installed UI edits this project's `.gantry/` files:

```bash
node <absolute-path-to>/gantry-editor.mjs serve --slug <slug> --root <project-root>
```

When running from this repository, the shorter form is:

```bash
node skills/gantry/scripts/gantry-editor.mjs serve --slug <slug>
```

**The skill launches this for the engineer — don't make them run it.** When the workflow reaches the drafting/editing surface, Claude/Codex starts the server itself, in the background (it is a long-lived process — launch it non-blocking so the conversation continues). On launch the server **opens the editor in the engineer's default browser automatically** and also prints the `http://127.0.0.1:<port>/` URL as a fallback. Pass `--no-open` only to suppress that (e.g. tests). The editor checks the underlying markdown once a second and re-renders external changes automatically; it pauses that check while the browser has unsaved edits. Save through the UI; if saving fails, the UI shows the server error and the markdown file is not updated.

Lint the Gantry markdown format:

```bash
node <absolute-path-to>/gantry-editor.mjs lint --slug <slug> --root <project-root>
```

Check the code-writing gate:

```bash
node <absolute-path-to>/gantry-editor.mjs lint --slug <slug> --gate --root <project-root>
```

If older Gantry docs contain checkbox annotations without stable ids, add ids before using the browser editor:

```bash
node <absolute-path-to>/gantry-editor.mjs ids --slug <slug> --root <project-root>
```

### Strict editable item format

Editable AI items live under `## Pseudocode`, immediately after the pseudocode step they apply to. Each item has a stable marker plus the human-readable checkbox line:

```markdown
1. Read the query from the request.
<!-- gantry:item id=gty-ref-query type=ref status=open mode=decision -->
- [ ] **ref:** which existing helper already parses this route's request?
```

An item you are surfacing for the engineer to decide has **no `- comment:` line** — see [Presenting is not resolving](#presenting-is-not-resolving). A comment appears only after the engineer resolves the item.

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

Valid item types are `ref`, `edge`, `feat`, `ripple`, `update`, and `mismatch`. Valid statuses are `open`, `accept`, `reject`, `edit`, `choice-a`, `choice-b`, and `choice-c`. `open` items still block code writing.

**When a question has distinct alternatives, write them out as a choice item.** Spell each alternative as an option (A, B, C) so the engineer answers by picking one, not by typing a comment. A question phrased "should it be X or Y?" is a two-option choice item, not a `mode=decision` item — the same goes for a fork, where each path is a named alternative. Reserve `mode=decision` (free-text comment) for genuinely open-ended questions that have no enumerable options. For example, "Should login show a retry error, or recreate the missing auth identity before sending OTP?" is a choice: `A: show a retry error` / `B: recreate the identity, then send OTP`.

### Presenting is not resolving

Surfacing an item, choice, given, or fork **never** carries your own comment, edit, or status. Leave everything you present unresolved: `status=open` (or `mode=choice` with no chosen option), the checkbox unchecked, and **no `- comment:` line**.

This is a hard mechanical constraint, not a style preference. The editor derives status from comment presence: a non-empty comment on any open item, given, or fork resolves it to `edit` and collapses it into decision history (that's how the UI works — see `app.js` `effectiveStatus`/`hasProposedEdit`). So an AI-written comment silently marks the decision "done" and hides it before the engineer has touched it — the exact rubber-stamp collapse gantry exists to prevent. A comment is an engineer resolution record; you write one only after they decide, to capture what they chose (see [Resolution](#resolution)).

**Put your recommendation, rationale, or default at the end of the item's content — never in an option's wording and never in a comment.** Keep each option a clean, neutral statement of that alternative; append your steer as a trailing sentence on the item/question line itself. For the empty-query choice above, the options stay `A: return all vendors` / `B: return no vendors` / `C: throw validation error`, and the question line ends with `default: B — matches the empty-result contract callers already expect`. When you also raise these as a chat question (e.g. AskUserQuestion), the same holds: the recommendation trails the content, the options stay neutral, and the doc item stays open and comment-free until the engineer answers.

Annotation items are for the **annotation pass** (after the engineer's design is endorsed). AI-drafted pseudocode uses a different, lighter representation — see [AI-drafted pseudocode: givens and forks](#ai-drafted-pseudocode-givens-and-forks).

### Givens and forks (the AI-draft representation)

When AI drafts pseudocode, it does **not** mark every line as a "proposed step." It classifies each line into one of two kinds:

A **given** is settled pseudocode — a line with a clear default and no real alternative. It carries provenance (`author`) and resolves with the **same vocabulary as an annotation item** — accept, reject, or edit — never "proposed:" prose. When you draft a given, it is `status=open` with the text on the line after the marker and **no comment** ([Presenting is not resolving](#presenting-is-not-resolving)). A `- comment:` line is what the *engineer* adds to propose an edit; because the editor reads any comment as an edit, a given that carries one is already resolved (`status=edit`), not open:

```markdown
<!-- gantry:step id=gty-cc-normalize author=ai status=open -->
Step 0 — normalize source: probe rotation; bake if non-zero, else copy.
```

A given may own indented pseudocode sub-bullets. Use this when one conceptual step has a small internal list, such as supported modes or ordered sub-actions. Keep those sub-bullets inside the same `gantry:step`; do not explode them into fake top-level steps just to satisfy the editor.

```markdown
<!-- gantry:step id=gty-output-rag-modes author=ai status=open -->
Support three output-RAG flow modes:
  - `tool_output_only`: retrieve with observed tool/output text, then run the final pass with that memory.
  - `model_output_only`: run a first pass, retrieve with that response text, then run the final pass.
  - `tool_then_model_output`: retrieve with tool/output text, run an intermediate pass, retrieve again with that response, then run the final pass.
```

- `author` is `ai` (drafted by AI, must be resolved) or `user` (the engineer's own line, implicitly accepted — usually a plain pseudocode line with no marker at all, rendered with a static approved mark).
- `status` is `open` | `accept` | `reject` | `edit` — identical to a decision item. Only `open` givens block the gate; a non-empty comment makes a given an `edit`.

A **fork** is the branch decision — the *only* thing that demands an answer. It is a recursive parent: it owns two or more **paths**, and each path owns its own givens. **Use a fork only when picking a path commits the engineer to a multi-step sub-flow:** at least one path must own two or more steps (or hold a nested fork). If every path is a single answer, the decision is a choice item (one MCQ step), not a fork — **the linter enforces this** (`fork-not-branching`). A fork is unresolved (`status=open`) until the engineer picks a path (`status=<path-id>`) or drops the whole fork (`status=reject`). Each path carries `status` `open` | `pick` | `reject`; rejecting a path collapses everything under it.

```markdown
<!-- gantry:fork id=gty-cc-takes status=open -->
fork: How should repeated takes be detected?
<!-- gantry:path id=gty-cc-takes-llm fork=gty-cc-takes status=open -->
path: A — LLM adjudication
<!-- gantry:step id=gty-cc-llm-cluster author=ai status=open path=gty-cc-takes-llm -->
Send candidate restarts to the LLM; cluster the ones it judges to be the same take.
<!-- gantry:step id=gty-cc-llm-keep author=ai status=open path=gty-cc-takes-llm -->
Keep the LAST take in each cluster; never cut all copies.
<!-- gantry:path id=gty-cc-takes-ngram fork=gty-cc-takes status=open -->
path: B — deterministic fuzzy n-gram
<!-- gantry:step id=gty-cc-ngram-scan author=ai status=open path=gty-cc-takes-ngram -->
Slide an n-gram window over the transcript; score adjacent spans for similarity.
<!-- gantry:step id=gty-cc-ngram-cut author=ai status=open path=gty-cc-takes-ngram -->
Cut the earlier span wherever the score clears the threshold.
```

Fork/path structure is driven entirely by the `id`/`fork`/`path` attributes, not by indentation: a path belongs to the fork named in its `fork=` attribute, and a given belongs to the path named in its `path=` attribute (top-level givens omit `path=`). Indentation inside a step is still meaningful pseudocode text: indented bullets are rendered and saved as part of the owning step body.

## State inference (first thing the skill does)

If the invocation is a help request (`help`/`--help`/`-h`, or "how do I use gantry?"), short-circuit to [Help mode](#help-mode) before anything below — never treat `help` as a slug.

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

<!-- gantry:workflow pseudocode=pending annotations=pending stabilization=pending implementation=pending -->

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
guidance: <guided | collaborative | concise>
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

1. **Ask the target.** When gantry is invoked with no slug and no description, explicitly ask "what are you building?" — one sentence — before doing anything else. Run the related-doc search (see state inference above), then use the one-liner as the doc target and slug source.
2. **Scaffold.** Create main doc + sidecar. Record baseline.
3. **Draft pseudocode.** Choose the drafting path from the engineer's explicit intent:
   - **Engineer-first (default):** A freshly scaffolded doc has no AI items, so the editor shows a single freeform pseudocode field — the engineer writes loosely and saves. Fallback: chat — if the engineer types pseudocode into chat, transcribe it into the main doc verbatim (no rewording).
   - **AI-draft (explicit request only):** Claude/Codex reads the target context and writes an initial pseudocode draft into `## Pseudocode` as **givens and forks** (see [AI-drafted pseudocode: givens and forks](#ai-drafted-pseudocode-givens-and-forks)), because AI-authored pseudocode is not yet the engineer's design. A request to "make/build/add" a feature is not a request to treat AI-generated pseudocode as engineer-authored; all synthesized steps remain `author=ai status=open`. Settled lines are givens the engineer approves; genuine decisions are forks the engineer resolves. Both must be cleared before annotation or code-writing.
   Then launch the browser editor as the primary drafting/resolution surface — run it in the background so it doesn't block the conversation:
   ```bash
   node <absolute-path-to>/gantry-editor.mjs serve --slug <slug> --root <project-root>
   ```
   This opens the editor in the engineer's browser automatically. In AI-draft mode, launch it after populating the draft so the engineer resolves the proposal in the same approval UI.
   **STOP after presenting the draft/editor.** Yield the turn so the engineer can inspect it. Do not annotate, clear workflow state, or implement in the drafting turn.
4. **Engineer reviews the current pseudocode and signals "ready"** (or similar). Set `pseudocode=approved`. Now AI annotates. A prior request to build the feature is not this approval.
5. **Annotate inline.** Walk the pseudocode step by step. Under each step that needs it, add `- [ ]` annotations of four types (rules in [annotation bar](#annotation-bar) below):
   - `**ref:**` — verify symbols and resolve ambiguity for references the engineer used.
   - `**edge:**` — substantive edge cases the pseudocode didn't address.
   - `**feat:**` — useful or necessary feature additions the engineer did not specify but should consciously accept or reject.
   - `**ripple:**` — structural changes elsewhere in the codebase needed to make this work.
6. **Resolution and stabilization loop.** Engineer resolves annotations in-file or in chat (see [resolution](#resolution)). After every resolution batch:
   - normalize the completed annotations;
   - materialize their outcomes into the affected pseudocode steps;
   - run a targeted stabilization pass over those steps and their downstream dependencies;
   - surface any newly implied substantive decisions, then repeat after those are resolved.
   On every turn, also run the diff script, reconcile against engineer code changes, surface uncertain triage in chat, and auto-revert resolved annotations whose context shifted.
7. **Approval gate.** Code-writing is blocked until all three conditions hold:
   - zero unresolved items, AI steps, or forks remain;
   - every accepted, edited, or chosen outcome is reflected in the canonical pseudocode;
   - the latest stabilization pass added no new substantive decisions.
   Record the completed annotation and stabilization phases in the workflow marker:
   `pseudocode=approved annotations=complete stabilization=complete implementation=pending`.
   Only then tell the engineer the design gate is clear, invite "write the code" (or equivalent), and **STOP**. A successful `lint --gate` is not possible yet and is not a substitute for this pause.
8. **Receive explicit implementation authorization.** Only after the engineer responds to the stable current design with "write the code" (or equivalent), set `implementation=authorized` and run `lint --gate`. If it passes, translate the pseudocode into source. If the engineer has not sent that separate authorization, do not edit source files.
9. **Translate to body.** Mechanically translate the now-resolved pseudocode into the actual source files. Do not introduce design decisions that weren't surfaced and approved.
10. **Snapshot.** Embed the as-written code into the main doc's `## Code` section, dated and pinned to the current commit. This is the historical record — it is *not* updated when source evolves.
11. **If mid-translation a gap appears** (something approved pseudocode doesn't specify but the implementation needs): stop. Reset `annotations=pending stabilization=pending implementation=pending`, add a fresh `- [ ]` to the affected step describing the gap, surface it in chat, and wait for resolution. Resume only after stabilization and a fresh implementation authorization.

## The flow (continue mode)

`.gantry/<slug>.md` already exists. Engineer is back.

1. **Drift check first.** Compare the as-written code snapshot in the main doc against current source for the referenced files. For each drifted region, add a `- [ ] **update:**` annotation against the affected pseudocode step: "source has changed since this was written — was this an intended design update (rewrite the pseudocode to match), unrelated (mark obsolete), or accidental drift (revert source)?"
2. **Engineer resolves drift annotations.** Same resolution mechanics as everything else.
3. **Once drift is resolved**, continue forward — engineer adds new pseudocode, AI annotates, gate, write, snapshot.

## The flow (rebuild mode)

Source for the slug exists but no `.gantry/<slug>.md`. Offer the engineer two sub-paths in chat:

- **(a) Write-blind.** Engineer writes pseudocode of what they *think* the function does, without looking at the source. AI compares to actual source and surfaces mismatches as `- [ ] **mismatch:**` annotations. This is the diagnostic mode — it finds mental-model gaps. When a mismatch is accepted or edited, rewrite the owning step to the corrected mental model while preserving the completed mismatch beneath it as history.
- **(b) AI-bootstrap.** AI reads the source and generates pseudocode as a starting point. Every generated step is `- [ ]` proposed. Engineer must resolve each — accept ("yes, this is what it should do"), edit ("the source has it wrong / unclear, here's what it should be"), or reject ("this exists but I don't know why"). This is the on-ramp for adopting gantry on an existing codebase.

After rebuild's initial pass completes, the doc is live — continue mode applies on future invocations.

## Annotation bar (this is load-bearing)

Annotations cost the engineer attention. Over-surfacing trains the engineer to skim and rubber-stamp, which collapses the approval gate. Surface only what passes the bar:

- **edge:** Surface only if the answer would change *observable system behavior* in a way a caller or user can see. Substantive branching: throw vs. return empty, parameterize vs. hardcode, error-on-invalid vs. silently-skip. Do NOT surface defensive nitpicks: whitespace handling, null-vs-empty when the answer is obviously "do the sane thing," length checks on data that's already validated upstream.
- **feat:** Surface only when the current pseudocode appears to omit a user-visible capability that is likely necessary for the intended workflow, or a small adjacent feature that would materially improve the outcome. A `feat` is an explicit expansion candidate: it must state why the addition belongs, what behavior changes if accepted, and what scope cost it creates. Do NOT use `feat` for generic polish, speculative product ideas, "while we're here" extras, or mechanical implementation consequences.
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

**Chat resolution** works in parallel: "approve 2.1, 4.1. reject 3.1 — validated upstream. edit 5.1: parameterize with default 20." AI applies the resolutions to the file. A chat answer is not just a comment: update the marker status, checkbox line, badge, and owning pseudocode or decision-history bullet so the browser editor can be understood without the chat transcript.

**AI normalizes after each turn.** Reads the resolved annotations, infers intent from prose (accept if just `[x]`; reject if prose contradicts; edit if prose is a refinement), and rewrites each into a canonical resolved form with a type badge:

```
- [x] **edge:** [edit] `limit` is a parameter, default 20, clamped to 100.
- [x] **edge:** [reject] category-not-in-enum — validated upstream.
- [x] **ref:** [accept] use existing `sortByRating` in `utils/sort.ts`.
```

If AI is uncertain about intent (e.g., "yes but also do Y" — accept-with-augmentation or edit?), confirm once in chat before normalizing.

For choice items resolved in chat, persist the actual decision explicitly. Do not leave the item as `status=open` or as a vague `comment: approved in chat`; that makes the decision history unreadable. If the engineer picks one of the listed options, the marker and checkbox badge carry the chosen option, and the item text states the selected behavior:

```markdown
<!-- gantry:item id=gty-trace-recording type=edge status=choice-a mode=choice -->
- [x] **edge:** [choice-a] Record first-pass text, response id, resolved model, usage, and both retrieval queries in the trace.
  - A: record first-pass text, response id, resolved model, usage, and both retrieval queries
  - B: record only the retrieval query
  - C: do not record the first pass separately
  - comment: approved in chat: full recording behavior
```

If the engineer answers with something that is not one of the listed options, record it as an edit instead of forcing it into A/B/C. Keep the original options as context, but make the chosen behavior the completed decision-history bullet:

```markdown
<!-- gantry:item id=gty-trace-recording type=edge status=edit mode=choice -->
- [x] **edge:** [edit] Record the first-pass response and both retrieval queries, but omit token usage from the trace.
  - A: record first-pass text, response id, resolved model, usage, and both retrieval queries
  - B: record only the retrieval query
  - C: do not record the first pass separately
  - comment: resolved in chat: custom trace payload, not A/B/C
```

For non-choice items resolved in chat, the same rule applies: the status badge records the decision (`[accept]`, `[reject]`, or `[edit]`), and any chat wording becomes provenance after the canonical resolved text, not the only record of the decision.

### Materialize resolved decisions

Normalization preserves what the engineer decided; materialization makes that decision the actual design. After normalizing a resolution batch, every decision must land in one of two places: the owning pseudocode if it changes the current design, or a completed decision-history bullet attached to the related pseudocode step if it records why an alternative was rejected, replaced, or left out. A decision that exists only in chat, only in an unchecked/open annotation, only as "approved in chat", or only in a detached bottom section is missing from the Gantry doc.

- **Accept, edit, or choice:** incorporate the approved outcome into the owning step when it changes the current behavior. Replace superseded wording rather than leaving contradictory instructions side by side.
- **Choice answer outside the listed options:** use `status=edit`, rewrite the item text to the engineer's actual decision, preserve the original A/B/C options under it, and materialize the edited behavior into pseudocode if it is current design.
- **Accepted ripple or feature:** insert or split out a pseudocode step when the outcome adds distinct work elsewhere. Do not bury a structural addition inside an annotation.
- **Reject:** leave the pseudocode behavior unchanged, but keep the completed annotation and rejection reason as the decision trail.
- **AI given edit:** rewrite the given's text to the engineer's version, retain `status=edit`, and keep the comment as provenance.
- **Picked fork:** fold the surviving path into the settled flow once its givens are resolved; rejected paths remain recorded as history but are not part of the canonical flow.

The completed annotation stays immediately beneath the step that caused it, even after the step text is rewritten. If materialization splits one step into several steps, move each completed decision under the new step it explains. If materialization merges steps, carry the relevant histories into the merged step. Do not collect resolved decisions at the bottom of `## Pseudocode`; a bottom holding area is allowed only temporarily while no owning step exists, and the next normalization pass must either attach each item to a related step or ask the engineer where it belongs.

Example:

```markdown
3. Record first-pass response text, response id, resolved model, and both retrieval queries in the trace. Do not record token usage.
<!-- gantry:item id=gty-trace-recording type=edge status=edit mode=choice -->
- [x] **edge:** [edit] Record the first-pass response and both retrieval queries, but omit token usage from the trace.
  - A: record first-pass text, response id, resolved model, usage, and both retrieval queries
  - B: record only the retrieval query
  - C: do not record the first pass separately
  - comment: resolved in chat: custom trace payload, not A/B/C
```

That completed item is history, not the current instruction. In the browser editor, completed annotations may be collapsed by default so the canonical pseudocode remains fast to scan.

Never declare the gate clear while an accepted annotation contradicts, refines, or adds behavior that is still absent from the pseudocode. A checked box is an approval record, not a substitute for updating the spec.

### AI-drafted pseudocode: givens and forks

AI-drafted pseudocode is not yet the engineer's design, so it must be endorsed before annotation or code-writing. But endorsement must not become 13 identical "proposed step" gates — uniform ceremony trains the engineer to skim and rubber-stamp, which is the exact failure gantry exists to prevent. So the draft is split into two kinds of content (markup in [Givens and forks](#givens-and-forks-the-ai-draft-representation) above):

**Your job when drafting is to classify, not to propose everything.** For each line:

- **Clear default, no real alternative → emit a `given`** (`author=ai status=open`). Most lines are givens. They render as clean pseudocode the engineer accepts, rejects, or edits — individually, or a whole block at once via "approve all." A sensible default is not a decision; do not gate it behind prose.
- **A real decision among discrete options, each a single answer → emit one choice item** (`mode=choice`, options A/B/C). One MCQ step: the engineer picks an option and the decision is done.
- **A real decision whose alternatives each branch into multiple steps → emit a `fork`**, at the point in the pipeline where the branch occurs, with each path owning the givens it implies. Forks are only for multi-step branches; a single-step choice is a choice item, not a fork.

**Pulling decisions out of givens is what makes the workflow safe.** Approving givens in bulk is safe *only because* every genuine decision has been pulled out — into a choice item or a fork — where it cannot be bulk-resolved. So: **when in doubt, surface the decision (choice item or fork) — do not bury it in a given.** If you hide a real alternative inside a given, the engineer can approve past it without ever deciding, and the design record is a lie. (Choice for a single-answer pick; fork only when the branches each run multiple steps.)

Resolution:

- **Given — accept:** the engineer endorses it (`status=accept`). Per line, or per block via "approve all."
- **Given — reject:** the engineer drops the line (`status=reject`); it won't be built.
- **Given — edit:** the engineer rewrites the line or leaves a comment (`status=edit`); it stays a given, now theirs.
- **Fork — pick a path:** `status=<path-id>`; sibling paths are rejected and collapse. The picked path's givens fold into the settled flow (still each resolvable).
- **Fork — drop:** `status=reject`; every path collapses. The engineer stops worrying about anything underneath.

When a path or fork is rejected, **you own keeping the surviving givens coherent.** Rejecting a branch collapses everything *under* it for free (containment). But givens *after* the fork that assumed the dropped feature (a merge step that referenced its output, a report that counted its results) are not underneath it — silently reconcile those to match the new reality and note that you did. The engineer decides forks; you keep the givens consistent. Do not ask them to clean up the ripple.

The gate (`status=open` givens, `status=open` forks) blocks code-writing until cleared. Do not add `ref`/`edge`/`feat`/`ripple` annotations against unresolved givens or forks; first establish what the engineer actually endorses, then run the annotation pass on the settled pseudocode.

## Stabilization pass (after every resolution batch)

Resolution can create new design consequences. Gantry must follow those consequences to a fixed point instead of stopping after one annotation round.

1. Materialize the newly resolved outcomes into the canonical pseudocode.
2. Re-read the changed steps plus the symbols, call sites, contracts, and later steps that depend on them.
3. Handle mechanical consequences silently: imports, obvious parameter plumbing, renumbering, and formatting do not become new gates.
4. Surface only newly implied **substantive** decisions that pass the annotation bar: observable behavior, genuine ambiguity, useful scope expansion, or structural change.
5. If new items were added, wait for the engineer to resolve them, materialize those outcomes, and run stabilization again.
6. A pass that adds zero items marks the current design stable. Record that result in the sidecar reconciliation history.

This is incremental ripple closure, not a full rescan. It follows the consequences of decisions that just changed; it does not regenerate unrelated annotations or reopen unchanged resolutions. There is no fixed number of rounds.

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
- Engineer resolves an annotation in chat → AI rewrites the exact annotation in the file, including marker status, checkbox state, status badge, chosen option or resolved text, and any provenance comment. Chat-only resolution does not satisfy completeness.
- Engineer changes source code → AI proposes a pseudocode update in the doc, anchored to the affected step. Engineer resolves; pseudocode is rewritten if accepted/edited, left alone if rejected (rejection means "that code change wasn't a design decision").
- Engineer resolves an annotation or fork → AI rewrites the affected pseudocode and runs stabilization. The completed item remains beneath the related canonical step as history, including after the step is rewritten, split, or merged.

If a decision exists in the engineer's head or in the code but not in the doc, the workflow has failed. If it exists only in a completed annotation but not in the canonical pseudocode, the workflow is not finished.

## Targeted vs. rescan

Default: **targeted updates**. When the engineer raises a specific pushback ("you missed X in step 3"), respond to that specific thing. Don't regenerate other annotations or invalidate other resolutions. The mandatory stabilization pass is also targeted: it follows only the downstream consequences of the decisions that just changed.

Engineer can request a **rescan** ("rescan everything" or similar). Then re-read the whole doc and source, regenerate all annotations from scratch. Prior resolutions stay where the context is unchanged; reset to `- [ ]` where it shifted.

## Code-writing rules

When the engineer says "write the code" (or equivalent) in response to the stable current design, set `implementation=authorized`, then verify the full gate with `lint --gate`: explicit pseudocode approval, completed annotation and stabilization passes, implementation authorization, zero unresolved items, and every resolution materialized into canonical pseudocode.

The workflow marker is fail-closed:

```markdown
<!-- gantry:workflow pseudocode=pending annotations=pending stabilization=pending implementation=pending -->
```

- Set `pseudocode=approved` only from the engineer's explicit review of the current pseudocode.
- Set `annotations=complete stabilization=complete` only after those passes actually run.
- Set `implementation=authorized` only from a separate engineer message authorizing the stable current design.
- Any substantive pseudocode change resets downstream fields to `pending`; any new annotation resets `annotations`, `stabilization`, and `implementation`; any new stabilization finding resets `stabilization` and `implementation`.
- Never write these approvals based on tool output or the agent's own judgment.

- Translate mechanically. The approved pseudocode is the spec.
- Mechanical consequences of accepted decisions (imports, simple parameter plumbing) are handled at this stage automatically — they were not separate ripples for a reason.
- If during translation a real gap appears: stop, add a fresh `- [ ]` to the affected step, surface in chat. Resume only after the gap is resolved.
- After translation: write the code into the actual source files, and embed the as-written code into the main doc's `## Code` section with the date and commit hash. Do not duplicate edits — the doc snapshot is historical.

Never introduce design decisions at code-write time that weren't surfaced and approved. If the implementation forces a choice not in the pseudocode, that's a mid-implementation gap — halt and surface it.

## What this skill does NOT do

- It does not invent edge cases AI didn't think of. Gantry forces engagement with the edge cases AI surfaces, but cannot generate cases beyond AI's own thinking. The engineer's own pseudocode is the input that pushes AI to think about cases beyond the obvious.
- It does not enforce hard gates (pre-commit hooks etc.) in v0. Soft enforcement only — this SKILL.md, used by Claude inside Claude Code.
- It does not silently replace the engineer's thinking. AI may draft starting pseudocode only when the engineer explicitly requests it, and every generated step remains unapproved until accepted or edited by the engineer.
- It does not normalize the engineer's pseudocode formatting. Engineer writes loose; AI parses what's there. If pseudocode patterns break parsing in practice, that's when a format-normalization pass gets designed.
- It does not generate documentation. The main doc is the artifact — it documents itself through the pseudocode, annotations, resolutions, and code snapshot.

## Implementation notes

- The diff script should be a single command (likely `git diff` against baseline + a summarizer) so Claude processes one chunk of output per turn, not a sprawl of tool calls.
- `.gantry/` is typically gitignored by default (skill-managed working state). Commit-mode (checking the directory in) is an opt-in for teams that want the artifacts shared.
- Slug-to-source fuzzy matching: use filename match, exported-symbol match, and prior in-scope files from sibling gantry docs as signal. When matches are ambiguous, ask the engineer.
