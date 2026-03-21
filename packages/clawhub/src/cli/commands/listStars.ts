import { apiRequest } from "../../http.js";
import { ApiRoutes, ApiV1StarsListResponseSchema } from "../../schema/index.js";
import { requireAuthToken } from "../authToken.js";
import { getRegistry } from "../registry.js";
import type { GlobalOpts } from "../types.js";
import { createSpinner, formatError } from "../ui.js";

export async function cmdListStars(opts: GlobalOpts) {
    const token = await requireAuthToken();
    const registry = await getRegistry(opts, { cache: true });
    const spinner = createSpinner("Fetching starred skills from your highlights");
    try {
        const result = await apiRequest(
            registry,
            { method: "GET", path: ApiRoutes.stars, token },
            ApiV1StarsListResponseSchema,
        );
        spinner.succeed(`Found ${result.items.length} starred skill${result.items.length === 1 ? "" : "s"} in your highlights`);
        for (const item of result.items) {
            console.log(`${item.slug}  ${item.displayName}`);
        }
        return result;
    } catch (error) {
        spinner.fail(formatError(error));
        throw error;
    }
}