// Template manifest summary structure without a validation library, for storage validators.
export const TEMPLATE_SUMMARY_AGENT_NAME_MAX_CHARS = 128;
export const TEMPLATE_SUMMARY_AGENT_DESCRIPTION_MAX_CHARS = 1_024;

export type TemplateManifestSummary = {
  schemaVersion: 1;
  agent: { id: string; name?: string; description?: string };
  workspace: { bootstrapFiles: string[]; fileCount: number };
  packages: { skillCount: number; pluginCount: number };
  // Historical immutable release summaries may retain these stored fields. New summaries never emit them.
  profiles?: { count: number; hasOpenClaw: boolean };
  extensions?: { count: number };
  mcpServerCount: number;
  cronJobCount: number;
};

export type TemplateManifestSummarySchemaAdapter<TValue, TOptional = TValue> = {
  literalOne: TValue;
  string: TValue;
  number: TValue;
  boolean: TValue;
  stringArray: TValue;
  boundedString: (maxCharacters: number) => TValue;
  optional: (schema: TValue) => TOptional;
  object: (fields: Record<string, TValue | TOptional>) => TValue;
};

/** Builds the v1 summary structure for both the public schema and durable storage validators. */
export function createTemplateManifestSummarySchema<TValue, TOptional = TValue>(
  adapter: TemplateManifestSummarySchemaAdapter<TValue, TOptional>,
): TValue {
  return adapter.object({
    schemaVersion: adapter.literalOne,
    agent: adapter.object({
      id: adapter.string,
      name: adapter.optional(adapter.boundedString(TEMPLATE_SUMMARY_AGENT_NAME_MAX_CHARS)),
      description: adapter.optional(
        adapter.boundedString(TEMPLATE_SUMMARY_AGENT_DESCRIPTION_MAX_CHARS),
      ),
    }),
    workspace: adapter.object({
      bootstrapFiles: adapter.stringArray,
      fileCount: adapter.number,
    }),
    packages: adapter.object({
      skillCount: adapter.number,
      pluginCount: adapter.number,
    }),
    profiles: adapter.optional(
      adapter.object({
        count: adapter.number,
        hasOpenClaw: adapter.boolean,
      }),
    ),
    extensions: adapter.optional(
      adapter.object({
        count: adapter.number,
      }),
    ),
    mcpServerCount: adapter.number,
    cronJobCount: adapter.number,
  });
}
