import type { ApiV1PackageResponse } from "clawhub-schema";

export const TEMPLATE_DIRECTORY_SHARE = {
  title: "OpenClaw Templates",
  description: "Browse ready-to-use agents you can add to OpenClaw.",
  imagePath: "/og/templates-v2.png",
} as const;

export function getTemplateShareCopy(pkg: NonNullable<ApiV1PackageResponse["package"]>) {
  const agent = pkg.templateManifestSummary?.agent;
  const slug = pkg.name.split("/").at(-1) ?? pkg.name;
  const readableSlug = slug.replace(/[-_]+/g, " ").replace(/^./u, (char) => char.toUpperCase());
  return {
    title:
      agent?.name?.trim() ||
      (pkg.displayName !== pkg.name && pkg.displayName?.trim()) ||
      readableSlug,
    description: pkg.summary?.trim() || agent?.description?.trim() || "OpenClaw Template",
  };
}
