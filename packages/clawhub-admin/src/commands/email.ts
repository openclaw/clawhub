import { readFile } from "node:fs/promises";
import { requireAuthToken } from "../../../clawhub/src/cli/authToken.js";
import { getRegistry } from "../../../clawhub/src/cli/registry.js";
import type { GlobalOpts } from "../../../clawhub/src/cli/types.js";
import { createSpinner, fail, formatError } from "../../../clawhub/src/cli/ui.js";
import { apiRequest } from "../../../clawhub/src/http.js";
import { ApiRoutes, ApiV1StaffEmailSendResponseSchema } from "../../../clawhub/src/schema/index.js";

type StaffEmailSendOptions = {
  to?: string;
  user?: string;
  subject?: string;
  bodyFile?: string;
  body?: string;
  send?: boolean;
  confirmUserRequest?: boolean;
  confirmUserSignoff?: boolean;
  json?: boolean;
};

function normalizeEmail(value: string | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function normalizeHandle(value: string | undefined) {
  return value?.trim().replace(/^@+/, "").toLowerCase() ?? "";
}

async function readBody(options: StaffEmailSendOptions) {
  const bodyFile = options.bodyFile?.trim();
  const inlineBody = options.body?.trim();
  if (bodyFile && inlineBody) fail("Pass --body-file or --body, not both");
  if (!bodyFile && !inlineBody) fail("--body-file required (or --body for short test messages)");
  const body = bodyFile ? await readFile(bodyFile, "utf8") : (inlineBody ?? "");
  const trimmed = body.trim();
  if (!trimmed) fail("Email body must not be empty");
  return trimmed;
}

function resolveRecipient(options: StaffEmailSendOptions) {
  const toEmail = normalizeEmail(options.to);
  const userHandle = normalizeHandle(options.user);
  if (toEmail && userHandle) fail("Pass --to or --user, not both");
  if (!toEmail && !userHandle) fail("--to or --user required");
  if (toEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(toEmail)) fail("--to must be an email address");
  return { toEmail, userHandle };
}

function requireSendSignoff(options: StaffEmailSendOptions) {
  if (!options.confirmUserRequest || !options.confirmUserSignoff) {
    fail(
      [
        "Refusing to send.",
        "Use this command only when the user explicitly asked for the email.",
        "Before sending, the user must sign off on the final recipient, subject, and body.",
        "Then rerun with --send --confirm-user-request --confirm-user-signoff.",
      ].join(" "),
    );
  }
}

export async function cmdSendStaffEmail(opts: GlobalOpts, options: StaffEmailSendOptions = {}) {
  const { toEmail, userHandle } = resolveRecipient(options);
  const subject = options.subject?.trim();
  if (!subject) fail("--subject required");
  if (subject.length > 200) fail("--subject is too long (max 200 chars)");
  const body = await readBody(options);
  if (body.length > 20_000) fail("Email body is too long (max 20000 chars)");

  const dryRun = options.send !== true;
  const preview = {
    ok: true as const,
    dryRun,
    recipient: toEmail ? { email: toEmail } : { userHandle },
    subject,
    body,
  };

  if (dryRun) {
    if (options.json) {
      process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
    } else {
      console.log("Staff email dry run. No email was sent.");
      console.log("Only send after the user explicitly asks for it and signs off on this draft.");
      console.log("");
      console.log(`To: ${toEmail || `@${userHandle}`}`);
      console.log(`Subject: ${subject}`);
      console.log("");
      console.log(body);
      console.log("");
      console.log("To send: rerun with --send --confirm-user-request --confirm-user-signoff");
    }
    return preview;
  }

  requireSendSignoff(options);
  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = options.json ? null : createSpinner("Sending staff email");
  try {
    const result = await apiRequest(
      registry,
      {
        method: "POST",
        path: `${ApiRoutes.users}/email`,
        token,
        retryCount: 0,
        body: {
          ...(toEmail ? { toEmail } : {}),
          ...(userHandle ? { userHandle } : {}),
          subject,
          body,
          confirmUserRequest: true,
          confirmUserSignoff: true,
        },
      },
      ApiV1StaffEmailSendResponseSchema,
    );
    spinner?.succeed(`Sent email to ${result.recipient.handle ?? result.recipient.email}`);
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    }
    return result;
  } catch (error) {
    spinner?.fail(formatError(error));
    throw error;
  }
}
