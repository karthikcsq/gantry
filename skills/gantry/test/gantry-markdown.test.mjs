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

test("round-trips unchanged markdown when no updates are applied", () => {
  const parsed = parseGantryMarkdown(validMarkdown);
  assert.equal(serializeGantryMarkdown(parsed, {}), validMarkdown);
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
