import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { type PointerEvent, useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { convexHttp } from "../convex/client";
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
  { handle: "mvanhorn", name: "Matt Van Horn", kind: "user" },
  { handle: "wscats", name: "enoyao", kind: "user" },
  { handle: "ivangdavila", name: "Iván", kind: "user" },
  { handle: "byungkyu", name: "byungkyu", kind: "user" },
  { handle: "pskoett", name: "pskoett", kind: "user" },
  { handle: "1kalin", name: "1kalin", kind: "user" },
  { handle: "spclaudehome", name: "spclaudehome", kind: "user" },
];

function PopularPublisherCard({
  pinned,
  publisher,
}: {
  pinned: PinnedPublisher;
  publisher?: PublicPublisherListItem;
}) {
  const name = publisher?.displayName?.trim() || pinned.name;
  const bio = publisher?.bio?.trim() || "Publisher on ClawHub.";
  const kind = publisher?.kind ?? pinned.kind;
  const itemCount = (publisher?.stats?.skills ?? 0) + (publisher?.stats?.packages ?? 0);

  return (
    <Link
      to="/user/$handle"
      params={{ handle: pinned.handle }}
      className="home-v2-popular-publisher-card"
      aria-label={`${name}, @${pinned.handle}`}
      draggable={false}
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
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ pointerId: -1, startX: 0, scrollLeft: 0, moved: false });
  const [dragging, setDragging] = useState(false);
  const [publishersByHandle, setPublishersByHandle] = useState<
    Record<string, PublicPublisherListItem>
  >({});

  useEffect(() => {
    let cancelled = false;

    const hydratePublishers = async () => {
      // These profile queries compute catalog totals. Keep them serial so the
      // homepage does not starve auth and navigation queries on smaller deployments.
      for (const pinned of PINNED_PUBLISHERS) {
        try {
          const publisher = (await convexHttp.query(api.publishers.getProfileByHandle, {
            handle: pinned.handle,
          })) as PublicPublisherListItem | null;
          if (cancelled) return;
          if (publisher) {
            setPublishersByHandle((current) => ({
              ...current,
              [pinned.handle]: publisher,
            }));
          }
        } catch {
          // Static card metadata remains usable when a profile cannot be hydrated.
        }
      }
    };

    void hydratePublishers();
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      scrollLeft: viewport.scrollLeft,
      moved: false,
    };
    setDragging(true);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    if (!viewport || dragRef.current.pointerId !== event.pointerId) return;
    const distance = event.clientX - dragRef.current.startX;
    if (Math.abs(distance) > 4) {
      dragRef.current.moved = true;
      if (!viewport.hasPointerCapture(event.pointerId)) {
        viewport.setPointerCapture(event.pointerId);
      }
    }
    viewport.scrollLeft = dragRef.current.scrollLeft - distance;
  };

  const stopDragging = (event: PointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    if (!viewport || dragRef.current.pointerId !== event.pointerId) return;
    if (viewport.hasPointerCapture(event.pointerId))
      viewport.releasePointerCapture(event.pointerId);
    dragRef.current.pointerId = -1;
    setDragging(false);
  };

  return (
    <section className="home-v2-popular-publishers" aria-labelledby="popular-publishers-title">
      <header className="home-v2-popular-publishers-header">
        <div className="home-v2-popular-publishers-heading">
          <h2 id="popular-publishers-title">Popular creators</h2>
          <p>Explore skills and plugins from standout builders.</p>
        </div>
        <Link to="/publishers" className="home-v2-popular-publishers-link">
          Browse creators <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </header>
      <div
        ref={viewportRef}
        className={`home-v2-popular-publishers-viewport${dragging ? " is-dragging" : ""}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
        onDragStart={(event) => event.preventDefault()}
        onClickCapture={(event) => {
          if (!dragRef.current.moved) return;
          event.preventDefault();
          event.stopPropagation();
          dragRef.current.moved = false;
        }}
      >
        <div className="home-v2-popular-publishers-track">
          {PINNED_PUBLISHERS.map((publisher) => (
            <PopularPublisherCard
              key={publisher.handle}
              pinned={publisher}
              publisher={publishersByHandle[publisher.handle]}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
