import { useLayoutEffect, useState } from "react";
import { readHomeViewportHeight, shouldShowHomeV2FoldBottomFade } from "../lib/homeFoldFade";

type HomeV2FoldBottomFadeProps = {
  listingId?: string;
};

/** Fixed viewport bottom fade while the home listing section is still in scroll range. */
export function HomeV2FoldBottomFade({ listingId = "home-v2-listing" }: HomeV2FoldBottomFadeProps) {
  const [visible, setVisible] = useState(true);

  useLayoutEffect(() => {
    const listing = document.getElementById(listingId);
    if (!listing) return undefined;

    const update = () => {
      const { bottom } = listing.getBoundingClientRect();
      setVisible(shouldShowHomeV2FoldBottomFade(bottom, readHomeViewportHeight()));
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(listing);
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);

    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
    };
  }, [listingId]);

  return <div className={`home-v2-fold-fade${visible ? "" : " is-hidden"}`} aria-hidden="true" />;
}
