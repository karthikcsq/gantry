const ITEM_TYPES = new Set(["ref", "edge", "feat", "ripple", "update", "mismatch"]);
const STATUSES = new Set(["open", "accept", "reject", "edit", "choice-a", "choice-b", "choice-c"]);
const AUTHORS = new Set(["user", "ai"]);
// An AI-authored step resolves with the same vocabulary as a decision item:
// open until the engineer accepts, rejects, or proposes an edit (a comment).
const STEP_STATUSES = new Set(["open", "accept", "reject", "edit"]);
const PATH_STATUSES = new Set(["open", "pick", "reject"]);
const ID_PATTERN = /^gty-[a-z0-9][a-z0-9-]*$/;
const WORKFLOW_FIELDS = {
  pseudocode: new Set(["pending", "approved"]),
  annotations: new Set(["pending", "complete"]),
  stabilization: new Set(["pending", "complete"]),
  implementation: new Set(["pending", "authorized"]),
};

export { ITEM_TYPES, STATUSES, AUTHORS, STEP_STATUSES, PATH_STATUSES, ID_PATTERN, WORKFLOW_FIELDS };

export function parseGantryMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const sections = findSections(lines);
  const pseudocode = sections.get("pseudocode") ?? { start: 0, end: lines.length };
  const items = [];
  const steps = [];
  const aiSteps = [];
  const forks = [];
  const blocks = [];
  const forkById = new Map();
  const pathById = new Map();
  const workflowMarkers = [];
  let currentStep = null;

  for (let index = 0; index < lines.length; index += 1) {
    const workflow = parseWorkflowMarker(lines[index]);
    if (workflow) workflowMarkers.push({ ...workflow, line: index });
  }

  for (let index = pseudocode.start; index < pseudocode.end; index += 1) {
    const line = lines[index];
    const marker = parseMarker(line);

    // Annotation item: marker + checkbox line, or a legacy markerless checkbox line.
    if (marker?.kind === "item" && isItemLine(linesSafe(lines, index + 1))) {
      const item = readItem(lines, index, index + 1, pseudocode.end, currentStep);
      items.push(item);
      index = item.endLine;
      continue;
    }
    if (!marker && isItemLine(line)) {
      const item = readItem(lines, index, index, pseudocode.end, currentStep);
      items.push(item);
      index = item.endLine;
      continue;
    }

    // AI-authored step: a pseudocode line that is not yet the engineer's design,
    // so it needs approval. It looks and reads exactly like a user step — the
    // only difference is `author=ai` + a `status` the engineer must resolve
    // (accept / reject / edit). The text is on the next line; comments follow.
    if (marker?.kind === "step") {
      const textLine = index + 1;
      const comments = [];
      const textLines = [linesSafe(lines, textLine)];
      let endLine = textLine;
      for (let i = textLine + 1; i < pseudocode.end; i += 1) {
        const sub = linesSafe(lines, i);
        if (!sub.trim() || parseMarker(sub) || isItemLine(sub) || isTopLevelEditableStepLine(sub)) break;
        if (/^\s*- comment:\s*/.test(sub)) comments.push(sub.replace(/^\s*- comment:\s*/, ""));
        else if (isPseudocodeContinuationLine(sub)) textLines.push(sub);
        else if (/^\s{2,}.+/.test(sub)) comments.push(sub.trim());
        endLine = i;
      }
      const step = {
        kind: "step",
        id: marker.id ?? `missing-${index + 1}`,
        markerLine: index,
        line: textLine,
        endLine,
        text: textLines.join("\n"),
        // Preserve the raw author/status so an invalid marker surfaces as a lint
        // error instead of being silently coerced (items and forks do the same).
        author: marker.author ?? "ai",
        status: marker.status ?? "open",
        comments,
        pathId: marker.path ?? null,
      };
      aiSteps.push(step);
      const parentPath = step.pathId ? pathById.get(step.pathId) : null;
      if (parentPath) parentPath.children.push(step);
      else blocks.push(step);
      currentStep = step;
      index = endLine;
      continue;
    }

    // Fork: a branch point. The recursive parent — owns paths, each path owns
    // steps. Unresolved (status=open) until the engineer picks a path
    // (status=<path-id>), drops the whole fork (status=reject), or proposes a
    // different path in a comment (status=edit). Comment lines follow the title.
    if (marker?.kind === "fork") {
      const titleLine = index + 1;
      const comments = [];
      let endLine = titleLine;
      for (let i = titleLine + 1; i < pseudocode.end; i += 1) {
        const sub = linesSafe(lines, i);
        if (!sub.trim() || parseMarker(sub) || isItemLine(sub) || isEditableStepLine(sub)) break;
        if (/^\s*- comment:\s*/.test(sub)) comments.push(sub.replace(/^\s*- comment:\s*/, ""));
        else if (/^\s{2,}.+/.test(sub)) comments.push(sub.trim());
        endLine = i;
      }
      const fork = {
        kind: "fork",
        id: marker.id ?? `missing-${index + 1}`,
        markerLine: index,
        line: titleLine,
        endLine,
        title: stripLabel(linesSafe(lines, titleLine), "fork"),
        status: marker.status ?? "open",
        comments,
        pathId: marker.path ?? null,
        paths: [],
      };
      forks.push(fork);
      forkById.set(fork.id, fork);
      // A fork with a path= attribute is nested inside that path (recursion);
      // otherwise it's a top-level branch.
      const parentForkPath = fork.pathId ? pathById.get(fork.pathId) : null;
      if (parentForkPath) parentForkPath.children.push(fork);
      else blocks.push(fork);
      index = endLine;
      continue;
    }

    // Path: one branch of a fork. Carries its own pick/reject status so a
    // rejected path collapses without touching its siblings.
    if (marker?.kind === "path") {
      const titleLine = index + 1;
      const path = {
        kind: "path",
        id: marker.id ?? `missing-${index + 1}`,
        markerLine: index,
        line: titleLine,
        title: stripLabel(linesSafe(lines, titleLine), "path"),
        // Raw status preserved so an invalid path status reaches lint (see step above).
        status: marker.status ?? "open",
        forkId: marker.fork ?? null,
        forkRef: marker.fork ?? null, // raw reference, preserved for lint
        children: [],
      };
      pathById.set(path.id, path);
      const fork = (path.forkId && forkById.get(path.forkId)) || forks[forks.length - 1];
      if (fork) {
        path.forkId = fork.id;
        fork.paths.push(path);
      }
      index = titleLine;
      continue;
    }

    if (isPseudocodeContinuationLine(line) && currentStep) {
      currentStep.text = `${currentStep.text}\n${line}`;
      currentStep.endLine = index;
      continue;
    }

    if (isTopLevelEditableStepLine(line)) {
      currentStep = {
        kind: "step",
        id: `step-${steps.length + 1}`,
        line: index,
        endLine: index,
        text: line,
        author: "user",
        status: "accept",
      };
      steps.push(currentStep);
      blocks.push(currentStep);
    }
  }

  return {
    markdown,
    lines,
    sections,
    steps,
    items,
    aiSteps,
    forks,
    blocks,
    workflow: workflowMarkers[0] ?? null,
    workflowMarkers,
  };
}

export function serializeGantryMarkdown(parsed, updates) {
  const lines = [...parsed.lines];

  // Freeform drafting path: when the client sends a raw `pseudocode` body, replace
  // the whole `## Pseudocode` section with it verbatim (no forced renumbering).
  // Only valid before any AI items/steps/forks exist — an annotated doc must never
  // lose its gate state through this path, so refuse the overwrite when present.
  if (typeof updates.pseudocode === "string") {
    const section = parsed.sections.get("pseudocode");
    if (!section) {
      throw statusError("Cannot draft: document has no ## Pseudocode section.", 422);
    }
    if (parsed.items.length > 0 || parsed.aiSteps.length > 0 || parsed.forks.length > 0) {
      throw statusError("Cannot overwrite pseudocode: document already has AI annotations.", 422);
    }
    const body = updates.pseudocode.replace(/\r\n/g, "\n").replace(/\s+$/g, "");
    const bodyLines = body.length ? body.split("\n") : [];
    lines.splice(section.start, section.end - section.start, "", ...bodyLines, "");
    return lines.join("\n");
  }

  const stepUpdates = new Map((updates.steps ?? []).map((step) => [step.id, step]));
  const itemUpdates = new Map((updates.items ?? []).map((item) => [item.id, item]));
  const aiStepUpdates = new Map((updates.aiSteps ?? []).map((step) => [step.id, step]));
  const forkUpdates = new Map((updates.forks ?? []).map((fork) => [fork.id, fork]));
  const pathUpdates = new Map((updates.paths ?? []).map((path) => [path.id, path]));

  // Plain (user) step text edits are single-line in place — no line shift.
  const edits = [];
  for (const step of parsed.steps) {
    const update = stepUpdates.get(step.id);
    if (update && typeof update.text === "string") {
      edits.push({ start: step.line, end: step.endLine ?? step.line, lines: stepTextLines(update.text) });
    }
  }

  // Every marked construct is a marker + content span. Collect the changed ones,
  // splice from the bottom up so earlier line indices stay valid.
  for (const item of parsed.items) {
    if (!itemUpdates.has(item.id)) continue;
    const next = { ...item, ...itemUpdates.get(item.id) };
    edits.push({ start: item.startLine, end: item.endLine, lines: renderItem(next) });
  }
  for (const step of parsed.aiSteps) {
    if (!aiStepUpdates.has(step.id)) continue;
    const next = { ...step, ...aiStepUpdates.get(step.id) };
    edits.push({ start: step.markerLine, end: step.endLine ?? step.line, lines: renderAiStep(next) });
  }
  for (const fork of parsed.forks) {
    if (forkUpdates.has(fork.id)) {
      const next = { ...fork, ...forkUpdates.get(fork.id) };
      edits.push({ start: fork.markerLine, end: fork.endLine ?? fork.line, lines: renderFork(next) });
    }
    for (const path of fork.paths) {
      if (!pathUpdates.has(path.id)) continue;
      const next = { ...path, ...pathUpdates.get(path.id) };
      edits.push({ start: path.markerLine, end: path.line, lines: renderPath(next) });
    }
  }

  edits.sort((a, b) => b.start - a.start);
  for (const edit of edits) {
    lines.splice(edit.start, edit.end - edit.start + 1, ...edit.lines);
  }

  return lines.join("\n");
}

export function lintGantryMarkdown(markdown, options = {}) {
  const parsed = parseGantryMarkdown(markdown);
  const errors = [];
  const seen = new Set();

  if (parsed.workflowMarkers.length > 1) {
    for (const marker of parsed.workflowMarkers.slice(1)) {
      errors.push(issue("duplicate-workflow", marker.line, "Only one gantry workflow marker is allowed."));
    }
  }
  if (parsed.workflow) {
    for (const [field, allowed] of Object.entries(WORKFLOW_FIELDS)) {
      const value = parsed.workflow[field];
      if (!allowed.has(value)) {
        errors.push(issue(
          "invalid-workflow",
          parsed.workflow.line,
          `Workflow field "${field}" must be one of: ${[...allowed].join(", ")}.`,
        ));
      }
    }
  }

  // Reference integrity for nesting: a step/fork that names a parent path, or a
  // path that names its fork, must point at a real node — otherwise the parser
  // silently un-nests it and the document is malformed.
  const forkIds = new Set(parsed.forks.map((fork) => fork.id));
  const pathIds = new Set(parsed.forks.flatMap((fork) => fork.paths.map((path) => path.id)));

  for (const item of parsed.items) {
    if (!item.markerLinePresent) {
      errors.push(issue("missing-id", item.itemLine, "AI item is missing a gantry id marker."));
    } else if (!ID_PATTERN.test(item.id)) {
      errors.push(issue("invalid-id", item.startLine, `Invalid gantry item id "${item.id}".`));
    } else if (seen.has(item.id)) {
      errors.push(issue("duplicate-id", item.startLine, `Duplicate gantry item id "${item.id}".`));
    }
    seen.add(item.id);

    if (!ITEM_TYPES.has(item.type)) {
      errors.push(issue("invalid-type", item.itemLine, `Invalid item type "${item.type}".`));
    }
    if (!STATUSES.has(item.status)) {
      errors.push(issue("invalid-status", item.itemLine, `Invalid status "${item.status}".`));
    }
    if (!item.stepId) {
      errors.push(issue("invalid-nesting", item.itemLine, "AI item must be nested under a pseudocode step."));
    }
    if (item.mode === "choice" && item.choices.length < 2) {
      errors.push(issue("invalid-options", item.itemLine, "Choice items must include at least two options."));
    }
    if (item.mode === "decision" && item.status.startsWith("choice-")) {
      errors.push(issue("invalid-status", item.itemLine, "Decision items cannot use an A/B/C status."));
    }
    if (item.mode === "choice" && ["accept", "reject"].includes(item.status)) {
      errors.push(issue("invalid-status", item.itemLine, "Choice items must resolve to option A, B, or C."));
    }
  }

  for (const step of parsed.aiSteps) {
    if (!ID_PATTERN.test(step.id)) {
      errors.push(issue("invalid-id", step.markerLine, `Invalid step id "${step.id}".`));
    } else if (seen.has(step.id)) {
      errors.push(issue("duplicate-id", step.markerLine, `Duplicate gantry id "${step.id}".`));
    }
    seen.add(step.id);
    if (!AUTHORS.has(step.author)) {
      errors.push(issue("invalid-author", step.markerLine, `Invalid step author "${step.author}".`));
    }
    if (!STEP_STATUSES.has(step.status)) {
      errors.push(issue("invalid-status", step.markerLine, `Invalid step status "${step.status}".`));
    }
    if (step.pathId && !pathIds.has(step.pathId)) {
      errors.push(issue("unknown-parent", step.markerLine, `Step references unknown path "${step.pathId}".`));
    }
  }

  for (const fork of parsed.forks) {
    if (!ID_PATTERN.test(fork.id)) {
      errors.push(issue("invalid-id", fork.markerLine, `Invalid fork id "${fork.id}".`));
    } else if (seen.has(fork.id)) {
      errors.push(issue("duplicate-id", fork.markerLine, `Duplicate gantry id "${fork.id}".`));
    }
    seen.add(fork.id);
    if (fork.paths.length < 2) {
      errors.push(issue("invalid-fork", fork.markerLine, "Fork must offer at least two paths."));
    } else if (!fork.paths.some(isMultiStepPath)) {
      // A fork is only justified when picking a path commits the engineer to a
      // genuine multi-step sub-flow. If every path is a single step (or empty)
      // with no nested fork, the decision is a one-answer pick — that's a choice
      // item (mode=choice), not a fork.
      errors.push(issue("fork-not-branching", fork.markerLine, "Fork has no multi-step path — use a choice item (mode=choice) instead."));
    }
    if (fork.pathId && !pathIds.has(fork.pathId)) {
      errors.push(issue("unknown-parent", fork.markerLine, `Nested fork references unknown path "${fork.pathId}".`));
    }
    const ownPathIds = new Set(fork.paths.map((path) => path.id));
    if (!(["open", "reject", "edit"].includes(fork.status) || ownPathIds.has(fork.status))) {
      errors.push(issue("invalid-status", fork.markerLine, `Fork status "${fork.status}" is not open, reject, edit, or one of its path ids.`));
    }
    for (const path of fork.paths) {
      if (!ID_PATTERN.test(path.id)) {
        errors.push(issue("invalid-id", path.markerLine, `Invalid path id "${path.id}".`));
      } else if (seen.has(path.id)) {
        errors.push(issue("duplicate-id", path.markerLine, `Duplicate gantry id "${path.id}".`));
      }
      seen.add(path.id);
      if (!PATH_STATUSES.has(path.status)) {
        errors.push(issue("invalid-status", path.markerLine, `Invalid path status "${path.status}".`));
      }
      if (path.forkRef && !forkIds.has(path.forkRef)) {
        errors.push(issue("unknown-parent", path.markerLine, `Path references unknown fork "${path.forkRef}".`));
      }
    }
  }

  if (options.gate) {
    if (!parsed.workflow) {
      errors.push(issue(
        "missing-workflow",
        0,
        "Code-writing gate requires a gantry workflow marker with explicit engineer review and implementation authorization.",
      ));
    } else {
      const required = {
        pseudocode: "approved",
        annotations: "complete",
        stabilization: "complete",
        implementation: "authorized",
      };
      for (const [field, expected] of Object.entries(required)) {
        if (parsed.workflow[field] !== expected) {
          errors.push(issue(
            "workflow-gate",
            parsed.workflow.line,
            `Workflow field "${field}" is "${parsed.workflow[field] ?? "missing"}"; code writing requires "${expected}".`,
          ));
        }
      }
    }

    // A step or fork left under a rejected path is moot — the engineer dropped that
    // branch, so its leftover marker (which serialization keeps as-is) must not trip
    // the gate. Resolve ancestry once and skip anything beneath a dropped path.
  }

  if (options.gate || options.review || options.model) {
    const pathById = new Map();
    const forkById = new Map();
    for (const fork of parsed.forks) {
      forkById.set(fork.id, fork);
      for (const path of fork.paths) pathById.set(path.id, path);
    }
    const live = (node) => !underRejectedPath(node, pathById, forkById);

    const gateTarget = options.gate
      ? "code writing"
      : options.model
      ? "model reconciliation"
      : "review readiness";
    const unresolvedItemStatuses = options.review ? ["open"] : ["open", "edit"];
    for (const item of parsed.items.filter((item) => unresolvedItemStatuses.includes(item.status))) {
      errors.push(issue("unresolved-gate", item.itemLine, `Unresolved ${item.type} item blocks ${gateTarget}.`));
    }
    const unresolvedStepStatuses = options.review ? ["open"] : ["open", "edit"];
    for (const step of parsed.aiSteps.filter((step) => unresolvedStepStatuses.includes(step.status) && live(step))) {
      errors.push(issue("unresolved-step", step.markerLine, `Unresolved AI step blocks ${gateTarget}.`));
    }
    for (const fork of parsed.forks.filter((fork) => fork.status === "open" && live(fork))) {
      errors.push(issue("unresolved-fork", fork.markerLine, "Unresolved fork blocks code writing — pick a path or drop it."));
    }
  }

  return { ok: errors.length === 0, errors, parsed };
}

export function ensureGantryIds(markdown) {
  const parsed = parseGantryMarkdown(markdown);
  const lines = [...parsed.lines];
  let counter = 1;
  const existing = new Set(parsed.items.map((item) => item.id).filter((id) => ID_PATTERN.test(id)));

  const itemsToMark = parsed.items.filter((item) => !item.markerLinePresent);
  const assigned = new Map();
  for (const item of itemsToMark) {
    let id;
    do {
      id = `gty-${String(counter).padStart(3, "0")}`;
      counter += 1;
    } while (existing.has(id));
    existing.add(id);
    assigned.set(item, id);
  }

  for (const item of [...itemsToMark].reverse()) {
    if (item.markerLinePresent) continue;
    const id = assigned.get(item);
    const mode = item.choices.length > 0 ? "choice" : "decision";
    lines.splice(item.itemLine, 0, markerFor({ ...item, id, mode }));
  }

  return lines.join("\n");
}

function findSections(lines) {
  const headings = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^(#{2,6})\s+(.+?)\s*$/.exec(lines[i]);
    if (match) headings.push({ level: match[1].length, title: normalizeHeading(match[2]), line: i });
  }

  const sections = new Map();
  for (let i = 0; i < headings.length; i += 1) {
    const heading = headings[i];
    let end = lines.length;
    for (let j = i + 1; j < headings.length; j += 1) {
      if (headings[j].level <= heading.level) {
        end = headings[j].line;
        break;
      }
    }
    sections.set(heading.title, { headingLine: heading.line, start: heading.line + 1, end });
  }
  return sections;
}

function normalizeHeading(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function readItem(lines, markerLine, itemLine, sectionEnd, step) {
  const marker = markerLine !== itemLine ? parseMarker(linesSafe(lines, markerLine)) : null;
  const itemMatch = /^(\s*)- \[([ xX])\]\s+\*\*([a-z]+):\*\*\s*(.*)$/.exec(linesSafe(lines, itemLine));
  const indent = itemMatch?.[1] ?? "";
  const type = itemMatch?.[3] ?? "unknown";
  const body = itemMatch?.[4] ?? "";
  const markerData = marker ?? {};
  const status = markerData.status ?? statusFromLine(itemMatch?.[2], body);
  const choices = [];
  const comments = [];
  let endLine = itemLine;

  for (let i = itemLine + 1; i < sectionEnd; i += 1) {
    const line = linesSafe(lines, i);
    if (parseMarker(line) || isItemLine(line) || isEditableStepLine(line)) break;
    if (/^\s*- [ABC]:\s*/.test(line)) {
      const [, key, text] = /^\s*- ([ABC]):\s*(.*)$/.exec(line);
      choices.push({ key, text });
    } else if (/^\s*- comment:\s*/.test(line)) {
      comments.push(line.replace(/^\s*- comment:\s*/, ""));
    } else if (/^\s{2,}.+/.test(line)) {
      comments.push(line.trim());
    }
    endLine = i;
  }

  return {
    id: markerData.id ?? `missing-${itemLine + 1}`,
    markerLinePresent: Boolean(marker),
    startLine: marker ? markerLine : itemLine,
    endLine,
    itemLine,
    indent,
    type,
    text: body.replace(/^\[(accept|reject|edit|choice-[abc])\]\s*/, ""),
    status,
    mode: markerData.mode ?? (choices.length > 0 ? "choice" : "decision"),
    choices,
    comments,
    stepId: step?.id ?? null,
  };
}

function renderItem(item) {
  const checkbox = item.status === "open" ? " " : "x";
  const badge = item.status === "open" ? "" : `[${item.status}] `;
  const lines = [
    markerFor(item),
    `${item.indent ?? ""}- [${checkbox}] **${item.type}:** ${badge}${item.text ?? ""}`.trimEnd(),
  ];
  for (const choice of item.choices ?? []) {
    lines.push(`  - ${choice.key}: ${choice.text}`);
  }
  for (const comment of item.comments ?? []) {
    if (comment.trim()) lines.push(`  - comment: ${comment.trim()}`);
  }
  return lines;
}

function renderAiStep(step) {
  // Write back whatever the engineer set; lint (and the server's pre-write gate)
  // reject invalid values rather than this renderer silently normalizing them.
  const author = step.author ?? "ai";
  const status = step.status ?? "open";
  const pathAttr = step.pathId ? ` path=${step.pathId}` : "";
  const out = [
    `<!-- gantry:step id=${step.id} author=${author} status=${status}${pathAttr} -->`,
    ...stepTextLines(step.text ?? ""),
  ];
  for (const comment of step.comments ?? []) {
    if (comment.trim()) out.push(`  - comment: ${comment.trim()}`);
  }
  return out;
}

function renderFork(fork) {
  const status = fork.status ?? "open";
  const pathAttr = fork.pathId ? ` path=${fork.pathId}` : "";
  const out = [
    `<!-- gantry:fork id=${fork.id} status=${status}${pathAttr} -->`,
    `fork: ${fork.title ?? ""}`.trimEnd(),
  ];
  for (const comment of fork.comments ?? []) {
    if (comment.trim()) out.push(`  - comment: ${comment.trim()}`);
  }
  return out;
}

function renderPath(path) {
  const status = path.status ?? "open";
  const forkAttr = path.forkId ? ` fork=${path.forkId}` : "";
  return [
    `<!-- gantry:path id=${path.id}${forkAttr} status=${status} -->`,
    `path: ${path.title ?? ""}`.trimEnd(),
  ];
}

function markerFor(item) {
  const mode = item.mode ?? ((item.choices?.length ?? 0) > 0 ? "choice" : "decision");
  return `<!-- gantry:item id=${item.id} type=${item.type} status=${item.status} mode=${mode} -->`;
}

function parseMarker(line) {
  const match = /^\s*<!--\s*gantry:(item|step|fork|path)\s+(.+?)\s*-->\s*$/.exec(line ?? "");
  if (!match) return null;
  const attrs = { kind: match[1] };
  for (const [, key, value] of match[2].matchAll(/([a-z]+)=("[^"]*"|[^\s]+)/g)) {
    attrs[key] = value.replace(/^"|"$/g, "");
  }
  return attrs;
}

function parseWorkflowMarker(line) {
  const match = /^\s*<!--\s*gantry:workflow\s+(.+?)\s*-->\s*$/.exec(line ?? "");
  if (!match) return null;
  const attrs = {};
  for (const [, key, value] of match[1].matchAll(/([a-z]+)=("[^"]*"|[^\s]+)/g)) {
    attrs[key] = value.replace(/^"|"$/g, "");
  }
  return attrs;
}

function isItemLine(line) {
  return /^\s*- \[[ xX]\]\s+\*\*[a-z]+:\*\*/.test(line ?? "");
}

function isEditableStepLine(line) {
  if (!line || !line.trim()) return false;
  if (/^\s*</.test(line)) return false;
  if (/^\s*>/.test(line)) return false; // blockquote = drafting guidance, not a step
  if (/^\s*- \[[ xX]\]/.test(line)) return false;
  if (/^\s*- (comment|[ABC]):/.test(line)) return false;
  if (/^#{1,6}\s/.test(line)) return false;
  return true;
}

function isTopLevelEditableStepLine(line) {
  return isEditableStepLine(line) && !/^\s+/.test(line ?? "");
}

function isPseudocodeContinuationLine(line) {
  if (!isEditableStepLine(line)) return false;
  return /^\s+(?:[-*+]\s+|(?:[0-9]+|[a-z]+|[ivxlcdm]+)[.)]\s+)/i.test(line);
}

function stepTextLines(text) {
  return String(text ?? "").replace(/\r\n/g, "\n").split("\n");
}

// Strip a leading `fork:` / `path:` label (with optional bold/list decoration)
// so the stored title is just the prose; render re-adds the canonical label.
function stripLabel(line, label) {
  const pattern = new RegExp(`^\\s*(?:- )?\\*{0,2}${label}\\*{0,2}\\s*:?\\s*`, "i");
  return line.replace(pattern, "").trim();
}

function statusFromLine(checkbox, body) {
  if ((checkbox ?? " ") === " ") return "open";
  const badge = /^\[(accept|reject|edit|choice-[abc])\]\s*/.exec(body);
  if (badge) return badge[1];
  if (/\breject(ed)?\b/i.test(body)) return "reject";
  return "accept";
}

function issue(code, line, message) {
  return { code, line: line + 1, message };
}

function statusError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function linesSafe(lines, index) {
  return lines[index] ?? "";
}

// A path is a genuine multi-step sub-flow when it owns two or more steps, or holds
// a nested fork (its own branching). A path with a single step (or none) is just a
// one-answer option — a choice, not a branch.
function isMultiStepPath(path) {
  const children = path.children ?? [];
  const stepCount = children.filter((child) => child.kind === "step").length;
  const hasNestedFork = children.some((child) => child.kind === "fork");
  return stepCount >= 2 || hasNestedFork;
}

// Walk a step/fork's ancestor chain (path → owning fork → that fork's path → …).
// Returns true if any path in the chain was rejected, meaning the node sits under
// a dropped branch and its own status is moot for the gate.
function underRejectedPath(node, pathById, forkById) {
  let pathId = node.pathId;
  while (pathId) {
    const path = pathById.get(pathId);
    if (!path) break;
    if (path.status === "reject") return true;
    const fork = path.forkId ? forkById.get(path.forkId) : null;
    pathId = fork ? fork.pathId : null;
  }
  return false;
}
