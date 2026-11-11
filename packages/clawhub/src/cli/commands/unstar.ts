import { apiRequest, registryUrl } from "../../http.js";
import { ApiRoutes, ApiV1UnstarResponseSchema } from "../../schema/index.js";
import { requireAuthToken } from "../authToken.js";
import { withLoaderErrorHandling } from "../loader.js";
import { getRegistry } from "../registry.js";
import { parseSkillRef } from "../slug.js";
import type { GlobalOpts } from "../types.js";
import { createCrabLoader, fail, isInteractive, promptConfirm } from "../ui.js";

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

  const registry = await getRegistry(opts, { cache: true });
  const token = await requireAuthToken(registry);
  const spinner = createCrabLoader(`Unstarring ${slug}`);
  return await withLoaderErrorHandling(spinner, async () => {
    const result = await apiRequest(
      registry,
      unstarRequestArgs(registry, slug, requested.ownerHandle, token),
      ApiV1UnstarResponseSchema,
    );
    spinner.succeed(
      result.alreadyUnstarred ? `OK. ${slug} already unstarred.` : `OK. Unstarred ${slug}`,
    );
    return result;
  });
}
