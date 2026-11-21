import { apiRequest } from "../http.js";
import { ApiRoutes, ApiV1SkillResolveResponseSchema } from "../schema/index.js";
import { formatError } from "./ui.js";

export async function resolveSkillVersion(
  registry: string,
  params: URLSearchParams,
  token?: string,
) {
  try {
    return await apiRequest(
      registry,
      { method: "GET", path: `${ApiRoutes.resolve}?${params.toString()}`, token },
      ApiV1SkillResolveResponseSchema,
    );
  } catch (error) {
    if (/skill not found|HTTP 404/i.test(formatError(error))) {
      return { match: null, latestVersion: null };
    }
    throw error;
  }
}
