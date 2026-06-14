#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = resolve(fileURLToPath(import.meta.url), "..");
const CLAWHUB_ROOT = resolve(HERE, "..");
const DOCS_ROOT = resolve(CLAWHUB_ROOT, "public", "docs");
const HOST = process.env.DOCS_RUN_HOST || "127.0.0.1";
const PORT = Number(process.env.DOCS_RUN_PORT || "4174");

run("node", ["scripts/docs-builder.mjs"]);

const server = createServer((request, response) => {
  if (!request.url) {
    response.writeHead(400);
    response.end("Bad request");
    return;
  }

  const url = new URL(request.url, `http://${HOST}:${PORT}`);
  const file = resolveDocsPath(url.pathname);
  if (!file) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  response.writeHead(200, { "Content-Type": contentType(file) });
  createReadStream(file).pipe(response);
});

server.listen(PORT, HOST, () => {
  console.log(`ClawHub docs preview: http://${HOST}:${PORT}/`);
});

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    cwd: CLAWHUB_ROOT,
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function resolveDocsPath(pathname: string) {
  const decoded = decodeURIComponent(pathname);
  const normalized = normalize(decoded).replace(/^(\.\.(?:\/|\\|$))+/, "");
  let candidate = resolve(DOCS_ROOT, `.${sep}${normalized}`);

  if (!candidate.startsWith(`${DOCS_ROOT}${sep}`) && candidate !== DOCS_ROOT) {
    return "";
  }

  if (existsSync(candidate) && statSync(candidate).isDirectory()) {
    candidate = join(candidate, "index.html");
  } else if (!extname(candidate) && existsSync(join(candidate, "index.html"))) {
    candidate = join(candidate, "index.html");
  }

  return existsSync(candidate) && statSync(candidate).isFile() ? candidate : "";
}

function contentType(file: string) {
  switch (extname(file)) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".gif":
      return "image/gif";
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".md":
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".wasm":
      return "application/wasm";
    default:
      return "application/octet-stream";
  }
}
