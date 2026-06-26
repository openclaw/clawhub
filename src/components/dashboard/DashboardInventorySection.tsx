import type { ReactNode } from "react";
import { formatCompactStat } from "../../lib/numberFormat";

type DashboardInventorySectionProps = {
  totalCount: number;
  toolbar: ReactNode;
  children: ReactNode;
};

export function DashboardInventorySection({
  totalCount,
  toolbar,
  children,
}: DashboardInventorySectionProps) {
  return (
    <section className="dashboard-inventory-section" aria-label="Inventory">
      <header className="dashboard-section-head">
        <div className="dashboard-section-head-main">
          <h2 className="dashboard-section-title">Inventory</h2>
          <span className="dashboard-section-count">{formatCompactStat(totalCount)}</span>
        </div>
      </header>

      {toolbar}

      <div className="dashboard-inventory-body">{children}</div>
    </section>
  );
}
