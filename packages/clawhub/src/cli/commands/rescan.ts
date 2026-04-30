import { apiRequest } from "../../http.js";
import {
  ApiRoutes,
  ApiV1RescanResponseSchema,
  parseArk,
  type ApiV1RescanResponse,
} from "../../schema/index.js";
import { requireAuthToken } from "../authToken.js";
import { getRegistry } from "../registry.js";
import type { GlobalOpts } from "../types.js";
import { createSpinner, fail, formatError, isInteractive, promptConfirm } from "../ui.js";

type RescanTargetKind = "skill" | "package";

type RescanOptions = {
  yes?: boolean;
  json?: boolean;
};

export async function cmdRescanSkill(
  opts: GlobalOpts,
  slugArg: string,
  options: RescanOptions,
  inputAllowed: boolean,
) {
  const slug = slugArg.trim().toLowerCase();
  if (!slug) fail("Slug required");
  return requestRescan(opts, "skill", slug, options, inputAllowed);
}

export async function cmdRescanPackage(
  opts: GlobalOpts,
  nameArg: string,
  options: RescanOptions,
  inputAllowed: boolean,
) {
  const name = nameArg.trim();
  if (!name) fail("Package name required");
  return requestRescan(opts, "package", name, options, inputAllowed);
}

async function requestRescan(
  opts: GlobalOpts,
  targetKind: RescanTargetKind,
  name: string,
  options: RescanOptions,
  inputAllowed: boolean,
) {
  const allowPrompt = isInteractive() && inputAllowed !== false;
  if (!options.yes) {
    if (!allowPrompt) fail("Pass --yes (no input)");
    const ok = await promptConfirm(`Request latest ${targetKind} rescan for ${name}?`);
    if (!ok) return undefined;
  }

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = createSpinner(`Requesting ${targetKind} rescan for ${name}`);
  try {
    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: buildRescanPath(targetKind, name),
        token,
      },
      ApiV1RescanResponseSchema,
    );
    const parsed = parseArk(ApiV1RescanResponseSchema, result, "Rescan response");
    if (options.json) {
      spinner.stop();
      console.log(JSON.stringify(parsed, null, 2));
    } else {
      spinner.succeed(formatRescanSuccess(parsed));
    }
    return parsed;
  } catch (error) {
    spinner.fail(formatError(error));
    throw error;
  }
}

function buildRescanPath(targetKind: RescanTargetKind, name: string) {
  const root = targetKind === "skill" ? ApiRoutes.skills : ApiRoutes.packages;
  return `${root}/${encodeURIComponent(name)}/rescan`;
}

function formatRescanSuccess(result: ApiV1RescanResponse) {
  const label = result.targetKind === "skill" ? "skill" : "package";
  return `OK. Requested ${label} rescan for ${result.name}@${result.version} (${result.remainingRequests}/${result.maxRequests} remaining)`;
}
