import { Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { ArrowRight } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { formatCompactStat } from "../lib/numberFormat";
import type { PublicPublisherListItem } from "../lib/publicUser";
import { MarketplaceIcon } from "./MarketplaceIcon";

type PinnedPublisher = {
  handle: string;
  name: string;
  kind: "org" | "user";
};

const PINNED_PUBLISHERS: PinnedPublisher[] = [
  { handle: "openclaw", name: "OpenClaw", kind: "org" },
  { handle: "nvidia", name: "NVIDIA", kind: "org" },
  { handle: "steipete", name: "Peter Steinberger", kind: "user" },
  { handle: "vincentkoc", name: "Vincent Koc", kind: "user" },
  { handle: "mvanhorn", name: "Matt Van Horn", kind: "user" },
  { handle: "ivangdavila", name: "Iván", kind: "user" },
  { handle: "byungkyu", name: "byungkyu", kind: "user" },
  { handle: "pskoett", name: "pskoett", kind: "user" },
  { handle: "1kalin", name: "1kalin", kind: "user" },
  { handle: "spclaudehome", name: "spclaudehome", kind: "user" },
];

function PopularPublisherCard({ pinned }: { pinned: PinnedPublisher }) {
  const publisher = useQuery(api.publishers.getProfileByHandle, { handle: pinned.handle }) as
    | PublicPublisherListItem
    | null
    | undefined;
  const name = publisher?.displayName?.trim() || pinned.name;
  const bio = publisher?.bio?.trim() || "Publisher on ClawHub.";
  const kind = publisher?.kind ?? pinned.kind;
  const itemCount = (publisher?.stats.skills ?? 0) + (publisher?.stats.packages ?? 0);

  return (
    <Link
      to="/user/$handle"
      params={{ handle: pinned.handle }}
      className="home-v2-popular-publisher-card"
      aria-label={`${name}, @${pinned.handle}`}
      role="listitem"
    >
      <div className="home-v2-popular-publisher-head">
        <MarketplaceIcon
          kind={kind === "org" ? "org" : "user"}
          label={name}
          imageUrl={publisher?.image ?? `https://github.com/${pinned.handle}.png`}
          size="md"
        />
        <span className="home-v2-popular-publisher-name">{name}</span>
      </div>
      <div className="home-v2-popular-publisher-copy">
        <p className="home-v2-popular-publisher-bio">{bio}</p>
        <span className="home-v2-popular-publisher-stats">
          Explore {formatCompactStat(itemCount)} {itemCount === 1 ? "item" : "items"}
          <ArrowRight size={13} aria-hidden="true" />
        </span>
      </div>
    </Link>
  );
}

export function HomePopularPublishersSection() {
  return (
    <section className="home-v2-popular-publishers" aria-labelledby="popular-publishers-title">
      <header className="home-v2-popular-publishers-header">
        <div className="home-v2-popular-publishers-heading">
          <h2 id="popular-publishers-title">Popular publishers</h2>
          <p>Explore skills and plugins from standout builders.</p>
        </div>
        <Link to="/publishers" className="home-v2-popular-publishers-link">
          Browse publishers <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </header>
      <div className="home-v2-popular-publishers-viewport">
        <div className="home-v2-popular-publishers-track" role="list">
          {PINNED_PUBLISHERS.map((publisher) => (
            <PopularPublisherCard key={publisher.handle} pinned={publisher} />
          ))}
        </div>
      </div>
    </section>
  );
}
