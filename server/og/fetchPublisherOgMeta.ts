import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";

export type PublisherOgMeta = {
  handle: string | null;
  kind: "user" | "org";
  displayName: string | null;
  bio: string | null;
  image: string | null;
  stats: {
    installs: number;
  };
};

type PublisherProfileResult = {
  handle?: string | null;
  kind?: "user" | "org";
  displayName?: string | null;
  bio?: string | null;
  image?: string | null;
  stats?: {
    installs?: number;
  };
} | null;

export async function fetchPublisherOgMeta(
  handle: string,
  convexUrl: string,
): Promise<PublisherOgMeta | null> {
  try {
    const client = new ConvexHttpClient(convexUrl);
    const profile = (await client.query(api.publishers.getProfileByHandle, {
      handle,
    })) as PublisherProfileResult;
    if (!profile) return null;
    return {
      handle: profile.handle ?? null,
      kind: profile.kind === "org" ? "org" : "user",
      displayName: profile.displayName ?? null,
      bio: profile.bio ?? null,
      image: profile.image ?? null,
      stats: {
        installs: readNumber(profile.stats?.installs),
      },
    };
  } catch {
    return null;
  }
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
