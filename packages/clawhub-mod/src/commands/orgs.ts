import { requireAuthToken } from "../../../clawhub/src/cli/authToken.js";
import { getRegistry } from "../../../clawhub/src/cli/registry.js";
import type { GlobalOpts } from "../../../clawhub/src/cli/types.js";
import { createSpinner, fail, formatError } from "../../../clawhub/src/cli/ui.js";
import { apiRequest } from "../../../clawhub/src/http.js";
import {
  ApiRoutes,
  ApiV1PublisherEnsureResponseSchema,
} from "../../../clawhub/src/schema/index.js";

type OrgMemberRole = "owner" | "admin" | "publisher";

type OrgCreateOptions = {
  displayName?: string;
  member?: string;
  role?: string;
  trusted?: boolean;
  json?: boolean;
};

function normalizeHandleOrFail(handle: string, label: string) {
  const normalized = handle.trim().replace(/^@+/, "").toLowerCase();
  if (!normalized) fail(`${label} required`);
  return normalized;
}

function normalizeRoleOrFail(role: string | undefined): OrgMemberRole {
  const normalized = (role ?? "admin").trim().toLowerCase();
  if (normalized === "owner" || normalized === "admin" || normalized === "publisher") {
    return normalized;
  }
  return fail("--role must be owner, admin, or publisher");
}

export async function cmdCreateOrg(opts: GlobalOpts, handle: string, options: OrgCreateOptions) {
  const orgHandle = normalizeHandleOrFail(handle, "Org handle");
  const displayName = options.displayName?.trim();
  const memberHandle = options.member ? normalizeHandleOrFail(options.member, "--member") : "";
  const memberRole = memberHandle ? normalizeRoleOrFail(options.role) : undefined;
  const trusted = options.trusted === true ? true : undefined;

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = options.json ? null : createSpinner(`Creating @${orgHandle}`);
  try {
    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: `${ApiRoutes.users}/publisher`,
        token,
        body: {
          handle: orgHandle,
          ...(displayName ? { displayName } : {}),
          ...(typeof trusted === "boolean" ? { trusted } : {}),
          ...(memberHandle ? { memberHandle } : {}),
          ...(memberRole ? { memberRole } : {}),
        },
      },
      ApiV1PublisherEnsureResponseSchema,
    );

    spinner?.succeed(
      `${result.created ? "Created" : "Updated"} @${result.handle}${
        result.member ? ` and set @${result.member.handle} as ${result.member.role}` : ""
      }`,
    );
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    }
    return result;
  } catch (error) {
    spinner?.fail(formatError(error));
    throw error;
  }
}
