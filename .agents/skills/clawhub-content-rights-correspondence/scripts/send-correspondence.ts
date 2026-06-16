import { spawn } from "node:child_process";

const defaultFrom = "ClawHub <noreply@notifications.openclaw.ai>";

type CorrespondenceOptions = {
  caseId: string;
  subject: string;
  bodyFile: string;
  attachments: string[];
  send: boolean;
  confirmUserSignoff: boolean;
};

type Dependencies = {
  exec: (args: string[]) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
};

type HermitCase = {
  case: {
    caseId: string;
    email: string;
  };
};

export const buildAdminEmailArgs = (input: {
  to: string;
  subject: string;
  bodyFile: string;
  send: boolean;
  confirmUserSignoff: boolean;
}) => [
  "run",
  "admin",
  "--",
  "email",
  "send",
  "--to",
  input.to,
  "--subject",
  input.subject,
  "--body-file",
  input.bodyFile,
  "--json",
  ...(input.send ? ["--send", "--confirm-user-request", "--confirm-user-signoff"] : []),
];

const runJson = async <T>(dependencies: Dependencies, args: string[], context: string) => {
  const result = await dependencies.exec(args);
  if (result.exitCode !== 0) throw new Error(result.stderr || `${context} failed.`);
  return JSON.parse(result.stdout) as T;
};

export const runCorrespondence = async (
  options: CorrespondenceOptions,
  dependencies: Dependencies,
) => {
  if (options.send && !options.confirmUserSignoff) {
    throw new Error("Sending requires --confirm-user-signoff.");
  }
  const hermitCase = await runJson<HermitCase>(
    dependencies,
    ["run", "admin", "--", "content-rights", "get", options.caseId, "--json"],
    "Fetching content rights case",
  );
  const args = buildAdminEmailArgs({
    to: hermitCase.case.email,
    subject: options.subject,
    bodyFile: options.bodyFile,
    send: options.send,
    confirmUserSignoff: options.confirmUserSignoff,
  });
  const result = await runJson<{
    providerId?: string | null;
    providerMessageId?: string | null;
  }>(dependencies, args, "ClawHub staff email command");
  if (!options.send) {
    return { sent: false, preview: result };
  }

  try {
    const recordArgs = [
      "run",
      "admin",
      "--",
      "content-rights",
      "record-correspondence",
      options.caseId,
      "--direction",
      "outbound",
      "--to",
      hermitCase.case.email,
      "--from",
      defaultFrom,
      "--subject",
      options.subject,
      "--body-file",
      options.bodyFile,
      ...(result.providerId || result.providerMessageId
        ? ["--provider-message-id", result.providerId || result.providerMessageId || ""]
        : []),
      ...options.attachments.flatMap((path) => ["--attachment", path]),
      "--json",
    ];
    const record = await runJson<{ ok: true; caseId: string; storedFiles: number }>(
      dependencies,
      recordArgs,
      "Recording Hermit correspondence",
    );
    return { sent: true, email: result, record };
  } catch (error) {
    throw new Error(
      `Email sent, but Hermit evidence recording failed. Do not resend. ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
  }
};

const parseArgs = (args: string[]): CorrespondenceOptions => {
  const caseId = args[0]?.trim() ?? "";
  let subject = "";
  let bodyFile = "";
  const attachments: string[] = [];
  let send = false;
  let confirmUserSignoff = false;
  for (let index = 1; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--subject") subject = args[++index] ?? "";
    else if (flag === "--body-file") bodyFile = args[++index] ?? "";
    else if (flag === "--attachment") attachments.push(args[++index] ?? "");
    else if (flag === "--send") send = true;
    else if (flag === "--confirm-user-signoff") confirmUserSignoff = true;
    else throw new Error(`Unknown argument: ${flag}`);
  }
  if (!/^CHR-\d+$/.test(caseId)) throw new Error("Pass an existing CHR-... case id.");
  if (!subject.trim()) throw new Error("--subject is required.");
  if (!bodyFile.trim()) throw new Error("--body-file is required.");
  return { caseId, subject: subject.trim(), bodyFile, attachments, send, confirmUserSignoff };
};

const exec = async (args: string[]) => {
  const child = spawn("bun", args, { stdio: ["ignore", "pipe", "pipe"] });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
  return {
    stdout: Buffer.concat(stdout).toString("utf8"),
    stderr: Buffer.concat(stderr).toString("utf8"),
    exitCode,
  };
};

if (import.meta.main) {
  runCorrespondence(parseArgs(process.argv.slice(2)), {
    exec,
  })
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
