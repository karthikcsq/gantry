const slugInput = document.querySelector("#slug-input");
const slugForm = document.querySelector("#slug-form");
const stepsEl = document.querySelector("#steps");
const statusEl = document.querySelector("#status");
const docPathEl = document.querySelector("#doc-path");
const docTitleEl = document.querySelector("#doc-title");
const stepTotalEl = document.querySelector("#step-total");
const openTotalEl = document.querySelector("#open-total");
const resolvedTotalEl = document.querySelector("#resolved-total");
const queueTotalEl = document.querySelector("#queue-total");
const saveButton = document.querySelector("#save-button");
const lintButton = document.querySelector("#lint-button");
const structureMapEl = document.querySelector("#structure-map");
const structureSummaryEl = document.querySelector("#structure-summary");
const queueListEl = document.querySelector("#queue-list");
const gateLabelEl = document.querySelector("#gate-label");
const gateFillEl = document.querySelector("#gate-fill");

let model = null;
let slug = new URLSearchParams(location.search).get("slug") ?? "";
let activeStepId = null;

if (slug) {
  slugInput.value = slug;
  await openSlug(slug);
}

slugForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  slug = slugInput.value.trim();
  history.replaceState(null, "", `/?slug=${encodeURIComponent(slug)}`);
  await openSlug(slug);
});

saveButton.addEventListener("click", save);
lintButton.addEventListener("click", () => checkGate(true));

async function openSlug(nextSlug) {
  setStatus("Loading...", "");
  const response = await fetch(`/api/doc?slug=${encodeURIComponent(nextSlug)}`);
  const data = await response.json();
  if (!response.ok || !data.ok) {
    setStatus(data.error ?? "Could not load Gantry doc.", "error");
    model = null;
    activeStepId = null;
    renderEmptyShell();
    return;
  }

  slug = nextSlug;
  model = data;
  activeStepId = model.steps?.[0]?.id ?? null;
  docPathEl.textContent = `.gantry/${slug.endsWith(".md") ? slug : `${slug}.md`}`;
  docTitleEl.textContent = humanizeSlug(slug);
  render();
  summarizeLint(data.lint);
}

async function save() {
  if (!model) return;
  const payload = collectUpdates();
  setStatus("Saving...", "");
  const response = await fetch("/api/doc", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    const detail = data.errors?.map((error) => `${error.line}: ${error.message}`).join("\n");
    setStatus(detail || data.error || "Save failed. The markdown file was not updated.", "error");
    return;
  }

  model = { slug, ...data.doc };
  render();
  setStatus("Saved to markdown.", "ok");
}

async function checkGate(showSuccess) {
  if (!slug) return;
  const response = await fetch(`/api/lint?gate=1&slug=${encodeURIComponent(slug)}`);
  const data = await response.json();
  if (!response.ok || !data.ok) {
    const detail = data.errors?.map((error) => `${error.line}: ${error.message}`).join("\n");
    setStatus(detail || data.error || "Gate check failed.", "error");
  } else if (showSuccess) {
    setStatus("Gate clear. No unresolved Gantry items.", "ok");
  }
}

function render() {
  stepsEl.innerHTML = "";
  const itemsByStep = new Map();
  for (const item of model.items) {
    const list = itemsByStep.get(item.stepId) ?? [];
    list.push(item);
    itemsByStep.set(item.stepId, list);
  }

  if (!activeStepId || !model.steps.some((step) => step.id === activeStepId)) {
    activeStepId = model.steps[0]?.id ?? null;
  }

  model.steps.forEach((step, index) => {
    const stepEl = document.createElement("article");
    stepEl.className = "step";
    stepEl.dataset.stepId = step.id;
    if (step.id === activeStepId) stepEl.classList.add("active");

    const stepItems = itemsByStep.get(step.id) ?? [];
    const openItems = stepItems.filter((item) => !isResolved(item.status));

    const stepHead = document.createElement("div");
    stepHead.className = "step-head";
    stepHead.innerHTML = `
      <span class="step-number">${index + 1}</span>
      <span class="step-title">Step ${index + 1}</span>
      <span class="step-state ${openItems.length ? "needs-work" : "clear"}">
        ${openItems.length ? `${openItems.length} open` : "clear"}
      </span>
    `;
    stepEl.append(stepHead);

    const textarea = document.createElement("textarea");
    textarea.setAttribute("aria-label", `Pseudocode step ${index + 1}`);
    textarea.value = step.text;
    textarea.dataset.field = "step-text";
    textarea.addEventListener("focus", () => {
      activeStepId = step.id;
      highlightActiveStep();
    });
    stepEl.append(textarea);

    const itemsEl = document.createElement("div");
    itemsEl.className = "items";
    if (stepItems.length === 0) {
      itemsEl.innerHTML = '<div class="inline-empty">No AI gates attached to this step.</div>';
    }
    for (const item of stepItems) {
      itemsEl.append(renderItem(item));
    }
    stepEl.append(itemsEl);
    stepsEl.append(stepEl);
  });

  if (model.steps.length === 0) {
    stepsEl.innerHTML =
      '<div class="empty-state"><strong>No editable steps found.</strong><span>Add numbered pseudocode steps to the Pseudocode section, then reopen this doc.</span></div>';
  }

  renderStructure(itemsByStep);
  renderQueue(itemsByStep);
  renderGate();
}

function renderStructure(itemsByStep) {
  structureMapEl.innerHTML = "";
  const stats = modelStats();
  structureSummaryEl.innerHTML = `
    <div><strong>${stats.steps}</strong><span>steps</span></div>
    <div><strong>${stats.resolved}</strong><span>resolved</span></div>
    <div><strong>${stats.open}</strong><span>open</span></div>
    <div><strong>${stats.choices}</strong><span>choices</span></div>
  `;

  for (const [index, step] of model.steps.entries()) {
    const stepItems = itemsByStep.get(step.id) ?? [];
    const link = document.createElement("button");
    link.type = "button";
    link.className = "map-step";
    link.dataset.stepId = step.id;
    if (step.id === activeStepId) link.classList.add("active");
    const unresolved = stepItems.filter((item) => !isResolved(item.status)).length;
    if (step.id === activeStepId) {
      link.setAttribute("aria-current", "step");
    } else {
      link.removeAttribute("aria-current");
    }
    link.innerHTML = `
      <span class="map-index">${index + 1}</span>
      <span class="map-copy">
        <strong>${escapeHtml(shortStepText(step.text))}</strong>
        <span>${stepItems.length ? itemSummary(stepItems) : "No AI gates attached"}</span>
      </span>
      <span class="map-state ${unresolved ? "needs-work" : "clear"}">${unresolved || "clear"}</span>
    `;
    link.addEventListener("click", () => {
      activeStepId = step.id;
      highlightActiveStep();
      document.querySelector(`.step[data-step-id="${CSS.escape(step.id)}"]`)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      document.querySelector(`.step[data-step-id="${CSS.escape(step.id)}"] textarea`)?.focus({ preventScroll: true });
    });
    structureMapEl.append(link);
  }

  if (model.steps.length === 0) {
    structureMapEl.innerHTML =
      '<div class="empty-state compact"><strong>No steps yet.</strong><span>Numbered pseudocode lines become the blueprint.</span></div>';
  }
}

function renderQueue(itemsByStep) {
  queueListEl.innerHTML = "";
  const stepById = new Map(model.steps.map((step, index) => [step.id, { step, index }]));
  const openItems = model.items.filter((item) => !isResolved(item.status));
  queueTotalEl.textContent = String(openItems.length);

  if (openItems.length === 0) {
    queueListEl.innerHTML = `
      <div class="empty-state compact success">
        <strong>Gate is clear.</strong>
        <span>Every AI contribution has an explicit decision.</span>
      </div>
    `;
    return;
  }

  for (const item of openItems) {
    const stepInfo = stepById.get(item.stepId);
    const card = document.createElement("button");
    card.type = "button";
    card.className = `queue-item ${item.type}`;
    card.innerHTML = `
      <span class="queue-meta">
        <span class="badge badge-${item.type}">${labelForType(item.type)}</span>
        <span>Step ${stepInfo ? stepInfo.index + 1 : "?"}</span>
      </span>
      <strong>${escapeHtml(item.text)}</strong>
      <span>${escapeHtml(stepInfo ? shortStepText(stepInfo.step.text) : "No parent step")}</span>
    `;
    card.addEventListener("click", () => {
      const stepId = item.stepId;
      activeStepId = stepId;
      highlightActiveStep();
      document.querySelector(`.step[data-step-id="${CSS.escape(stepId)}"]`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      document.querySelector(`.item[data-item-id="${CSS.escape(item.id)}"]`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
    queueListEl.append(card);
  }
}

function renderGate() {
  const stats = modelStats();
  const ratio = stats.total === 0 ? 1 : stats.resolved / stats.total;
  gateFillEl.style.width = `${Math.round(ratio * 100)}%`;
  gateLabelEl.textContent =
    stats.open === 0
      ? "Ready for code writing"
      : `${stats.open} unresolved ${stats.open === 1 ? "item" : "items"}`;
  stepTotalEl.textContent = String(stats.steps);
  openTotalEl.textContent = String(stats.open);
  resolvedTotalEl.textContent = String(stats.resolved);
  queueTotalEl.textContent = String(stats.openItems);
  docTitleEl.textContent = humanizeSlug(slug);
}

function renderEmptyShell() {
  stepsEl.innerHTML = "";
  structureMapEl.innerHTML = "";
  structureSummaryEl.innerHTML = '<div class="summary-placeholder">Open a Gantry doc to map the workflow.</div>';
  queueListEl.innerHTML = `
    <div class="empty-state compact">
      <strong>No document loaded.</strong>
      <span>Open a slug to see blocking references, edge cases, and ripples.</span>
    </div>
  `;
  gateFillEl.style.width = "0%";
  gateLabelEl.textContent = "No document open";
  stepTotalEl.textContent = "0";
  openTotalEl.textContent = "0";
  resolvedTotalEl.textContent = "0";
  queueTotalEl.textContent = "0";
  docTitleEl.textContent = "No document open";
}

function renderItem(item) {
  const el = document.createElement("section");
  el.className = `item ${item.type} ${item.status}`;
  el.dataset.itemId = item.id;

  const head = document.createElement("div");
  head.className = "item-head";
  head.innerHTML = `
    <span class="badge badge-${item.type}">${labelForType(item.type)}</span>
    <span class="badge badge-${item.status}">${labelForStatus(item.status)}</span>
  `;
  el.append(head);

  const text = document.createElement("textarea");
  text.dataset.field = "item-text";
  text.setAttribute("aria-label", `${labelForType(item.type)} text`);
  text.value = item.text;
  el.append(text);

  if (item.mode === "choice") {
    const choices = document.createElement("div");
    for (const choice of item.choices) {
      const choiceEl = document.createElement("div");
      choiceEl.className = "choice";
      choiceEl.innerHTML = `<strong>${choice.key}</strong><span>${escapeHtml(choice.text)}</span>`;
      choices.append(choiceEl);
    }
    el.append(choices);

    const row = document.createElement("div");
    row.className = "choice-row";
    for (const status of ["choice-a", "choice-b", "choice-c"]) {
      const button = statusButton(status, item.status);
      row.append(button);
    }
    el.append(row);
  } else {
    const row = document.createElement("div");
    row.className = "decision-row";
    for (const status of ["open", "accept", "reject", "edit"]) {
      row.append(statusButton(status, item.status));
    }
    el.append(row);
  }

  const label = document.createElement("label");
  label.className = "comment-label";
  label.textContent = "Comments";
  const comments = document.createElement("textarea");
  comments.dataset.field = "comments";
  comments.setAttribute("aria-label", "Decision comments");
  comments.value = (item.comments ?? []).join("\n");
  el.append(label, comments);

  return el;
}

function statusButton(status, current) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.status = status;
  button.textContent = labelForStatus(status);
  if (status === current) button.classList.add("active");
  button.addEventListener("click", () => {
    const item = button.closest(".item");
    const original = model?.items.find((candidate) => candidate.id === item.dataset.itemId);
    const itemType = original?.type ?? "";
    item.dataset.status = status;
    if (original) original.status = status;
    item.className = `item ${itemType} ${status}`;
    item.querySelectorAll("button[data-status]").forEach((candidate) => {
      candidate.classList.toggle("active", candidate === button);
    });
    updateStepState(item.closest(".step"));
    refreshSidebars();
  });
  return button;
}

function updateStepState(stepEl) {
  if (!stepEl || !model) return;
  const stepItems = model.items.filter((item) => item.stepId === stepEl.dataset.stepId);
  const openItems = stepItems.filter((item) => !isResolved(item.status));
  const state = stepEl.querySelector(".step-state");
  if (!state) return;
  state.className = `step-state ${openItems.length ? "needs-work" : "clear"}`;
  state.textContent = openItems.length ? `${openItems.length} open` : "clear";
}

function refreshSidebars() {
  if (!model) return;
  const itemsByStep = new Map();
  for (const item of model.items) {
    const list = itemsByStep.get(item.stepId) ?? [];
    list.push(item);
    itemsByStep.set(item.stepId, list);
  }
  renderStructure(itemsByStep);
  renderQueue(itemsByStep);
  renderGate();
  highlightActiveStep();
}

function highlightActiveStep() {
  document.querySelectorAll(".step").forEach((stepEl) => {
    stepEl.classList.toggle("active", stepEl.dataset.stepId === activeStepId);
  });
  document.querySelectorAll(".map-step").forEach((mapStep) => {
    const isActive = mapStep.dataset.stepId === activeStepId;
    mapStep.classList.toggle("active", isActive);
    if (isActive) {
      mapStep.setAttribute("aria-current", "step");
    } else {
      mapStep.removeAttribute("aria-current");
    }
  });
}

function collectUpdates() {
  const steps = [...document.querySelectorAll(".step")].map((step) => ({
    id: step.dataset.stepId,
    text: step.querySelector('[data-field="step-text"]').value,
  }));
  const items = [...document.querySelectorAll(".item")].map((itemEl) => {
    const original = model.items.find((item) => item.id === itemEl.dataset.itemId);
    return {
      id: itemEl.dataset.itemId,
      text: itemEl.querySelector('[data-field="item-text"]').value,
      status: itemEl.dataset.status ?? activeStatus(itemEl) ?? original?.status,
      comments: itemEl
        .querySelector('[data-field="comments"]')
        .value.split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    };
  });
  return { slug, steps, items };
}

function activeStatus(itemEl) {
  return itemEl.querySelector("button.active")?.dataset.status;
}

function summarizeLint(errors) {
  if (!errors?.length) {
    setStatus("Loaded. Markdown format is valid.", "ok");
    return;
  }
  setStatus(errors.map((error) => `${error.line}: ${error.message}`).join("\n"), "error");
}

function setStatus(message, kind) {
  statusEl.textContent = message;
  statusEl.className = `status ${kind ?? ""}`;
}

function labelForStatus(status) {
  return {
    open: "Open",
    accept: "Approve",
    reject: "Reject",
    edit: "Needs change",
    "choice-a": "Choose A",
    "choice-b": "Choose B",
    "choice-c": "Choose C",
  }[status];
}

function modelStats() {
  const resolved = model.items.filter((item) => isResolved(item.status)).length;
  const openItems = model.items.length - resolved;
  return {
    steps: model.steps.length,
    total: model.items.length,
    resolved,
    open: openItems,
    openItems,
    choices: model.items.filter((item) => item.mode === "choice").length,
  };
}

function labelForType(type) {
  return {
    ref: "Reference",
    edge: "Edge case",
    mismatch: "Mismatch",
    ripple: "Ripple",
    update: "Update",
  }[type] ?? type;
}

function isResolved(status) {
  return ["accept", "reject", "edit", "choice-a", "choice-b", "choice-c"].includes(status);
}

function shortStepText(text) {
  return text.replace(/^\s*\d+\.\s*/, "").trim();
}

function itemSummary(items) {
  const counts = items.reduce((summary, item) => {
    summary[item.type] = (summary[item.type] ?? 0) + 1;
    return summary;
  }, {});
  return Object.entries(counts)
    .map(([type, count]) => `${count} ${labelForType(type).toLowerCase()}`)
    .join(", ");
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

function humanizeSlug(value) {
  const raw = (value ?? "").replace(/\.md$/i, "").trim();
  if (!raw) return "No document open";
  return raw
    .split(/[-_/]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
