import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { applicationReasoning } from "./applicationModelPolicy";
import { extractResponseText } from "./openaiResponse";

const CHANGELOG_TIMEOUT_MS = 10_000;
const MAX_README_CHARS = 8_000;
const MAX_PATHS_IN_PROMPT = 30;

type FileMeta = { path: string; sha256?: string };

type FileDiffSummary = {
  added: string[];
  removed: string[];
  changed: string[];
};

function clampText(value: string, maxChars: number) {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars).trimEnd()}\n…`;
}

function summarizeFileDiff(oldFiles: FileMeta[], nextFiles: FileMeta[]): FileDiffSummary {
  const oldByPath = new Map(oldFiles.map((f) => [f.path, f] as const));
  const nextByPath = new Map(nextFiles.map((f) => [f.path, f] as const));

  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  for (const [path, file] of nextByPath.entries()) {
    const prev = oldByPath.get(path);
    if (!prev) {
      added.push(path);
      continue;
    }
    if (file.sha256 && prev.sha256 && file.sha256 !== prev.sha256) changed.push(path);
  }
  for (const path of oldByPath.keys()) {
    if (!nextByPath.has(path)) removed.push(path);
  }

  added.sort();
  removed.sort();
  changed.sort();
  return { added, removed, changed };
}

function formatDiffSummary(diff: FileDiffSummary) {
  const parts: string[] = [];
  if (diff.added.length) parts.push(`${diff.added.length} added`);
  if (diff.changed.length) parts.push(`${diff.changed.length} changed`);
  if (diff.removed.length) parts.push(`${diff.removed.length} removed`);
  return parts.join(", ") || "no file changes detected";
}

function pickPaths(values: string[]) {
  if (values.length <= MAX_PATHS_IN_PROMPT) return values;
  return values.slice(0, MAX_PATHS_IN_PROMPT);
}

async function generateWithOpenAI(args: {
  subjectLabel?: string;
  readmeLabel?: string;
  slug: string;
  version: string;
  oldReadme: string | null;
  nextReadme: string;
  fileDiff: FileDiffSummary | null;
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const subjectLabel = args.subjectLabel ?? "Skill";
  const readmeLabel = args.readmeLabel ?? "SKILL.md";
  const oldReadme = args.oldReadme ? clampText(args.oldReadme, MAX_README_CHARS) : "";
  const nextReadme = clampText(args.nextReadme, MAX_README_CHARS);

  const fileDiff = args.fileDiff;
  const diffSummary = fileDiff ? formatDiffSummary(fileDiff) : "unknown";
  const changedPaths = fileDiff ? pickPaths(fileDiff.changed) : [];
  const addedPaths = fileDiff ? pickPaths(fileDiff.added) : [];
  const removedPaths = fileDiff ? pickPaths(fileDiff.removed) : [];

  const input = [
    `${subjectLabel}: ${args.slug}`,
    `Version: ${args.version}`,
    `File changes: ${diffSummary}`,
    changedPaths.length ? `Changed files (sample): ${changedPaths.join(", ")}` : null,
    addedPaths.length ? `Added files (sample): ${addedPaths.join(", ")}` : null,
    removedPaths.length ? `Removed files (sample): ${removedPaths.join(", ")}` : null,
    oldReadme ? `Previous ${readmeLabel}:\n${oldReadme}` : null,
    `New ${readmeLabel}:\n${nextReadme}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const model = process.env.OPENAI_CHANGELOG_MODEL ?? "gpt-6-luna";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      reasoning: applicationReasoning(model, "low"),
      service_tier: "default",
      instructions: `Write a concise changelog for this ${subjectLabel.toLowerCase()} version. Audience: everyone. Output plain text. Prefer 2–6 bullet points. If it is a big change, include a short 1-line summary first, then bullets. Don’t mention that you are AI. Don’t invent details; only use the inputs.`,
      input,
      max_output_tokens: 2_048,
    }),
    signal: AbortSignal.timeout(CHANGELOG_TIMEOUT_MS),
  });

  if (!response.ok) return null;
  const payload = (await response.json()) as unknown;
  return extractResponseText(payload);
}

function generateFallback(
  args: { oldReadme: string | null; fileDiff: FileDiffSummary | null },
  updatedContents = "SKILL.md and bundle contents",
) {
  const lines: string[] = [];
  if (!args.oldReadme) {
    lines.push(`- Initial release.`);
    return lines.join("\n");
  }

  const diff = args.fileDiff;
  if (diff) {
    const parts: string[] = [];
    if (diff.added.length) parts.push(`added ${diff.added.length}`);
    if (diff.changed.length) parts.push(`updated ${diff.changed.length}`);
    if (diff.removed.length) parts.push(`removed ${diff.removed.length}`);
    if (parts.length) lines.push(`- ${parts.join(", ")} file(s).`);
  }

  lines.push(`- Updated ${updatedContents}.`);
  return lines.join("\n");
}

async function generateFromPrevious(
  ctx: Pick<ActionCtx, "storage">,
  previous: { files: Array<FileMeta & { storageId: string }> } | null,
  args: { slug: string; version: string; readmeText: string; files?: FileMeta[] },
  kind: "skill" | "package" = "skill",
): Promise<string> {
  const readmeFile = previous?.files.find((file) => {
    const lower = file.path.toLowerCase();
    return kind === "package"
      ? lower === "readme.md" || lower === "readme.mdx"
      : lower === "skill.md" || lower === "skills.md";
  });
  const blob = readmeFile ? await ctx.storage.get(readmeFile.storageId as Id<"_storage">) : null;
  const oldReadmeText = blob ? await blob.text() : null;
  const fileDiff = previous && args.files ? summarizeFileDiff(previous.files, args.files) : null;
  const ai = await generateWithOpenAI({
    ...(kind === "package" ? { subjectLabel: "Package", readmeLabel: "README" } : {}),
    slug: args.slug,
    version: args.version,
    oldReadme: oldReadmeText,
    nextReadme: args.readmeText,
    fileDiff,
  }).catch(() => null);
  return (
    ai ??
    generateFallback(
      { oldReadme: oldReadmeText, fileDiff },
      kind === "package" ? "README and package contents" : undefined,
    )
  );
}

export async function generateChangelogForPublish(
  ctx: ActionCtx,
  args: { slug: string; version: string; readmeText: string; files: FileMeta[] },
): Promise<string> {
  try {
    const skill = (await ctx.runQuery(internal.skills.getSkillBySlugInternal, {
      slug: args.slug,
    })) as Doc<"skills"> | null;
    const previous: Doc<"skillVersions"> | null =
      skill?.latestVersionId && !skill.softDeletedAt
        ? ((await ctx.runQuery(internal.skills.getVersionByIdInternal, {
            versionId: skill.latestVersionId,
          })) as Doc<"skillVersions"> | null)
        : null;

    return await generateFromPrevious(ctx, previous, args);
  } catch {
    return "- Updated skill.";
  }
}

export async function generatePackageChangelogPreview(
  ctx: ActionCtx,
  args: {
    name: string;
    version: string;
    readmeText: string;
    filePaths?: string[];
    latestReleaseId?: Id<"packageReleases"> | null;
  },
): Promise<string> {
  try {
    const previous: Doc<"packageReleases"> | null = args.latestReleaseId
      ? ((await ctx.runQuery(internal.packages.getReleaseByIdInternal, {
          releaseId: args.latestReleaseId,
        })) as Doc<"packageReleases"> | null)
      : null;

    return await generateFromPrevious(
      ctx,
      previous,
      {
        slug: args.name,
        version: args.version,
        readmeText: args.readmeText,
        files: args.filePaths?.map((path) => ({ path })),
      },
      "package",
    );
  } catch {
    return "- Updated package.";
  }
}

export async function generateChangelogPreview(
  ctx: ActionCtx,
  args: {
    slug: string;
    version: string;
    readmeText: string;
    filePaths?: string[];
    previous: Doc<"skillVersions"> | null;
  },
): Promise<string> {
  try {
    // The caller supplies only a version it has already authorized for file access.
    const previous = args.previous;

    return await generateFromPrevious(ctx, previous, {
      slug: args.slug,
      version: args.version,
      readmeText: args.readmeText,
      files: args.filePaths?.map((path) => ({ path })),
    });
  } catch {
    return "- Updated skill.";
  }
}

export const __test = {
  CHANGELOG_TIMEOUT_MS,
  clampText,
  extractResponseText,
  formatDiffSummary,
  generateWithOpenAI,
  summarizeFileDiff,
  generateFallback,
};
