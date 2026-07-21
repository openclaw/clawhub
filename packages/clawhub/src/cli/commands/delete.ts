import { apiRequest } from "../../http.js";
import { ApiRoutes, ApiV1DeleteResponseSchema, parseArk } from "../../schema/index.js";
import { requireAuthToken } from "../authToken.js";
import { getRegistry } from "../registry.js";
import type { GlobalOpts } from "../types.js";
import { createCrabLoader, fail, formatError, isInteractive, promptConfirm } from "../ui.js";

type SkillActionLabels = {
  verb: string;
  progress: string;
  past: string;
  promptSuffix?: string;
};

type SkillActionOptions = {
  yes?: boolean;
  reason?: string;
  note?: string;
};

type SkillRef = {
  slug: string;
  ownerHandle?: string;
};

type SkillDeleteOptions = SkillActionOptions & {
  version?: string;
};

const deleteLabels: SkillActionLabels = {
  verb: "Delete",
  progress: "Deleting",
  past: "Deleted",
  promptSuffix: "soft delete; owner slug reservation expires after 30 days",
};

const undeleteLabels: SkillActionLabels = {
  verb: "Undelete",
  progress: "Undeleting",
  past: "Undeleted",
  promptSuffix: "owner/moderator/admin",
};

const hideLabels: SkillActionLabels = {
  verb: "Hide",
  progress: "Hiding",
  past: "Hidden",
  promptSuffix: "owner/moderator/admin",
};

const unhideLabels: SkillActionLabels = {
  verb: "Unhide",
  progress: "Unhiding",
  past: "Unhidden",
  promptSuffix: "owner/moderator/admin",
};

export async function cmdDeleteSkill(
  opts: GlobalOpts,
  slugArg: string,
  options: SkillDeleteOptions,
  inputAllowed: boolean,
  labels: SkillActionLabels = deleteLabels,
) {
  const ref = parseSkillRef(slugArg);
  const slug = ref.slug;
  const reason = normalizeReason(options);
  const version = normalizeVersion(options.version);
  if (version && reason) fail("--reason/--note apply only to whole-skill deletion");
  const allowPrompt = isInteractive() && inputAllowed !== false;

  if (!options.yes) {
    if (!allowPrompt) fail("Pass --yes (no input)");
    const ok = await promptConfirm(formatPrompt(labels, formatSkillRef(ref), version));
    if (!ok) return undefined;
  }

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const target = version ? `${formatSkillRef(ref)} version ${version}` : formatSkillRef(ref);
  const spinner = createCrabLoader(`${labels.progress} ${target}`);
  try {
    const body = buildBody(reason, ref.ownerHandle, version);
    const result = await apiRequest(
      registry,
      {
        method: "DELETE",
        path: `${ApiRoutes.skills}/${encodeURIComponent(slug)}${
          version ? `/versions/${encodeURIComponent(version)}` : ""
        }`,
        token,
        body,
        ...(version ? { retryCount: 0 } : {}),
      },
      ApiV1DeleteResponseSchema,
    );
    const parsed = parseArk(ApiV1DeleteResponseSchema, result, "Delete response");
    spinner.succeed(`OK. ${labels.past} ${target}${version ? "" : formatSlugReservation(parsed)}`);
    return parsed;
  } catch (error) {
    spinner.fail(formatError(error));
    throw error;
  }
}

export async function cmdUndeleteSkill(
  opts: GlobalOpts,
  slugArg: string,
  options: SkillDeleteOptions,
  inputAllowed: boolean,
  labels: SkillActionLabels = undeleteLabels,
) {
  const ref = parseSkillRef(slugArg);
  const slug = ref.slug;
  const reason = normalizeReason(options);
  const version = normalizeVersion(options.version);
  if (version && reason) fail("--reason/--note apply only to whole-skill restoration");
  const allowPrompt = isInteractive() && inputAllowed !== false;

  if (!options.yes) {
    if (!allowPrompt) fail("Pass --yes (no input)");
    const ok = await promptConfirm(
      version
        ? `Restore ${formatSkillRef(ref)} version ${version}? (restores the exact retained artifact; does not make it latest or restore tags)`
        : formatPrompt(labels, formatSkillRef(ref)),
    );
    if (!ok) return undefined;
  }

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const target = version ? `${formatSkillRef(ref)} version ${version}` : formatSkillRef(ref);
  const spinner = createCrabLoader(`${labels.progress} ${target}`);
  try {
    const body = buildBody(reason, ref.ownerHandle, version);
    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: version
          ? `${ApiRoutes.skills}/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}/restore`
          : `${ApiRoutes.skills}/${encodeURIComponent(slug)}/undelete`,
        token,
        body,
        ...(version ? { retryCount: 0 } : {}),
      },
      ApiV1DeleteResponseSchema,
    );
    spinner.succeed(`OK. ${labels.past} ${target}`);
    return parseArk(ApiV1DeleteResponseSchema, result, "Undelete response");
  } catch (error) {
    spinner.fail(formatError(error));
    throw error;
  }
}

export async function cmdHideSkill(
  opts: GlobalOpts,
  slugArg: string,
  options: SkillActionOptions,
  inputAllowed: boolean,
) {
  return cmdDeleteSkill(opts, slugArg, options, inputAllowed, hideLabels);
}

export async function cmdUnhideSkill(
  opts: GlobalOpts,
  slugArg: string,
  options: SkillActionOptions,
  inputAllowed: boolean,
) {
  return cmdUndeleteSkill(opts, slugArg, options, inputAllowed, unhideLabels);
}

function normalizeOwnerHandle(raw: string | null | undefined) {
  const handle = raw?.trim().replace(/^@+/, "").toLowerCase();
  if (!handle) return undefined;
  if (handle.includes("/") || handle.includes("\\") || handle.includes("..")) {
    fail(`Invalid owner handle: ${raw}`);
  }
  return handle;
}

function normalizeSlug(slugArg: string) {
  const slug = slugArg.trim().toLowerCase();
  if (!slug) fail("Slug required");
  if (slug.includes("/") || slug.includes("\\") || slug.includes("..")) {
    fail(`Invalid slug: ${slugArg}`);
  }
  return slug;
}

function parseSkillRef(raw: string): SkillRef {
  const ref = raw.trim();
  if (!ref) fail("Slug required");
  const slashIndex = ref.indexOf("/");
  if (slashIndex < 0) return { slug: normalizeSlug(ref) };
  if (ref.indexOf("/", slashIndex + 1) >= 0) fail(`Invalid skill ref: ${ref}`);
  const ownerHandle = normalizeOwnerHandle(ref.slice(0, slashIndex));
  const slug = normalizeSlug(ref.slice(slashIndex + 1));
  if (!ownerHandle) fail(`Invalid skill ref: ${ref}`);
  return { slug, ownerHandle };
}

function formatSkillRef(ref: SkillRef) {
  return ref.ownerHandle ? `@${ref.ownerHandle}/${ref.slug}` : ref.slug;
}

function buildBody(reason: string | undefined, ownerHandle: string | undefined, version?: string) {
  const body = {
    ...(version ? { version } : {}),
    ...(reason ? { reason } : {}),
    ...(ownerHandle ? { ownerHandle } : {}),
  };
  return Object.keys(body).length > 0 ? body : undefined;
}

function normalizeReason(options: SkillDeleteOptions) {
  const reason = options.reason?.trim();
  const note = options.note?.trim();
  if (reason && note && reason !== note) fail("Pass only one of --reason or --note");
  const value = reason || note;
  if ((options.reason !== undefined || options.note !== undefined) && !value) {
    fail("--reason cannot be empty");
  }
  return value;
}

function normalizeVersion(value: string | undefined) {
  if (value === undefined) return undefined;
  const version = value.trim();
  if (!version) fail("--version cannot be empty");
  return version;
}

function formatPrompt(labels: SkillActionLabels, slug: string, version?: string) {
  if (version) {
    return `${labels.verb} ${slug} version ${version}? (withdraws public access; the exact retained artifact can be restored, but the version number remains reserved; publish a replacement first if deleting the current latest version)`;
  }
  const suffix = labels.promptSuffix ? ` (${labels.promptSuffix})` : "";
  return `${labels.verb} ${slug}?${suffix}`;
}

function formatSlugReservation(result: { slugReservedUntil?: number }) {
  if (typeof result.slugReservedUntil !== "number") return "";
  return `. Slug reserved until ${new Date(result.slugReservedUntil).toISOString()}`;
}
