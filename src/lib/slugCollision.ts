type SlugAvailabilityResult = {
  available: boolean;
  reason: "available" | "taken" | "reserved";
  message: string | null;
  url: string | null;
} | null;

type PublicSlugCollision = {
  message: string;
  url: string | null;
};

const DEFAULT_COLLISION_MESSAGE = "Slug is already taken. Choose a different slug.";

function publicCollisionMessage(message: string | null) {
  const trimmed = message?.trim();
  if (!trimmed) return DEFAULT_COLLISION_MESSAGE;
  return trimmed.replace(/\s+Existing skill:\s+\S+\s*$/u, "");
}

export function getPublicSlugCollision(params: {
  slug: string;
  result: SlugAvailabilityResult | undefined;
}): PublicSlugCollision | null {
  const normalizedSlug = params.slug.trim().toLowerCase();
  if (!normalizedSlug) return null;
  if (!params.result || params.result.available) return null;
  return {
    message: publicCollisionMessage(params.result.message),
    url: params.result.url ?? null,
  };
}
