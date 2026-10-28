import type { PackageFamily } from "clawhub-schema";
import type { Doc } from "../_generated/dataModel";

/** Existing production rows/indexes retain this physical discriminator. Never rewrite archives or rows for branding. */
export type StoredPackageFamily = Doc<"packages">["family"];

export function toStoredPackageFamily(family: PackageFamily): StoredPackageFamily {
  return family === "template" ? "claw" : family;
}

/** Canonical public contract; the historical storage discriminator is not a public alias. */
export function toPublicPackageFamily(family: StoredPackageFamily | PackageFamily): PackageFamily {
  return family === "claw" ? "template" : family;
}

export function withStoredPackageFamily<T extends { family?: PackageFamily }>(args: T) {
  return {
    ...args,
    family: args.family === undefined ? undefined : toStoredPackageFamily(args.family),
  };
}

/** Physical snapshot identity stays stable so the ordinary publisher updates the existing row/sequence. */
export const TEMPLATE_FEED_STORAGE_ID = "clawhub-official-claws";
