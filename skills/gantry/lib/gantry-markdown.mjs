const ITEM_TYPES = new Set(["ref", "edge", "ripple", "update", "mismatch"]);
const STATUSES = new Set(["open", "accept", "reject", "edit", "choice-a", "choice-b", "choice-c"]);
const ID_PATTERN = /^gty-[a-z0-9][a-z0-9-]*$/;

export { ITEM_TYPES, STATUSES, ID_PATTERN };

export function parseGantryMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const sections = findSections(lines);
  const pseudocode = sections.get("pseudocode") ?? { start: 0, end: lines.length };
  const items = [];
  const steps = [];
  let currentStep = null;

  for (let index = pseudocode.start; index < pseudocode.end; index += 1) {
    const line = lines[index];
    const itemStart = readItemStart(lines, index);
    if (itemStart) {
      const item = readItem(lines, itemStart.markerLine ?? index, itemStart.itemLine, pseudocode.end, currentStep);
      items.push(item);
      index = item.endLine;
      continue;
    }

    if (isEditableStepLine(line)) {
      currentStep = {
        id: `step-${steps.length + 1}`,
        line: index,
        text: line,
      };
      steps.push(currentStep);
    }
  }

  return { markdown, lines, sections, steps, items };
}

export function serializeGantryMarkdown(parsed, updates) {
  const lines = [...parsed.lines];
  const stepUpdates = new Map((updates.steps ?? []).map((step) => [step.id, step]));
  const itemUpdates = new Map((updates.items ?? []).map((item) => [item.id, item]));

  for (const step of parsed.steps) {
    const update = stepUpdates.get(step.id);
    if (update && typeof update.text === "string") {
      lines[step.line] = update.text;
    }
  }

  const changedItems = parsed.items
    .filter((item) => itemUpdates.has(item.id))
    .sort((a, b) => b.startLine - a.startLine);

  for (const item of changedItems) {
    const update = { ...item, ...itemUpdates.get(item.id) };
    const replacement = renderItem(update);
    lines.splice(item.startLine, item.endLine - item.startLine + 1, ...replacement);
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

  if (options.gate) {
    for (const item of parsed.items.filter((item) => item.status === "open")) {
      errors.push(issue("unresolved-gate", item.itemLine, `Unresolved ${item.type} item blocks code writing.`));
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

function readItemStart(lines, index) {
  const marker = parseMarker(lines[index]);
  if (marker && isItemLine(lines[index + 1])) {
    return { markerLine: index, itemLine: index + 1 };
  }
  if (isItemLine(lines[index])) {
    return { markerLine: null, itemLine: index };
  }
  return null;
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

function markerFor(item) {
  const mode = item.mode ?? ((item.choices?.length ?? 0) > 0 ? "choice" : "decision");
  return `<!-- gantry:item id=${item.id} type=${item.type} status=${item.status} mode=${mode} -->`;
}

function parseMarker(line) {
  const match = /^<!--\s*gantry:item\s+(.+?)\s*-->$/.exec(line ?? "");
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
  if (/^\s*- \[[ xX]\]/.test(line)) return false;
  if (/^\s*- (comment|[ABC]):/.test(line)) return false;
  if (/^#{1,6}\s/.test(line)) return false;
  return true;
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

function linesSafe(lines, index) {
  return lines[index] ?? "";
}
