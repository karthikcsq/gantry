const slugInput = document.querySelector("#slug-input");
const slugForm = document.querySelector("#slug-form");
const bufferEl = document.querySelector("#steps");
const statusEl = document.querySelector("#status");
const saveButton = document.querySelector("#save-button");
const lintButton = document.querySelector("#lint-button");
const gateLabelEl = document.querySelector("#gate-label");
const gateFillEl = document.querySelector("#gate-fill");
const overviewEl = document.querySelector("#overview");

let model = null;
let slug = new URLSearchParams(location.search).get("slug") ?? "";

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
  render();
  summarizeLint(data.lint);
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
  render();
  setStatus("saved", "ok");
}

async function checkGate(showSuccess) {
  if (!slug) return;
  const response = await fetch(`/api/lint?gate=1&slug=${encodeURIComponent(slug)}`);
  const data = await response.json();
  if (!response.ok || !data.ok) {
    const detail = data.errors?.map((error) => `${error.line}: ${error.message}`).join("; ");
    setStatus(detail || data.error || "gate failed", "error");
  } else if (showSuccess) {
    setStatus("gate clear", "ok");
  }
}

function render() {
  bufferEl.innerHTML = "";
  const itemsByStep = new Map();
  for (const item of model.items) {
    const list = itemsByStep.get(item.stepId) ?? [];
    list.push(item);
    itemsByStep.set(item.stepId, list);
  }

  renderDocumentLead();

  model.steps.forEach((step, index) => {
    const stepItems = itemsByStep.get(step.id) ?? [];
    bufferEl.append(renderStep(step, index, stepItems));
  });

  if (model.steps.length === 0) {
    const empty = line("plain", "No numbered pseudocode steps found.");
    bufferEl.append(empty);
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
  overviewEl.replaceChildren();

  const scrollable = document.documentElement.scrollHeight > window.innerHeight + 8;
  overviewEl.hidden = !scrollable || !model || model.steps.length === 0;
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
    num.textContent = `${index + 1}.`;
    row.append(num);

    if (openCount > 0) {
      const open = document.createElement("span");
      open.className = "ov-open";
      open.textContent = `${openCount} open`;
      row.append(open);
    }

    row.addEventListener("click", () => {
      const target = bufferEl.querySelector(`.step[data-step-id="${step.id}"]`);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    overviewEl.append(row);
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
  const title = lines.find((lineText) => /^#\s+/.test(lineText));
  const target = lines.find((lineText) => /^\*\*Target:\*\*/.test(lineText));

  if (title) bufferEl.append(line("heading h1", title));
  if (target) bufferEl.append(line("target", target));
  bufferEl.append(line("heading h2", "## Pseudocode"));
}

function renderStep(step, index, stepItems) {
  const block = document.createElement("section");
  block.className = "step";
  block.dataset.stepId = step.id;

  const stepLine = document.createElement("div");
  stepLine.className = "step-line";

  const number = document.createElement("span");
  number.className = "md-number";
  number.textContent = `${index + 1}.`;
  stepLine.append(number);

  const text = document.createElement("textarea");
  text.dataset.field = "step-text";
  text.setAttribute("aria-label", `Step ${index + 1}`);
  text.value = withoutNumber(step.text);
  autosize(text);
  text.addEventListener("input", () => autosize(text));
  stepLine.append(text);
  block.append(stepLine);

  for (const item of stepItems) block.append(renderItem(item));
  return block;
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
  type.textContent = `${item.type}:`;
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
  comments.placeholder = "  - comment:";
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
  bufferEl.append(line("heading h1", "# gantry"));
  bufferEl.append(line("target", "**Target:** open a .gantry markdown doc"));
  bufferEl.append(line("heading h2", "## Pseudocode"));
  bufferEl.append(line("plain", "1. Open a slug from the bottom bar."));
  renderGate();
}

function collectUpdates() {
  const steps = [...document.querySelectorAll(".step")].map((step, index) => ({
    id: step.dataset.stepId,
    text: `${index + 1}. ${step.querySelector('[data-field="step-text"]').value.trim()}`,
  }));
  const items = [...document.querySelectorAll(".gate-line")].map((itemEl) => ({
    id: itemEl.dataset.itemId,
    text: itemEl.querySelector('[data-field="item-text"]').value,
    status: itemEl.dataset.status,
    comments: itemEl
      .querySelector('[data-field="comments"]')
      .value.split("\n")
      .map((comment) => comment.replace(/^\s*-\s*comment:\s*/, "").trim())
      .filter(Boolean),
  }));
  return { slug, steps, items };
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
  statusEl.className = `status ${kind ?? ""}`;
}

function modelStats() {
  const open = model.items.filter((item) => effectiveStatus(item) === "open").length;
  const resolved = model.items.length - open;
  return { steps: model.steps.length, total: model.items.length, resolved, open };
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
