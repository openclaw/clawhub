import { buildCliPackage } from "../../clawhub/scripts/shared-schema.mjs";

await buildCliPackage(import.meta.url, "clawhub/src/schema");
