import {
  createTemplateManifestSummarySchema,
  type TemplateManifestSummary,
} from "clawhub-schema/templateManifestSummary";
import { v, type GenericValidator, type Validator, type Infer } from "convex/values";

export const clawManifestSummaryValidator = createTemplateManifestSummarySchema<GenericValidator>({
  literalOne: v.literal(1),
  string: v.string(),
  number: v.number(),
  boolean: v.boolean(),
  stringArray: v.array(v.string()),
  // Convex validators cannot express string lengths; publication must validate with the shared schema.
  boundedString: () => v.string(),
  optional: (validator) => v.optional(validator),
  object: (fields) => v.object(fields),
});
const name = v.string();
const bundled = { name, source: v.literal("bundled"), path: v.string() };
const dependency = { name, source: v.literal("clawhub"), ref: v.string(), version: v.string() };
// Strict allowlist. No guide text, scheduler messages, credentials, file bodies or scan state.
export const templateDisplayDataValidator = v.object({
  manifestPath: v.string(),
  templateManifestSummary: clawManifestSummaryValidator as Validator<TemplateManifestSummary>,
  contents: v.object({
    instructions: v.array(v.object({ name, source: v.string() })),
    skills: v.array(v.union(v.object(bundled), v.object(dependency))),
    integrations: v.array(
      v.union(
        v.object({ ...bundled, kind: v.literal("plugin") }),
        v.object({ ...dependency, kind: v.literal("plugin") }),
        v.object({ name, kind: v.literal("mcpServer") }),
      ),
    ),
    automations: v.array(
      v.object({ name, enabled: v.boolean(), schedule: v.string(), timezone: v.string() }),
    ),
  }),
});
export type TemplateDisplayData = Infer<typeof templateDisplayDataValidator>;
export const templateDisplayBindingValidator = v.object({
  packageName: v.string(),
  version: v.string(),
  storageId: v.id("_storage"),
  sha256: v.string(),
  size: v.number(),
  npmIntegrity: v.string(),
  npmShasum: v.optional(v.string()),
});
export type TemplateDisplayBinding = Infer<typeof templateDisplayBindingValidator>;
export const MAX_TEMPLATE_DISPLAY_ARCHIVE_BYTES = 4 * 1024 * 1024;
export const MAX_TEMPLATE_DISPLAY_DATA_BYTES = 256 * 1024;
