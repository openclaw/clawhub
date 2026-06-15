import { readFile } from "node:fs/promises";
import { requireAuthToken } from "../../../clawhub/src/cli/authToken.js";
import { getRegistry } from "../../../clawhub/src/cli/registry.js";
import type { GlobalOpts } from "../../../clawhub/src/cli/types.js";
import { createCrabLoader, fail, formatError } from "../../../clawhub/src/cli/ui.js";
import { apiRequest } from "../../../clawhub/src/http.js";
import { ApiRoutes, ApiV1StaffEmailSendResponseSchema } from "../../../clawhub/src/schema/index.js";

type StaffEmailSendOptions = {
  to?: string;
  user?: string;
  username?: string;
  recipientHandle?: string;
  subject?: string;
  title?: string;
  bodyFile?: string;
  body?: string;
  actionLabel?: string;
  actionUrl?: string;
  buttonText?: string;
  buttonLink?: string;
  send?: boolean;
  confirmUserRequest?: boolean;
  confirmUserSignoff?: boolean;
  json?: boolean;
};

const STAFF_EMAIL_TEMPLATE = "generic-one-off";

function normalizeEmail(value: string | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function normalizeHandle(value: string | undefined) {
  return value?.trim().replace(/^@+/, "").toLowerCase() ?? "";
}

function resolveAliasedValue(
  primaryValue: string | undefined,
  aliasValue: string | undefined,
  primaryFlag: string,
  aliasFlag: string,
) {
  const primary = primaryValue?.trim() ?? "";
  const alias = aliasValue?.trim() ?? "";
  if (primary && alias && primary !== alias) fail(`Pass ${primaryFlag} or ${aliasFlag}, not both`);
  return primary || alias;
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
  const username = normalizeHandle(options.username);
  const userHandle = normalizeHandle(
    resolveAliasedValue(options.user, !toEmail ? username : undefined, "--user", "--username"),
  );
  const recipientHandle = normalizeHandle(options.recipientHandle) || (toEmail ? username : "");
  if (toEmail && userHandle) fail("Pass --to or --user, not both");
  if (!toEmail && !userHandle) fail("--to or --user required");
  if (toEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(toEmail)) fail("--to must be an email address");
  return { toEmail, userHandle, recipientHandle };
}

function validateAction(options: StaffEmailSendOptions) {
  const label = resolveAliasedValue(
    options.actionLabel,
    options.buttonText,
    "--action-label",
    "--button-text",
  );
  const url = resolveAliasedValue(
    options.actionUrl,
    options.buttonLink,
    "--action-url",
    "--button-link",
  );
  if ((label && !url) || (!label && url)) {
    fail("Pass --action-label/--button-text and --action-url/--button-link together");
  }
  if (!label || !url) return undefined;
  if (label.length > 80) fail("--action-label is too long (max 80 chars)");
  if (url.length > 2_000) fail("--action-url is too long (max 2000 chars)");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    fail("--action-url must be an http(s) URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    fail("--action-url must be an http(s) URL");
  }
  return { label, url };
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
  const { toEmail, userHandle, recipientHandle } = resolveRecipient(options);
  const subject = options.subject?.trim();
  if (!subject) fail("--subject required");
  if (subject.length > 200) fail("--subject is too long (max 200 chars)");
  const title = options.title?.trim();
  if (title && title.length > 160) fail("--title is too long (max 160 chars)");
  const body = await readBody(options);
  if (body.length > 20_000) fail("Email body is too long (max 20000 chars)");
  const primaryAction = validateAction(options);

  const dryRun = options.send !== true;
  const preview = {
    ok: true as const,
    dryRun,
    template: STAFF_EMAIL_TEMPLATE,
    recipient: toEmail
      ? { email: toEmail, ...(recipientHandle ? { handle: recipientHandle } : {}) }
      : { userHandle },
    subject,
    ...(title ? { title } : {}),
    body,
    ...(primaryAction ? { primaryAction } : {}),
  };

  if (dryRun) {
    if (options.json) {
      process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
    } else {
      console.log("Staff email dry run. No email was sent.");
      console.log("Only send after the user explicitly asks for it and signs off on this draft.");
      console.log("");
      console.log(`To: ${toEmail || `@${userHandle}`}`);
      if (recipientHandle) console.log(`Username: ${recipientHandle}`);
      console.log(`Template: ${STAFF_EMAIL_TEMPLATE}`);
      console.log(`Subject: ${subject}`);
      if (title) console.log(`Title: ${title}`);
      if (primaryAction) console.log(`Action: ${primaryAction.label} <${primaryAction.url}>`);
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
  const spinner = options.json ? null : createCrabLoader("Sending staff email");
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
          ...(toEmail && recipientHandle ? { recipientHandle } : {}),
          template: STAFF_EMAIL_TEMPLATE,
          subject,
          ...(title ? { title } : {}),
          body,
          ...(primaryAction
            ? { primaryActionLabel: primaryAction.label, primaryActionUrl: primaryAction.url }
            : {}),
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
