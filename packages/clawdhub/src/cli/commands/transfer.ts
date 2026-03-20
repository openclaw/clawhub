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

function normalizeSlug(slugArg: string) {
  const slug = slugArg.trim().toLowerCase();
  if (!slug) fail("Skill slug required");
  return slug;
}

function canPrompt(inputAllowed: boolean) {
  return isInteractive() && inputAllowed !== false;
}

async function requireYesOrConfirm(options: ConfirmOptions, inputAllowed: boolean, prompt: string) {
  if (options.yes) return true;
  if (!canPrompt(inputAllowed)) fail("Pass --yes (no input)");
  return promptConfirm(prompt);
}

export async function cmdTransferRequest(
  opts: GlobalOpts,
  slugArg: string,
  toHandleArg: string,
  options: ConfirmOptions & { message?: string },
  inputAllowed: boolean,
) {
  const slug = normalizeSlug(slugArg);
  const toHandle = toHandleArg.trim().replace(/^@+/, "").toLowerCase();
  if (!toHandle) fail("Recipient handle required (e.g., @username)");

  const confirmed = await requireYesOrConfirm(
    options,
    inputAllowed,
    `Transfer ${slug} to @${toHandle}? Recipient must accept.`,
  );
  if (!confirmed) return;

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = createSpinner(`Requesting transfer of ${slug} to @${toHandle}`);

  try {
    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: `${ApiRoutes.skills}/${encodeURIComponent(slug)}/transfer`,
        token,
        body: JSON.stringify({
          toUserHandle: toHandle,
          message: options.message,
        }),
      },
      ApiV1TransferRequestResponseSchema,
    );
    const parsed = parseArk(
      ApiV1TransferRequestResponseSchema,
      result,
      "Transfer request response",
    );
    spinner.succeed(`Transfer requested for ${slug} to @${parsed.toUserHandle}`);
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
    for (const transfer of parsed.transfers) {
      const otherHandle = options.outgoing ? transfer.toUser?.handle : transfer.fromUser?.handle;
      const other = otherHandle ? `@${otherHandle.replace(/^@+/, "")}` : "(unknown user)";
      const expiresInDays = Math.max(
        0,
        Math.ceil((transfer.expiresAt - Date.now()) / (24 * 60 * 60 * 1000)),
      );
      console.log(`  ${transfer.skill.slug} -> ${other} (expires in ${expiresInDays}d)`);
    }
    return parsed;
  } catch (error) {
    spinner.fail(formatError(error));
    throw error;
  }
}

async function runTransferDecision(
  opts: GlobalOpts,
  slugArg: string,
  options: ConfirmOptions,
  inputAllowed: boolean,
  spec: DecisionSpec,
) {
  const slug = normalizeSlug(slugArg);
  const confirmed = await requireYesOrConfirm(
    options,
    inputAllowed,
    `${spec.verb} transfer of ${slug}?`,
  );
  if (!confirmed) return;

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = createSpinner(`${spec.progress} transfer of ${slug}`);

  try {
    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: `${ApiRoutes.skills}/${encodeURIComponent(slug)}/transfer/${spec.action}`,
        token,
      },
      ApiV1TransferDecisionResponseSchema,
    );
    const parsed = parseArk(ApiV1TransferDecisionResponseSchema, result, "Transfer response");
    spinner.succeed(`${spec.success} (${slug})`);
    return parsed;
  } catch (error) {
    spinner.fail(formatError(error));
    throw error;
  }
}

export function cmdTransferAccept(
  opts: GlobalOpts,
  slugArg: string,
  options: ConfirmOptions,
  inputAllowed: boolean,
) {
  return runTransferDecision(opts, slugArg, options, inputAllowed, DECISION_SPECS.accept);
}

export function cmdTransferReject(
  opts: GlobalOpts,
  slugArg: string,
  options: ConfirmOptions,
  inputAllowed: boolean,
) {
  return runTransferDecision(opts, slugArg, options, inputAllowed, DECISION_SPECS.reject);
}

export function cmdTransferCancel(
  opts: GlobalOpts,
  slugArg: string,
  options: ConfirmOptions,
  inputAllowed: boolean,
) {
  return runTransferDecision(opts, slugArg, options, inputAllowed, DECISION_SPECS.cancel);
}
