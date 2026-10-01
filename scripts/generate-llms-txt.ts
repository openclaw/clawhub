import { readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import {
  CLAWHUB_DOCS_URL,
  CLAWHUB_OPENAPI_URL,
  CLAWHUB_REPOSITORY_URL,
  CLAWHUB_SITE_URL,
  OPENCLAW_DOCS_LLMS_URL,
  PUBLIC_REGISTRY_SURFACES,
  clawhubDocsUrl,
  publicRegistryUrl,
} from "../src/lib/publicRegistry";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DOCS_DIRECTORY = join(REPOSITORY_ROOT, "docs");
const DEFAULT_OUTPUT_FILE = join(REPOSITORY_ROOT, "public", "llms.txt");

interface LlmsDoc {
  slug: string;
  summary: string;
  title: string;
}

interface Frontmatter {
  llms?: unknown;
  summary?: unknown;
  title?: unknown;
}

function normalizeInlineText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function isAscii(value: string) {
  for (const character of value) {
    if ((character.codePointAt(0) ?? 128) > 127) return false;
  }
  return true;
}

function parseFrontmatter(source: string, filename: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (!match) throw new Error(`docs/${filename} must start with YAML frontmatter`);

  const parsed: unknown = parseYaml(match[1]);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`docs/${filename} frontmatter must be a YAML object`);
  }
  return parsed as Frontmatter;
}

function findHeading(source: string, filename: string) {
  const heading = /^#\s+(.+)$/m.exec(source)?.[1];
  if (!heading) throw new Error(`docs/${filename} must define a level-one heading or title`);
  return normalizeInlineText(heading);
}

export async function readLlmsDocs(docsDirectory = DEFAULT_DOCS_DIRECTORY): Promise<LlmsDoc[]> {
  const entries = await readdir(docsDirectory, { withFileTypes: true });
  const docs = await Promise.all(
    entries
      .filter(
        (entry) => entry.isFile() && extname(entry.name) === ".md" && entry.name !== "README.md",
      )
      .map(async (entry) => {
        const source = await readFile(join(docsDirectory, entry.name), "utf8");
        const frontmatter = parseFrontmatter(source, entry.name);
        if (frontmatter.llms === false) return undefined;

        if (typeof frontmatter.summary !== "string" || !frontmatter.summary.trim()) {
          throw new Error(`docs/${entry.name} must define a non-empty summary`);
        }

        const title =
          typeof frontmatter.title === "string" && frontmatter.title.trim()
            ? normalizeInlineText(frontmatter.title)
            : findHeading(source, entry.name);

        return {
          slug: entry.name.slice(0, -extname(entry.name).length),
          summary: normalizeInlineText(frontmatter.summary),
          title,
        } satisfies LlmsDoc;
      }),
  );

  return docs
    .filter((doc): doc is LlmsDoc => doc !== undefined)
    .sort((left, right) => {
      if (left.slug === "clawhub") return -1;
      if (right.slug === "clawhub") return 1;
      if (left.title === right.title) return left.slug < right.slug ? -1 : 1;
      return left.title < right.title ? -1 : 1;
    });
}

function markdownLink(label: string, url: string, summary: string) {
  return `- [${label}](${url}): ${summary}`;
}

export async function renderLlmsTxt(options: { docsDirectory?: string } = {}) {
  const docs = await readLlmsDocs(options.docsDirectory);
  const lines = [
    "# ClawHub",
    "",
    "> ClawHub is the public registry for OpenClaw skills and plugins.",
    "",
    "Use OpenClaw to search, install, and update registry content. Use the ClawHub CLI for registry authentication, publishing, and listing management. Follow the canonical documentation below for current commands and workflows.",
    "",
    "This generated file is a machine-readable map, not an access-control policy or a substitute for reviewing an artifact before installation.",
    "",
    "## Primary",
    "",
    markdownLink(
      "ClawHub",
      CLAWHUB_SITE_URL,
      "Browse the public registry for skills, plugins, and creators.",
    ),
    markdownLink(
      "ClawHub documentation",
      CLAWHUB_DOCS_URL,
      "Canonical user, publisher, API, trust, and operations documentation.",
    ),
    markdownLink(
      "OpenClaw docs llms.txt",
      OPENCLAW_DOCS_LLMS_URL,
      "Machine-readable map for the full OpenClaw documentation set.",
    ),
    markdownLink(
      "OpenAPI v1",
      CLAWHUB_OPENAPI_URL,
      "Machine-readable schema for the current ClawHub HTTP API.",
    ),
    "",
    "## Public Registry Surfaces",
    "",
    ...PUBLIC_REGISTRY_SURFACES.map((surface) =>
      markdownLink(surface.label, publicRegistryUrl(surface.path), surface.summary),
    ),
    "",
    "## Documentation",
    "",
    ...docs.map((doc) =>
      markdownLink(
        doc.title,
        clawhubDocsUrl(doc.slug === "clawhub" ? undefined : doc.slug),
        doc.summary,
      ),
    ),
    "",
    "## Source",
    "",
    markdownLink(
      "Source repository",
      CLAWHUB_REPOSITORY_URL,
      "TanStack Start app, Convex backend, CLI packages, public docs, and specifications.",
    ),
    markdownLink(
      "Public docs source",
      `${CLAWHUB_REPOSITORY_URL}/tree/main/docs`,
      "Source Markdown mirrored into the OpenClaw documentation site.",
    ),
    markdownLink(
      "Schema package",
      `${CLAWHUB_REPOSITORY_URL}/tree/main/packages/schema`,
      "Shared API routes, package schemas, and compatibility contracts.",
    ),
    markdownLink(
      "ClawHub CLI",
      `${CLAWHUB_REPOSITORY_URL}/tree/main/packages/clawhub`,
      "CLI implementation for authentication, discovery, publishing, and listing management.",
    ),
    markdownLink(
      "Convex backend",
      `${CLAWHUB_REPOSITORY_URL}/tree/main/convex`,
      "Registry data, HTTP handlers, publishing, scans, moderation, and search.",
    ),
    "",
    "## Optional",
    "",
    markdownLink(
      "robots.txt",
      publicRegistryUrl("/robots.txt"),
      "Crawler policy for the ClawHub site.",
    ),
    markdownLink(
      "Web app manifest",
      publicRegistryUrl("/manifest.json"),
      "Installable web app metadata.",
    ),
    "",
  ];

  const output = lines.join("\n");
  if (!isAscii(output)) {
    throw new Error("Generated public/llms.txt must contain ASCII text only");
  }
  return output;
}

export async function writeLlmsTxt(outputFile = DEFAULT_OUTPUT_FILE) {
  const output = await renderLlmsTxt();
  const current = await readFile(outputFile, "utf8").catch(() => undefined);
  if (current === output) return false;

  const temporaryFile = `${outputFile}.${process.pid}.tmp`;
  await writeFile(temporaryFile, output, "utf8");
  try {
    await rename(temporaryFile, outputFile);
  } catch (error) {
    await unlink(temporaryFile).catch(() => undefined);
    throw error;
  }
  return true;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const unknown = [...args].filter((arg) => arg !== "--check" && arg !== "--stdout");
  if (unknown.length > 0) throw new Error(`Unknown argument: ${unknown.join(", ")}`);

  if (args.has("--stdout")) {
    process.stdout.write(await renderLlmsTxt());
    return;
  }
  if (args.has("--check")) {
    await renderLlmsTxt();
    return;
  }
  await writeLlmsTxt();
}

if (import.meta.main) {
  await main();
}
