import { ConvexHttpClient } from "convex/browser";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";

export type PublisherOgMeta = {
  handle: string | null;
  kind: "user" | "org";
  official: boolean;
  displayName: string | null;
  bio: string | null;
  image: string | null;
  affiliations: Array<{
    handle: string;
    displayName: string;
    image: string | null;
  }>;
  stats: {
    downloads: number;
  };
};

type PublisherProfileResult = FunctionReturnType<typeof api.publishers.getOgMetaByHandle>;
type PublisherProfileAffiliations = NonNullable<PublisherProfileResult>["affiliations"];

export async function fetchPublisherOgMeta(
  handle: string,
  convexUrl: string,
): Promise<PublisherOgMeta | null> {
  try {
    const client = new ConvexHttpClient(convexUrl);
    const profile = await client.query(api.publishers.getOgMetaByHandle, {
      handle,
    });
    if (!profile) return null;
    return {
      handle: profile.handle ?? null,
      kind: profile.kind === "org" ? "org" : "user",
      official: profile.official === true,
      displayName: profile.displayName ?? null,
      bio: profile.bio ?? null,
      image: profile.image ?? null,
      affiliations: readAffiliations(profile.affiliations),
      stats: {
        downloads: readNumber(profile.stats?.downloads),
      },
    };
  } catch {
    return null;
  }
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readAffiliations(value: PublisherProfileAffiliations) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const handle = item?.publisher?.handle?.trim();
      const displayName = item?.publisher?.displayName?.trim();
      if (!handle || !displayName) return null;
      return { handle, displayName, image: item.publisher?.image ?? null };
    })
    .filter((item): item is { handle: string; displayName: string; image: string | null } =>
      Boolean(item),
    );
}
