import { Link } from "@tanstack/react-router";
import { ChevronsUpDown, Plus } from "lucide-react";
import { addSearchParams } from "../../lib/addRoutes";
import { Button } from "../ui/button";
import { DashboardPublisherSelect } from "./DashboardPublisherSelect";
import type { DashboardPublisherEntry } from "./types";

type DashboardHeaderProps = {
  publishers: DashboardPublisherEntry[];
  activePublisherId: string;
  onPublisherChange: (publisherId: string) => void;
  ownerHandle: string;
  isSidebarVisible: boolean;
  onToggleSidebar: () => void;
};

export function DashboardHeader({
  publishers,
  activePublisherId,
  onPublisherChange,
  ownerHandle,
  isSidebarVisible,
  onToggleSidebar,
}: DashboardHeaderProps) {
  const showPublisherSelector = publishers.length > 1;

  return (
    <header className="browse-page-header dashboard-page-header dashboard-header">
      <div className="browse-page-header-main dashboard-page-header-main">
        <div className="dashboard-header-top">
          <div className="dashboard-header-intro">
            <h1 className="browse-title">Dashboard</h1>
          </div>
          {showPublisherSelector ? (
            <div className="dashboard-header-publisher-center">
              <div className="dashboard-welcome-publisher-control">
                <span className="dashboard-welcome-publisher-label">Viewing as</span>
                <DashboardPublisherSelect
                  publishers={publishers}
                  value={activePublisherId}
                  onValueChange={onPublisherChange}
                  triggerClassName="dashboard-welcome-publisher-trigger"
                  triggerIcon={<ChevronsUpDown className="h-4 w-4 opacity-50" />}
                />
              </div>
            </div>
          ) : null}
          <div className="dashboard-header-actions">
            <Button asChild size="sm">
              <Link to="/add" search={addSearchParams({ ownerHandle })}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add skill or plugin
              </Link>
            </Button>
            <button
              type="button"
              className="dashboard-sidebar-toggle"
              aria-label={isSidebarVisible ? "Hide dashboard sidebar" : "Show dashboard sidebar"}
              aria-pressed={!isSidebarVisible}
              title={isSidebarVisible ? "Hide sidebar" : "Show sidebar"}
              onClick={onToggleSidebar}
            >
              <DashboardSidebarToggleIcon hidden={!isSidebarVisible} />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}

function DashboardSidebarToggleIcon({ hidden }: { hidden: boolean }) {
  return (
    <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="2.5" y="3" width="13" height="12" rx="3" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.5 3.5v11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      {hidden ? (
        <path
          d="M5.4 9h2.8M6.8 7.6 5.4 9l1.4 1.4"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M7.8 9H5M6.4 7.6 7.8 9l-1.4 1.4"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
