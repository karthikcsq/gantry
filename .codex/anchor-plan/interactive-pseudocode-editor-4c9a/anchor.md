# Anchor

## Original request (verbatim)
> $anchor-plan I want to rewrite the editin for the skill to utilize a spun up html page that reads the markdown in an interactive way (using a script) and creates an interactive way for users to interact with the pseudocode gantry files. I need an easy way to provide feedback, an easy way to approve / reject stuff as well. make it look pretty / colored where necessary

## Captured at
2026-06-13T03:04:21.0175143Z

## Goals
- Rewrite the editing experience for the Gantry skill.
- Use a spun-up HTML page that reads Gantry markdown through a script.
- Make interaction with pseudocode Gantry files more interactive.
- Provide an easy way for users to give feedback.
- Provide an easy way for users to approve or reject proposed material.
- Use visual styling, colors, and polish where useful.

## Non-goals
- Not yet specified.

## Constraints
- Keep project-relevant plans within the current project's `.Codex` directory.
- Stay aligned with Gantry's authorship-discipline workflow: collaborative pseudocode, inline edge cases, explicit approval before code writing, and no audit or heatmap framing.
- Default drift budget because none was specified: low scope, low complexity, strict interpretation.

## Ambiguities (resolved)
- Q: When you say "rewrite the editing," do you mean replace the current markdown-in-editor workflow entirely, or add an optional browser UI around the same markdown files?
  A: Add a browser UI as an interactive wrapper around the same markdown files. The model should continue to read and reference the markdown file as the source of truth.
- Q: Should the HTML page write changes back into the `.gantry`/Gantry markdown files directly, or should it produce a separate reviewed/approved output that the skill later applies?
  A: The simple JS/browser wrapper should update the markdown file in a specific format, while preserving it as a human-readable simple file.
- Q: What needs approve/reject controls: AI-suggested references, inline edge cases, pseudocode steps, generated code blocks, or every proposed change?
  A: Everything should be editable, but AI-suggested references must be especially easy to approve or reject.
- Q: Should feedback be freeform comments attached to specific pseudocode lines/blocks, structured statuses like `approved/rejected/needs-change`, or both?
  A: Each item should be surfaced like AI planning tools, but improved: either simple approve/reject buttons with freeform comments underneath each item, or option A/B/C choices with freeform comments underneath each item.
- Q: May I use an independent Codex subagent for drift checks if the tool is available, or should I keep drift checks manual?
  A: Independent subagents are approved for drift checks.
- Q: Should v0 use a local server, or is a static HTML file plus a script acceptable if it can still write back safely?
  A: Static HTML is acceptable as long as it writes well.
- Q: For item decisions, should the default be simple `approve/reject`, or should v0 support `option A/B/C` too?
  A: V0 should support both approve/reject and A/B/C item decision patterns.
- Q: Should this live entirely inside the Gantry skill package, or should it be a small reusable app/script that the skill invokes?
  A: It should live with the Gantry skill so it can be easily installed and executed.
- Q: Should the markdown format be strict or loose?
  A: Use strict format guides, perhaps enforced through a linter.
- Q: What did web research show about static HTML writing back to markdown?
  A: Static HTML can plausibly write to a user-selected local markdown file using the browser File System Access API in supporting Chromium-based browsers, provided the action is user-initiated and capability-checked. The exact fallback for unsupported browsers should be planned explicitly.
- Q: What level of visual polish is required for v0?
  A: A clean utilitarian tool UI is enough for v0.
- Q: For unsupported browser write-back, should fallback be "download the edited markdown file," or "run a tiny local server command from the skill"?
  A: Use a local server fallback. If that is the only way to make write-back foolproof, start with the local server approach.

## Ambiguities (unresolved)
- None.

## Drift budget
- Scope: low
- Complexity: low
- Interpretation: strict

## Drift-check permission
- Independent Codex subagent: approved
