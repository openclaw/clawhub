import { useQuery } from "convex/react";
import { useMemo } from "react";
import { api } from "../../convex/_generated/api";
import type { PublicPublisher } from "./publicUser";

type UseHeroCreatorPublisherArgs = {
  owner: PublicPublisher | null | undefined;
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
  ) as PublicPublisher | null | undefined;

  return useMemo(() => {
    if (!owner) return owner;
    const showOfficial =
      owner.official === true ||
      publisherOfficialLookup?.official === true ||
      skillOfficial ||
      packageOfficial;
    return showOfficial ? { ...owner, official: true as const } : owner;
  }, [owner, publisherOfficialLookup, skillOfficial, packageOfficial]);
}
