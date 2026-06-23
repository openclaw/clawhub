import { readFile, writeFile } from "node:fs/promises";
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
import type { ApiV1PackageRepairNameResponse } from "../../../clawhub/src/schema/index.js";
import {
  ApiV1OfficialPublisherListResponseSchema,
  ApiV1OfficialPublisherUpdateResponseSchema,
  ApiV1PackageRepairNameResponseSchema,
  ApiRoutes,
  ApiV1PublisherDeleteResponseSchema,
  ApiV1PublisherEnsureResponseSchema,
  ApiV1PublisherReclaimResponseSchema,
  ApiV1PublisherRemoveMemberResponseSchema,
} from "../../../clawhub/src/schema/index.js";

type OrgMemberRole = "owner" | "admin" | "publisher";

type OrgCreateOptions = {
  displayName?: string;
  member?: string;
  role?: string;
  trusted?: boolean;
  json?: boolean;
};

type OrgRemoveMemberOptions = {
  json?: boolean;
};

type OrgDeleteOptions = {
  apply?: boolean;
  reason?: string;
  json?: boolean;
};

type OrgReclaimOptions = {
  apply?: boolean;
  confirm?: string;
  reason?: string;
  json?: boolean;
};

type OrgOfficialListOptions = {
  json?: boolean;
};

type OrgOfficialWriteOptions = {
  reason?: string;
  yes?: boolean;
  json?: boolean;
};

type ScopedPackageRepairOptions = {
  apply?: boolean;
  json?: boolean;
  limit?: number;
  start?: number;
  reason?: string;
  resultFile?: string;
};

type ScopedPackageRepairRow = {
  packageName: string;
  intendedOrg: string;
  legacyOwner: string;
  orgDisplayName?: string;
};

type ScopedPackageRepairItemResult = {
  packageName: string;
  intendedOrg: string;
  legacyOwner: string;
  status: "planned" | "applied" | "failed";
  error?: string;
};

type ScopedPackageRepairSummary = {
  ok: boolean;
  dryRun: boolean;
  total: number;
  planned: number;
  applied: number;
  failed: number;
  items: ScopedPackageRepairItemResult[];
};

function normalizeHandleOrFail(handle: string, label: string) {
  const normalized = handle.trim().replace(/^@+/, "").toLowerCase();
  if (!normalized) fail(`${label} required`);
  return normalized;
}

function normalizeRoleOrFail(role: string | undefined): OrgMemberRole {
  const normalized = (role ?? "owner").trim().toLowerCase();
  if (normalized === "owner" || normalized === "admin" || normalized === "publisher") {
    return normalized;
  }
  return fail("--role must be owner, admin, or publisher");
}

export async function cmdCreateOrg(opts: GlobalOpts, handle: string, options: OrgCreateOptions) {
  const orgHandle = normalizeHandleOrFail(handle, "Org handle");
  const displayName = options.displayName?.trim();
  const memberHandle = options.member ? normalizeHandleOrFail(options.member, "--member") : "";
  if (!memberHandle) fail("--member required");
  const memberRole = normalizeRoleOrFail(options.role);
  const trusted = options.trusted === true ? true : undefined;

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = options.json ? null : createCrabLoader(`Creating @${orgHandle}`);
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

export async function cmdRemoveOrgMember(
  opts: GlobalOpts,
  handle: string,
  memberHandle: string,
  options: OrgRemoveMemberOptions = {},
) {
  const orgHandle = normalizeHandleOrFail(handle, "Org handle");
  const normalizedMemberHandle = normalizeHandleOrFail(memberHandle, "Member handle");

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = options.json
    ? null
    : createCrabLoader(`Removing @${normalizedMemberHandle} from @${orgHandle}`);
  try {
    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: `${ApiRoutes.users}/publisher-member`,
        token,
        body: {
          handle: orgHandle,
          memberHandle: normalizedMemberHandle,
        },
      },
      ApiV1PublisherRemoveMemberResponseSchema,
    );

    spinner?.succeed(
      result.removed
        ? `Removed @${result.member.handle} from @${result.handle}`
        : `@${result.member.handle} is not a member of @${result.handle}`,
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

export async function cmdDeleteOrg(
  opts: GlobalOpts,
  handle: string,
  options: OrgDeleteOptions = {},
) {
  const orgHandle = normalizeHandleOrFail(handle, "Org handle");
  const reason = options.reason?.trim();
  if (!reason) fail("--reason required");
  const dryRun = options.apply !== true;

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = options.json
    ? null
    : createCrabLoader(`${dryRun ? "Planning delete for" : "Deleting"} @${orgHandle}`);
  try {
    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: `${ApiRoutes.users}/publisher-delete`,
        token,
        ...(dryRun ? {} : { retryCount: 0 }),
        body: {
          handle: orgHandle,
          reason,
          dryRun,
        },
      },
      ApiV1PublisherDeleteResponseSchema,
    );

    spinner?.succeed(
      result.deleted
        ? `Deleted @${result.handle}; ${result.memberCount} member(s) retained for history`
        : `Dry run OK for @${result.handle}: ${result.activeSkills} active skill(s), ${result.activePackages} active package(s), ${result.memberCount} member(s)`,
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

export async function cmdReclaimDeletedOrgHandle(
  opts: GlobalOpts,
  handle: string,
  options: OrgReclaimOptions = {},
) {
  const orgHandle = normalizeHandleOrFail(handle, "Org handle");
  const reason = options.reason?.trim();
  if (!reason) fail("--reason required");
  const dryRun = options.apply !== true;
  const confirmationToken = options.confirm?.trim();
  if (!dryRun && !confirmationToken) fail("--confirm required when using --apply");

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = options.json
    ? null
    : createCrabLoader(`${dryRun ? "Planning reclaim for" : "Reclaiming"} @${orgHandle}`);
  try {
    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: `${ApiRoutes.users}/publisher-reclaim`,
        token,
        ...(dryRun ? {} : { retryCount: 0 }),
        body: {
          handle: orgHandle,
          reason,
          dryRun,
          ...(confirmationToken ? { confirmationToken } : {}),
        },
      },
      ApiV1PublisherReclaimResponseSchema,
    );

    spinner?.succeed(
      result.hardDeleted
        ? `Reclaimed @${result.handle}; hard-deleted ${result.memberCount} member row(s)`
        : `Dry run OK for @${result.handle}: pass --apply --confirm ${result.confirmationToken} to hard-delete ${result.memberCount} member row(s)`,
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

export async function cmdListOfficialOrgs(opts: GlobalOpts, options: OrgOfficialListOptions = {}) {
  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = options.json ? null : createCrabLoader("Listing official publishers");
  try {
    const result = await apiRequest(
      registry,
      {
        method: "GET",
        path: `${ApiRoutes.users}/publisher-official`,
        token,
      },
      ApiV1OfficialPublisherListResponseSchema,
    );

    spinner?.stop();
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return result;
    }

    const items = result.items.filter((item) => item.active);
    if (items.length === 0) {
      console.log("No official publishers.");
      return result;
    }

    for (const item of items) {
      const handle = item.handle ? `@${item.handle}` : item.publisherId;
      const displayName =
        item.displayName && item.displayName !== item.handle ? item.displayName : "";
      const reason = item.reason ? ` - ${item.reason}` : "";
      console.log([handle, displayName].filter(Boolean).join("  ") + reason);
    }
    return result;
  } catch (error) {
    spinner?.fail(formatError(error));
    throw error;
  }
}

export async function cmdAddOfficialOrg(
  opts: GlobalOpts,
  handle: string,
  options: OrgOfficialWriteOptions = {},
  inputAllowed: boolean,
) {
  const orgHandle = normalizeHandleOrFail(handle, "Publisher handle");
  const reason = normalizeReasonOrFail(options.reason);
  await confirmOfficialOrgUpdate(
    `Mark @${orgHandle} official? (admin only; affects official badge and GitHub sync eligibility)`,
    options,
    inputAllowed,
  );

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = options.json ? null : createCrabLoader(`Marking @${orgHandle} official`);
  try {
    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: `${ApiRoutes.users}/publisher-official`,
        token,
        body: {
          action: "add",
          handle: orgHandle,
          reason,
        },
      },
      ApiV1OfficialPublisherUpdateResponseSchema,
    );

    spinner?.succeed(
      result.added ? `Marked @${result.handle} official` : `@${result.handle} is already official`,
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

export async function cmdRemoveOfficialOrg(
  opts: GlobalOpts,
  handle: string,
  options: OrgOfficialWriteOptions = {},
  inputAllowed: boolean,
) {
  const orgHandle = normalizeHandleOrFail(handle, "Publisher handle");
  const reason = normalizeReasonOrFail(options.reason);
  await confirmOfficialOrgUpdate(
    `Remove @${orgHandle} from official publishers? (admin only)`,
    options,
    inputAllowed,
  );

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = options.json
    ? null
    : createCrabLoader(`Removing @${orgHandle} from official publishers`);
  try {
    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: `${ApiRoutes.users}/publisher-official`,
        token,
        body: {
          action: "remove",
          handle: orgHandle,
          reason,
        },
      },
      ApiV1OfficialPublisherUpdateResponseSchema,
    );

    spinner?.succeed(
      result.removed
        ? `Removed @${result.handle} from official publishers`
        : `@${result.handle} was not official`,
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

export async function cmdRepairScopedPackages(
  opts: GlobalOpts,
  csvPath: string,
  options: ScopedPackageRepairOptions = {},
) {
  const rows = parseScopedPackageRepairCsv(await readFile(csvPath, "utf8"));
  const start = Math.max(0, options.start ?? 0);
  const limit = options.limit && options.limit > 0 ? options.limit : rows.length;
  const selectedRows = rows.slice(start, start + limit);
  const dryRun = options.apply !== true;
  const defaultReason = (intendedOrg: string) =>
    `Move legacy personal package into @${intendedOrg}`;
  const items: ScopedPackageRepairItemResult[] = [];

  const spinner = options.json
    ? null
    : createCrabLoader(`${dryRun ? "Planning" : "Applying"} scoped package repairs`);

  try {
    if (dryRun) {
      for (const row of selectedRows) {
        items.push({
          packageName: row.packageName,
          intendedOrg: row.intendedOrg,
          legacyOwner: row.legacyOwner,
          status: "planned",
        });
      }
    } else {
      const token = await requireAuthToken();
      const registry = await getRegistry(opts, { cache: true });
      for (const row of selectedRows) {
        try {
          await apiRequest(
            registry,
            {
              method: "POST",
              path: `${ApiRoutes.users}/publisher`,
              token,
              body: {
                handle: row.intendedOrg,
                ...(row.orgDisplayName ? { displayName: row.orgDisplayName } : {}),
                memberHandle: row.legacyOwner,
                memberRole: "owner",
              },
            },
            ApiV1PublisherEnsureResponseSchema,
          );

          const reason = options.reason?.trim() || defaultReason(row.intendedOrg);
          const dryRunResult = await apiRequest(
            registry,
            {
              method: "POST",
              path: `${ApiRoutes.packages}/${encodeURIComponent(row.packageName)}/repair-name`,
              token,
              body: {
                nextName: row.packageName,
                owner: row.intendedOrg,
                reason,
                dryRun: true,
              },
            },
            ApiV1PackageRepairNameResponseSchema,
          );
          assertSafeScopedPackageTransfer(row, dryRunResult);
          await apiRequest(
            registry,
            {
              method: "POST",
              path: `${ApiRoutes.packages}/${encodeURIComponent(row.packageName)}/repair-name`,
              token,
              body: {
                nextName: row.packageName,
                owner: row.intendedOrg,
                reason,
                dryRun: false,
              },
            },
            ApiV1PackageRepairNameResponseSchema,
          );
          items.push({
            packageName: row.packageName,
            intendedOrg: row.intendedOrg,
            legacyOwner: row.legacyOwner,
            status: "applied",
          });
        } catch (error) {
          items.push({
            packageName: row.packageName,
            intendedOrg: row.intendedOrg,
            legacyOwner: row.legacyOwner,
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    const summary = summarizeScopedPackageRepairs(dryRun, rows.length, items);
    if (options.resultFile) {
      await writeFile(options.resultFile, `${JSON.stringify(summary, null, 2)}\n`);
    }
    spinner?.succeed(
      `${dryRun ? "Planned" : "Applied"} scoped package repairs: ${summary.planned || summary.applied} ok, ${summary.failed} failed`,
    );
    if (options.json) process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return summary;
  } catch (error) {
    spinner?.fail(formatError(error));
    throw error;
  }
}

function summarizeScopedPackageRepairs(
  dryRun: boolean,
  total: number,
  items: ScopedPackageRepairItemResult[],
): ScopedPackageRepairSummary {
  const planned = items.filter((item) => item.status === "planned").length;
  const applied = items.filter((item) => item.status === "applied").length;
  const failed = items.filter((item) => item.status === "failed").length;
  return { ok: failed === 0, dryRun, total, planned, applied, failed, items };
}

function normalizeReasonOrFail(rawReason: string | undefined) {
  const reason = rawReason?.trim();
  if (!reason) fail("--reason required");
  if (reason.length > 500) fail("--reason must be 500 characters or fewer");
  return reason;
}

async function confirmOfficialOrgUpdate(
  prompt: string,
  options: OrgOfficialWriteOptions,
  inputAllowed: boolean,
) {
  if (options.yes) return;
  if (!isInteractive() || inputAllowed === false) fail("Pass --yes (no input)");
  const confirmed = await promptConfirm(prompt);
  if (!confirmed) fail("Canceled");
}

function parseScopedPackageRepairCsv(content: string): ScopedPackageRepairRow[] {
  const records = parseCsvRecords(content).filter((record) =>
    record.some((cell) => cell.trim().length > 0),
  );
  const header = records.shift()?.map((cell) => cell.trim()) ?? [];
  const required = ["packageName", "intendedOrg", "legacyOwner"];
  for (const name of required) {
    if (!header.includes(name)) fail(`CSV missing required column: ${name}`);
  }
  return records.map((record, index) => {
    const row = Object.fromEntries(
      header.map((name, columnIndex) => [name, record[columnIndex]?.trim() ?? ""]),
    );
    const packageName = row.packageName;
    const intendedOrg = normalizeHandleOrFail(
      row.intendedOrg ?? "",
      `row ${index + 2} intendedOrg`,
    );
    const legacyOwner = normalizeHandleOrFail(
      row.legacyOwner ?? "",
      `row ${index + 2} legacyOwner`,
    );
    const scopedOrg = getScopedPackageOwner(packageName);
    if (!scopedOrg) fail(`row ${index + 2} packageName must be scoped`);
    if (scopedOrg !== intendedOrg) {
      fail(`row ${index + 2} intendedOrg must match package scope @${scopedOrg}`);
    }
    if (legacyOwner === intendedOrg) {
      fail(`row ${index + 2} legacyOwner already matches intendedOrg`);
    }
    return {
      packageName,
      intendedOrg,
      legacyOwner,
      orgDisplayName: row.orgDisplayName?.trim() || undefined,
    };
  });
}

function parseCsvRecords(content: string) {
  const records: string[][] = [];
  let current = "";
  let row: string[] = [];
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];
    if (quoted && char === '"' && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === ",") {
      row.push(current);
      current = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(current);
      records.push(row);
      row = [];
      current = "";
    } else {
      current += char;
    }
  }
  if (current.length > 0 || row.length > 0) {
    row.push(current);
    records.push(row);
  }
  return records;
}

function getScopedPackageOwner(packageName: string) {
  const match = packageName.trim().match(/^@([^/]+)\//);
  return match ? normalizeHandleOrFail(match[1] ?? "", "package scope") : undefined;
}

function assertSafeScopedPackageTransfer(
  row: ScopedPackageRepairRow,
  result: ApiV1PackageRepairNameResponse,
) {
  const operations = result.operations ?? [];
  const operation = operations[0];
  if (
    !result.dryRun ||
    result.retiredName ||
    operations.length !== 1 ||
    operation?.action !== "transfer-owner" ||
    operation.owner !== row.intendedOrg ||
    result.source.name !== row.packageName ||
    result.target?.packageId !== result.source.packageId
  ) {
    throw new Error(`Unsafe transfer plan for ${row.packageName}`);
  }
}
