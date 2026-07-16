import { createFileRoute } from "@tanstack/react-router";
import { HomeAppsSection } from "../components/HomeAppsSection";
import { HomeBringSkillsSection } from "../components/HomeBringSkillsSection";
import { HomeListingSection } from "../components/HomeListingSection";
import { HomePopularPublishersSection } from "../components/HomePopularPublishersSection";
import { HomeV2FoldBottomFade } from "../components/HomeV2FoldBottomFade";
import { fetchInitialHomeListing, type HomeListingInitialData } from "../lib/homeListingData";

export const Route = createFileRoute("/")({
  loader: loadInitialHomeListing,
  component: SkillsHome,
});

async function loadInitialHomeListing(): Promise<HomeListingInitialData | null> {
  try {
    return await fetchInitialHomeListing();
  } catch (error) {
    console.error("Failed to load initial home listing:", error);
    return null;
  }
}

function SkillsHome() {
  const initialListing = Route.useLoaderData();

  return (
    <main className="home-v2-main oc-app-surface">
      <HomeV2FoldBottomFade />

      {/* ═══ HERO ═══ */}
      <section className="home-v2-hero oc-hero">
        <div className="home-v2-hero-bg" aria-hidden="true" />

        <h1 className="home-v2-headline oc-hero-title">
          <span className="home-v2-action-word home-v2-static-headline">Claws for your Claws</span>
        </h1>

        <p className="home-v2-sub oc-hero-lede">Discover skills and plugins from top creators</p>
      </section>

      <HomeListingSection initialListing={initialListing} />
      <HomePopularPublishersSection />
      <HomeAppsSection />
      <HomeBringSkillsSection />
    </main>
  );
}
