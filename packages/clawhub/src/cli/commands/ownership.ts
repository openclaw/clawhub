import { apiRequest } from "../../http.js";
import {
  ApiRoutes,
  ApiV1SkillMergeResponseSchema,
  ApiV1SkillRenameResponseSchema,
  parseArk,
} from "../../schema/index.js";
import { requireAuthToken } from "../authToken.js";
import { getRegistry } from "../registry.js";
import type { GlobalOpts } from "../types.js";
import { createSpinner, fail, formatError, isInteractive, promptConfirm } from "../ui.js";

type ConfirmOptions = { yes?: boolean };

type SkillRef = {
  slug: string;
  ownerHandle?: string;
};

function normalizeOwnerHandle(raw: string | null | undefined) {
  const handle = raw?.trim().replace(/^@+/, "").toLowerCase();
  if (!handle) return undefined;
  if (handle.includes("/") || handle.includes("\\") || handle.includes("..")) {
    fail(`Invalid owner handle: ${raw}`);
  }
  return handle;
}

function normalizeSlug(slugArg: string, label = "Skill") {
  const slug = slugArg.trim().toLowerCase();
  if (!slug) fail(`${label} required`);
  if (slug.includes("/") || slug.includes("\\") || slug.includes("..")) {
    fail(`Invalid ${label.toLowerCase()}: ${slugArg}`);
  }
  return slug;
}

function parseSkillRef(raw: string, label = "Skill"): SkillRef {
  const ref = raw.trim();
  if (!ref) fail(`${label} required`);
  const slashIndex = ref.indexOf("/");
  if (slashIndex < 0) return { slug: normalizeSlug(ref, label) };
  if (ref.indexOf("/", slashIndex + 1) >= 0) fail(`Invalid ${label.toLowerCase()} ref: ${ref}`);
  const ownerHandle = normalizeOwnerHandle(ref.slice(0, slashIndex));
  const slug = normalizeSlug(ref.slice(slashIndex + 1), label);
  if (!ownerHandle) fail(`Invalid ${label.toLowerCase()} ref: ${ref}`);
  return { slug, ownerHandle };
}

function formatSkillRef(ref: SkillRef) {
  return ref.ownerHandle ? `@${ref.ownerHandle}/${ref.slug}` : ref.slug;
}

function canPrompt(inputAllowed: boolean) {
  return isInteractive() && inputAllowed !== false;
}

async function requireYesOrConfirm(options: ConfirmOptions, inputAllowed: boolean, prompt: string) {
  if (options.yes) return true;
  if (!canPrompt(inputAllowed)) fail("Pass --yes (no input)");
  return promptConfirm(prompt);
}

export async function cmdRenameSkill(
  opts: GlobalOpts,
  slugArg: string,
  newSlugArg: string,
  options: ConfirmOptions,
  inputAllowed: boolean,
) {
  const source = parseSkillRef(slugArg);
  const slug = source.slug;
  const newSlug = normalizeSlug(newSlugArg, "New slug");
  if (slug === newSlug) fail("New slug must be different");

  const confirmed = await requireYesOrConfirm(
    options,
    inputAllowed,
    `Rename ${formatSkillRef(source)} to ${newSlug}? Old slug will redirect.`,
  );
  if (!confirmed) return undefined;

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = createSpinner(`Renaming ${formatSkillRef(source)} to ${newSlug}`);

  try {
    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: `${ApiRoutes.skills}/${encodeURIComponent(slug)}/rename`,
        token,
        body: {
          newSlug,
          ...(source.ownerHandle ? { ownerHandle: source.ownerHandle } : {}),
        },
      },
      ApiV1SkillRenameResponseSchema,
    );
    const parsed = parseArk(ApiV1SkillRenameResponseSchema, result, "Rename skill response");
    spinner.succeed(`Renamed ${parsed.previousSlug} to ${parsed.slug}`);
    return parsed;
  } catch (error) {
    spinner.fail(formatError(error));
    throw error;
  }
}

export async function cmdMergeSkill(
  opts: GlobalOpts,
  sourceSlugArg: string,
  targetSlugArg: string,
  options: ConfirmOptions,
  inputAllowed: boolean,
) {
  const source = parseSkillRef(sourceSlugArg, "Source skill");
  const target = parseSkillRef(targetSlugArg, "Target skill");
  const sourceSlug = source.slug;
  const targetSlug = target.slug;
  const targetOwnerHandle = target.ownerHandle ?? source.ownerHandle;
  if (sourceSlug === targetSlug && source.ownerHandle === targetOwnerHandle) {
    fail("Target slug must be different");
  }

  const confirmed = await requireYesOrConfirm(
    options,
    inputAllowed,
    `Merge ${formatSkillRef(source)} into ${formatSkillRef(target)}? Source slug will redirect and stop listing publicly.`,
  );
  if (!confirmed) return undefined;

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = createSpinner(`Merging ${formatSkillRef(source)} into ${formatSkillRef(target)}`);

  try {
    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: `${ApiRoutes.skills}/${encodeURIComponent(sourceSlug)}/merge`,
        token,
        body: {
          targetSlug,
          ...(source.ownerHandle
            ? { ownerHandle: source.ownerHandle, sourceOwnerHandle: source.ownerHandle }
            : {}),
          ...(targetOwnerHandle ? { targetOwnerHandle } : {}),
        },
      },
      ApiV1SkillMergeResponseSchema,
    );
    const parsed = parseArk(ApiV1SkillMergeResponseSchema, result, "Merge skill response");
    spinner.succeed(`Merged ${parsed.sourceSlug} into ${parsed.targetSlug}`);
    return parsed;
  } catch (error) {
    spinner.fail(formatError(error));
    throw error;
  }
}
