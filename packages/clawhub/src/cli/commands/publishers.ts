import { apiRequest } from "../../http.js";
import { ApiRoutes, ApiV1PublisherCreateResponseSchema } from "../../schema/index.js";
import { requireAuthToken } from "../authToken.js";
import { getRegistry } from "../registry.js";
import type { GlobalOpts } from "../types.js";

type PublisherCreateOptions = {
  displayName?: string;
  json?: boolean;
};

function normalizePublisherHandleOrFail(handle: string) {
  const normalized = handle.trim().replace(/^@+/, "").toLowerCase();
  if (!normalized) throw new Error("Publisher handle is required");
  return normalized;
}

export async function cmdCreatePublisher(
  opts: GlobalOpts,
  handle: string,
  options: PublisherCreateOptions = {},
) {
  const normalizedHandle = normalizePublisherHandleOrFail(handle);
  const displayName = options.displayName?.trim();
  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const result = await apiRequest(
    registry,
    {
      method: "POST",
      path: ApiRoutes.publishers,
      token,
      body: {
        handle: normalizedHandle,
        ...(displayName ? { displayName } : {}),
      },
    },
    ApiV1PublisherCreateResponseSchema,
  );

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  console.log(`OK. Created publisher @${result.handle}.`);
}
