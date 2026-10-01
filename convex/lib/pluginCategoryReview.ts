import { isCurrentPluginCategoryAssignment } from "clawhub-schema";
import type { Infer } from "convex/values";
import { tryNormalizePackageName } from "./packageRegistry";
import type { pluginCategoryReviewProvenanceValidator } from "./pluginCategoryClassificationContract";

export type CategoryReviewProvenance = Infer<typeof pluginCategoryReviewProvenanceValidator>;

export function validateCategoryPackageNames(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 10 ||
    value.some((name) => typeof name !== "string" || tryNormalizePackageName(name) !== name) ||
    new Set(value).size !== value.length
  ) {
    throw new Error("Use 1–10 distinct, exact canonical package names.");
  }
  return value;
}

export type CategoryCorrection = { id: string; category: string; evidence: string };
export type CategoryReviewRow = {
  _id: string;
  runId: string;
  packageId: string;
  releaseId: string;
  packageName: string;
  version: string;
  beforeHash: string;
  beforeCategories?: string[];
  categories: string[];
  classification: {
    source: string;
    classifierVersion: string;
    inputHash: string;
    evidence: string;
    reviewId?: string;
  };
  review?: {
    category: string;
    evidence: string;
    sourceHash?: string;
    provenance?: CategoryReviewProvenance;
  };
};

export function validateCategoryCorrections(corrections: CategoryCorrection[], ids: string[]) {
  if (
    corrections.length > 100 ||
    new Set(corrections.map((row) => row.id)).size !== corrections.length
  )
    throw new Error("Use at most 100 distinct category corrections.");
  for (const row of corrections) {
    if (
      !ids.includes(row.id) ||
      !isCurrentPluginCategoryAssignment([row.category]) ||
      !row.evidence.trim() ||
      row.evidence !== row.evidence.trim() ||
      row.evidence.length > 500
    )
      throw new Error(
        "Each correction needs a selected journal ID, one current category, and 1–500 characters of reviewed evidence.",
      );
  }
}

// Only decision evidence enters reports/hashes; timestamps and execution provenance
// are recorded after approval and must not change the reviewed decision's identity.
export function reviewRow(row: CategoryReviewRow, correction?: CategoryCorrection) {
  const decision = correction ?? row.review;
  return {
    id: row._id,
    runId: row.runId,
    packageId: row.packageId,
    releaseId: row.releaseId,
    packageName: row.packageName,
    version: row.version,
    beforeHash: row.beforeHash,
    beforeCategories: row.beforeCategories ?? [],
    categories: row.categories,
    classification: {
      source: row.classification.source,
      classifierVersion: row.classification.classifierVersion,
      inputHash: row.classification.inputHash,
      evidence: row.classification.evidence.slice(0, 500),
      ...(row.classification.reviewId ? { reviewId: row.classification.reviewId } : {}),
    },
    ...(decision ? { review: { category: decision.category, evidence: decision.evidence } } : {}),
  };
}

export function categoryReviewPayload(
  rows: CategoryReviewRow[],
  corrections: CategoryCorrection[] = [],
) {
  validateCategoryCorrections(
    corrections,
    rows.map((row) => row._id),
  );
  return JSON.stringify(
    rows
      .map((row) =>
        reviewRow(
          row,
          corrections.find((item) => item.id === row._id),
        ),
      )
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
}
