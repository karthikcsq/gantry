#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const VALID_LEVELS = new Set(["guided", "collaborative", "concise"]);

const MODE_HINT = `guided — more teaching and smaller steps
collaborative — balanced pairing (default)
concise — terse, fluency-assuming context`;

function withModes(message) {
  return `${message}\n\nAvailable modes:\n${MODE_HINT}`;
}

function parseArgs(argv) {
  let home = os.homedir();
  let root = process.cwd();
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--home") {
      if (!argv[i + 1]) throw new Error("--home requires a path");
      home = path.resolve(argv[i + 1]);
      i += 1;
    } else if (argv[i] === "--root") {
      if (!argv[i + 1]) throw new Error("--root requires a path");
      root = path.resolve(argv[i + 1]);
      i += 1;
    } else {
      positional.push(argv[i]);
    }
  }

  if (positional.length > 2) throw new Error("expected a mode and optional Gantry slug");
  return {
    home,
    root,
    mode: positional[0]?.toLowerCase(),
    slug: positional[1],
  };
}

function readConfig(configPath) {
  if (!fs.existsSync(configPath)) return {};

  let value;
  try {
    value = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    throw new Error(`Malformed Gantry config: ${configPath}. Fix the JSON manually; no changes were made.`);
  }

  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`Malformed Gantry config: ${configPath} must contain a JSON object. No changes were made.`);
  }
  return value;
}

function status(config) {
  const configured = config.guidance;
  const effective = VALID_LEVELS.has(configured) ? configured : "collaborative";
  const invalid = configured !== undefined && !VALID_LEVELS.has(configured)
    ? `\nConfigured value "${configured}" is invalid; using collaborative.`
    : "";

  return `Gantry guidance: ${effective}${invalid}

${MODE_HINT}`;
}

function writeConfig(configPath, config) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const temporaryPath = `${configPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, configPath);
}

function validateSlug(slug) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(slug)) {
    throw new Error(`Invalid Gantry slug "${slug}". Use the filename stem from .gantry/<slug>.md.`);
  }
}

function writeSidecarGuidance(root, slug, guidance) {
  validateSlug(slug);
  const sidecarPath = path.join(root, ".gantry", `${slug}.diff.md`);
  if (!fs.existsSync(sidecarPath)) {
    throw new Error(`Gantry sidecar not found: ${sidecarPath}`);
  }

  const content = fs.readFileSync(sidecarPath, "utf8");
  const frontmatter = content.match(/^---(\r?\n)([\s\S]*?)(\r?\n)---(?=\r?\n|$)/);
  if (!frontmatter) {
    throw new Error(`Gantry sidecar has no valid frontmatter: ${sidecarPath}`);
  }

  const lineEnding = frontmatter[1];
  const lines = frontmatter[2].split(/\r?\n/);
  const guidanceLines = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^guidance\s*:/.test(line));

  if (guidanceLines.length > 1) {
    throw new Error(`Gantry sidecar has duplicate guidance keys: ${sidecarPath}`);
  }

  if (guidanceLines.length === 1) {
    lines[guidanceLines[0].index] = `guidance: ${guidance}`;
  } else {
    lines.push(`guidance: ${guidance}`);
  }

  const replacement = `---${lineEnding}${lines.join(lineEnding)}${lineEnding}---`;
  fs.writeFileSync(sidecarPath, replacement + content.slice(frontmatter[0].length), "utf8");
  return sidecarPath;
}

function main() {
  const { home, root, mode, slug } = parseArgs(process.argv.slice(2));
  const configPath = path.join(home, ".gantry", "config.json");
  const config = readConfig(configPath);

  if (mode === undefined) {
    console.log(status(config));
    return;
  }

  if (mode === "reset") {
    if (slug) {
      const fallback = VALID_LEVELS.has(config.guidance) ? config.guidance : "collaborative";
      const sidecarPath = writeSidecarGuidance(root, slug, fallback);
      console.log(withModes(`Gantry task "${slug}" reset to ${fallback}.\nSidecar: ${sidecarPath}`));
      return;
    }

    delete config.guidance;
    writeConfig(configPath, config);
    console.log(withModes(`Gantry guidance reset to collaborative.\nConfig: ${configPath}`));
    return;
  }

  if (!VALID_LEVELS.has(mode)) {
    throw new Error(`Unknown Gantry guidance "${mode}". Choose guided, collaborative, concise, or reset.`);
  }

  if (slug) {
    const sidecarPath = writeSidecarGuidance(root, slug, mode);
    console.log(withModes(`Gantry task "${slug}" set to ${mode} immediately.\nSidecar: ${sidecarPath}`));
    return;
  }

  config.guidance = mode;
  writeConfig(configPath, config);
  console.log(withModes(`Gantry guidance set to ${mode} for future tasks.\nConfig: ${configPath}`));
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
