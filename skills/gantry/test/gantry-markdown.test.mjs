import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  ensureGantryIds,
  lintGantryMarkdown,
  parseGantryMarkdown,
  serializeGantryMarkdown,
} from "../lib/gantry-markdown.mjs";

const validMarkdown = `# vendor-search

**Target:** add vendor search

## Pseudocode

1. Read the query from the request.
<!-- gantry:item id=gty-ref-query type=ref status=open mode=decision -->
- [ ] **ref:** should this use \`searchParams\` or the parsed body?
  - comment: confirm route shape
2. Search vendors by name.
<!-- gantry:item id=gty-edge-empty type=edge status=choice-b mode=choice -->
- [x] **edge:** [choice-b] what happens for an empty query?
  - A: return all vendors
  - B: return no vendors
  - C: throw validation error

## Code (as written 2026-06-13 @ abc123)

empty
`;

const emptyScaffold = `# vendor-search

**Target:** add vendor search

## Pseudocode

<empty — engineer writes here>

## Code (as written <date> @ <commit>)

<empty until code-write phase>
`;

const draftMarkdown = `# clean-cut

**Target:** tighten a talking-head video

## Pseudocode

<!-- gantry:step id=gty-cc-args author=ai status=open -->
Parse args; require ffmpeg + whisper.
<!-- gantry:fork id=gty-cc-takes status=open -->
fork: Detect & cut repeated takes?
<!-- gantry:path id=gty-cc-takes-a fork=gty-cc-takes status=open -->
path: A — LLM adjudication
<!-- gantry:step id=gty-cc-a1 author=ai status=open path=gty-cc-takes-a -->
Cluster restarts → emit cuts.
<!-- gantry:path id=gty-cc-takes-b fork=gty-cc-takes status=open -->
path: B — deterministic fuzzy n-gram
<!-- gantry:step id=gty-cc-b1 author=ai status=open path=gty-cc-takes-b -->
Slide window → cut earlier span.
<!-- gantry:step id=gty-cc-render author=ai status=open -->
Merge cuts → render one pass.

## Code (as written 2026-06-16 @ none)

empty
`;

test("round-trips unchanged markdown when no updates are applied", () => {
  const parsed = parseGantryMarkdown(validMarkdown);
  assert.equal(serializeGantryMarkdown(parsed, {}), validMarkdown);
});

test("round-trips a givens/forks draft unchanged", () => {
  const parsed = parseGantryMarkdown(draftMarkdown);
  assert.equal(serializeGantryMarkdown(parsed, {}), draftMarkdown);
});

test("parses givens, forks, and nested paths into ordered blocks", () => {
  const parsed = parseGantryMarkdown(draftMarkdown);
  assert.equal(parsed.aiSteps.length, 4);
  assert.equal(parsed.forks.length, 1);

  const fork = parsed.forks[0];
  assert.equal(fork.id, "gty-cc-takes");
  assert.equal(fork.status, "open");
  assert.equal(fork.paths.length, 2);
  assert.equal(fork.paths[0].id, "gty-cc-takes-a");
  assert.equal(fork.paths[0].steps.length, 1);
  assert.equal(fork.paths[0].steps[0].id, "gty-cc-a1");

  // Top-level blocks: step, fork, step (path-nested steps stay under the fork).
  assert.deepEqual(parsed.blocks.map((b) => b.kind), ["step", "fork", "step"]);
});

test("AI steps accept, reject, and edit (comment) the same way items do", () => {
  const parsed = parseGantryMarkdown(draftMarkdown);
  const next = serializeGantryMarkdown(parsed, {
    aiSteps: [
      { id: "gty-cc-args", status: "accept" },
      { id: "gty-cc-render", status: "edit", comments: ["render twice instead"] },
    ],
  });
  assert.match(next, /id=gty-cc-args author=ai status=accept/);
  assert.match(next, /id=gty-cc-render author=ai status=edit/);
  assert.match(next, /^  - comment: render twice instead$/m);

  // A given with a comment re-parses with its comment attached.
  const reparsed = parseGantryMarkdown(next);
  const render = reparsed.aiSteps.find((given) => given.id === "gty-cc-render");
  assert.deepEqual(render.comments, ["render twice instead"]);
});

test("picking a fork path records pick/reject and a resolved fork status", () => {
  const parsed = parseGantryMarkdown(draftMarkdown);
  const next = serializeGantryMarkdown(parsed, {
    forks: [{ id: "gty-cc-takes", status: "gty-cc-takes-a" }],
    paths: [
      { id: "gty-cc-takes-a", status: "pick" },
      { id: "gty-cc-takes-b", status: "reject" },
    ],
  });
  assert.match(next, /gantry:fork id=gty-cc-takes status=gty-cc-takes-a/);
  assert.match(next, /id=gty-cc-takes-a fork=gty-cc-takes status=pick/);
  assert.match(next, /id=gty-cc-takes-b fork=gty-cc-takes status=reject/);
});

test("gate blocks on unresolved givens and forks, clears when resolved", () => {
  const blocked = lintGantryMarkdown(draftMarkdown, { gate: true });
  assert.equal(blocked.ok, false);
  assert(blocked.errors.some((error) => error.code === "unresolved-step"));
  assert(blocked.errors.some((error) => error.code === "unresolved-fork"));

  // accept/reject/edit all clear a given; picking a path clears the fork.
  const resolved = draftMarkdown
    .replace(/author=ai status=open/g, "author=ai status=accept")
    .replace("gantry:fork id=gty-cc-takes status=open", "gantry:fork id=gty-cc-takes status=gty-cc-takes-a");
  const clear = lintGantryMarkdown(resolved, { gate: true });
  assert.equal(clear.ok, true, JSON.stringify(clear.errors));
});

test("a fork comment proposes a path, persists, and resolves the gate (edit)", () => {
  const parsed = parseGantryMarkdown(draftMarkdown);
  const next = serializeGantryMarkdown(parsed, {
    forks: [{ id: "gty-cc-takes", status: "edit", comments: ["neither — use scene-cut detection"] }],
    // every step accepted so only the fork's resolution is under test
    aiSteps: parsed.aiSteps.map((step) => ({ id: step.id, status: "accept" })),
  });
  assert.match(next, /gantry:fork id=gty-cc-takes status=edit/);
  assert.match(next, /^  - comment: neither — use scene-cut detection$/m);

  const reparsed = parseGantryMarkdown(next);
  assert.deepEqual(reparsed.forks[0].comments, ["neither — use scene-cut detection"]);

  // status=edit clears the fork half of the gate.
  const gate = lintGantryMarkdown(next, { gate: true });
  assert.equal(gate.ok, true, JSON.stringify(gate.errors));
});

test("lint rejects a fork with fewer than two paths", () => {
  const bad = `# x

## Pseudocode

<!-- gantry:fork id=gty-solo status=open -->
fork: only one branch?
<!-- gantry:path id=gty-solo-a fork=gty-solo status=open -->
path: A — the only option
`;
  const result = lintGantryMarkdown(bad);
  assert(result.errors.some((error) => error.code === "invalid-fork"));
});

test("updates steps, decisions, choices, and comments", () => {
  const parsed = parseGantryMarkdown(validMarkdown);
  const next = serializeGantryMarkdown(parsed, {
    steps: [{ id: "step-1", text: "1. Read the normalized query from the request." }],
    items: [
      {
        id: "gty-ref-query",
        status: "accept",
        text: "use `request.nextUrl.searchParams`.",
        comments: ["route is GET-only"],
      },
      {
        id: "gty-edge-empty",
        status: "choice-c",
        comments: ["empty query should fail loudly"],
      },
    ],
  });

  assert.match(next, /1\. Read the normalized query from the request\./);
  assert.match(next, /status=accept/);
  assert.match(next, /\[accept\] use `request\.nextUrl\.searchParams`\./);
  assert.match(next, /comment: route is GET-only/);
  assert.match(next, /status=choice-c/);
  assert.match(next, /comment: empty query should fail loudly/);
});

test("freeform drafting replaces the Pseudocode body verbatim", () => {
  const parsed = parseGantryMarkdown(emptyScaffold);
  const next = serializeGantryMarkdown(parsed, {
    pseudocode: "Read the query.\nSearch vendors by name.\n- maybe sort by rating",
  });

  // Body written verbatim — no forced "1." renumbering, placeholder gone.
  assert.match(
    next,
    /## Pseudocode\n\nRead the query\.\nSearch vendors by name\.\n- maybe sort by rating\n\n## Code/,
  );
  assert.doesNotMatch(next, /engineer writes here/);
});

test("a saved freeform body re-parses into anchorable steps", () => {
  const parsed = parseGantryMarkdown(emptyScaffold);
  const next = serializeGantryMarkdown(parsed, {
    pseudocode: "Read the query.\nSearch vendors by name.",
  });

  const reparsed = parseGantryMarkdown(next);
  assert.equal(reparsed.steps.length, 2);
  assert.equal(reparsed.steps[0].text, "Read the query.");
  assert.equal(reparsed.steps[1].text, "Search vendors by name.");
});

test("freeform path refuses to overwrite an annotated doc", () => {
  const parsed = parseGantryMarkdown(validMarkdown);
  assert.throws(
    () => serializeGantryMarkdown(parsed, { pseudocode: "wipe everything" }),
    /already has AI annotations/,
  );
});

test("lint catches missing ids, invalid statuses, nesting, and unresolved gate items", () => {
  const bad = `# bad

## Pseudocode

- [ ] **ref:** no step and no id
<!-- gantry:item id=bad id2=x type=edge status=maybe mode=decision -->
- [x] **edge:** unsupported status
`;
  const result = lintGantryMarkdown(bad, { gate: true });
  assert.equal(result.ok, false);
  assert(result.errors.some((error) => error.code === "missing-id"));
  assert(result.errors.some((error) => error.code === "invalid-id"));
  assert(result.errors.some((error) => error.code === "invalid-status"));
  assert(result.errors.some((error) => error.code === "invalid-nesting"));
  assert(result.errors.some((error) => error.code === "unresolved-gate"));
});

test("id migration assigns stable ids in visual order", () => {
  const migrated = ensureGantryIds(`# sample

## Pseudocode

1. First step
   - [x] **ref:** [accept] first item
2. Second step
   - [x] **edge:** [edit] second item
`);

  assert.match(migrated, /id=gty-001 type=ref/);
  assert.match(migrated, /id=gty-002 type=edge/);
  assert(migrated.indexOf("gty-001") < migrated.indexOf("gty-002"));
});

test("server reads and writes only the requested gantry doc", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "gantry-editor-"));
  await mkdir(path.join(root, ".gantry"));
  await writeFile(path.join(root, ".gantry", "sample.md"), validMarkdown, "utf8");
  await writeFile(path.join(root, ".gantry", "other.md"), "# other\n", "utf8");

  const child = spawn(process.execPath, [
    "skills/gantry/scripts/gantry-editor.mjs",
    "serve",
    "--root",
    root,
    "--slug",
    "sample",
    "--no-open",
  ], { cwd: path.resolve("."), stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => child.kill());

  const port = await new Promise((resolve, reject) => {
    child.stderr.on("data", (data) => reject(new Error(data.toString())));
    child.stdout.on("data", (data) => {
      const match = /http:\/\/127\.0\.0\.1:(\d+)/.exec(data.toString());
      if (match) resolve(match[1]);
    });
  });

  const read = await fetch(`http://127.0.0.1:${port}/api/doc?slug=sample`).then((res) => res.json());
  assert.equal(read.ok, true);
  assert.equal(read.items.length, 2);

  const write = await fetch(`http://127.0.0.1:${port}/api/doc`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      slug: "sample",
      items: [{ id: "gty-ref-query", status: "reject", comments: ["not needed"] }],
    }),
  }).then((res) => res.json());

  assert.equal(write.ok, true);
  assert.match(await readFile(path.join(root, ".gantry", "sample.md"), "utf8"), /status=reject/);
  assert.equal(await readFile(path.join(root, ".gantry", "other.md"), "utf8"), "# other\n");
});

test("server saves a freeform pseudocode draft into an empty scaffold", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "gantry-editor-"));
  await mkdir(path.join(root, ".gantry"));
  await writeFile(path.join(root, ".gantry", "draft.md"), emptyScaffold, "utf8");

  const child = spawn(process.execPath, [
    "skills/gantry/scripts/gantry-editor.mjs",
    "serve",
    "--root",
    root,
    "--slug",
    "draft",
    "--no-open",
  ], { cwd: path.resolve("."), stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => child.kill());

  const port = await new Promise((resolve, reject) => {
    child.stderr.on("data", (data) => reject(new Error(data.toString())));
    child.stdout.on("data", (data) => {
      const match = /http:\/\/127\.0\.0\.1:(\d+)/.exec(data.toString());
      if (match) resolve(match[1]);
    });
  });

  const write = await fetch(`http://127.0.0.1:${port}/api/doc`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ slug: "draft", pseudocode: "Read the query.\nSearch vendors by name." }),
  }).then((res) => res.json());

  assert.equal(write.ok, true);
  const saved = await readFile(path.join(root, ".gantry", "draft.md"), "utf8");
  assert.match(saved, /Read the query\.\nSearch vendors by name\./);
  assert.doesNotMatch(saved, /engineer writes here/);
});
