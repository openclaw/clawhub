import { apiRequest, registryUrl } from "../../http.js";
import { ApiRoutes, ApiV1StarResponseSchema } from "../../schema/index.js";
import { requireAuthToken } from "../authToken.js";
import { getRegistry } from "../registry.js";
import { parseSkillRef } from "../slug.js";
import type { GlobalOpts } from "../types.js";
import { createCrabLoader, fail, formatError, isInteractive, promptConfirm } from "../ui.js";

function starRequestArgs(
  registry: string,
  slug: string,
  ownerHandle: string | undefined,
  token: string,
) {
  const path = `${ApiRoutes.stars}/${encodeURIComponent(slug)}`;
  if (!ownerHandle) return { method: "POST" as const, path, token };
  const url = registryUrl(path, registry);
  url.searchParams.set("ownerHandle", ownerHandle);
  return { method: "POST" as const, url: url.toString(), token };
}

export async function cmdStarSkill(
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
    const ok = await promptConfirm(`Star ${slug}?`);
    if (!ok) return undefined;
  }

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = createCrabLoader(`Starring ${slug}`);
  try {
    const result = await apiRequest(
      registry,
      starRequestArgs(registry, slug, requested.ownerHandle, token),
      ApiV1StarResponseSchema,
    );
    spinner.succeed(result.alreadyStarred ? `OK. ${slug} already starred.` : `OK. Starred ${slug}`);
    return result;
  } catch (error) {
    spinner.fail(formatError(error));
    throw error;
  }
}
