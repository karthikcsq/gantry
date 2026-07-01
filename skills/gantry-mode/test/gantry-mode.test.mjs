import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";

const script = path.resolve("skills/gantry-mode/scripts/gantry-mode.mjs");

function run(home, ...args) {
  return spawnSync(process.execPath, [script, "--home", home, ...args], {
    encoding: "utf8",
  });
}

function makeSidecar(root, slug, guidance = "collaborative") {
  const directory = path.join(root, ".gantry");
  fs.mkdirSync(directory, { recursive: true });
  const sidecarPath = path.join(directory, `${slug}.diff.md`);
  fs.writeFileSync(
    sidecarPath,
    `---\nbaseline_commit: HEAD\nguidance: ${guidance}\n---\n\n# Diff log\n`,
  );
  return sidecarPath;
}

test("reports collaborative when no config exists", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gantry-mode-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));

  const result = run(home);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Gantry guidance: collaborative/);
});

test("sets guidance while preserving unrelated keys, then resets", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gantry-mode-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const configPath = path.join(home, ".gantry", "config.json");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, '{"theme":"dark"}\n');

  const setResult = run(home, "GUIDED");
  assert.equal(setResult.status, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(configPath, "utf8")), {
    theme: "dark",
    guidance: "guided",
  });

  const resetResult = run(home, "reset");
  assert.equal(resetResult.status, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(configPath, "utf8")), {
    theme: "dark",
  });
});

test("does not overwrite malformed config", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gantry-mode-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const configPath = path.join(home, ".gantry", "config.json");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, "{broken");

  const result = run(home, "concise");
  assert.equal(result.status, 1);
  assert.equal(fs.readFileSync(configPath, "utf8"), "{broken");
});

test("rejects an unknown mode without creating config", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gantry-mode-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));

  const result = run(home, "expert");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Choose guided, collaborative, concise, or reset/);
  assert.equal(fs.existsSync(path.join(home, ".gantry", "config.json")), false);
});

test("changes an existing task immediately without changing the global default", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gantry-mode-home-"));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gantry-mode-root-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sidecarPath = makeSidecar(root, "vendor-search");

  const result = run(home, "--root", root, "guided", "vendor-search");
  assert.equal(result.status, 0);
  assert.match(result.stdout, /set to guided immediately/);
  assert.match(fs.readFileSync(sidecarPath, "utf8"), /^guidance: guided$/m);
  assert.equal(fs.existsSync(path.join(home, ".gantry", "config.json")), false);
});

test("resets an existing task to the current global default", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gantry-mode-home-"));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gantry-mode-root-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const configPath = path.join(home, ".gantry", "config.json");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, '{"guidance":"concise"}\n');
  const sidecarPath = makeSidecar(root, "vendor-search", "guided");

  const result = run(home, "--root", root, "reset", "vendor-search");
  assert.equal(result.status, 0);
  assert.match(result.stdout, /reset to concise/);
  assert.match(fs.readFileSync(sidecarPath, "utf8"), /^guidance: concise$/m);
});

test("rejects a task slug that could escape the .gantry directory", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gantry-mode-home-"));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gantry-mode-root-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const result = run(home, "--root", root, "guided", "../outside");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid Gantry slug/);
});
