import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { addSearchParams } from "../../lib/addRoutes";
import { MarketplaceIcon } from "../MarketplaceIcon";
import { Button } from "../ui/button";
import { DashboardPublisherIdentityLine } from "./DashboardPublisherIdentityLine";
import { DashboardPublisherSelect } from "./DashboardPublisherSelect";
import {
  formatDashboardPublisherRole,
  shouldShowDashboardPublisherRole,
} from "./dashboardPublisherIdentity";
import type { DashboardPublisherEntry } from "./types";

type DashboardHeaderProps = {
  publisher: DashboardPublisherEntry["publisher"];
  publishers: DashboardPublisherEntry[];
  activePublisherId: string;
  onPublisherChange: (publisherId: string) => void;
  ownerHandle: string;
};

export function DashboardHeader({
  publisher,
  publishers,
  activePublisherId,
  onPublisherChange,
  ownerHandle,
}: DashboardHeaderProps) {
  const showPublisherSelector = publishers.length > 1;
  const selectedEntry =
    publishers.find((entry) => entry.publisher?._id === activePublisherId) ?? null;
  const roleLabel =
    selectedEntry && shouldShowDashboardPublisherRole(selectedEntry)
      ? formatDashboardPublisherRole(selectedEntry.role)
      : null;
  const scopeKind = publisher.kind === "org" ? "Org" : "Personal";

  return (
    <header className="browse-page-header dashboard-page-header dashboard-header">
      <div className="browse-page-header-main dashboard-page-header-main">
        <div className="dashboard-header-top">
          <div className="dashboard-header-intro">
            <h1 className="browse-title">Dashboard</h1>
            <p className="dashboard-header-subtitle">
              Manage your catalog and review items that need attention.
            </p>
          </div>
          <div className="dashboard-header-actions">
            <Button asChild size="sm">
              <Link to="/add" search={addSearchParams({ ownerHandle })}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add
              </Link>
            </Button>
          </div>
        </div>

        <div className="dashboard-scope-bar">
          <span className="dashboard-scope-avatar" aria-hidden="true">
            <MarketplaceIcon
              kind={publisher.kind === "org" ? "org" : "user"}
              label={publisher.displayName || publisher.handle}
              imageUrl={publisher.image}
              size="sm"
            />
          </span>
          <div className="dashboard-scope-identity">
            {showPublisherSelector ? (
              <DashboardPublisherSelect
                variant="identity"
                publishers={publishers}
                value={activePublisherId}
                onValueChange={onPublisherChange}
              />
            ) : (
              <DashboardPublisherIdentityLine publisher={publisher} />
            )}
            {roleLabel ? (
              <>
                <span className="dashboard-header-meta-sep" aria-hidden="true">
                  ·
                </span>
                <span className="dashboard-header-role">{roleLabel}</span>
              </>
            ) : null}
          </div>
          <span className="dashboard-scope-kind">{scopeKind}</span>
        </div>
      </div>
    </header>
  );
}
