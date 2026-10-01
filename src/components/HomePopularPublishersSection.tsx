import { Link } from "@tanstack/react-router";
import { ArrowRight, RefreshCw } from "lucide-react";
import { type PointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { convexHttp } from "../convex/client";
import { formatCompactStat } from "../lib/numberFormat";
import type { PublicPublisherSummary } from "../lib/publicUser";
import { MarketplaceIcon } from "./MarketplaceIcon";

const HOME_OFFICIAL_CREATOR_LIMIT = 12;

function OfficialCreatorCard({ publisher }: { publisher: PublicPublisherSummary }) {
  const name = publisher.displayName.trim() || publisher.handle;
  const bio = publisher.bio?.trim() || "Official creator on ClawHub.";
  const downloads = publisher.stats.downloads;

  return (
    <Link
      to="/$slug"
      params={{ slug: publisher.handle }}
      className="home-v2-popular-publisher-card oc-card oc-card-interactive"
      aria-label={`${name}, @${publisher.handle}`}
      draggable={false}
    >
      <div className="home-v2-popular-publisher-head">
        <MarketplaceIcon
          kind="org"
          label={name}
          imageUrl={publisher.image ?? `https://github.com/${publisher.handle}.png`}
          size="md"
        />
        <span className="home-v2-popular-publisher-name">{name}</span>
      </div>
      <div className="home-v2-popular-publisher-copy">
        <p className="home-v2-popular-publisher-bio">{bio}</p>
        <span className="home-v2-popular-publisher-stats">
          {formatCompactStat(downloads)} {downloads === 1 ? "download" : "downloads"}
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
  const requestedPublishersRef = useRef(false);
  const mountedRef = useRef(true);
  const [publishers, setPublishers] = useState<PublicPublisherSummary[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const hydratePublishers = useCallback(async () => {
    if (requestedPublishersRef.current) return;
    requestedPublishersRef.current = true;
    setLoadFailed(false);
    try {
      const result = (await convexHttp.query(api.publishers.listPublicPage, {
        kind: "org",
        official: true,
        paginationOpts: { cursor: null, numItems: HOME_OFFICIAL_CREATOR_LIMIT },
      })) as { page: PublicPublisherSummary[] };
      if (!mountedRef.current) return;
      setPublishers(result.page);
    } catch {
      requestedPublishersRef.current = false;
      if (!mountedRef.current) return;
      setPublishers([]);
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof IntersectionObserver === "undefined") {
      void hydratePublishers();
      return () => {};
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        void hydratePublishers();
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(viewport);
    return () => {
      observer.disconnect();
    };
  }, [hydratePublishers]);

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
    <section
      className="home-v2-popular-publishers oc-section"
      aria-labelledby="official-creators-title"
    >
      <header className="home-v2-popular-publishers-header oc-section-header">
        <div className="home-v2-popular-publishers-heading oc-section-heading">
          <h2 id="official-creators-title" className="oc-section-title">
            Official creators
          </h2>
          <p className="oc-section-copy">Explore skills and plugins from official creators.</p>
        </div>
        <Link to="/official" className="home-v2-popular-publishers-link oc-action oc-action-ghost">
          Browse official <ArrowRight size={14} aria-hidden="true" />
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
          {publishers.map((publisher) => (
            <OfficialCreatorCard key={publisher._id} publisher={publisher} />
          ))}
        </div>
        {loadFailed ? (
          <button
            type="button"
            className="home-v2-popular-publishers-retry oc-action oc-action-ghost"
            onClick={() => void hydratePublishers()}
          >
            <RefreshCw size={14} aria-hidden="true" />
            Retry
          </button>
        ) : null}
      </div>
    </section>
  );
}
