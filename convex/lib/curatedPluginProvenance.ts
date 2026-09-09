import { ConvexError, v } from "convex/values";
import type { Doc } from "../_generated/dataModel";

export const curatedPluginProvenanceValidator = v.object({
  supersedes: v.optional(v.array(v.string())),
  integration: v.string(),
  job: v.string(),
  authorship: v.union(v.literal("company"), v.literal("registry")),
  repositoryId: v.number(),
  ownerId: v.number(),
  sourceContentHash: v.string(),
  author: v.optional(v.string()),
  omittedCapabilities: v.array(v.string()),
  format: v.string(),
  syncedAt: v.number(),
});
export type CuratedPluginMetadata = {
  supersedes?: string[];
  integration: string;
  job: string;
  authorship: "company" | "registry";
  repositoryId: number;
  ownerId: number;
  sourceContentHash: string;
  author?: string;
  omittedCapabilities: string[];
  format: string;
};

export function validateCuratedPluginPublisher(input: {
  actor: Pick<Doc<"users">, "role">;
  publisher: Pick<Doc<"publishers">, "kind" | "handle" | "staffCustody"> | null;
  sourceRepo: string | undefined;
  curation: CuratedPluginMetadata;
}) {
  const { actor, publisher, sourceRepo, curation } = input;
  if (actor.role !== "admin")
    throw new ConvexError("Only staff may publish curated source provenance");
  if (!publisher || publisher.kind !== "org")
    throw new ConvexError("Curated plugins require an organization publisher");
  if (!sourceRepo || !/^[-\w.]+\/[-\w.]+$/.test(sourceRepo))
    throw new ConvexError("Curated plugins require a GitHub source");
  if (
    !/^[a-f0-9]{64}$/.test(curation.sourceContentHash) ||
    ![curation.repositoryId, curation.ownerId].every((n) => Number.isSafeInteger(n) && n > 0)
  )
    throw new ConvexError("Invalid curated source identity or content hash");
  if (
    ![curation.integration, curation.job].every((s) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)) ||
    (curation.author && curation.author.length > 2000) ||
    curation.omittedCapabilities.length > 20
  )
    throw new ConvexError("Invalid curated plugin metadata");
  if (
    curation.supersedes?.length &&
    (curation.authorship !== "company" ||
      curation.supersedes.length > 3 ||
      curation.supersedes.some((name) => !/^@[a-z0-9-]+\/[a-z0-9-]+$/.test(name)))
  )
    throw new ConvexError("Invalid canonical replacement identities");
  if (curation.authorship === "company") {
    const custody = publisher.staffCustody;
    if (
      !custody ||
      custody.repositoryOwnerId !== curation.ownerId ||
      sourceRepo.toLowerCase() !== custody.sourceRepo.toLowerCase() ||
      sourceRepo.split("/")[0].toLowerCase() !== custody.repositoryOwner.toLowerCase()
    )
      throw new ConvexError(
        "Company source does not match staff custody, or the company has adopted the publisher",
      );
  } else {
    const owners: Record<string, string> = {
      cursor: "cursor",
      openai: "openai",
      anthropic: "anthropics",
    };
    if (
      !owners[publisher.handle] ||
      sourceRepo.split("/")[0].toLowerCase() !== owners[publisher.handle]
    )
      throw new ConvexError("Registry-authored plugins must retain their registry publisher");
  }
}
