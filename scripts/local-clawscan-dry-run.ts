import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import ignore from "ignore";
import mime from "mime";
import { runStaticModerationScan, type StaticScanResult } from "../convex/lib/moderationEngine";
import { extractResponseText } from "../convex/lib/openaiResponse";
import {
  applyInjectionSignalFloor,
  assembleEvalUserMessage,
  assembleSkillEvalUserMessage,
  detectInjectionPatterns,
  getLlmEvalModel,
  getLlmEvalReasoningEffort,
  getLlmEvalServiceTier,
  LLM_EVAL_MAX_OUTPUT_TOKENS,
  parseLlmEvalResponse,
  SKILL_SECURITY_EVALUATOR_SYSTEM_PROMPT,
  type LlmEvalResponse,
  type SkillEvalContext,
} from "../convex/lib/securityPrompt";
import {
  getFrontmatterMetadata,
  getFrontmatterValue,
  isTextFile,
  parseClawdisMetadata,
  parseFrontmatter,
} from "../convex/lib/skills";
import { parseClawPack } from "../packages/clawhub/src/clawpack";

export type LocalClawScanDryRunEnv = Record<string, string | undefined>;

type ArtifactKind = "skill" | "plugin";

type LocalFile = {
  path: string;
  bytes: Uint8Array;
  contentType?: string;
};

type TextFile = {
  path: string;
  content: string;
};

type RunOptions = {
  cwd?: string;
  path: string;
  kind: ArtifactKind;
  json?: boolean;
  env?: LocalClawScanDryRunEnv;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

type LocalLlmAnalysis = {
  status: "clean" | "suspicious" | "malicious" | "pending";
  verdict: LlmEvalResponse["verdict"];
  confidence: LlmEvalResponse["confidence"];
  summary: string;
  dimensions: LlmEvalResponse["dimensions"];
  guidance: string;
  findings?: string;
  agenticRiskFindings?: LlmEvalResponse["agenticRiskFindings"];
  riskSummary?: LlmEvalResponse["riskSummary"];
  model: string;
  checkedAt: number;
};

export type LocalClawScanDryRunResult = {
  kind: ArtifactKind;
  source: string;
  name: string;
  displayName: string;
  version: string;
  files: Array<{ path: string; size: number }>;
  staticScan: StaticScanResult;
  llmAnalysis: LocalLlmAnalysis;
};

const DOT_DIR = ".clawhub";
const LEGACY_DOT_DIR = ".clawdhub";
const DOT_IGNORE = ".clawhubignore";
const LEGACY_DOT_IGNORE = ".clawdhubignore";

const textDecoder = new TextDecoder();

export async function loadEnvLocal(cwd: string, env: LocalClawScanDryRunEnv = process.env) {
  if (env.OPENAI_API_KEY?.trim()) return;
  let raw = "";
  try {
    raw = await readFile(join(cwd, ".env.local"), "utf8");
  } catch {
    return;
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    if (key !== "OPENAI_API_KEY" || env[key]?.trim()) continue;
    env[key] = unquoteEnvValue(match[2] ?? "");
  }
}

export async function runLocalClawScanDryRun(
  options: RunOptions,
): Promise<LocalClawScanDryRunResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  await loadEnvLocal(cwd, env);

  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required. Add it to .env.local or export it.");
  }

  const source = resolve(cwd, options.path);
  const now = options.now ?? Date.now;
  const artifact =
    options.kind === "skill"
      ? await buildSkillArtifact(source, now)
      : await buildPluginArtifact(source, now);
  const llmAnalysis = await evaluateWithLlm({
    apiKey,
    ctx: artifact.evalCtx,
    fetchImpl: options.fetchImpl ?? fetch,
    now,
    useSkillPrompt: options.kind === "skill",
  });

  return {
    kind: options.kind,
    source,
    name: artifact.name,
    displayName: artifact.displayName,
    version: artifact.version,
    files: artifact.evalCtx.files,
    staticScan: artifact.staticScan,
    llmAnalysis,
  };
}

async function buildSkillArtifact(source: string, now: () => number) {
  const sourceStat = await stat(source).catch(() => null);
  if (!sourceStat?.isDirectory()) throw new Error("Skill path must be a folder");
  const files = await listTextFiles(source);
  const skillMd = findFile(files, ["skill.md", "skills.md"]);
  if (!skillMd) throw new Error("SKILL.md required");

  const skillMdContent = textDecoder.decode(skillMd.bytes);
  const frontmatter = parseFrontmatter(skillMdContent);
  const metadata = getFrontmatterMetadata(frontmatter);
  const clawdis = parseClawdisMetadata(frontmatter);
  const slug = basename(source);
  const displayName = getFrontmatterValue(frontmatter, "name") ?? titleCase(slug);
  const summary =
    getFrontmatterDescription(metadata) ?? getFrontmatterValue(frontmatter, "description");
  const textFiles = decodeTextFiles(files);
  const staticScan = runStaticModerationScan({
    slug,
    displayName,
    summary,
    frontmatter,
    metadata,
    files: files.map((file) => ({ path: file.path, size: file.bytes.byteLength })),
    fileContents: textFiles,
  });
  const injectionSignals = detectInjectionPatterns(
    [skillMdContent, ...textFiles.map((file) => file.content)].join("\n"),
  );

  return {
    name: slug,
    displayName,
    version: "local",
    staticScan,
    evalCtx: {
      slug,
      displayName,
      ownerUserId: "local",
      version: "local",
      createdAt: now(),
      summary,
      homepage:
        getFrontmatterValue(frontmatter, "homepage") ??
        getFrontmatterValue(frontmatter, "website") ??
        getFrontmatterValue(frontmatter, "url"),
      parsed: { frontmatter, metadata, clawdis },
      files: files.map((file) => ({ path: file.path, size: file.bytes.byteLength })),
      skillMdContent,
      fileContents: textFiles.filter((file) => file.path !== skillMd.path),
      injectionSignals,
      staticScan,
    } satisfies SkillEvalContext,
  };
}

async function buildPluginArtifact(source: string, now: () => number) {
  const sourceStat = await stat(source).catch(() => null);
  if (!sourceStat) throw new Error("Plugin path must be a folder or ClawPack .tgz");

  let files: LocalFile[];
  let packageJson: Record<string, unknown> | undefined;
  let pluginManifest: Record<string, unknown> | undefined;
  if (sourceStat.isFile()) {
    if (!source.endsWith(".tgz")) throw new Error("Plugin file must be a ClawPack .tgz");
    const parsed = parseClawPack(new Uint8Array(await readFile(source)));
    files = parsed.entries.map((entry) => ({
      path: entry.path,
      bytes: entry.bytes,
      contentType: mime.getType(entry.path) ?? "application/octet-stream",
    }));
    packageJson = parsed.packageJson;
    pluginManifest = parsed.pluginManifest;
  } else if (sourceStat.isDirectory()) {
    files = await listPackageFiles(source);
    packageJson = readJsonFile(files, "package.json");
    pluginManifest = readJsonFile(files, "openclaw.plugin.json");
  } else {
    throw new Error("Plugin path must be a folder or ClawPack .tgz");
  }

  if (!findFile(files, ["openclaw.plugin.json"])) throw new Error("openclaw.plugin.json required");

  const textFiles = decodeTextFiles(
    files.filter((file) => isTextFile(file.path, file.contentType)),
  );
  const readme =
    findFile(files, ["readme.md", "readme.mdx", "readme.markdown"]) ??
    findFile(files, ["package.json"]);
  const readmeContent = readme
    ? textDecoder.decode(readme.bytes)
    : `# ${readString(packageJson, "displayName") ?? readString(packageJson, "name") ?? basename(source)}`;
  const name =
    readString(packageJson, "name") ?? readString(pluginManifest, "id") ?? basename(source);
  const displayName =
    readString(packageJson, "displayName") ??
    readString(pluginManifest, "name") ??
    titleCase(name.split("/").at(-1) ?? name);
  const version = readString(packageJson, "version") ?? "local";
  const summary = readString(packageJson, "description");
  const fileSummaries = files.map((file) => ({ path: file.path, size: file.bytes.byteLength }));
  const metadata = { packageJson, pluginManifest };
  const staticScan = runStaticModerationScan({
    slug: name,
    displayName,
    summary,
    frontmatter: {},
    metadata,
    files: fileSummaries,
    fileContents: textFiles,
  });
  const injectionSignals = detectInjectionPatterns(
    [readmeContent, ...textFiles.map((file) => file.content)].join("\n"),
  );

  return {
    name,
    displayName,
    version,
    staticScan,
    evalCtx: {
      slug: name,
      displayName,
      ownerUserId: "local",
      version,
      createdAt: now(),
      summary,
      parsed: {
        frontmatter: {},
        metadata: {
          packageJson,
          pluginManifest,
          staticScan,
        },
      },
      files: fileSummaries,
      skillMdContent: readmeContent,
      fileContents: textFiles,
      injectionSignals,
      staticScan,
    } satisfies SkillEvalContext,
  };
}

async function evaluateWithLlm(params: {
  apiKey: string;
  ctx: SkillEvalContext;
  fetchImpl: typeof fetch;
  now: () => number;
  useSkillPrompt: boolean;
}): Promise<LocalLlmAnalysis> {
  const model = getLlmEvalModel();
  const requestBody = JSON.stringify({
    model,
    service_tier: getLlmEvalServiceTier(),
    instructions: SKILL_SECURITY_EVALUATOR_SYSTEM_PROMPT,
    input: params.useSkillPrompt
      ? assembleSkillEvalUserMessage(params.ctx)
      : assembleEvalUserMessage(params.ctx),
    reasoning: {
      effort: getLlmEvalReasoningEffort(),
    },
    max_output_tokens: LLM_EVAL_MAX_OUTPUT_TOKENS,
    text: {
      format: {
        type: "json_object",
      },
    },
  });

  const response = await params.fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: requestBody,
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${errorText.slice(0, 200)}`);
  }

  const raw = extractResponseText((await response.json()) as unknown);
  if (!raw) throw new Error("Empty response from OpenAI");
  const parsed = parseLlmEvalResponse(raw);
  if (!parsed) throw new Error("Failed to parse LLM evaluation response");
  const result = applyInjectionSignalFloor(parsed, params.ctx.injectionSignals);

  return {
    status: verdictToStatus(result.verdict),
    verdict: result.verdict,
    confidence: result.confidence,
    summary: result.summary,
    dimensions: result.dimensions,
    guidance: result.guidance,
    findings: result.findings || undefined,
    agenticRiskFindings: result.agenticRiskFindings,
    riskSummary: result.riskSummary,
    model,
    checkedAt: params.now(),
  };
}

function verdictToStatus(verdict: LlmEvalResponse["verdict"]): LocalLlmAnalysis["status"] {
  if (verdict === "benign") return "clean";
  if (verdict === "malicious" || verdict === "suspicious") return verdict;
  return "pending";
}

async function listTextFiles(root: string) {
  const files = await listPackageFiles(root);
  return files.filter((file) => isTextFile(file.path, file.contentType));
}

async function listPackageFiles(root: string) {
  const files: LocalFile[] = [];
  const absRoot = resolve(root);
  const ig = ignore();
  ig.add([".git/", "node_modules/", `${DOT_DIR}/`, `${LEGACY_DOT_DIR}/`]);
  await addIgnoreFile(ig, join(absRoot, ".gitignore"));
  await addIgnoreFile(ig, join(absRoot, DOT_IGNORE));
  await addIgnoreFile(ig, join(absRoot, LEGACY_DOT_IGNORE));

  await walk(absRoot, async (absPath) => {
    const path = normalizePath(relative(absRoot, absPath));
    if (!path || ig.ignores(path)) return;
    const bytes = new Uint8Array(await readFile(absPath));
    files.push({
      path,
      bytes,
      contentType: mime.getType(path) ?? "application/octet-stream",
    });
  });
  return files;
}

async function walk(dir: string, onFile: (path: string) => Promise<void>) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, onFile);
      continue;
    }
    if (entry.isFile()) await onFile(full);
  }
}

async function addIgnoreFile(ig: ReturnType<typeof ignore>, path: string) {
  try {
    ig.add((await readFile(path, "utf8")).split(/\r?\n/));
  } catch {
    // Optional ignore file.
  }
}

function decodeTextFiles(files: LocalFile[]): TextFile[] {
  return files.map((file) => ({ path: file.path, content: textDecoder.decode(file.bytes) }));
}

function findFile(files: LocalFile[], names: string[]) {
  const normalized = new Set(names.map((name) => name.toLowerCase()));
  return files.find((file) => normalized.has(file.path.toLowerCase()));
}

function readJsonFile(files: LocalFile[], path: string) {
  const file = findFile(files, [path]);
  if (!file) return undefined;
  try {
    const parsed = JSON.parse(textDecoder.decode(file.bytes)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function readString(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getFrontmatterDescription(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  return readString(metadata as Record<string, unknown>, "description");
}

function normalizePath(path: string) {
  return path
    .split(sep)
    .join("/")
    .replace(/^\.\/+/, "");
}

function titleCase(value: string) {
  return value
    .split(/[-_\s/]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function unquoteEnvValue(value: string) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseArgs(argv: string[]) {
  const options: { path?: string; kind?: ArtifactKind; json?: boolean } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--kind") {
      const kind = argv[++index];
      if (kind !== "skill" && kind !== "plugin") throw new Error("--kind must be skill or plugin");
      options.kind = kind;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}`);
    if (options.path) throw new Error("Only one path may be provided");
    options.path = arg;
  }

  if (!options.path) throw new Error("Path required");
  if (!options.kind) throw new Error("--kind required");
  return options as { path: string; kind: ArtifactKind; json?: boolean };
}

function printHuman(result: LocalClawScanDryRunResult) {
  console.log(`ClawScan dry run: ${result.kind}`);
  console.log(`Source: ${result.source}`);
  console.log(`Name: ${result.name}`);
  console.log(`Display: ${result.displayName}`);
  console.log(`Version: ${result.version}`);
  console.log(`Files: ${result.files.length}`);
  console.log("");
  console.log(`Static: ${result.staticScan.status}`);
  console.log(`Static summary: ${result.staticScan.summary}`);
  console.log(`Static engine: ${result.staticScan.engineVersion}`);
  if (result.staticScan.reasonCodes.length > 0) {
    console.log(`Static reason codes: ${result.staticScan.reasonCodes.join(", ")}`);
  }
  if (result.staticScan.findings.length > 0) {
    console.log("Static findings:");
    for (const finding of result.staticScan.findings) {
      console.log(
        `  ${finding.severity} ${finding.code} ${finding.file}:${finding.line} - ${finding.message}`,
      );
      console.log(`    ${finding.evidence}`);
    }
  }
  console.log("");
  console.log(`LLM: ${result.llmAnalysis.status}`);
  console.log(`LLM verdict: ${result.llmAnalysis.verdict}`);
  console.log(`LLM confidence: ${result.llmAnalysis.confidence}`);
  console.log(`LLM model: ${result.llmAnalysis.model}`);
  console.log(`LLM checked: ${new Date(result.llmAnalysis.checkedAt).toISOString()}`);
  console.log(`LLM summary: ${result.llmAnalysis.summary}`);
  if (result.llmAnalysis.guidance) console.log(`LLM guidance: ${result.llmAnalysis.guidance}`);
  if (result.llmAnalysis.findings) {
    console.log("LLM findings:");
    console.log(result.llmAnalysis.findings);
  }
}

export async function main(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);
  const result = await runLocalClawScanDryRun(parsed);
  if (parsed.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    printHuman(result);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
