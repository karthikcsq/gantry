const ITEM_TYPES = new Set(["ref", "edge", "feat", "ripple", "update", "mismatch"]);
const STATUSES = new Set(["open", "accept", "reject", "edit", "choice-a", "choice-b", "choice-c"]);
const AUTHORS = new Set(["user", "ai"]);
// An AI-authored step resolves with the same vocabulary as a decision item:
// open until the engineer accepts, rejects, or proposes an edit (a comment).
const STEP_STATUSES = new Set(["open", "accept", "reject", "edit"]);
const PATH_STATUSES = new Set(["open", "pick", "reject"]);
const ID_PATTERN = /^gty-[a-z0-9][a-z0-9-]*$/;

export { ITEM_TYPES, STATUSES, AUTHORS, STEP_STATUSES, PATH_STATUSES, ID_PATTERN };

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
  let currentStep = null;

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
      let endLine = textLine;
      for (let i = textLine + 1; i < pseudocode.end; i += 1) {
        const sub = linesSafe(lines, i);
        if (!sub.trim() || parseMarker(sub) || isItemLine(sub) || isEditableStepLine(sub)) break;
        if (/^\s*- comment:\s*/.test(sub)) comments.push(sub.replace(/^\s*- comment:\s*/, ""));
        else if (/^\s{2,}.+/.test(sub)) comments.push(sub.trim());
        endLine = i;
      }
      const step = {
        kind: "step",
        id: marker.id ?? `missing-${index + 1}`,
        markerLine: index,
        line: textLine,
        endLine,
        text: linesSafe(lines, textLine),
        author: AUTHORS.has(marker.author) ? marker.author : "ai",
        status: STEP_STATUSES.has(marker.status) ? marker.status : "open",
        comments,
        pathId: marker.path ?? null,
      };
      aiSteps.push(step);
      const parentPath = step.pathId ? pathById.get(step.pathId) : null;
      if (parentPath) parentPath.steps.push(step);
      else blocks.push(step);
      currentStep = { id: step.id, line: textLine, text: step.text };
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
        paths: [],
      };
      forks.push(fork);
      forkById.set(fork.id, fork);
      blocks.push(fork);
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
        status: PATH_STATUSES.has(marker.status) ? marker.status : "open",
        forkId: marker.fork ?? null,
        steps: [],
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

    if (isEditableStepLine(line)) {
      currentStep = { id: `step-${steps.length + 1}`, line: index, text: line };
      steps.push(currentStep);
      blocks.push({ kind: "step", id: currentStep.id, line: index, text: line, author: "user", status: "accept" });
    }
  }

  return { markdown, lines, sections, steps, items, aiSteps, forks, blocks };
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
  for (const step of parsed.steps) {
    const update = stepUpdates.get(step.id);
    if (update && typeof update.text === "string") {
      lines[step.line] = update.text;
    }
  }

  // Every marked construct is a marker + content span. Collect the changed ones,
  // splice from the bottom up so earlier line indices stay valid.
  const edits = [];
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
    }
    const pathIds = new Set(fork.paths.map((path) => path.id));
    if (!(["open", "reject", "edit"].includes(fork.status) || pathIds.has(fork.status))) {
      errors.push(issue("invalid-status", fork.markerLine, `Fork status "${fork.status}" is not open, reject, edit, or a path id.`));
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
    }
  }

  if (options.gate) {
    for (const item of parsed.items.filter((item) => item.status === "open")) {
      errors.push(issue("unresolved-gate", item.itemLine, `Unresolved ${item.type} item blocks code writing.`));
    }
    for (const step of parsed.aiSteps.filter((step) => step.status === "open")) {
      errors.push(issue("unresolved-step", step.markerLine, "Unresolved AI step blocks code writing."));
    }
    for (const fork of parsed.forks.filter((fork) => fork.status === "open")) {
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
  const author = AUTHORS.has(step.author) ? step.author : "ai";
  const status = STEP_STATUSES.has(step.status) ? step.status : "open";
  const pathAttr = step.pathId ? ` path=${step.pathId}` : "";
  const out = [
    `<!-- gantry:step id=${step.id} author=${author} status=${status}${pathAttr} -->`,
    step.text ?? "",
  ];
  for (const comment of step.comments ?? []) {
    if (comment.trim()) out.push(`  - comment: ${comment.trim()}`);
  }
  return out;
}

function renderFork(fork) {
  const status = fork.status ?? "open";
  const out = [
    `<!-- gantry:fork id=${fork.id} status=${status} -->`,
    `fork: ${fork.title ?? ""}`.trimEnd(),
  ];
  for (const comment of fork.comments ?? []) {
    if (comment.trim()) out.push(`  - comment: ${comment.trim()}`);
  }
  return out;
}

function renderPath(path) {
  const status = PATH_STATUSES.has(path.status) ? path.status : "open";
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
