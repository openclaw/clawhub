import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { requireAuthToken } from "../../../clawhub/src/cli/authToken.js";
import { getRegistry } from "../../../clawhub/src/cli/registry.js";
import type { GlobalOpts } from "../../../clawhub/src/cli/types.js";
import { fail } from "../../../clawhub/src/cli/ui.js";
import { apiRequest, apiRequestForm } from "../../../clawhub/src/http.js";
import { ApiRoutes } from "../../../clawhub/src/schema/index.js";

type GetOptions = { json?: boolean };

type RecordOptions = {
  direction?: string;
  to?: string;
  from?: string;
  subject?: string;
  bodyFile?: string;
  providerMessageId?: string;
  attachment?: string[];
  json?: boolean;
};

const normalizeCaseId = (value: string) => {
  const caseId = value.trim().toUpperCase();
  if (!/^CHR-\d+$/.test(caseId)) fail("Case id must match CHR-...");
  return caseId;
};

const contentTypeFor = (path: string) => {
  const extension = extname(path).toLowerCase();
  if (extension === ".pdf") return "application/pdf";
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".json") return "application/json";
  if (extension === ".txt" || extension === ".md") return "text/plain";
  return "application/octet-stream";
};

const output = (value: unknown, json?: boolean) => {
  if (json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  } else {
    console.log(JSON.stringify(value, null, 2));
  }
};

export async function cmdGetContentRightsCase(
  opts: GlobalOpts,
  rawCaseId: string,
  options: GetOptions = {},
) {
  const caseId = normalizeCaseId(rawCaseId);
  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const result = await apiRequest(registry, {
    method: "GET",
    path: `${ApiRoutes.contentRights}/${encodeURIComponent(caseId)}`,
    token,
    retryCount: 0,
  });
  output(result, options.json);
  return result;
}

export async function cmdRecordContentRightsCorrespondence(
  opts: GlobalOpts,
  rawCaseId: string,
  options: RecordOptions = {},
) {
  const caseId = normalizeCaseId(rawCaseId);
  const direction = options.direction?.trim().toLowerCase();
  const to = options.to?.trim();
  const from = options.from?.trim();
  const subject = options.subject?.trim();
  const bodyFile = options.bodyFile?.trim();
  if (direction !== "inbound" && direction !== "outbound") {
    fail("--direction must be inbound or outbound");
  }
  if (!to) fail("--to required");
  if (!from) fail("--from required");
  if (!subject) fail("--subject required");
  if (!bodyFile) fail("--body-file required");
  const text = (await readFile(bodyFile, "utf8")).trim();
  if (!text) fail("Email body must not be empty");

  const form = new FormData();
  form.set("direction", direction);
  form.set("to", to);
  form.set("from", from);
  form.set("subject", subject);
  form.set("text", text);
  if (options.providerMessageId?.trim()) {
    form.set("providerMessageId", options.providerMessageId.trim());
  }
  for (const path of options.attachment ?? []) {
    const bytes = await readFile(path);
    form.append(
      "attachments",
      new File([new Uint8Array(bytes)], basename(path), { type: contentTypeFor(path) }),
    );
  }

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const result = await apiRequestForm(registry, {
    method: "POST",
    path: `${ApiRoutes.contentRights}/${encodeURIComponent(caseId)}/correspondence`,
    token,
    form,
    retryCount: 0,
  });
  output(result, options.json);
  return result;
}
