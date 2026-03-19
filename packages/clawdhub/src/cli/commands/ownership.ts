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

function normalizeSlug(slugArg: string, label = "Skill slug") {
  const slug = slugArg.trim().toLowerCase();
  if (!slug) fail(`${label} required`);
  return slug;
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
  const slug = normalizeSlug(slugArg);
  const newSlug = normalizeSlug(newSlugArg, "New slug");
  if (slug === newSlug) fail("New slug must be different");

  const confirmed = await requireYesOrConfirm(
    options,
    inputAllowed,
    `Rename ${slug} to ${newSlug}? Old slug will redirect.`,
  );
  if (!confirmed) return;

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = createSpinner(`Renaming ${slug} to ${newSlug}`);

  try {
    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: `${ApiRoutes.skills}/${encodeURIComponent(slug)}/rename`,
        token,
        body: JSON.stringify({ newSlug }),
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
  const sourceSlug = normalizeSlug(sourceSlugArg, "Source slug");
  const targetSlug = normalizeSlug(targetSlugArg, "Target slug");
  if (sourceSlug === targetSlug) fail("Target slug must be different");

  const confirmed = await requireYesOrConfirm(
    options,
    inputAllowed,
    `Merge ${sourceSlug} into ${targetSlug}? Source slug will redirect and stop listing publicly.`,
  );
  if (!confirmed) return;

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = createSpinner(`Merging ${sourceSlug} into ${targetSlug}`);

  try {
    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: `${ApiRoutes.skills}/${encodeURIComponent(sourceSlug)}/merge`,
        token,
        body: JSON.stringify({ targetSlug }),
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
