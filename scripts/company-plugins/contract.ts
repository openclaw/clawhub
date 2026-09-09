import { z } from "zod";
import { PLUGIN_CATEGORY_SLUGS } from "../../packages/schema/src/catalogMetadata";

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const repo = z
  .string()
  .regex(/^[\w.-]+\/[\w.-]+$/)
  .transform((value) => value.toLowerCase());
const path = z
  .string()
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !/[\\\0]/.test(value) &&
      (!value || !value.split("/").some((part) => !part || part === ".." || part === ".")),
    "Use a repository-relative canonical path",
  );
const registry = z.enum(["cursor", "claude", "openai"]);
const identity = z.object({ integration: slug, job: slug });
const source = identity
  .extend({
    repo,
    path,
    ref: z.string().min(1),
    publisher: slug,
    authorship: z.enum(["company", "registry"]),
    format: z.enum(["cursor", "claude", "codex", "agent"]),
    registry: registry.optional(),
    repositoryId: z.number().int().positive(),
    ownerId: z.number().int().positive(),
    ownershipEvidence: z.url(),
    categories: z.array(z.enum(PLUGIN_CATEGORY_SLUGS)).max(3),
    supersedes: z
      .array(z.string().regex(/^@[a-z0-9-]+\/[a-z0-9-]+$/))
      .max(3)
      .optional(),
    approved: z.boolean().optional(),
    approvedInitialHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    preferred: z.boolean().optional(),
    decisionReason: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.authorship === "registry" &&
      (!value.registry ||
        value.publisher !==
          ({ cursor: "cursor", claude: "anthropic", openai: "openai" } as const)[value.registry])
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Registry copies must use their registry publisher",
      });
    }
    if (value.supersedes?.length && value.authorship !== "company")
      ctx.addIssue({
        code: "custom",
        message: "Only a company source may replace registry wrappers",
      });
    if (value.approved && !value.approvedInitialHash)
      ctx.addIssue({
        code: "custom",
        message: "Approved sources require the reviewed initial source hash",
      });
    if (value.preferred && !value.decisionReason)
      ctx.addIssue({ code: "custom", message: "A curator preference requires a reason" });
  });
export const curatedManifestSchema = z
  .object({
    version: z.literal(1),
    registries: z.array(z.object({ registry, repo, ref: z.string().min(1) }).strict()),
    sources: z.array(source),
    openclaw: z.array(
      identity
        .extend({
          package: z.string().min(1).optional(),
          bundledId: slug.optional(),
          evidence: z.url(),
        })
        .strict()
        .refine(
          (v) => Boolean(v.package || v.bundledId),
          "An OpenClaw identity requires a package or bundled id",
        ),
    ),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const approved = new Set<string>();
    for (const source of manifest.sources.filter((s) => s.approved)) {
      const key = `${source.integration}:${source.job}`;
      if (approved.has(key))
        ctx.addIssue({ code: "custom", message: `Multiple approved sources for ${key}` });
      approved.add(key);
    }
  });
export type CuratedManifest = z.infer<typeof curatedManifestSchema>;
export type CuratedSource = CuratedManifest["sources"][number];
export type Registry = z.infer<typeof registry>;
export type Snapshot = {
  repo: string;
  repositoryId: number;
  ownerId: number;
  commit: string;
  updatedAt: string;
  files: Record<string, string>;
  fileBytes?: Record<string, Uint8Array>;
  fileHashes?: Record<string, string>;
  fileSizes?: Record<string, number>;
};
export function sourceKey(repo: string, path: string) {
  return `${repo.toLowerCase()}#${path}`;
}
