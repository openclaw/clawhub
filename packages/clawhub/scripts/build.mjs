import { buildCliPackage } from "./shared-schema.mjs";

await buildCliPackage(import.meta.url, "schema");
