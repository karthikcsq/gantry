const slugInput = document.querySelector("#slug-input");
const slugForm = document.querySelector("#slug-form");
const bufferEl = document.querySelector("#steps");
const statusEl = document.querySelector("#status");
const saveButton = document.querySelector("#save-button");
const lintButton = document.querySelector("#lint-button");
const gateLabelEl = document.querySelector("#gate-label");
const gateFillEl = document.querySelector("#gate-fill");
const overviewEl = document.querySelector("#overview");
const overviewRowsEl = document.querySelector("#overview-rows");
const tabNameEl = document.querySelector("#tab-name");

let model = null;
let slug = new URLSearchParams(location.search).get("slug") ?? "";
// Gate items grouped by the step they annotate, rebuilt each render so the
// approval renderer can attach them inline (deep path-nested steps included).
let stepItemIndex = new Map();

if (slug) {
  slugInput.value = slug.replace(/\.md$/i, "");
  await openSlug(slug);
} else {
  renderEmptyShell();
}

slugForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  slug = slugInput.value.trim();
  history.replaceState(null, "", `/?slug=${encodeURIComponent(slug)}`);
  await openSlug(slug);
});

saveButton.addEventListener("click", save);
lintButton.addEventListener("click", () => checkGate(true));

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    save();
  }
});

window.addEventListener("scroll", updateActiveStep, { passive: true });
window.addEventListener("resize", buildOverview);

async function openSlug(nextSlug) {
  setStatus("loading", "");
  const response = await fetch(`/api/doc?slug=${encodeURIComponent(nextSlug)}`);
  const data = await response.json();
  if (!response.ok || !data.ok) {
    setStatus(data.error ?? "load failed", "error");
    model = null;
    renderEmptyShell();
    return;
  }

  slug = nextSlug;
  model = data;
  indexModel(model);
  render();
  summarizeLint(data.lint);
}

// Rebuild the flat AI-step/fork lists from the block tree so every list shares
// the same object references the renderer mutates on click. The server sends
// flat copies too, but JSON has no shared refs — driving everything off `blocks`
// keeps one source of truth for collectUpdates.
function indexModel(target) {
  const aiSteps = [];
  const forks = [];
  // Forks nest inside paths, so walk the tree recursively to collect every AI
  // step and fork (for gate stats + collectUpdates), sharing block references.
  const visitFork = (fork) => {
    forks.push(fork);
    for (const path of fork.paths ?? []) {
      for (const child of path.children ?? []) {
        if (child.kind === "fork") visitFork(child);
        else if (child.kind === "step" && child.author === "ai") aiSteps.push(child);
      }
    }
  };
  for (const block of target.blocks ?? []) {
    if (block.kind === "step" && block.author === "ai") aiSteps.push(block);
    else if (block.kind === "fork") visitFork(block);
  }
  target.aiSteps = aiSteps;
  target.forks = forks;
}

async function save() {
  if (!model) return;
  setStatus("saving", "");
  const response = await fetch("/api/doc", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(collectUpdates()),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    const detail = data.errors?.map((error) => `${error.line}: ${error.message}`).join("; ");
    setStatus(detail || data.error || "save failed", "error");
    return;
  }

  model = { slug, ...data.doc };
  indexModel(model);
  render();
  setStatus("saved", "ok");
}

async function checkGate(showSuccess) {
  if (!slug) return;
  const response = await fetch(`/api/lint?gate=1&slug=${encodeURIComponent(slug)}`);
  const data = await response.json();
  if (!response.ok || !data.ok) {
    // No red error spam in the bar — the white box + scroll to the first open
    // item is the feedback. Clear any stale status so nothing lingers.
    setStatus("", "");
    revealFirstOpen();
  } else if (showSuccess) {
    setStatus("gate clear", "ok");
  }
}

// Scroll to and draw a white box around the first unresolved gate component so a
// failed gate check points the engineer straight at what still needs a decision
// instead of leaving them to hunt. Components under a rejected path are moot (the
// branch was dropped) and skipped — matching the server gate, which skips them too.
function revealFirstOpen() {
  // Only the current first-open item carries the box — clear any prior one.
  document.querySelectorAll(".gate-highlight").forEach((el) => el.classList.remove("gate-highlight"));
  const target = firstOpenComponent();
  if (!target) return;
  // A rejected path renders collapsed, and a blocker can also sit inside a path the
  // engineer hand-collapsed — expand every collapsed ancestor so it's actually visible.
  for (let p = target.closest(".path.collapsed"); p; p = p.parentElement?.closest(".path.collapsed")) {
    p.classList.remove("collapsed");
  }
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.classList.add("gate-highlight");
}

// The first open gate component in document order — an open item, AI step, or fork
// not sitting under a rejected path. DOM order matches document order, so the first
// match is the topmost blocker.
function firstOpenComponent() {
  const open = document.querySelectorAll(
    '.gate-line[data-status="open"], .step.ai[data-status="open"], .fork[data-status="open"]'
  );
  for (const el of open) {
    if (el.closest('.path[data-status="reject"]')) continue;
    return el;
  }
  return null;
}

function render() {
  bufferEl.innerHTML = "";
  const itemsByStep = new Map();
  for (const item of model.items) {
    const list = itemsByStep.get(item.stepId) ?? [];
    list.push(item);
    itemsByStep.set(item.stepId, list);
  }
  stepItemIndex = itemsByStep;

  renderDocumentLead();

  // There are no "modes". A gantry doc is one thing: an ordered list of steps,
  // each with an `author` (user steps default to accepted, AI steps to open) and
  // any gate items the AI surfaced against them, plus forks. We always render that
  // one list (renderReview). The only exception is a blank doc with nothing written
  // yet — there's no list to render, so we show a freeform field to start writing.
  if (isEmptyDoc()) {
    bufferEl.append(renderFreeform());
  } else {
    renderReview();
  }

  renderGate();
  // Re-measure once elements have their real laid-out width, so long lines
  // wrap to their true height instead of being clipped from a 0-width measure.
  requestAnimationFrame(() => {
    bufferEl.querySelectorAll("textarea").forEach(autosize);
    buildOverview();
    // buildOverview may toggle .with-outline, changing the buffer width and
    // therefore how lines wrap — re-measure heights at the settled width.
    bufferEl.querySelectorAll("textarea").forEach(autosize);
  });
}

// Build the right-side step outline: a numbered row per pseudocode step with
// a count of how many gates are still open on it. Steps with nothing open
// collapse to a compact, dimmed number. Only shown when the document is tall
// enough to scroll. Clicking a row jumps to that step.
function buildOverview() {
  overviewRowsEl.replaceChildren();

  const scrollable = document.documentElement.scrollHeight > window.innerHeight + 8;
  // The outline maps numbered plain steps to per-step DOM. It's hidden for a blank
  // doc (nothing to jump to) and for AI-annotated docs (whose forks/AI steps the
  // simple numbered outline can't represent) — leaving it for plain step docs.
  overviewEl.hidden =
    !scrollable || !model || model.steps.length === 0 || isEmptyDoc() || hasDraftContent();
  bufferEl.classList.toggle("with-outline", !overviewEl.hidden);
  if (overviewEl.hidden) return;

  model.steps.forEach((step, index) => {
    const openCount = model.items.filter(
      (item) => item.stepId === step.id && effectiveStatus(item) === "open"
    ).length;

    const row = document.createElement("button");
    row.type = "button";
    row.className = `ov-row ${openCount > 0 ? "has-open" : "clear"}`;
    row.dataset.stepId = step.id;

    const num = document.createElement("span");
    num.className = "ov-num";
    num.textContent = `${index + 1}`;
    row.append(num);

    const text = document.createElement("span");
    text.className = "ov-text";
    text.textContent = withoutNumber(step.text) || "(empty step)";
    row.append(text);

    if (openCount > 0) {
      const badge = document.createElement("span");
      badge.className = "ov-badge";
      badge.textContent = String(openCount);
      badge.title = `${openCount} open gate${openCount === 1 ? "" : "s"}`;
      row.append(badge);
    }

    row.addEventListener("click", () => {
      const target = bufferEl.querySelector(`.step[data-step-id="${step.id}"]`);
      if (!target) return;
      // scrollIntoView lands the step at y=0, behind the fixed topbar. Offset by
      // the topbar height so the step clears it; the first step scrolls all the
      // way to the top so the document title stays visible.
      const offset = 48;
      const top = index === 0 ? 0 : target.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    });
    overviewRowsEl.append(row);
  });

  updateActiveStep();
}

// Highlight the outline row for the step currently at the top of the viewport.
function updateActiveStep() {
  if (overviewEl.hidden) return;
  const steps = [...bufferEl.querySelectorAll(".step")];
  let activeId = steps[0]?.dataset.stepId;
  for (const step of steps) {
    if (step.getBoundingClientRect().top <= 80) activeId = step.dataset.stepId;
  }
  overviewEl.querySelectorAll(".ov-row").forEach((row) => {
    row.classList.toggle("active", row.dataset.stepId === activeId);
  });
}

function renderDocumentLead() {
  const lines = model.markdown.replace(/\r\n/g, "\n").split("\n");
  const titleLine = lines.find((lineText) => /^#\s+/.test(lineText));
  const targetLine = lines.find((lineText) => /^\*\*Target:\*\*/.test(lineText));

  const title = titleLine ? titleLine.replace(/^#\s+/, "").trim() : slugName();
  setTabName(`${title}`);
  bufferEl.append(docTitle(title));
  if (targetLine) {
    bufferEl.append(metaRow("Target", targetLine.replace(/^\*\*Target:\*\*\s*/, "").trim()));
  }
  bufferEl.append(sectionHeader("Pseudocode", sectionCount()));
}

// The count chip next to the "Pseudocode" header: every step (either author) plus
// forks. Nothing while the doc is still blank.
function sectionCount() {
  if (isEmptyDoc()) return undefined;
  return (model.blocks ?? []).filter((block) => block.kind === "step").length + (model.forks?.length ?? 0);
}

function docTitle(text) {
  const el = document.createElement("h1");
  el.className = "doc-title";
  el.textContent = text;
  return el;
}

// A labelled metadata callout (e.g. "Target: …") rendered as a styled banner
// instead of leaving the raw **bold** markdown on screen.
function metaRow(label, body) {
  const row = document.createElement("p");
  row.className = "doc-target";
  const labelEl = document.createElement("span");
  labelEl.className = "doc-target-label";
  labelEl.textContent = label;
  const bodyEl = document.createElement("span");
  bodyEl.className = "doc-target-text";
  bodyEl.textContent = body;
  row.append(labelEl, bodyEl);
  return row;
}

// A section divider: tracked uppercase label + count + a hairline rule, in
// place of a literal "## Pseudocode" markdown line.
function sectionHeader(title, count) {
  const header = document.createElement("div");
  header.className = "section-header";
  const label = document.createElement("span");
  label.className = "section-label";
  label.textContent = title;
  header.append(label);
  if (typeof count === "number") {
    const countEl = document.createElement("span");
    countEl.className = "section-count";
    countEl.textContent = `${count} step${count === 1 ? "" : "s"}`;
    header.append(countEl);
  }
  const rule = document.createElement("span");
  rule.className = "section-rule";
  header.append(rule);
  return header;
}

function setTabName(title) {
  tabNameEl.textContent = `${title.replace(/\.md$/i, "")}.md`;
}

function slugName() {
  return (slug || "untitled").replace(/\.md$/i, "");
}

// A blank doc — nothing authored yet (no steps of either author, no forks, no
// gate items). There's no list to render, so the freeform field is shown as the
// starting surface for writing pseudocode. Everything else renders the one list.
function isEmptyDoc() {
  if (!model) return true;
  const steps = (model.steps?.length ?? 0) + (model.aiSteps?.length ?? 0);
  return steps === 0 && (model.forks?.length ?? 0) === 0 && model.items.length === 0;
}

// True once the AI has drafted steps or forks — used only to decide whether the
// step outline (which maps to plain numbered steps) is meaningful, not as a mode.
function hasDraftContent() {
  return Boolean(model) && ((model.aiSteps?.length ?? 0) > 0 || (model.forks?.length ?? 0) > 0);
}

// A single freeform field for the whole Pseudocode section. The engineer writes
// loosely — prose, their own numbering, or none; we persist it verbatim.
function renderFreeform() {
  const wrap = document.createElement("section");
  wrap.className = "draft";

  const text = document.createElement("textarea");
  text.className = "freeform";
  text.dataset.field = "pseudocode-freeform";
  text.setAttribute("aria-label", "Pseudocode draft");
  text.placeholder =
    "Write your pseudocode here — freeform. One idea per line; number them or not, your call.";
  text.value = pseudocodeBody(model.markdown);
  autosize(text);
  text.addEventListener("input", () => autosize(text));
  wrap.append(text);
  return wrap;
}

// Slice the raw text of the `## Pseudocode` section out of the markdown, dropping
// scaffold placeholder lines like `<empty — engineer writes here>` so a fresh doc
// opens to a blank field.
function pseudocodeBody(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i += 1) {
    if (start < 0) {
      if (/^##\s+pseudocode\s*$/i.test(lines[i])) start = i + 1;
    } else if (/^#{1,6}\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }
  if (start < 0) return "";
  return lines
    .slice(start, end)
    .filter((text) => !/^\s*<.*>\s*$/.test(text))
    .join("\n")
    .trim();
}

// ---- The one rendered view: the doc's steps, forks, and gate items ----------

// Every line is a step. A user step is already approved and renders plainly; an
// AI step is identical except it carries accept/reject/edit controls until you
// resolve it. Steps are numbered in document order; forks sit inline; a run of
// consecutive AI steps shares one block-scoped "approve all"; gate items render
// beneath the step they annotate.
function renderReview() {
  const blocks = model.blocks ?? [];
  let number = 0;
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    if (block.kind === "fork") {
      bufferEl.append(renderForkBlock(block));
      i += 1;
      continue;
    }
    if (block.author === "ai") {
      const run = [];
      while (i < blocks.length && blocks[i].kind === "step" && blocks[i].author === "ai") {
        run.push(blocks[i]);
        i += 1;
      }
      bufferEl.append(renderStepRun(run, number + 1));
      number += run.length;
    } else {
      number += 1;
      bufferEl.append(renderReviewStep(block, number));
      i += 1;
    }
  }

  // Safety net: an item whose stepId matches no step in the tree (malformed or
  // stale reference) would otherwise render nowhere and silently vanish — surface
  // it at the end so the gate count and the visible doc never disagree.
  const rendered = new Set([...(model.aiSteps ?? []), ...(model.steps ?? [])].map((step) => step.id));
  for (const item of model.items.filter((item) => !rendered.has(item.stepId))) {
    bufferEl.append(renderItem(item));
  }
}

// A contiguous run of AI steps gets ONE approve-all, scoped to just this block —
// never the whole doc. Steps still number continuously with the rest.
function renderStepRun(run, startNumber) {
  const wrap = document.createElement("section");
  wrap.className = "step-run";

  const pending = run.filter((step) => effectiveStepStatus(step) === "open").length;
  const head = document.createElement("div");
  head.className = "run-head";
  const approveAll = document.createElement("button");
  approveAll.type = "button";
  approveAll.className = "approve-all";
  approveAll.textContent = pending ? `Approve all (${pending})` : "All resolved";
  approveAll.disabled = pending === 0;
  approveAll.addEventListener("click", () => {
    for (const step of run) {
      if (effectiveStepStatus(step) === "open") step.status = "accept";
    }
    render();
  });
  head.append(approveAll);
  wrap.append(head);

  run.forEach((step, idx) => wrap.append(renderReviewStep(step, startNumber + idx)));
  return wrap;
}

// One step. Renders exactly like a normal numbered pseudocode step. The only
// difference for an AI step: accept ✓ / reject × controls in the gutter and a
// comment box (a non-empty comment is a proposed edit). User steps get neither —
// they're already the engineer's design. Pass number=null for a path-nested step.
function renderReviewStep(step, number) {
  const block = document.createElement("section");
  block.className = "step";
  block.dataset.stepId = step.id;
  const ai = step.author === "ai";
  if (ai) {
    block.classList.add("ai");
    block.dataset.status = effectiveStepStatus(step);
  }

  const stepLine = document.createElement("div");
  stepLine.className = "step-line";

  if (ai) {
    const controls = document.createElement("div");
    controls.className = "controls";
    controls.append(stepStatusButton("accept", step), stepStatusButton("reject", step));
    stepLine.append(controls);
  }

  // Top-level steps are numbered; path-nested steps (number=null) carry no
  // number or bullet — they read as the body of the path they sit under.
  if (number != null) {
    const num = document.createElement("span");
    num.className = "md-number";
    num.textContent = `${number}`;
    stepLine.append(num);
  }

  const text = document.createElement("textarea");
  text.dataset.field = ai ? "ai-step-text" : "user-step-text";
  text.dataset.stepId = step.id;
  text.setAttribute("aria-label", `Step ${number ?? ""}`);
  text.value = withoutNumber(step.text);
  autosize(text);
  text.addEventListener("input", () => {
    autosize(text);
    step.text = text.value;
  });
  stepLine.append(text);
  block.append(stepLine);

  if (ai) {
    const comments = document.createElement("textarea");
    comments.className = "comments";
    comments.dataset.field = "step-comments";
    comments.setAttribute("aria-label", "Step comments");
    comments.placeholder = "Add a comment or proposed edit…";
    comments.value = (step.comments ?? []).join("\n");
    autosize(comments);
    comments.addEventListener("input", () => {
      autosize(comments);
      step.comments = comments.value.split("\n").map((line) => line.trim()).filter(Boolean);
      // Update state in place — re-rendering would steal focus mid-type.
      const effective = effectiveStepStatus(step);
      block.dataset.status = effective;
      block.querySelectorAll(".step-line .decision").forEach((control) => {
        control.classList.toggle("active", control.dataset.status === effective);
      });
      renderGate();
    });
    block.append(comments);
  }

  // Gate items the AI surfaced against this step (ref/edge/feat/ripple) render
  // inline beneath it — same per-step gate view annotation mode uses — so a
  // rebuild/forward doc that carries both steps and items shows everything.
  for (const item of stepItemIndex.get(step.id) ?? []) block.append(renderItem(item));
  return block;
}

// Mirrors effectiveStatus for items: accept/reject win; otherwise a non-empty
// comment is a proposed edit; otherwise the step is still open.
function effectiveStepStatus(step) {
  if (step.status === "accept" || step.status === "reject") return step.status;
  return (step.comments ?? []).some((comment) => comment.trim().length > 0) ? "edit" : "open";
}

function stepStatusButton(nextStatus, step) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `decision ${nextStatus}`;
  button.dataset.status = nextStatus;
  button.textContent = nextStatus === "accept" ? "✓" : "×";
  button.title = nextStatus === "accept" ? "Approve" : "Reject";
  button.setAttribute("aria-label", button.title);
  button.classList.toggle("active", nextStatus === effectiveStepStatus(step));
  button.addEventListener("click", () => {
    step.status = step.status === nextStatus ? "open" : nextStatus;
    render();
  });
  return button;
}

// A fork: the branch decision. Header carries the question + a "drop fork"
// reject that collapses every path under it. Unresolved until a path is picked.
function renderForkBlock(fork, depth = 0) {
  const wrap = document.createElement("section");
  wrap.className = "fork";
  wrap.dataset.forkId = fork.id;
  wrap.dataset.status = forkStateName(fork);
  // Nesting depth drives the pink intensity; it cycles every 3 levels so deep
  // nesting deepens then resets to base instead of compounding indefinitely.
  wrap.dataset.depth = String(depth % 3);

  const head = document.createElement("div");
  head.className = "fork-head";
  const chip = document.createElement("span");
  chip.className = "fork-chip";
  chip.textContent = "fork";
  head.append(chip);

  const title = document.createElement("textarea");
  title.dataset.field = "fork-title";
  title.setAttribute("aria-label", "Fork question");
  title.value = fork.title;
  autosize(title);
  title.addEventListener("input", () => {
    autosize(title);
    fork.title = title.value;
  });
  head.append(title);

  const drop = document.createElement("button");
  drop.type = "button";
  drop.className = "fork-drop";
  const dropped = fork.status === "reject";
  drop.textContent = dropped ? "Undo drop" : "Drop fork";
  drop.title = dropped
    ? "Restore this fork"
    : "Reject the whole fork and everything under it";
  drop.addEventListener("click", () => {
    if (fork.status === "reject") {
      fork.status = "open";
      for (const path of fork.paths) path.status = "open";
    } else {
      fork.status = "reject";
      for (const path of fork.paths) {
        path.status = "reject";
        rejectBranch(path);
      }
    }
    render();
  });
  head.append(drop);
  wrap.append(head);

  const paths = document.createElement("div");
  paths.className = "paths";
  fork.paths.forEach((path, index) => paths.append(renderPath(fork, path, index, depth)));
  wrap.append(paths);

  // Propose a different path. A non-empty comment resolves the fork (edit) — the
  // engineer is saying "none of these, do this instead." It does NOT auto-pick
  // a remaining option.
  const comments = document.createElement("textarea");
  comments.className = "comments fork-comment";
  comments.dataset.field = "fork-comments";
  comments.setAttribute("aria-label", "Propose another path");
  comments.placeholder = "Propose another path…";
  comments.value = (fork.comments ?? []).join("\n");
  autosize(comments);
  comments.addEventListener("input", () => {
    autosize(comments);
    fork.comments = comments.value.split("\n").map((line) => line.trim()).filter(Boolean);
    wrap.dataset.status = forkStateName(fork);
    renderGate();
  });
  wrap.append(comments);
  return wrap;
}

// One branch of a fork. Pick promotes it (and rejects siblings); reject collapses
// it. Rejecting one path no longer auto-picks the other — you may reject both and
// propose a third in the fork comment. A rejected path collapses to its title.
function renderPath(fork, path, index, depth = 0) {
  const key = String.fromCharCode(65 + index);
  const isPicked = path.status === "pick";
  const isRejected = path.status === "reject";

  const sec = document.createElement("section");
  sec.className = "path";
  sec.dataset.pathId = path.id;
  sec.dataset.status = isPicked ? "pick" : isRejected ? "reject" : "open";
  if (isRejected) sec.classList.add("collapsed");

  const head = document.createElement("div");
  head.className = "path-head";

  const pick = document.createElement("button");
  pick.type = "button";
  pick.className = "path-pick";
  pick.textContent = "✓";
  pick.title = "Pick this path";
  pick.classList.toggle("active", isPicked);
  pick.addEventListener("click", () => choosePath(fork, path, "pick"));

  const reject = document.createElement("button");
  reject.type = "button";
  reject.className = "path-reject";
  reject.textContent = "×";
  reject.title = "Reject this path";
  reject.classList.toggle("active", isRejected);
  reject.addEventListener("click", () => choosePath(fork, path, "reject"));
  head.append(pick, reject);

  // The option's key (A/B/C…) as a highlighted chip, like the "fork" chip — so
  // each option reads as a distinct labelled branch, not just prose.
  const chip = document.createElement("span");
  chip.className = "path-chip";
  chip.textContent = key;
  head.append(chip);

  const title = document.createElement("textarea");
  title.dataset.field = "path-title";
  title.setAttribute("aria-label", `Path ${key}`);
  title.value = stripPathKey(path.title);
  autosize(title);
  title.addEventListener("input", () => {
    autosize(title);
    path.title = title.value;
  });
  head.append(title);

  const expand = document.createElement("button");
  expand.type = "button";
  expand.className = "path-expand";
  expand.textContent = "▸";
  expand.title = "Show / hide this path";
  expand.addEventListener("click", () => sec.classList.toggle("collapsed"));
  head.append(expand);
  sec.append(head);

  const body = document.createElement("div");
  body.className = "path-body";
  const children = path.children ?? [];
  if (children.length === 0) {
    body.append(line("plain", "(no steps under this path yet)"));
  } else {
    // A path holds steps and, recursively, nested forks (one level deeper).
    for (const child of children) {
      body.append(child.kind === "fork" ? renderForkBlock(child, depth + 1) : renderReviewStep(child, null));
    }
  }
  sec.append(body);
  return sec;
}

// Resolve a fork. Picking a path rejects its siblings. Rejecting a path collapses
// ONLY that path — it never auto-picks a survivor, so you can reject every option
// and propose a new one in the fork comment. Re-clicking a selected control
// returns it to open. fork.status tracks the picked path id (or open).
function choosePath(fork, path, action) {
  if (action === "pick") {
    if (path.status === "pick") {
      fork.status = "open";
      for (const candidate of fork.paths) candidate.status = "open";
    } else {
      fork.status = path.id;
      for (const candidate of fork.paths) {
        const picked = candidate.id === path.id;
        candidate.status = picked ? "pick" : "reject";
        // Picking one path drops its siblings — cascade the drop onto their child
        // steps/forks so the whole branch resolves instead of leaving open markers
        // that still trip the gate. The picked branch keeps its own review states.
        if (!picked) rejectBranch(candidate);
      }
    }
  } else {
    const nowRejected = path.status !== "reject";
    path.status = nowRejected ? "reject" : "open";
    if (nowRejected) rejectBranch(path);
    // Fork is "picked" only if some path is explicitly pick; otherwise open.
    const picked = fork.paths.find((candidate) => candidate.status === "pick");
    fork.status = picked ? picked.id : "open";
  }
  render();
}

// Cascade a drop onto everything beneath a path: child AI steps and nested forks
// (and the paths under those forks) are marked rejected too, so dropping a branch
// resolves its whole subtree instead of leaving orphaned open markers that still
// trip the gate. One-directional by design — reviving a branch returns its paths
// to open and lets the engineer re-review the steps rather than silently undoing
// approvals that may have been deliberate.
function rejectBranch(path) {
  for (const child of path.children ?? []) {
    if (child.kind === "step" && child.author === "ai") {
      child.status = "reject";
    } else if (child.kind === "fork") {
      child.status = "reject";
      for (const sub of child.paths ?? []) {
        sub.status = "reject";
        rejectBranch(sub);
      }
    }
  }
}

// A fork resolves by picking a path, dropping it, or proposing a different path
// in a comment (edit). Anything else is still open and blocks the gate.
function effectiveForkStatus(fork) {
  if (fork.paths.some((path) => path.id === fork.status)) return "pick";
  if (fork.status === "reject") return "drop";
  if ((fork.comments ?? []).some((comment) => comment.trim().length > 0)) return "edit";
  return "open";
}

function forkStateName(fork) {
  const resolution = effectiveForkStatus(fork);
  return resolution === "open"
    ? "open"
    : resolution === "drop"
    ? "dropped"
    : resolution === "edit"
    ? "proposed"
    : "resolved";
}

// Strip a leading option key ("A — ", "B: ", "C -") from a path title — the key
// now lives in the chip, so the title is just the description.
function stripPathKey(title) {
  return (title ?? "").replace(/^\s*[A-Za-z]\s*[—–:-]\s+/, "").trim();
}

function renderItem(item) {
  const row = document.createElement("section");
  row.dataset.itemId = item.id;

  const head = document.createElement("div");
  head.className = "gate-head";
  row.append(head);

  const controls = document.createElement("div");
  controls.className = "controls";
  if (item.mode === "choice") {
    for (const choice of item.choices) controls.append(choiceButton(choice, item.status));
  } else {
    controls.append(statusButton("accept", item.status), statusButton("reject", item.status));
  }
  head.append(controls);

  const type = document.createElement("span");
  type.className = `md-type ${item.type}`;
  type.textContent = item.type;
  head.append(type);

  const text = document.createElement("textarea");
  text.dataset.field = "item-text";
  text.setAttribute("aria-label", `${item.type} gate`);
  text.value = item.text;
  autosize(text);
  text.addEventListener("input", () => autosize(text));
  head.append(text);

  if (item.mode === "choice") {
    const choices = document.createElement("div");
    choices.className = "choice-lines";
    for (const choice of item.choices) {
      choices.append(line("choice", `  - ${choice.key}: ${choice.text}`));
    }
    row.append(choices);
  }

  const comments = document.createElement("textarea");
  comments.className = "comments";
  comments.dataset.field = "comments";
  comments.setAttribute("aria-label", "Gate comments");
  comments.placeholder = "Add a comment or proposed edit…";
  comments.value = (item.comments ?? []).join("\n");
  autosize(comments);
  comments.addEventListener("input", () => {
    autosize(comments);
    item.comments = comments.value.split("\n").map((comment) => comment.trim()).filter(Boolean);
    applyItemState(row, item);
    renderGate();
  });
  row.append(comments);

  applyItemState(row, item);
  return row;
}

// A gate is open only when it is neither accepted/rejected nor carries a
// proposed edit. A non-empty comment on an open gate is a proposed edit, so it
// resolves to the "edit" state. accept/reject/choice from the buttons win.
function applyItemState(row, item) {
  const effective = effectiveStatus(item);
  row.dataset.status = effective;
  row.className = `gate-line ${item.type} ${effective}`;
}

function effectiveStatus(item) {
  if (item.status === "accept" || item.status === "reject") return item.status;
  if (item.status.startsWith("choice-")) return item.status;
  // "open" or a bare "edit" flag: only resolved when there is an actual
  // proposed edit (a comment). An edit flag with no proposal is still open.
  return hasProposedEdit(item) ? "edit" : "open";
}

function hasProposedEdit(item) {
  return (item.comments ?? []).some((comment) => comment.trim().length > 0);
}

function statusButton(nextStatus, current) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `decision ${nextStatus}`;
  button.dataset.status = nextStatus;
  button.textContent = nextStatus === "accept" ? "✓" : "×";
  button.title = nextStatus === "accept" ? "Approve" : "Reject";
  button.setAttribute("aria-label", button.title);
  button.classList.toggle("active", nextStatus === current);
  button.addEventListener("click", () => setItemStatus(button, nextStatus));
  return button;
}

function choiceButton(choice, current) {
  const nextStatus = `choice-${choice.key.toLowerCase()}`;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "decision choice-button";
  button.dataset.status = nextStatus;
  button.textContent = choice.key;
  button.title = `Choose ${choice.key}`;
  button.setAttribute("aria-label", button.title);
  button.classList.toggle("active", nextStatus === current);
  button.addEventListener("click", () => setItemStatus(button, nextStatus));
  return button;
}

function setItemStatus(button, nextStatus) {
  const row = button.closest(".gate-line");
  const original = model?.items.find((candidate) => candidate.id === row.dataset.itemId);
  // Clicking the already-selected control deselects it back to open.
  const deselect = original?.status === nextStatus;
  if (original) {
    original.status = deselect ? "open" : nextStatus;
    applyItemState(row, original);
  }
  row.querySelectorAll("button[data-status]").forEach((candidate) => {
    candidate.classList.toggle("active", !deselect && candidate === button);
  });
  renderGate();
}

function renderGate() {
  if (!model) {
    gateFillEl.style.width = "0%";
    return;
  }
  const stats = modelStats();
  const ratio = stats.total === 0 ? 1 : stats.resolved / stats.total;
  gateFillEl.style.width = `${Math.round(ratio * 100)}%`;
  gateLabelEl.textContent = stats.open === 0 ? "gate clear" : `${stats.open} open`;
  gateFillEl.style.background = stats.open === 0 ? "var(--green)" : "var(--orange)";
  buildOverview();
}

function renderEmptyShell() {
  bufferEl.innerHTML = "";
  setTabName("untitled");
  bufferEl.append(docTitle("gantry"));
  bufferEl.append(metaRow("Target", "Open a .gantry markdown doc to begin."));
  bufferEl.append(sectionHeader("Pseudocode"));
  bufferEl.append(line("plain", "Open a slug from the bottom bar."));
  renderGate();
}

function collectUpdates() {
  // A blank doc is authored through the freeform field; the server replaces the
  // whole Pseudocode section with it verbatim. No structured round-trip yet.
  const freeform = document.querySelector('[data-field="pseudocode-freeform"]');
  if (freeform) {
    return { slug, pseudocode: freeform.value };
  }

  // One unified payload for the one rendered list: user steps carry text; AI steps
  // carry text + status + comments; forks/paths carry their resolution; gate items
  // carry their decision. The block tree is mutated in place on click/input, and
  // items are read from their rendered gate-lines.
  return {
    slug,
    steps: (model.blocks ?? [])
      .filter((block) => block.kind === "step" && block.author === "user")
      .map((block) => ({ id: block.id, text: block.text })),
    aiSteps: model.aiSteps.map((step) => ({
      id: step.id,
      text: step.text,
      status: effectiveStepStatus(step),
      comments: step.comments ?? [],
    })),
    forks: model.forks.map((fork) => ({
      id: fork.id,
      // Persist "edit" when the fork is resolved by a proposed-path comment;
      // otherwise the picked-path id, "reject", or "open".
      status: effectiveForkStatus(fork) === "edit" ? "edit" : fork.status,
      title: fork.title,
      comments: fork.comments ?? [],
    })),
    paths: model.forks.flatMap((fork) =>
      fork.paths.map((path) => ({
        id: path.id,
        status: path.status,
        title: path.title,
        forkId: fork.id,
      })),
    ),
    items: [...document.querySelectorAll(".gate-line")].map((itemEl) => ({
      id: itemEl.dataset.itemId,
      text: itemEl.querySelector('[data-field="item-text"]').value,
      status: itemEl.dataset.status,
      comments: itemEl
        .querySelector('[data-field="comments"]')
        .value.split("\n")
        .map((comment) => comment.replace(/^\s*-\s*comment:\s*/, "").trim())
        .filter(Boolean),
    })),
  };
}

function summarizeLint(errors) {
  if (!errors?.length) {
    setStatus("loaded", "ok");
    return;
  }
  setStatus(errors.map((error) => `${error.line}: ${error.message}`).join("; "), "error");
}

function setStatus(message, kind) {
  statusEl.textContent = message;
  // The bar clips long gate errors to one line; expose the full text on hover.
  statusEl.title = message;
  statusEl.className = `status ${kind ?? ""}`;
}

function modelStats() {
  const aiSteps = model.aiSteps ?? [];
  const forks = model.forks ?? [];
  // Steps/forks beneath a rejected path are moot — the branch was dropped — so they
  // count as resolved, matching the server gate. (Counts in total, not in open.)
  const { pathById, forkById } = pathLookup(model);
  const live = (node) => !underRejectedPath(node, pathById, forkById);
  const openItems = model.items.filter((item) => effectiveStatus(item) === "open").length;
  const openSteps = aiSteps.filter((step) => live(step) && effectiveStepStatus(step) === "open").length;
  const openForks = forks.filter((fork) => live(fork) && effectiveForkStatus(fork) === "open").length;
  const open = openItems + openSteps + openForks;
  const total = model.items.length + aiSteps.length + forks.length;
  return { steps: model.steps.length, total, resolved: total - open, open };
}

// Index every path and fork by id so a node's ancestry can be walked. Mirrors the
// server's gate logic so the meter and the gate agree on what's still open.
function pathLookup(model) {
  const pathById = new Map();
  const forkById = new Map();
  for (const fork of model.forks ?? []) {
    forkById.set(fork.id, fork);
    for (const path of fork.paths ?? []) pathById.set(path.id, path);
  }
  return { pathById, forkById };
}

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

function line(className, text) {
  const el = document.createElement("div");
  el.className = `md-line ${className}`;
  el.textContent = text;
  return el;
}

function withoutNumber(text) {
  return text.replace(/^\s*\d+\.\s*/, "");
}

function autosize(textarea) {
  textarea.style.height = "0px";
  textarea.style.height = `${textarea.scrollHeight}px`;
}
