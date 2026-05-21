import { isCancel, select } from "@clack/prompts";
import { requireAuthToken } from "../../../clawhub/src/cli/authToken.js";
import { getRegistry } from "../../../clawhub/src/cli/registry.js";
import type { GlobalOpts } from "../../../clawhub/src/cli/types.js";
import {
  createSpinner,
  fail,
  formatError,
  isInteractive,
  promptConfirm,
} from "../../../clawhub/src/cli/ui.js";
import { apiRequest, registryUrl } from "../../../clawhub/src/http.js";
import {
  ApiRoutes,
  ApiV1BanUserResponseSchema,
  ApiV1ReclassifyBanResponseSchema,
  ApiV1RemediateAutobansResponseSchema,
  ApiV1SetRoleResponseSchema,
  ApiV1SkillRescanResponseSchema,
  ApiV1UnbanUserResponseSchema,
  ApiV1UserSearchResponseSchema,
  parseArk,
} from "../../../clawhub/src/schema/index.js";

export async function cmdBanUser(
  opts: GlobalOpts,
  identifierArg: string,
  options: { yes?: boolean; id?: boolean; fuzzy?: boolean; reason?: string },
  inputAllowed: boolean,
) {
  const raw = identifierArg.trim();
  if (!raw) fail("Handle or user id required");

  const reason = options.reason?.trim() || undefined;

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const allowPrompt = isInteractive() && inputAllowed !== false;
  const resolved = await resolveUserIdentifier(
    registry,
    token,
    raw,
    { id: options.id, fuzzy: options.fuzzy },
    allowPrompt,
  );
  if (!resolved) return undefined;
  if (!options.yes) {
    if (!allowPrompt) fail("Pass --yes (no input)");
    const ok = await promptConfirm(
      `Ban ${resolved.label}? (requires moderator/admin; deletes owned skills)`,
    );
    if (!ok) return undefined;
  }

  const spinner = createSpinner(`Banning ${resolved.label}`);
  try {
    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: `${ApiRoutes.users}/ban`,
        token,
        body: resolved.userId
          ? { userId: resolved.userId, reason }
          : { handle: resolved.handle, reason },
      },
      ApiV1BanUserResponseSchema,
    );
    const parsed = parseArk(ApiV1BanUserResponseSchema, result, "Ban user response");
    if (parsed.alreadyBanned) {
      spinner.succeed(`OK. ${resolved.label} already banned`);
      return parsed;
    }
    spinner.succeed(`OK. Banned ${resolved.label} (${formatDeletedSkills(parsed.deletedSkills)})`);
    return parsed;
  } catch (error) {
    spinner.fail(formatError(error));
    throw error;
  }
}

export async function cmdUnbanUser(
  opts: GlobalOpts,
  identifierArg: string,
  options: { yes?: boolean; id?: boolean; fuzzy?: boolean; reason?: string },
  inputAllowed: boolean,
) {
  const raw = identifierArg.trim();
  if (!raw) fail("Handle or user id required");

  const reason = options.reason?.trim() || undefined;

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const allowPrompt = isInteractive() && inputAllowed !== false;
  const resolved = await resolveUserIdentifier(
    registry,
    token,
    raw,
    { id: options.id, fuzzy: options.fuzzy },
    allowPrompt,
  );
  if (!resolved) return undefined;
  if (!options.yes) {
    if (!allowPrompt) fail("Pass --yes (no input)");
    const ok = await promptConfirm(
      `Unban ${resolved.label}? (admin only; restores eligible skills)`,
    );
    if (!ok) return undefined;
  }

  const spinner = createSpinner(`Unbanning ${resolved.label}`);
  try {
    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: `${ApiRoutes.users}/unban`,
        token,
        body: resolved.userId
          ? { userId: resolved.userId, reason }
          : { handle: resolved.handle, reason },
      },
      ApiV1UnbanUserResponseSchema,
    );
    const parsed = parseArk(ApiV1UnbanUserResponseSchema, result, "Unban user response");
    if (parsed.alreadyUnbanned) {
      spinner.succeed(`OK. ${resolved.label} already unbanned`);
      return parsed;
    }
    spinner.succeed(
      `OK. Unbanned ${resolved.label} (${formatRestoredSkills(parsed.restoredSkills)})`,
    );
    return parsed;
  } catch (error) {
    spinner.fail(formatError(error));
    throw error;
  }
}

export async function cmdSetRole(
  opts: GlobalOpts,
  identifierArg: string,
  roleArg: string,
  options: { yes?: boolean; id?: boolean; fuzzy?: boolean },
  inputAllowed: boolean,
) {
  const raw = identifierArg.trim();
  if (!raw) fail("Handle or user id required");
  const role = normalizeRole(roleArg);

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const allowPrompt = isInteractive() && inputAllowed !== false;
  const resolved = await resolveUserIdentifier(
    registry,
    token,
    raw,
    { id: options.id, fuzzy: options.fuzzy },
    allowPrompt,
  );
  if (!resolved) return undefined;
  if (!options.yes) {
    if (!allowPrompt) fail("Pass --yes (no input)");
    const ok = await promptConfirm(`Set role for ${resolved.label} to ${role}? (admin only)`);
    if (!ok) return undefined;
  }

  const spinner = createSpinner(`Setting role for ${resolved.label}`);
  try {
    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: `${ApiRoutes.users}/role`,
        token,
        body: resolved.userId
          ? { userId: resolved.userId, role }
          : { handle: resolved.handle, role },
      },
      ApiV1SetRoleResponseSchema,
    );
    const parsed = parseArk(ApiV1SetRoleResponseSchema, result, "Set role response");
    spinner.succeed(`OK. ${resolved.label} is now ${parsed.role}`);
    return parsed;
  } catch (error) {
    spinner.fail(formatError(error));
    throw error;
  }
}

export async function cmdRescanSkill(
  opts: GlobalOpts,
  slugArg: string,
  options: { version?: string; yes?: boolean; json?: boolean },
  inputAllowed: boolean,
) {
  const slug = normalizeSkillSlug(slugArg);
  const version = options.version?.trim();
  const allowPrompt = isInteractive() && inputAllowed !== false;

  if (!options.yes) {
    if (!allowPrompt) fail("Pass --yes (no input)");
    const target = version ? `${slug}@${version}` : `${slug} latest`;
    const ok = await promptConfirm(`Queue ClawScan rescan for ${target}? (moderator/admin)`);
    if (!ok) return undefined;
  }

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = options.json ? null : createSpinner(`Queueing ClawScan rescan for ${slug}`);
  try {
    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: `${ApiRoutes.skills}/${encodeURIComponent(slug)}/rescan`,
        token,
        body: version ? { version } : {},
      },
      ApiV1SkillRescanResponseSchema,
    );
    const parsed = parseArk(ApiV1SkillRescanResponseSchema, result, "Skill rescan response");
    spinner?.succeed(
      `OK. Queued ClawScan for ${parsed.slug}@${parsed.version} (${parsed.alreadyQueued ? "existing job" : "new job"}).`,
    );
    if (options.json) {
      process.stdout.write(`${JSON.stringify(parsed, null, 2)}\n`);
    }
    return parsed;
  } catch (error) {
    spinner?.fail(formatError(error));
    throw error;
  }
}

export async function cmdReclassifyBan(
  opts: GlobalOpts,
  identifierArg: string,
  options: {
    apply?: boolean;
    dryRun?: boolean;
    yes?: boolean;
    id?: boolean;
    fuzzy?: boolean;
    reason?: string;
    json?: boolean;
  },
  inputAllowed: boolean,
) {
  if (options.apply && options.dryRun) fail("Choose either --apply or --dry-run, not both");

  const raw = identifierArg.trim();
  if (!raw) fail("Handle or user id required");

  const reason = options.reason?.trim();
  if (!reason) fail("Reason required");
  if (reason.length > 500) fail("Reason too long (max 500 chars)");

  const dryRun = options.apply !== true;
  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const allowPrompt = isInteractive() && inputAllowed !== false;
  const resolved = await resolveUserIdentifier(
    registry,
    token,
    raw,
    { id: options.id, fuzzy: options.fuzzy },
    allowPrompt,
  );
  if (!resolved) return undefined;

  if (!dryRun && !options.yes) {
    if (!allowPrompt) fail("Pass --yes (no input)");
    const ok = await promptConfirm(
      `Reclassify ban for ${resolved.label} as "${reason}"? (admin only; no unban/restore)`,
    );
    if (!ok) return undefined;
  }

  const spinner = options.json
    ? null
    : createSpinner(
        `${dryRun ? "Planning" : "Applying"} ban reclassification for ${resolved.label}`,
      );
  try {
    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: `${ApiRoutes.users}/reclassify-ban`,
        token,
        body: {
          ...(resolved.userId ? { userId: resolved.userId } : { handle: resolved.handle }),
          reason,
          dryRun,
        },
      },
      ApiV1ReclassifyBanResponseSchema,
    );
    const parsed = parseArk(ApiV1ReclassifyBanResponseSchema, result, "Reclassify ban response");
    spinner?.succeed(
      `${dryRun ? "Dry run" : "Applied"} ban reclassification for ${resolved.label}: ${parsed.previousReason ?? "none"} -> ${parsed.nextReason}${parsed.changed ? "" : " (already set)"}.`,
    );
    if (options.json) {
      process.stdout.write(`${JSON.stringify(parsed, null, 2)}\n`);
    } else if (dryRun) {
      console.log("Re-run with --apply --yes to write this change.");
    }
    return parsed;
  } catch (error) {
    spinner?.fail(formatError(error));
    throw error;
  }
}

export async function cmdRemediateAutobans(
  opts: GlobalOpts,
  options: {
    apply?: boolean;
    dryRun?: boolean;
    user?: string;
    id?: boolean;
    since?: string;
    limit?: string | number;
    reason?: string;
    json?: boolean;
    all?: boolean;
    cursor?: string;
  },
  inputAllowed: boolean,
) {
  if (options.apply && options.dryRun) fail("Choose either --apply or --dry-run, not both");

  const dryRun = options.apply !== true;
  const target = options.user?.trim();
  const limit = normalizeOptionalPositiveInt(options.limit);
  const reason = options.reason?.trim();
  const since = options.since?.trim();
  let cursor = options.cursor?.trim() || null;

  if (reason && reason.length > 500) fail("Reason too long (max 500 chars)");
  if (since && Number.isNaN(Date.parse(since))) fail("Invalid --since date");
  if (options.all && target) fail("Use either --all or --user, not both");

  void inputAllowed;

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = options.json
    ? null
    : createSpinner(`${dryRun ? "Planning" : "Applying"} autoban remediation`);

  try {
    const pages = [];
    do {
      const body: Record<string, unknown> = { dryRun };
      if (target) {
        if (options.id) body.userId = target;
        else body.handle = normalizeHandle(target);
      }
      if (reason) body.reason = reason;
      if (since) body.since = since;
      if (limit !== undefined) body.limit = limit;
      if (cursor) body.cursor = cursor;

      const result = await apiRequest(
        registry,
        {
          method: "POST",
          path: `${ApiRoutes.users}/remediate-autobans`,
          token,
          body,
        },
        ApiV1RemediateAutobansResponseSchema,
      );
      const parsedPage = parseArk(
        ApiV1RemediateAutobansResponseSchema,
        result,
        "Remediate autobans response",
      );
      pages.push(parsedPage);
      cursor = parsedPage.nextCursor ?? null;
      if (!options.all || parsedPage.done) break;
    } while (cursor);

    const parsed = {
      ok: true as const,
      dryRun,
      scanned: pages.reduce((sum, page) => sum + page.scanned, 0),
      wouldUnban: pages.reduce((sum, page) => sum + page.wouldUnban, 0),
      unbanned: pages.reduce((sum, page) => sum + page.unbanned, 0),
      skipped: pages.reduce((sum, page) => sum + page.skipped, 0),
      restoredSkills: pages.reduce((sum, page) => sum + page.restoredSkills, 0),
      restoredPackages: pages.reduce((sum, page) => sum + page.restoredPackages, 0),
      items: pages.flatMap((page) => page.items),
      nextCursor: pages.at(-1)?.nextCursor ?? null,
      done: pages.at(-1)?.done ?? true,
    };
    spinner?.succeed(
      `${dryRun ? "Dry run" : "Applied"} autoban remediation: scanned ${parsed.scanned}, ${dryRun ? "would unban" : "unbanned"} ${dryRun ? parsed.wouldUnban : parsed.unbanned}, skipped ${parsed.skipped}.`,
    );
    if (options.json) {
      process.stdout.write(`${JSON.stringify(parsed, null, 2)}\n`);
    } else {
      console.log(
        `Restores: ${formatRestoredSkills(parsed.restoredSkills)}, ${formatRestoredPackages(parsed.restoredPackages)}.`,
      );
      if (!parsed.done && parsed.nextCursor) {
        console.log(`Next cursor: ${parsed.nextCursor}`);
      }
      if (dryRun) console.log("Re-run with --apply to write these changes.");
    }
    return parsed;
  } catch (error) {
    spinner?.fail(formatError(error));
    throw error;
  }
}

function normalizeHandle(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith("@") ? trimmed.slice(1).toLowerCase() : trimmed.toLowerCase();
}

function normalizeSkillSlug(value: string) {
  const slug = value.trim().toLowerCase();
  if (!slug) fail("Slug required");
  if (slug.includes("/") || slug.includes("\\") || slug.includes(".."))
    fail(`Invalid slug: ${slug}`);
  return slug;
}

type ResolvedUser = {
  handle: string | null;
  userId: string | null;
  label: string;
};

type UserSearchItem = {
  userId: string;
  handle: string | null;
  displayName?: string | null;
  name?: string | null;
  role?: "admin" | "moderator" | "user" | null;
};

async function resolveUserIdentifier(
  registry: string,
  token: string,
  raw: string,
  options: { id?: boolean; fuzzy?: boolean },
  allowPrompt: boolean,
): Promise<ResolvedUser | null> {
  const usesId = Boolean(options.id);
  if (usesId) {
    return { handle: null, userId: raw, label: raw };
  }

  const handle = normalizeHandle(raw);
  if (!options.fuzzy) {
    return { handle, userId: null, label: `@${handle}` };
  }

  const matches = await searchUsers(registry, token, raw);
  if (matches.items.length === 0) {
    fail(`No users matched "${raw}".`);
  }

  if (matches.items.length === 1) {
    const match = matches.items[0] as UserSearchItem;
    return {
      handle: match.handle ?? null,
      userId: match.userId,
      label: formatUserLabel(match),
    };
  }

  if (!allowPrompt) {
    fail(`Multiple users matched "${raw}". Use --id.\n${formatUserList(matches.items)}`);
  }

  const choice = await select({
    message: `Select a user for "${raw}"`,
    options: matches.items.map((item) => ({
      value: item.userId,
      label: formatUserLabel(item),
    })),
  });
  if (isCancel(choice)) return null;
  const selected = matches.items.find((item) => item.userId === choice);
  if (!selected) return null;
  return {
    handle: selected.handle ?? null,
    userId: selected.userId,
    label: formatUserLabel(selected),
  };
}

async function searchUsers(registry: string, token: string, query: string) {
  const url = registryUrl(ApiRoutes.users, registry);
  url.searchParams.set("q", query.trim());
  url.searchParams.set("limit", "10");
  const result = await apiRequest(
    registry,
    { method: "GET", url: url.toString(), token },
    ApiV1UserSearchResponseSchema,
  );
  return parseArk(ApiV1UserSearchResponseSchema, result, "User search response");
}

function formatUserLabel(user: UserSearchItem) {
  const handle = user.handle ? `@${user.handle}` : "unknown";
  const name = user.displayName ?? user.name;
  const role = user.role ? ` (${user.role})` : "";
  const label = name ? `${handle} - ${name}` : handle;
  return `${label}${role} - ${user.userId}`;
}

function formatUserList(users: UserSearchItem[]) {
  return users.map((user) => `- ${formatUserLabel(user)}`).join("\n");
}

function normalizeRole(value: string) {
  const role = value.trim().toLowerCase();
  if (role === "user" || role === "moderator" || role === "admin") return role;
  return fail("Role must be user|moderator|admin");
}

function normalizeOptionalPositiveInt(value: string | number | undefined) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) fail("Limit must be a positive integer");
  return Math.floor(parsed);
}

function formatDeletedSkills(count: number) {
  if (!Number.isFinite(count)) return "deleted skills unknown";
  if (count === 1) return "deleted 1 skill";
  return `deleted ${count} skills`;
}

function formatRestoredSkills(count: number | undefined) {
  if (!Number.isFinite(count)) return "restored skills unknown";
  if (count === 1) return "restored 1 skill";
  return `restored ${count} skills`;
}

function formatRestoredPackages(count: number | undefined) {
  if (!Number.isFinite(count)) return "restored packages unknown";
  if (count === 1) return "restored 1 package";
  return `restored ${count} packages`;
}
