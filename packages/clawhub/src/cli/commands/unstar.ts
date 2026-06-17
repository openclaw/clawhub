import { apiRequest, registryUrl } from "../../http.js";
import { ApiRoutes, ApiV1UnstarResponseSchema } from "../../schema/index.js";
import { requireAuthToken } from "../authToken.js";
import { getRegistry } from "../registry.js";
import type { GlobalOpts } from "../types.js";
import { createCrabLoader, fail, formatError, isInteractive, promptConfirm } from "../ui.js";

function parseSkillRef(skillArg: string) {
  const value = skillArg.trim().toLowerCase();
  if (!value) fail("Skill required");
  const slashIndex = value.indexOf("/");
  if (slashIndex < 0) return { slug: value, ownerHandle: undefined };
  if (value.indexOf("/", slashIndex + 1) >= 0) fail(`Invalid skill ref: ${skillArg}`);
  const ownerHandle = value.slice(0, slashIndex).replace(/^@+/, "");
  const slug = value.slice(slashIndex + 1);
  if (!ownerHandle || !slug) fail(`Invalid skill ref: ${skillArg}`);
  return { slug, ownerHandle };
}

function unstarRequestArgs(
  registry: string,
  slug: string,
  ownerHandle: string | undefined,
  token: string,
) {
  const path = `${ApiRoutes.stars}/${encodeURIComponent(slug)}`;
  if (!ownerHandle) return { method: "DELETE" as const, path, token };
  const url = registryUrl(path, registry);
  url.searchParams.set("ownerHandle", ownerHandle);
  return { method: "DELETE" as const, url: url.toString(), token };
}

export async function cmdUnstarSkill(
  opts: GlobalOpts,
  slugArg: string,
  options: { yes?: boolean },
  inputAllowed: boolean,
) {
  const requested = parseSkillRef(slugArg);
  const slug = requested.slug;
  const allowPrompt = isInteractive() && inputAllowed !== false;

  if (!options.yes) {
    if (!allowPrompt) fail("Pass --yes (no input)");
    const ok = await promptConfirm(`Unstar ${slug}?`);
    if (!ok) return undefined;
  }

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = createCrabLoader(`Unstarring ${slug}`);
  try {
    const result = await apiRequest(
      registry,
      unstarRequestArgs(registry, slug, requested.ownerHandle, token),
      ApiV1UnstarResponseSchema,
    );
    spinner.succeed(
      result.alreadyUnstarred ? `OK. ${slug} already unstarred.` : `OK. Unstarred ${slug}`,
    );
    return result;
  } catch (error) {
    spinner.fail(formatError(error));
    throw error;
  }
}
