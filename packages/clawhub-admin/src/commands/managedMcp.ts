import { open, readFile } from "node:fs/promises";
import { requireAuthToken } from "../../../clawhub/src/cli/authToken.js";
import { getRegistry } from "../../../clawhub/src/cli/registry.js";
import type { GlobalOpts } from "../../../clawhub/src/cli/types.js";
import { apiRequest } from "../../../clawhub/src/http.js";
import { ApiRoutes } from "../../../clawhub/src/schema/index.js";
import { parseManagedMcpDefinition } from "../../../schema/src/managedMcp.js";

const path = `${ApiRoutes.packages}/-/managed-mcp`;

async function readIconBase64(file: string): Promise<string> {
  const maxBytes = 512 * 1024;
  const handle = await open(file, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("Icon must be a regular PNG file");
    if (stat.size > maxBytes) throw new Error("Icon must be no larger than 512KB");
    // Bound the actual read as well: the file may grow after stat().
    const bytes = Buffer.alloc(maxBytes + 1);
    let size = 0;
    while (size < bytes.byteLength) {
      const { bytesRead } = await handle.read(bytes, size, bytes.byteLength - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > maxBytes) throw new Error("Icon must be no larger than 512KB");
    return bytes.subarray(0, size).toString("base64");
  } finally {
    await handle.close();
  }
}

export async function cmdPublishManagedMcp(
  opts: GlobalOpts,
  file: string,
  options: { dryRun?: boolean; icon?: string },
) {
  let input: unknown = JSON.parse(await readFile(file, "utf8"));
  if (options.icon) {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error("--icon requires a single definition");
    const definition = input as Record<string, unknown>;
    if (!definition.icon || typeof definition.icon !== "object" || Array.isArray(definition.icon))
      throw new Error("Definition must include icon rights metadata");
    input = {
      ...definition,
      icon: { ...definition.icon, pngBase64: await readIconBase64(options.icon) },
    };
  }
  const definitions = (Array.isArray(input) ? input : [input]).map(parseManagedMcpDefinition);
  if (!definitions.length || definitions.length > 200)
    throw new Error("Supply 1–200 integration definitions");
  if (new Set(definitions.map((entry) => entry.id)).size !== definitions.length)
    throw new Error("Duplicate integration ids");
  if (options.dryRun) {
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          validation: "definition-fields-only",
          unchecked: ["icon contents", "endpoint compatibility", "security scans"],
          packages: definitions.map((entry) => ({
            name: `@openclaw/${entry.id}`,
            version: entry.version,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }
  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  // A batch uses exactly the single-entry operation. Already-published immutable versions
  // are handled by normal publication retries; no second import-only publication path.
  for (const definition of definitions) {
    const result = await apiRequest(registry, { method: "POST", path, token, body: definition });
    console.log(JSON.stringify({ name: `@openclaw/${definition.id}`, result }));
  }
}

export async function cmdGetManagedMcp(opts: GlobalOpts, id: string) {
  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  console.log(
    JSON.stringify(
      await apiRequest(registry, {
        method: "GET",
        path: `${path}/${encodeURIComponent(id)}`,
        token,
      }),
      null,
      2,
    ),
  );
}

export async function cmdUnpublishManagedMcp(opts: GlobalOpts, id: string) {
  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  console.log(
    JSON.stringify(
      await apiRequest(registry, {
        method: "POST",
        path: `${path}/${encodeURIComponent(id)}/unpublish`,
        token,
        body: {},
      }),
    ),
  );
}
