const slugInput = document.querySelector("#slug-input");
const slugForm = document.querySelector("#slug-form");
const stepsEl = document.querySelector("#steps");
const rawEl = document.querySelector("#raw-markdown");
const statusEl = document.querySelector("#status");
const docPathEl = document.querySelector("#doc-path");
const saveButton = document.querySelector("#save-button");
const lintButton = document.querySelector("#lint-button");

let model = null;
let slug = new URLSearchParams(location.search).get("slug") ?? "";

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
    return;
  }
  slug = nextSlug;
  model = data;
  docPathEl.textContent = `.gantry/${slug.endsWith(".md") ? slug : `${slug}.md`}`;
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
  rawEl.textContent = model.markdown;
  const itemsByStep = new Map();
  for (const item of model.items) {
    const list = itemsByStep.get(item.stepId) ?? [];
    list.push(item);
    itemsByStep.set(item.stepId, list);
  }

  for (const step of model.steps) {
    const stepEl = document.createElement("article");
    stepEl.className = "step";
    stepEl.dataset.stepId = step.id;

    const textarea = document.createElement("textarea");
    textarea.value = step.text;
    textarea.dataset.field = "step-text";
    stepEl.append(textarea);

    const itemsEl = document.createElement("div");
    itemsEl.className = "items";
    for (const item of itemsByStep.get(step.id) ?? []) {
      itemsEl.append(renderItem(item));
    }
    stepEl.append(itemsEl);
    stepsEl.append(stepEl);
  }

  if (model.steps.length === 0) {
    stepsEl.innerHTML = '<div class="status">No editable pseudocode steps found in the Pseudocode section.</div>';
  }
}

function renderItem(item) {
  const el = document.createElement("section");
  el.className = `item ${item.type} ${item.status}`;
  el.dataset.itemId = item.id;

  const head = document.createElement("div");
  head.className = "item-head";
  head.innerHTML = `<span class="badge">${item.type}</span><span class="badge">${item.status}</span>`;
  el.append(head);

  const text = document.createElement("textarea");
  text.dataset.field = "item-text";
  text.value = item.text;
  el.append(text);

  if (item.mode === "choice") {
    const choices = document.createElement("div");
    for (const choice of item.choices) {
      const choiceEl = document.createElement("div");
      choiceEl.className = "choice";
      choiceEl.innerHTML = `<strong>${choice.key}</strong>${escapeHtml(choice.text)}`;
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
    item.dataset.status = status;
    item.querySelectorAll("button[data-status]").forEach((candidate) => {
      candidate.classList.toggle("active", candidate === button);
    });
  });
  return button;
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
      status: itemEl.dataset.status ?? activeStatus(itemEl) ?? original.status,
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

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}
