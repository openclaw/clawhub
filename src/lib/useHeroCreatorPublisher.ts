import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

type HeroCreatorPublisher = {
  _id?: string;
  _creationTime?: number;
  kind?: "user" | "org";
  handle?: string | null;
  displayName?: string | null;
  image?: string | null;
  bio?: string | null;
  linkedUserId?: string;
  official?: boolean;
};

type UseHeroCreatorPublisherArgs = {
  owner: HeroCreatorPublisher | null | undefined;
  skillOfficial?: boolean;
  packageOfficial?: boolean;
};

export function useHeroCreatorPublisher({
  owner,
  skillOfficial = false,
  packageOfficial = false,
}: UseHeroCreatorPublisherArgs) {
  const shouldLookupPublisherOfficial =
    Boolean(owner?.handle) && owner?.official !== true && !skillOfficial && !packageOfficial;
  const publisherOfficialLookup = useQuery(
    api.publishers.getByHandle,
    shouldLookupPublisherOfficial && owner?.handle ? { handle: owner.handle } : "skip",
  ) as HeroCreatorPublisher | null | undefined;

  if (!owner) return owner;
  const showOfficial =
    owner.official === true ||
    publisherOfficialLookup?.official === true ||
    skillOfficial ||
    packageOfficial;
  return showOfficial ? { ...owner, official: true as const } : owner;
}
