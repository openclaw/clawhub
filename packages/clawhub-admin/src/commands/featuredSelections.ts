import { readFile } from "node:fs/promises";
import { requireAuthToken } from "../../../clawhub/src/cli/authToken.js";
import { getRegistry } from "../../../clawhub/src/cli/registry.js";
import type { GlobalOpts } from "../../../clawhub/src/cli/types.js";
import { fail } from "../../../clawhub/src/cli/ui.js";
import { apiRequest } from "../../../clawhub/src/http.js";
import { ApiRoutes, parseArk } from "../../../clawhub/src/schema/index.js";
import {
  FeaturedEditorialSaveSchema,
  FeaturedSelectionPublishSchema,
} from "../../../schema/src/featuredSelections.js";

export async function cmdFeaturedSelection(
  opts: GlobalOpts,
  catalog: string,
  operation: "get" | "editorial" | "publish",
  file?: string,
  dryRun = true,
) {
  if (catalog !== "plugin" && catalog !== "skill") fail("Catalog must be plugin or skill");
  if (operation === "editorial" && catalog !== "plugin")
    fail("Only plugins have editorial reservations");
  let body;
  if (operation !== "get") {
    if (!file) fail("A reviewed selection JSON file is required");
    const payload: unknown = JSON.parse(await readFile(file, "utf8"));
    body =
      operation === "editorial"
        ? parseArk(FeaturedEditorialSaveSchema, payload, "editorial selection")
        : parseArk(
            FeaturedSelectionPublishSchema,
            { ...(payload as object), dryRun },
            "Featured publication",
          );
  }
  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const result = await apiRequest(registry, {
    method: operation === "get" ? "GET" : "POST",
    path: `${ApiRoutes.featured}/${catalog}${operation === "get" ? "" : `/${operation}`}`,
    token,
    ...(body ? { body } : {}),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
