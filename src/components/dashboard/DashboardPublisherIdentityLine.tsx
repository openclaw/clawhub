import { formatDashboardPublisherIdentity } from "./dashboardPublisherIdentity";
import type { DashboardPublisherEntry } from "./types";

export function DashboardPublisherIdentityLine({
  publisher,
}: {
  publisher: DashboardPublisherEntry["publisher"];
}) {
  const { name, handle } = formatDashboardPublisherIdentity(publisher);

  return (
    <>
      {name ? (
        <>
          <span className="dashboard-header-name">{name}</span>
          <span className="dashboard-header-meta-sep" aria-hidden="true">
            ·
          </span>
        </>
      ) : null}
      <span className="dashboard-header-handle">@{handle}</span>
    </>
  );
}
