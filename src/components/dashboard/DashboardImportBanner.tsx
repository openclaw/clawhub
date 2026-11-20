import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { GitHubIcon as GitHubLogo } from "../BrandIcons";

const DASHBOARD_IMPORT_BANNER_DISMISSED_KEY = "clawhub.dashboard.importBannerDismissed";

type DashboardImportBannerProps = {
  ownerHandle: string;
};

export function DashboardImportBanner({ ownerHandle }: DashboardImportBannerProps) {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    setIsVisible(window.localStorage.getItem(DASHBOARD_IMPORT_BANNER_DISMISSED_KEY) !== "1");
  }, []);

  if (!isVisible) return null;

  function dismiss() {
    window.localStorage.setItem(DASHBOARD_IMPORT_BANNER_DISMISSED_KEY, "1");
    setIsVisible(false);
  }

  return (
    <section className="dashboard-import-banner" aria-labelledby="dashboard-import-banner-title">
      <div className="dashboard-import-banner-text">
        <div className="dashboard-import-banner-heading">
          <h2 id="dashboard-import-banner-title" className="dashboard-import-banner-title">
            Import from GitHub
          </h2>
          <span className="dashboard-import-banner-badge">New</span>
        </div>
        <p className="dashboard-import-banner-copy">
          Import skills directly from your GitHub repositories.
        </p>
      </div>
      <div className="dashboard-import-banner-art-wrap">
        <img
          src="/github-import-hero-art.png"
          alt=""
          className="dashboard-import-banner-art"
          draggable={false}
          aria-hidden="true"
        />
      </div>
      <div className="dashboard-import-banner-actions">
        <Link
          to="/import"
          search={{ ownerHandle: ownerHandle || undefined }}
          className="dashboard-import-banner-action"
        >
          <GitHubLogo className="h-4 w-4" />
          Import skills
        </Link>
        <button
          type="button"
          className="dashboard-import-banner-dismiss"
          aria-label="Dismiss GitHub import banner"
          onClick={dismiss}
        >
          <span>Dismiss</span>
        </button>
      </div>
    </section>
  );
}
