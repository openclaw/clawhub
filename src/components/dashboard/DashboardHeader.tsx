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
};

export function DashboardHeader({
  publishers,
  activePublisherId,
  onPublisherChange,
  ownerHandle,
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
          </div>
        </div>
      </div>
    </header>
  );
}
