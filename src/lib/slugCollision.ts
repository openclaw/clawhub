type SlugAvailabilityResult = {
  available: boolean;
  reason: "available" | "taken" | "reserved";
  message: string | null;
  url: string | null;
} | null;

export type PublicSlugCollision = {
  message: string;
  url: string | null;
};

export function getPublicSlugCollision(params: {
  isSoulMode: boolean;
  slug: string;
  result: SlugAvailabilityResult | undefined;
}): PublicSlugCollision | null {
  if (params.isSoulMode) return null;
  const normalizedSlug = params.slug.trim().toLowerCase();
  if (!normalizedSlug) return null;
  if (!params.result || params.result.available) return null;
  return {
    message: params.result.message?.trim() || "Slug is already taken. Choose a different slug.",
    url: params.result.url ?? null,
  };
}
