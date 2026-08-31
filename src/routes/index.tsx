import { createFileRoute } from "@tanstack/react-router";
import { HomeAppsSection } from "../components/HomeAppsSection";
import { HomeBringSkillsSection } from "../components/HomeBringSkillsSection";
import { HomeListingSection } from "../components/HomeListingSection";
import { HomePopularPublishersSection } from "../components/HomePopularPublishersSection";
import { HomeV2FoldBottomFade } from "../components/HomeV2FoldBottomFade";
import { FeatureFlagProvider, useFeatureFlag } from "../lib/featureFlags";
import { loadInitialFeatureFlags, type InitialFeatureFlags } from "../lib/featureFlags.functions";
import { fetchInitialHomeListing, type HomeListingInitialData } from "../lib/homeListingData";

type HomeRouteLoaderData = {
  initialFeatureFlags: InitialFeatureFlags;
  initialListing: HomeListingInitialData | null;
};

export const Route = createFileRoute("/")({
  loader: loadHomeRoute,
  component: SkillsHome,
});

async function loadHomeRoute(): Promise<HomeRouteLoaderData> {
  const [initialFeatureFlags, initialListing] = await Promise.all([
    loadInitialFeatureFlags(),
    loadInitialHomeListing(),
  ]);
  return { initialFeatureFlags, initialListing };
}

async function loadInitialHomeListing(): Promise<HomeListingInitialData | null> {
  try {
    return await fetchInitialHomeListing();
  } catch (error) {
    console.error("Failed to load initial home listing:", error);
    return null;
  }
}

function SkillsHome() {
  const { initialFeatureFlags, initialListing } = Route.useLoaderData();

  return (
    <FeatureFlagProvider initialValues={initialFeatureFlags.values}>
      <SkillsHomeContent initialListing={initialListing} />
    </FeatureFlagProvider>
  );
}

function SkillsHomeContent({ initialListing }: { initialListing: HomeListingInitialData | null }) {
  const showTestMessage = useFeatureFlag("homepageTestMessage");

  return (
    <main className="home-v2-main oc-app-surface">
      <HomeV2FoldBottomFade />

      {/* ═══ HERO ═══ */}
      <section className="home-v2-hero oc-hero">
        <div className="home-v2-hero-bg" aria-hidden="true" />

        <h1 className="home-v2-headline oc-hero-title">
          <span className="home-v2-action-word home-v2-static-headline">Claws for your Claws</span>
        </h1>

        <p className="home-v2-sub oc-hero-lede">
          {showTestMessage
            ? "Feature flag test is enabled."
            : "Discover skills and plugins from top creators"}
        </p>
      </section>

      <HomeListingSection initialListing={initialListing} />
      <HomePopularPublishersSection />
      <HomeAppsSection />
      <HomeBringSkillsSection />
    </main>
  );
}
