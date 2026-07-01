import type { ReactNode } from "react";

type DashboardInventorySectionProps = {
  toolbar: ReactNode;
  children: ReactNode;
  count: number;
};

export function DashboardInventorySection({
  toolbar,
  children,
  count,
}: DashboardInventorySectionProps) {
  return (
    <section className="dashboard-inventory-section" aria-label="Packages">
      <header className="dashboard-section-head">
        <div className="dashboard-section-head-main">
          <h2 className="dashboard-section-title">Packages</h2>
          <span className="dashboard-section-count">{count}</span>
        </div>
      </header>

      {toolbar}

      <div className="dashboard-inventory-body">{children}</div>
    </section>
  );
}
