import { apiRequest, registryUrl } from "../../http.js";
import {
  ApiRoutes,
  ApiV1StarResponseSchema,
  ApiV1UnstarResponseSchema,
} from "../../schema/index.js";
import { requireAuthToken } from "../authToken.js";
import { withLoaderErrorHandling } from "../loader.js";
import { getRegistry } from "../registry.js";
import { parseSkillRef } from "../slug.js";
import type { GlobalOpts } from "../types.js";
import { createCrabLoader, fail, isInteractive, promptConfirm } from "../ui.js";

function starRequestArgs(
  method: "POST" | "DELETE",
  registry: string,
  slug: string,
  ownerHandle: string | undefined,
  token: string,
) {
  const path = `${ApiRoutes.stars}/${encodeURIComponent(slug)}`;
  if (!ownerHandle) return { method, path, token };
  const url = registryUrl(path, registry);
  url.searchParams.set("ownerHandle", ownerHandle);
  return { method, url: url.toString(), token };
}

async function prepareStarCommand(
  opts: GlobalOpts,
  slugArg: string,
  options: { yes?: boolean },
  inputAllowed: boolean,
  verb: "Star" | "Unstar",
) {
  const requested = parseSkillRef(slugArg);
  const slug = requested.slug;
  const allowPrompt = isInteractive() && inputAllowed !== false;

  if (!options.yes) {
    if (!allowPrompt) fail("Pass --yes (no input)");
    const ok = await promptConfirm(`${verb} ${slug}?`);
    if (!ok) return undefined;
  }

  const registry = await getRegistry(opts, { cache: true });
  const token = await requireAuthToken(registry);
  return { registry, token, slug, ownerHandle: requested.ownerHandle };
}

export async function cmdStarSkill(
  opts: GlobalOpts,
  slugArg: string,
  options: { yes?: boolean },
  inputAllowed: boolean,
) {
  const prepared = await prepareStarCommand(opts, slugArg, options, inputAllowed, "Star");
  if (!prepared) return undefined;
  const { registry, token, slug, ownerHandle } = prepared;
  const spinner = createCrabLoader(`Starring ${slug}`);
  return await withLoaderErrorHandling(spinner, async () => {
    const result = await apiRequest(
      registry,
      starRequestArgs("POST", registry, slug, ownerHandle, token),
      ApiV1StarResponseSchema,
    );
    spinner.succeed(result.alreadyStarred ? `OK. ${slug} already starred.` : `OK. Starred ${slug}`);
    return result;
  });
}

export async function cmdUnstarSkill(
  opts: GlobalOpts,
  slugArg: string,
  options: { yes?: boolean },
  inputAllowed: boolean,
) {
  const prepared = await prepareStarCommand(opts, slugArg, options, inputAllowed, "Unstar");
  if (!prepared) return undefined;
  const { registry, token, slug, ownerHandle } = prepared;
  const spinner = createCrabLoader(`Unstarring ${slug}`);
  return await withLoaderErrorHandling(spinner, async () => {
    const result = await apiRequest(
      registry,
      starRequestArgs("DELETE", registry, slug, ownerHandle, token),
      ApiV1UnstarResponseSchema,
    );
    spinner.succeed(
      result.alreadyUnstarred ? `OK. ${slug} already unstarred.` : `OK. Unstarred ${slug}`,
    );
    return result;
  });
}
