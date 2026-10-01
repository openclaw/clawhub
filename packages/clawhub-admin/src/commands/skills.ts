import { requireAuthToken } from "../../../clawhub/src/cli/authToken.js";
import { getRegistry } from "../../../clawhub/src/cli/registry.js";
import type { GlobalOpts } from "../../../clawhub/src/cli/types.js";
import {
  createCrabLoader,
  fail,
  formatError,
  isInteractive,
  promptConfirm,
} from "../../../clawhub/src/cli/ui.js";
import { apiRequest } from "../../../clawhub/src/http.js";
import {
  ApiRoutes,
  ApiV1SkillHardDeleteResponseSchema,
} from "../../../clawhub/src/schema/index.js";

type SkillHardDeleteOptions = {
  reason?: string;
  apply?: boolean;
  confirm?: string;
  json?: boolean;
  yes?: boolean;
};

type OwnerQualifiedSkillRef = {
  ownerHandle: string;
  slug: string;
};

export async function cmdHardDeleteSkill(
  opts: GlobalOpts,
  skillRef: string,
  options: SkillHardDeleteOptions,
  inputAllowed: boolean,
) {
  const ref = parseOwnerQualifiedSkillRef(skillRef);
  const label = `@${ref.ownerHandle}/${ref.slug}`;
  const reason = options.reason?.trim();
  if (!reason) fail("--reason required");
  const dryRun = options.apply !== true;
  const confirmationToken = options.confirm?.trim();
  if (!dryRun && !confirmationToken) fail("--confirm required when using --apply");

  if (!dryRun && !options.yes) {
    const allowPrompt = isInteractive() && inputAllowed !== false;
    if (!allowPrompt) fail("Pass --yes (no input)");
    const confirmed = await promptConfirm(
      `Permanently hard-delete ${label} and all related history? (cannot be undone)`,
    );
    if (!confirmed) return undefined;
  }

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = options.json
    ? null
    : createCrabLoader(`${dryRun ? "Planning hard delete for" : "Hard-deleting"} ${label}`);
  try {
    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: `${ApiRoutes.skills}/${encodeURIComponent(ref.slug)}/hard-delete`,
        token,
        ...(dryRun ? {} : { retryCount: 0 }),
        body: {
          ownerHandle: ref.ownerHandle,
          reason,
          dryRun,
          ...(confirmationToken ? { confirmationToken } : {}),
        },
      },
      ApiV1SkillHardDeleteResponseSchema,
    );

    spinner?.succeed(
      result.scheduled
        ? `Scheduled hard delete for @${result.ownerHandle}/${result.slug}`
        : `Dry run OK for @${result.ownerHandle}/${result.slug}: pass --apply --confirm ${result.confirmationToken}`,
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

function parseOwnerQualifiedSkillRef(value: string): OwnerQualifiedSkillRef {
  const ref = value.trim();
  const slashIndex = ref.indexOf("/");
  if (slashIndex < 0 || ref.indexOf("/", slashIndex + 1) >= 0) {
    fail("Use an owner-qualified skill ref: @owner/slug");
  }

  const ownerHandle = ref.slice(0, slashIndex).trim().replace(/^@+/, "").toLowerCase();
  const slug = ref
    .slice(slashIndex + 1)
    .trim()
    .toLowerCase();
  if (
    !ownerHandle ||
    !slug ||
    ownerHandle.includes("\\") ||
    ownerHandle.includes("..") ||
    slug.includes("\\") ||
    slug.includes("..")
  ) {
    fail(`Invalid skill ref: ${value}`);
  }
  return { ownerHandle, slug };
}
