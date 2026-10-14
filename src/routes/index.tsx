import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowDownRight, ArrowRight } from "lucide-react";
import { useCallback } from "react";
import { ClawDiscovery, ClawSearch } from "../components/ClawDiscovery";
import { HomeAppsSection } from "../components/HomeAppsSection";
import { HomeBringSkillsSection } from "../components/HomeBringSkillsSection";
import { HomeListingSection } from "../components/HomeListingSection";
import { HomePopularPublishersSection } from "../components/HomePopularPublishersSection";
import { fetchClawDiscovery } from "../lib/clawDiscovery";
import { FeatureFlagProvider, useFeatureFlag } from "../lib/featureFlags";
import { loadInitialFeatureFlags, type InitialFeatureFlags } from "../lib/featureFlags.functions";
import {
  fetchInitialHomeListing,
  homeListingSearchFromView,
  homeListingViewFromSearch,
  parseHomeListingSearch,
  type HomeListingInitialData,
  type HomeListingView,
} from "../lib/homeListingData";
import { CLAWHUB_DOCS_URL } from "../lib/publicRegistry";
import "../claws.css";

export const Route = createFileRoute("/")({
  validateSearch: parseHomeListingSearch,
  // Tools retain their URL-selected view without refetching Claws on every tab switch.
  loader: async ({
    location,
  }): Promise<{
    initialFeatureFlags: InitialFeatureFlags;
    initialListing: HomeListingInitialData | null;
    initialData: Awaited<ReturnType<typeof fetchClawDiscovery>> | null;
  }> => {
    const [initialFeatureFlags, initialData, initialListing] = await Promise.all([
      loadInitialFeatureFlags(),
      fetchClawDiscovery().catch(() => null),
      fetchInitialHomeListing(
        homeListingViewFromSearch(parseHomeListingSearch(location.search)),
      ).catch(() => null),
    ]);
    return { initialFeatureFlags, initialData, initialListing };
  },
  pendingComponent: () => (
    <main className="claw-container claw-state" role="status">
      Loading Claws…
    </main>
  ),
  head: () => ({
    meta: [
      { title: "Claws · ClawHub" },
      {
        name: "description",
        content:
          "Find a Claw for the job. Discover ready-made agents, featured Claws, and popular categories on ClawHub.",
      },
    ],
  }),
  component: Home,
});

function Home() {
  const { initialData, initialFeatureFlags, initialListing } = Route.useLoaderData();
  return (
    <FeatureFlagProvider initialValues={initialFeatureFlags.values}>
      <ClawsHome initialData={initialData} initialListing={initialListing} />
    </FeatureFlagProvider>
  );
}

function ClawsHome({
  initialData,
  initialListing,
}: {
  initialData: Awaited<ReturnType<typeof fetchClawDiscovery>> | null;
  initialListing: HomeListingInitialData | null;
}) {
  const showTestMessage = useFeatureFlag("homepageTestMessage");
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/" });
  const handleListingViewChange = useCallback(
    (view: HomeListingView) => {
      void navigate({
        search: (prev) => ({ ...prev, ...homeListingSearchFromView(view) }),
        replace: true,
        resetScroll: false,
      });
    },
    [navigate],
  );
  return (
    <main className="claws-home home-v2-main oc-app-surface">
      <section className="claw-hero">
        <div className="claw-container claw-hero-inner">
          <span className="oc-eyebrow">The ClawHub field guide</span>
          <h1>Find a Claw for the job.</h1>
          <p>
            {showTestMessage ? (
              "Feature flag test is enabled."
            ) : (
              <>
                Ready-made agents, each with a point of view.
                <br className="claw-desktop-break" /> Find one for your work. Make it your own.
              </>
            )}
          </p>
          <ClawSearch />
          <a className="claw-hero-browse" href="#claw-discovery">
            Explore the collection <ArrowDownRight size={16} aria-hidden="true" />
          </a>
          <span className="claw-hero-note" aria-hidden="true">
            A little help.
            <br />A world of possibilities.
          </span>
        </div>
      </section>
      <div className="claw-container" id="claw-discovery">
        <ClawDiscovery initialData={initialData} />
      </div>
      <section className="claw-tools" aria-labelledby="claw-tools-title">
        <header className="claw-container claw-section-head">
          <div>
            <span className="oc-eyebrow">Build on what you have</span>
            <h2 id="claw-tools-title">Tools for your agents</h2>
            <p>Skills bring know-how. Plugins connect your apps and services.</p>
          </div>
          <div className="claw-tools-links">
            <Link to="/skills" className="claw-text-link">
              Skills <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <Link to="/plugins" className="claw-text-link">
              Plugins <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </header>
        <HomeListingSection
          initialListing={initialListing}
          requestedView={homeListingViewFromSearch(search)}
          onViewChange={handleListingViewChange}
        />
      </section>
      <HomePopularPublishersSection />
      <HomeAppsSection />
      <HomeBringSkillsSection />
      <div className="claw-container claw-publish-docs">
        <p>Have something worth sharing?</p>
        <a href={CLAWHUB_DOCS_URL} className="claw-text-link">
          Publisher & CLI documentation <ArrowRight size={16} aria-hidden="true" />
        </a>
      </div>
    </main>
  );
}
