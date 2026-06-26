import type { ReactNode } from "react";

type DashboardInventorySectionProps = {
  toolbar: ReactNode;
  children: ReactNode;
};

export function DashboardInventorySection({ toolbar, children }: DashboardInventorySectionProps) {
  return (
    <section className="dashboard-inventory-section" aria-label="My inventory">
      <header className="dashboard-section-head">
        <div className="dashboard-section-head-main">
          <h2 className="dashboard-section-title">My inventory</h2>
        </div>
      </header>

      {toolbar}

      <div className="dashboard-inventory-body">{children}</div>
    </section>
  );
}
