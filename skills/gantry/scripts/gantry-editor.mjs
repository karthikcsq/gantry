#!/usr/bin/env node
import { createServer } from "node:http";
import { readFile, writeFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureGantryIds,
  lintGantryMarkdown,
  parseGantryMarkdown,
  serializeGantryMarkdown,
} from "../lib/gantry-markdown.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../public");

const command = process.argv[2] ?? "serve";
const args = parseArgs(process.argv.slice(3));
const root = path.resolve(args.root ?? process.cwd());

if (command === "serve") {
  serve({ root, slug: args.slug, port: Number(args.port ?? 0) });
} else if (command === "lint") {
  await lint({ root, slug: args.slug, gate: Boolean(args.gate) });
} else if (command === "ids") {
  await addIds({ root, slug: args.slug });
} else {
  usage();
  process.exitCode = 1;
}

function serve({ root, slug, port }) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname === "/api/doc" && req.method === "GET") {
        const doc = await readDoc(root, url.searchParams.get("slug") ?? slug);
        sendJson(res, doc);
        return;
      }
      if (url.pathname === "/api/doc" && req.method === "PUT") {
        const body = await readJson(req);
        const current = await readMarkdown(root, body.slug ?? slug);
        const parsed = parseGantryMarkdown(current);
        const next = serializeGantryMarkdown(parsed, body);
        const lintResult = lintGantryMarkdown(next);
        if (!lintResult.ok) {
          sendJson(res, { ok: false, errors: lintResult.errors }, 422);
          return;
        }
        await writeMarkdown(root, body.slug ?? slug, next);
        sendJson(res, { ok: true, doc: modelFromMarkdown(next) });
        return;
      }
      if (url.pathname === "/api/lint" && req.method === "GET") {
        const markdown = await readMarkdown(root, url.searchParams.get("slug") ?? slug);
        const result = lintGantryMarkdown(markdown, { gate: url.searchParams.get("gate") === "1" });
        sendJson(res, { ok: result.ok, errors: result.errors });
        return;
      }
      await serveStatic(req, res, url.pathname);
    } catch (error) {
      sendJson(res, { ok: false, error: error.message }, error.statusCode ?? 500);
    }
  });

  server.listen(port, "127.0.0.1", () => {
    const address = server.address();
    const query = slug ? `?slug=${encodeURIComponent(slug)}` : "";
    console.log(`Gantry editor: http://127.0.0.1:${address.port}/${query}`);
    console.log(`Project root: ${root}`);
  });
}

async function lint({ root, slug, gate }) {
  if (!slug) throw new Error("lint requires --slug <name>");
  const markdown = await readMarkdown(root, slug);
  const result = lintGantryMarkdown(markdown, { gate });
  for (const error of result.errors) {
    console.error(`${error.line}: ${error.code}: ${error.message}`);
  }
  process.exitCode = result.ok ? 0 : 1;
}

async function addIds({ root, slug }) {
  if (!slug) throw new Error("ids requires --slug <name>");
  const markdown = await readMarkdown(root, slug);
  await writeMarkdown(root, slug, ensureGantryIds(markdown));
}

async function readDoc(root, slug) {
  const markdown = await readMarkdown(root, slug);
  return { ok: true, slug, ...modelFromMarkdown(markdown) };
}

function modelFromMarkdown(markdown) {
  const parsed = parseGantryMarkdown(markdown);
  return {
    markdown,
    steps: parsed.steps,
    items: parsed.items,
    lint: lintGantryMarkdown(markdown).errors,
  };
}

async function readMarkdown(root, slug) {
  const file = docPath(root, slug);
  return readFile(file, "utf8");
}

async function writeMarkdown(root, slug, markdown) {
  const file = docPath(root, slug);
  await writeFile(file, markdown, "utf8");
}

function docPath(root, slug) {
  if (!slug || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(slug)) {
    const error = new Error("Slug must be a simple .gantry markdown filename without path separators.");
    error.statusCode = 400;
    throw error;
  }
  const file = path.resolve(root, ".gantry", slug.endsWith(".md") ? slug : `${slug}.md`);
  const gantryDir = path.resolve(root, ".gantry") + path.sep;
  if (!file.startsWith(gantryDir)) {
    const error = new Error("Resolved file escaped the .gantry directory.");
    error.statusCode = 400;
    throw error;
  }
  return file;
}

async function serveStatic(req, res, requestPath) {
  const pathname = requestPath === "/" ? "/index.html" : requestPath;
  const file = path.resolve(publicDir, `.${pathname}`);
  if (!file.startsWith(publicDir + path.sep)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  await stat(file);
  res.writeHead(200, { "content-type": contentType(file) });
  createReadStream(file).pipe(res);
}

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  return "application/octet-stream";
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return JSON.parse(raw || "{}");
}

function sendJson(res, body, status = 200) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--gate") {
      result.gate = true;
    } else if (arg.startsWith("--")) {
      result[arg.slice(2)] = argv[i + 1];
      i += 1;
    } else if (!result.slug) {
      result.slug = arg;
    }
  }
  return result;
}

function usage() {
  console.error(`Usage:
  node skills/gantry/scripts/gantry-editor.mjs serve --slug <slug> [--port 8787] [--root <repo>]
  node skills/gantry/scripts/gantry-editor.mjs lint --slug <slug> [--gate] [--root <repo>]
  node skills/gantry/scripts/gantry-editor.mjs ids --slug <slug> [--root <repo>]`);
}
