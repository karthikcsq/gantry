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

<!-- gantry:workflow pseudocode=pending annotations=pending stabilization=pending implementation=pending -->

## Pseudocode

<!-- gantry:step id=gty-cc-args author=ai status=open -->
Parse args; require ffmpeg + whisper.
<!-- gantry:fork id=gty-cc-takes status=open -->
fork: Detect & cut repeated takes?
<!-- gantry:path id=gty-cc-takes-a fork=gty-cc-takes status=open -->
path: A — LLM adjudication
<!-- gantry:step id=gty-cc-a1 author=ai status=open path=gty-cc-takes-a -->
Cluster restarts via LLM adjudication.
<!-- gantry:step id=gty-cc-a2 author=ai status=open path=gty-cc-takes-a -->
Keep the last take in each cluster; emit cuts.
<!-- gantry:path id=gty-cc-takes-b fork=gty-cc-takes status=open -->
path: B — deterministic fuzzy n-gram
<!-- gantry:step id=gty-cc-b1 author=ai status=open path=gty-cc-takes-b -->
Slide an n-gram window over the transcript.
<!-- gantry:step id=gty-cc-b2 author=ai status=open path=gty-cc-takes-b -->
Cut the earlier span over the similarity threshold.
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
  assert.equal(parsed.aiSteps.length, 6);
  assert.equal(parsed.forks.length, 1);

  const fork = parsed.forks[0];
  assert.equal(fork.id, "gty-cc-takes");
  assert.equal(fork.status, "open");
  assert.equal(fork.paths.length, 2);
  assert.equal(fork.paths[0].id, "gty-cc-takes-a");
  assert.equal(fork.paths[0].children.length, 2);
  assert.equal(fork.paths[0].children[0].id, "gty-cc-a1");

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
    .replace("gantry:fork id=gty-cc-takes status=open", "gantry:fork id=gty-cc-takes status=gty-cc-takes-a")
    .replace(
      "pseudocode=pending annotations=pending stabilization=pending implementation=pending",
      "pseudocode=approved annotations=complete stabilization=complete implementation=authorized",
    );
  const clear = lintGantryMarkdown(resolved, { gate: true });
  assert.equal(clear.ok, true, JSON.stringify(clear.errors));
});

test("gate fails closed when AI writes plain pseudocode without engineer approval", () => {
  const unreviewedAiSynthesis = `# retrieval-workbench

**Target:** add a local retrieval workbench

## Pseudocode

1. Add a local HTTP server.
2. Show retrieved evidence and the model response.

## Code

Pending translation.
`;
  const result = lintGantryMarkdown(unreviewedAiSynthesis, { gate: true });
  assert.equal(result.ok, false);
  assert(result.errors.some((error) => error.code === "missing-workflow"));
});

test("gate requires review, completed checks, and separate implementation authorization", () => {
  const states = `# guarded

**Target:** prove workflow state is enforced

<!-- gantry:workflow pseudocode=approved annotations=complete stabilization=complete implementation=pending -->

## Pseudocode

Engineer-reviewed step.
`;
  const blocked = lintGantryMarkdown(states, { gate: true });
  assert.equal(blocked.ok, false);
  assert(blocked.errors.some(
    (error) => error.code === "workflow-gate" && /implementation/.test(error.message),
  ));

  const authorized = states.replace("implementation=pending", "implementation=authorized");
  assert.equal(lintGantryMarkdown(authorized, { gate: true }).ok, true);
});

test("gate ignores an open AI step left under a rejected path", () => {
  const rejectedPathMarkdown = `# rejected-path-gate

**Target:** dropped branches must not trip the gate

<!-- gantry:workflow pseudocode=approved annotations=complete stabilization=complete implementation=authorized -->

## Pseudocode

<!-- gantry:step id=gty-rp-args author=ai status=accept -->
Parse args.
<!-- gantry:fork id=gty-rp-takes status=gty-rp-takes-b -->
fork: which approach?
<!-- gantry:path id=gty-rp-takes-a fork=gty-rp-takes status=reject -->
path: A — rejected approach
<!-- gantry:step id=gty-rp-a1 author=ai status=open path=gty-rp-takes-a -->
Leftover open marker under the dropped path.
<!-- gantry:step id=gty-rp-a2 author=ai status=open path=gty-rp-takes-a -->
Another leftover open step under the dropped path.
<!-- gantry:path id=gty-rp-takes-b fork=gty-rp-takes status=pick -->
path: B — chosen approach
<!-- gantry:step id=gty-rp-b1 author=ai status=accept path=gty-rp-takes-b -->
Chosen step one, approved.
<!-- gantry:step id=gty-rp-b2 author=ai status=accept path=gty-rp-takes-b -->
Chosen step two, approved.

## Code (as written 2026-06-18 @ none)

empty
`;
  const result = lintGantryMarkdown(rejectedPathMarkdown, { gate: true });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert(!result.errors.some((error) => error.code === "unresolved-step"));
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
  const authorized = next.replace(
    "pseudocode=pending annotations=pending stabilization=pending implementation=pending",
    "pseudocode=approved annotations=complete stabilization=complete implementation=authorized",
  );
  const gate = lintGantryMarkdown(authorized, { gate: true });
  assert.equal(gate.ok, true, JSON.stringify(gate.errors));
});

test("nests a fork inside a path and round-trips it", () => {
  const md = `# nested

## Pseudocode

<!-- gantry:fork id=gty-outer status=open -->
fork: outer?
<!-- gantry:path id=gty-outer-a fork=gty-outer status=open -->
path: option A
<!-- gantry:step id=gty-s1 author=ai status=open path=gty-outer-a -->
a step under A
<!-- gantry:fork id=gty-inner status=open path=gty-outer-a -->
fork: inner under A?
<!-- gantry:path id=gty-inner-x fork=gty-inner status=open -->
path: X
<!-- gantry:step id=gty-s2 author=ai status=open path=gty-inner-x -->
deep step under X
<!-- gantry:path id=gty-inner-y fork=gty-inner status=open -->
path: Y
<!-- gantry:path id=gty-outer-b fork=gty-outer status=open -->
path: option B
`;
  const parsed = parseGantryMarkdown(md);
  // Two forks total (flat), one nested under outer's path A.
  assert.equal(parsed.forks.length, 2);
  assert.equal(parsed.blocks.length, 1); // only the outer fork is top-level
  const outerA = parsed.forks.find((f) => f.id === "gty-outer").paths[0];
  assert.deepEqual(outerA.children.map((c) => `${c.kind}:${c.id}`), ["step:gty-s1", "fork:gty-inner"]);
  assert.equal(parsed.aiSteps.length, 2);

  // Round-trips with the nested fork's path= attribute intact.
  assert.equal(serializeGantryMarkdown(parsed, {}), md);
});

test("lint flags dangling parent references that break nesting", () => {
  const bad = `# x

## Pseudocode

<!-- gantry:fork id=gty-f status=open -->
fork: pick?
<!-- gantry:path id=gty-f-a fork=gty-nope status=open -->
path: A
<!-- gantry:path id=gty-f-b fork=gty-f status=open -->
path: B
<!-- gantry:step id=gty-orphan author=ai status=open path=gty-missing -->
a step pointing at a path that does not exist
`;
  const result = lintGantryMarkdown(bad);
  assert(result.errors.some((e) => e.code === "unknown-parent" && /unknown path "gty-missing"/.test(e.message)));
  assert(result.errors.some((e) => e.code === "unknown-parent" && /unknown fork "gty-nope"/.test(e.message)));
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

test("lint rejects a fork whose paths are all single steps (should be a choice item)", () => {
  const mcqAsFork = `# x

## Pseudocode

<!-- gantry:fork id=gty-pick status=open -->
fork: which error should login show?
<!-- gantry:path id=gty-pick-a fork=gty-pick status=open -->
path: A — retry error
<!-- gantry:step id=gty-pick-a1 author=ai status=open path=gty-pick-a -->
Show a support/retry error.
<!-- gantry:path id=gty-pick-b fork=gty-pick status=open -->
path: B — recreate identity
<!-- gantry:step id=gty-pick-b1 author=ai status=open path=gty-pick-b -->
Recreate the missing auth identity, then send OTP.
`;
  const flagged = lintGantryMarkdown(mcqAsFork);
  assert(flagged.errors.some((error) => error.code === "fork-not-branching"));

  // Give one path a real multi-step sub-flow and the fork is justified.
  const branching = mcqAsFork.replace(
    "Recreate the missing auth identity, then send OTP.\n",
    "Recreate the missing auth identity.\n" +
      "<!-- gantry:step id=gty-pick-b2 author=ai status=open path=gty-pick-b -->\n" +
      "Send OTP and establish the session.\n",
  );
  const ok = lintGantryMarkdown(branching);
  assert(!ok.errors.some((error) => error.code === "fork-not-branching"));
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

test("materializes a resolution into the canonical step without deleting its decision trail", () => {
  const parsed = parseGantryMarkdown(validMarkdown);
  const next = serializeGantryMarkdown(parsed, {
    steps: [{ id: "step-1", text: "1. Read the normalized query from `request.nextUrl.searchParams`." }],
    items: [{
      id: "gty-ref-query",
      status: "accept",
      text: "use `request.nextUrl.searchParams`.",
      comments: ["resolved into step 1"],
    }],
  });

  const reparsed = parseGantryMarkdown(next);
  assert.equal(
    reparsed.steps[0].text,
    "1. Read the normalized query from `request.nextUrl.searchParams`.",
  );
  assert.equal(reparsed.items[0].status, "accept");
  assert.equal(reparsed.items[0].text, "use `request.nextUrl.searchParams`.");
  assert.deepEqual(reparsed.items[0].comments, ["resolved into step 1"]);
  assert.equal(lintGantryMarkdown(next, { gate: true }).errors.some(
    (error) => error.code === "unresolved-gate" && error.line === reparsed.items[0].itemLine + 1,
  ), false);
});

test("edit feedback clears reviewer readiness but blocks model readiness", () => {
  const parsed = parseGantryMarkdown(validMarkdown);
  const next = serializeGantryMarkdown(parsed, {
    items: [{
      id: "gty-ref-query",
      status: "edit",
      comments: ["ELI20, don't get it"],
    }],
  });

  const reparsed = parseGantryMarkdown(next);
  const item = reparsed.items.find((candidate) => candidate.id === "gty-ref-query");
  assert.equal(item.status, "edit");
  assert.deepEqual(item.comments, ["ELI20, don't get it"]);
  assert.match(next, /status=edit mode=decision/);
  assert.equal(lintGantryMarkdown(next, { review: true }).ok, true);
  assert(lintGantryMarkdown(next, { model: true }).errors.some(
    (error) => error.code === "unresolved-gate" && error.line === item.itemLine + 1,
  ));
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

test("indented pseudocode bullets belong to the preceding user step", () => {
  const md = `# nested-pseudocode

## Pseudocode

Support three output-RAG flow modes:
  - \`tool_output_only\`: retrieve with observed tool output.
  - \`model_output_only\`: retrieve with first-pass model output.
Then record the selected mode in the trace.
`;
  const parsed = parseGantryMarkdown(md);

  assert.equal(parsed.steps.length, 2);
  assert.equal(parsed.blocks.length, 2);
  assert.equal(
    parsed.steps[0].text,
    "Support three output-RAG flow modes:\n" +
      "  - `tool_output_only`: retrieve with observed tool output.\n" +
      "  - `model_output_only`: retrieve with first-pass model output.",
  );
  assert.equal(serializeGantryMarkdown(parsed, {}), md);

  const next = serializeGantryMarkdown(parsed, {
    steps: [{
      id: parsed.steps[0].id,
      text:
        "Support three output-RAG flow modes:\n" +
        "  - `tool_output_only`: retrieve with observed tool output.\n" +
        "  - `model_output_only`: retrieve with first-pass model output.\n" +
        "  - `tool_then_model_output`: retrieve twice.",
    }],
  });
  assert.match(next, /  - `tool_then_model_output`: retrieve twice\.\nThen record/);
});

test("indented pseudocode bullets belong to the preceding AI step", () => {
  const md = `# ai-nested-pseudocode

## Pseudocode

<!-- gantry:step id=gty-output-rag-modes author=ai status=open -->
Support three output-RAG flow modes:
  - \`tool_output_only\`: retrieve with observed tool output.
  - \`model_output_only\`: retrieve with first-pass model output.
  - comment: make sure mode names stay literal
`;
  const parsed = parseGantryMarkdown(md);

  assert.equal(parsed.aiSteps.length, 1);
  assert.equal(
    parsed.aiSteps[0].text,
    "Support three output-RAG flow modes:\n" +
      "  - `tool_output_only`: retrieve with observed tool output.\n" +
      "  - `model_output_only`: retrieve with first-pass model output.",
  );
  assert.deepEqual(parsed.aiSteps[0].comments, ["make sure mode names stay literal"]);
  assert.equal(serializeGantryMarkdown(parsed, {}), md);
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

// Boot the editor server against a temp root and resolve once it prints its port.
// Shared by every server test so the spawn/port-handshake lives in one place.
async function startEditor(t, root, slug) {
  const child = spawn(process.execPath, [
    "skills/gantry/scripts/gantry-editor.mjs",
    "serve",
    "--root",
    root,
    "--slug",
    slug,
    "--no-open",
  ], { cwd: path.resolve("."), stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => child.kill());

  return new Promise((resolve, reject) => {
    child.stderr.on("data", (data) => reject(new Error(data.toString())));
    child.stdout.on("data", (data) => {
      const match = /http:\/\/127\.0\.0\.1:(\d+)/.exec(data.toString());
      if (match) resolve(match[1]);
    });
  });
}

test("server reads and writes only the requested gantry doc", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "gantry-editor-"));
  await mkdir(path.join(root, ".gantry"));
  await writeFile(path.join(root, ".gantry", "sample.md"), validMarkdown, "utf8");
  await writeFile(path.join(root, ".gantry", "other.md"), "# other\n", "utf8");

  const port = await startEditor(t, root, "sample");

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

  const port = await startEditor(t, root, "draft");

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

// --- legacy markerless items: parsing + status inference ---

const markerlessMarkdown = `# legacy

## Pseudocode

1. Do the thing.
- [ ] **ref:** still open, no badge
- [x] **edge:** [reject] badge wins over prose
- [x] **feat:** we rejected this approach
- [x] **ripple:** checked with no signal means accept

## Code (as written 2026-06-13 @ abc123)

empty
`;

test("infers item status from checkbox, badge, and prose on markerless items", () => {
  const parsed = parseGantryMarkdown(markerlessMarkdown);
  const byType = Object.fromEntries(parsed.items.map((item) => [item.type, item]));
  assert.equal(byType.ref.status, "open"); // unchecked → open regardless of body
  assert.equal(byType.edge.status, "reject"); // explicit [reject] badge
  assert.equal(byType.feat.status, "reject"); // inferred from the word "rejected"
  assert.equal(byType.ripple.status, "accept"); // checked, no other signal

  // No marker line means lint flags every one as missing an id.
  assert.equal(byType.ref.markerLinePresent, false);
  const lint = lintGantryMarkdown(markerlessMarkdown);
  assert.equal(lint.errors.filter((e) => e.code === "missing-id").length, 4);
});

test("migrating markerless items preserves inferred status and adds ids", () => {
  const migrated = ensureGantryIds(markerlessMarkdown);
  const reparsed = parseGantryMarkdown(migrated);
  assert(reparsed.items.every((item) => item.markerLinePresent));
  const statusByType = Object.fromEntries(reparsed.items.map((item) => [item.type, item.status]));
  assert.deepEqual(statusByType, { ref: "open", edge: "reject", feat: "reject", ripple: "accept" });
});

// --- choice-item lint rules ---

test("lint enforces choice/decision status rules", () => {
  const bad = `# choices

## Pseudocode

1. Pick options.
<!-- gantry:item id=gty-solo type=edge status=choice-a mode=choice -->
- [x] **edge:** [choice-a] only one option offered?
  - A: the only one
<!-- gantry:item id=gty-dec type=ref status=choice-b mode=decision -->
- [x] **ref:** [choice-b] a decision wearing a choice status
<!-- gantry:item id=gty-bad type=feat status=accept mode=choice -->
- [x] **feat:** [accept] a choice that resolved to accept
  - A: first
  - B: second
`;
  const result = lintGantryMarkdown(bad);
  assert(result.errors.some((e) => e.code === "invalid-options"));
  assert(result.errors.some((e) => e.code === "invalid-status" && /cannot use an A\/B\/C/.test(e.message)));
  assert(result.errors.some((e) => e.code === "invalid-status" && /must resolve to option A, B, or C/.test(e.message)));
});

// --- duplicate ids ---

test("lint flags a reused gantry id", () => {
  const bad = `# dup

## Pseudocode

1. step
<!-- gantry:item id=gty-dup type=ref status=open mode=decision -->
- [ ] **ref:** first use
<!-- gantry:item id=gty-dup type=edge status=open mode=decision -->
- [ ] **edge:** second use of the same id
`;
  const result = lintGantryMarkdown(bad);
  assert(result.errors.some((e) => e.code === "duplicate-id"));
});

// --- fork status outside its allowed vocabulary ---

test("lint rejects a fork status that is neither a keyword nor a path id", () => {
  const bad = `# forkstatus

## Pseudocode

<!-- gantry:fork id=gty-f status=bogus -->
fork: which way?
<!-- gantry:path id=gty-f-a fork=gty-f status=open -->
path: A
<!-- gantry:path id=gty-f-b fork=gty-f status=open -->
path: B
`;
  const result = lintGantryMarkdown(bad);
  assert(result.errors.some((e) => e.code === "invalid-status" && /not open, reject, edit/.test(e.message)));
});

test("lint flags an invalid AI step author and status", () => {
  const bad = `# steps

## Pseudocode

<!-- gantry:step id=gty-s1 author=robot status=maybe -->
A step with a bogus author and status.
`;
  const result = lintGantryMarkdown(bad);
  assert(result.errors.some((e) => e.code === "invalid-author"));
  assert(result.errors.some((e) => e.code === "invalid-status" && /step status/.test(e.message)));
});

test("lint flags an invalid path status", () => {
  const bad = `# paths

## Pseudocode

<!-- gantry:fork id=gty-f status=open -->
fork: which way?
<!-- gantry:path id=gty-f-a fork=gty-f status=sideways -->
path: A
<!-- gantry:path id=gty-f-b fork=gty-f status=open -->
path: B
`;
  const result = lintGantryMarkdown(bad);
  assert(result.errors.some((e) => e.code === "invalid-status" && /path status/.test(e.message)));
});

// --- CRLF inputs normalize to LF and still round-trip ---

test("normalizes CRLF input and round-trips as LF", () => {
  const crlf = validMarkdown.replace(/\n/g, "\r\n");
  const parsed = parseGantryMarkdown(crlf);
  assert.equal(parsed.items.length, 2);
  assert.equal(serializeGantryMarkdown(parsed, {}), validMarkdown);
});

// --- legacy doc block ordering (plain user steps, items are not blocks) ---

test("orders legacy user steps as blocks and keeps items out of the block list", () => {
  const parsed = parseGantryMarkdown(validMarkdown);
  assert.deepEqual(
    parsed.blocks.map((b) => `${b.kind}:${b.author}`),
    ["step:user", "step:user"],
  );
  assert.equal(parsed.steps.length, 2);
  assert.equal(parsed.items.length, 2);
});

// --- server error paths ---

test("server returns an error for an unknown slug", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "gantry-editor-"));
  await mkdir(path.join(root, ".gantry"));
  await writeFile(path.join(root, ".gantry", "sample.md"), validMarkdown, "utf8");

  const port = await startEditor(t, root, "sample");
  const res = await fetch(`http://127.0.0.1:${port}/api/doc?slug=does-not-exist`);
  const body = await res.json();
  assert.equal(res.status, 500);
  assert.equal(body.ok, false);
});

test("server rejects a slug with path separators", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "gantry-editor-"));
  await mkdir(path.join(root, ".gantry"));
  await writeFile(path.join(root, ".gantry", "sample.md"), validMarkdown, "utf8");

  const port = await startEditor(t, root, "sample");
  const res = await fetch(`http://127.0.0.1:${port}/api/doc?slug=${encodeURIComponent("../escape")}`);
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.ok, false);
});

test("server surfaces the overwrite guard as a 422", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "gantry-editor-"));
  await mkdir(path.join(root, ".gantry"));
  await writeFile(path.join(root, ".gantry", "sample.md"), validMarkdown, "utf8");

  const port = await startEditor(t, root, "sample");
  const res = await fetch(`http://127.0.0.1:${port}/api/doc`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ slug: "sample", pseudocode: "wipe everything" }),
  });
  const body = await res.json();
  assert.equal(res.status, 422);
  assert.equal(body.ok, false);
  assert.match(body.error, /already has AI annotations/);
  // The annotated doc on disk is untouched.
  assert.equal(await readFile(path.join(root, ".gantry", "sample.md"), "utf8"), validMarkdown);
});

test("server returns an error for malformed JSON", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "gantry-editor-"));
  await mkdir(path.join(root, ".gantry"));
  await writeFile(path.join(root, ".gantry", "sample.md"), validMarkdown, "utf8");

  const port = await startEditor(t, root, "sample");
  const res = await fetch(`http://127.0.0.1:${port}/api/doc`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: "{ not valid json",
  });
  const body = await res.json();
  assert.equal(res.status, 500);
  assert.equal(body.ok, false);
});
