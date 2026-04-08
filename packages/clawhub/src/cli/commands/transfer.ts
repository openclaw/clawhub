import { apiRequest } from "../../http.js";
import {
  ApiRoutes,
  ApiV1TransferDecisionResponseSchema,
  ApiV1TransferListResponseSchema,
  ApiV1TransferRequestResponseSchema,
  parseArk,
} from "../../schema/index.js";
import { requireAuthToken } from "../authToken.js";
import { getRegistry } from "../registry.js";
import type { GlobalOpts } from "../types.js";
import { createSpinner, fail, formatError, isInteractive, promptConfirm } from "../ui.js";

type ConfirmOptions = { yes?: boolean };

type DecisionAction = "accept" | "reject" | "cancel";

type DecisionSpec = {
  verb: string;
  progress: string;
  success: string;
  action: DecisionAction;
};

const DECISION_SPECS: Record<DecisionAction, DecisionSpec> = {
  accept: {
    verb: "Accept",
    progress: "Accepting",
    success: "Transfer accepted",
    action: "accept",
  },
  reject: {
    verb: "Reject",
    progress: "Rejecting",
    success: "Transfer rejected",
    action: "reject",
  },
  cancel: {
    verb: "Cancel",
    progress: "Cancelling",
    success: "Transfer cancelled",
    action: "cancel",
  },
};

function normalizeName(nameArg: string) {
  const name = nameArg.trim().toLowerCase();
  if (!name) fail("Skill slug or package name required");
  return name;
}

function canPrompt(inputAllowed: boolean) {
  return isInteractive() && inputAllowed !== false;
}

async function requireYesOrConfirm(options: ConfirmOptions, inputAllowed: boolean, prompt: string) {
  if (options.yes) return true;
  if (!canPrompt(inputAllowed)) fail("Pass --yes (no input)");
  return promptConfirm(prompt);
}

async function resolveItemType(
  opts: GlobalOpts,
  name: string,
  explicitType?: string,
): Promise<"skill" | "package"> {
  if (explicitType === "skill" || explicitType === "package") return explicitType;
  if (explicitType) fail(`Invalid type "${explicitType}". Use "skill" or "package".`);

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });

  const [skillRes, pkgRes] = await Promise.all([
    fetch(
      new URL(
        `${ApiRoutes.skills}/${encodeURIComponent(name)}`,
        registry,
      ).toString(),
      { headers: { Authorization: `Bearer ${token}` } },
    ).then((r) => r.ok),
    fetch(
      new URL(
        `${ApiRoutes.packages}/${encodeURIComponent(name)}`,
        registry,
      ).toString(),
      { headers: { Authorization: `Bearer ${token}` } },
    ).then(async (r) => {
      if (!r.ok) return false;
      // The packages endpoint falls back to returning skills when no package
      // exists, so check that the response actually contains a package
      try {
        const body = await r.json();
        return Boolean(body?.package);
      } catch {
        return false;
      }
    }),
  ]);

  if (skillRes && pkgRes)
    fail(
      `Found both a skill and package named "${name}". Use --type skill or --type package to specify.`,
    );
  if (skillRes) return "skill";
  if (pkgRes) return "package";
  fail(
    `No skill or package named "${name}" found. If the item is private, use --type skill or --type package to skip auto-detection.`,
  );
}

function resolveApiPath(name: string, type: "skill" | "package"): string {
  return type === "package"
    ? `${ApiRoutes.packages}/${encodeURIComponent(name)}`
    : `${ApiRoutes.skills}/${encodeURIComponent(name)}`;
}

export async function cmdTransferRequest(
  opts: GlobalOpts,
  nameArg: string,
  toHandleArg: string,
  options: ConfirmOptions & { message?: string; type?: string; publisher?: string },
  inputAllowed: boolean,
) {
  const name = normalizeName(nameArg);
  const toHandle = toHandleArg.trim().replace(/^@+/, "").toLowerCase();
  if (!toHandle) fail("Recipient handle required (e.g., @username)");

  const itemType = await resolveItemType(opts, name, options.type);

  const confirmed = await requireYesOrConfirm(
    options,
    inputAllowed,
    `Transfer ${itemType} "${name}" to @${toHandle}? Recipient must accept.`,
  );
  if (!confirmed) return;

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = createSpinner(`Requesting transfer of ${itemType} "${name}" to @${toHandle}`);

  try {
    const body: Record<string, string | undefined> = {
      toUserHandle: toHandle,
      message: options.message,
    };
    if (options.publisher) {
      body.toPublisherHandle = options.publisher.replace(/^@+/, "");
    }

    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: `${resolveApiPath(name, itemType)}/transfer`,
        token,
        body,
      },
      ApiV1TransferRequestResponseSchema,
    );
    const parsed = parseArk(
      ApiV1TransferRequestResponseSchema,
      result,
      "Transfer request response",
    );
    spinner.succeed(`Transfer requested for ${itemType} "${name}" to @${parsed.toUserHandle}`);
    return parsed;
  } catch (error) {
    spinner.fail(formatError(error));
    throw error;
  }
}

export async function cmdTransferList(opts: GlobalOpts, options: { outgoing?: boolean }) {
  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = createSpinner("Fetching transfers");

  try {
    const path = options.outgoing
      ? `${ApiRoutes.transfers}/outgoing`
      : `${ApiRoutes.transfers}/incoming`;
    const result = await apiRequest(
      registry,
      { method: "GET", path, token },
      ApiV1TransferListResponseSchema,
    );
    const parsed = parseArk(ApiV1TransferListResponseSchema, result, "Transfer list response");
    spinner.stop();

    if (parsed.transfers.length === 0) {
      console.log(options.outgoing ? "No outgoing transfers." : "No incoming transfers.");
      return parsed;
    }

    console.log(options.outgoing ? "Outgoing transfers:" : "Incoming transfers:");
    console.log("  TYPE      NAME                  FROM/TO       EXPIRES");
    for (const transfer of parsed.transfers) {
      const otherHandle = options.outgoing ? transfer.toUser?.handle : transfer.fromUser?.handle;
      const other = otherHandle ? `@${otherHandle.replace(/^@+/, "")}` : "(unknown user)";
      const expiresInDays = Math.max(
        0,
        Math.ceil((transfer.expiresAt - Date.now()) / (24 * 60 * 60 * 1000)),
      );
      const itemType = transfer.type ?? "skill";
      const itemName = transfer.package?.name ?? transfer.skill?.slug ?? "(unknown)";
      console.log(
        `  ${itemType.padEnd(9)} ${itemName.padEnd(21)} ${other.padEnd(13)} ${expiresInDays}d`,
      );
    }
    return parsed;
  } catch (error) {
    spinner.fail(formatError(error));
    throw error;
  }
}

async function runTransferDecision(
  opts: GlobalOpts,
  nameArg: string,
  options: ConfirmOptions & { type?: string; publisher?: string },
  inputAllowed: boolean,
  spec: DecisionSpec,
) {
  const name = normalizeName(nameArg);
  const itemType = await resolveItemType(opts, name, options.type);

  const confirmed = await requireYesOrConfirm(
    options,
    inputAllowed,
    `${spec.verb} transfer of ${itemType} "${name}"?`,
  );
  if (!confirmed) return;

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = createSpinner(`${spec.progress} transfer of ${itemType} "${name}"`);

  try {
    const body: Record<string, string> | undefined =
      spec.action === "accept" && options.publisher
        ? { publisherHandle: options.publisher.replace(/^@+/, "") }
        : undefined;

    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: `${resolveApiPath(name, itemType)}/transfer/${spec.action}`,
        token,
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
      ApiV1TransferDecisionResponseSchema,
    );
    const parsed = parseArk(ApiV1TransferDecisionResponseSchema, result, "Transfer response");
    spinner.succeed(`${spec.success} (${name})`);
    return parsed;
  } catch (error) {
    spinner.fail(formatError(error));
    throw error;
  }
}

export function cmdTransferAccept(
  opts: GlobalOpts,
  nameArg: string,
  options: ConfirmOptions & { type?: string; publisher?: string },
  inputAllowed: boolean,
) {
  return runTransferDecision(opts, nameArg, options, inputAllowed, DECISION_SPECS.accept);
}

export function cmdTransferReject(
  opts: GlobalOpts,
  nameArg: string,
  options: ConfirmOptions & { type?: string },
  inputAllowed: boolean,
) {
  return runTransferDecision(opts, nameArg, options, inputAllowed, DECISION_SPECS.reject);
}

export function cmdTransferCancel(
  opts: GlobalOpts,
  nameArg: string,
  options: ConfirmOptions & { type?: string },
  inputAllowed: boolean,
) {
  return runTransferDecision(opts, nameArg, options, inputAllowed, DECISION_SPECS.cancel);
}
