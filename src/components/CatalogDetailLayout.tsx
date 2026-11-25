import { ChevronRight } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { cn } from "../lib/utils";
import "./catalog-detail-layout.css";

const serverDate = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

export function useCatalogDateFormatter() {
  // The first client render must match the server, even across a calendar-day boundary.
  const [formatter, setFormatter] = useState(serverDate);
  useEffect(() => setFormatter(new Intl.DateTimeFormat(undefined, { dateStyle: "medium" })), []);
  return formatter;
}

// Keep the public detail views on one rail, like Control UI's PluginDetailShell.
export function CatalogDetailLayout(props: {
  breadcrumb: ReactNode;
  icon: ReactNode;
  title: ReactNode;
  publisher?: ReactNode;
  summary?: ReactNode;
  sidebar: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headingId = useId();
  return (
    <section className={cn("catalog-detail", props.className)} aria-labelledby={headingId}>
      {props.breadcrumb}
      <header className="catalog-detail__hero">
        <div className="catalog-detail__icon" aria-hidden="true">
          {props.icon}
        </div>
        <div className="catalog-detail__heading">
          <div className="catalog-detail__title-row">
            <h1 id={headingId}>{props.title}</h1>
          </div>
          {props.publisher && <div className="catalog-detail__publisher">{props.publisher}</div>}
        </div>
      </header>
      <div className="catalog-detail__content">
        <div className="catalog-detail__main">
          {props.summary && <div className="catalog-detail__summary">{props.summary}</div>}
          {props.children}
        </div>
        <aside className="catalog-detail__sidebar">{props.sidebar}</aside>
      </div>
    </section>
  );
}

export function CatalogDetailBreadcrumb({
  href,
  label,
  current,
}: {
  href: string;
  label: string;
  current: string;
}) {
  return (
    <nav className="catalog-detail__breadcrumb" aria-label="Breadcrumb">
      <a href={href}>{label}</a>
      <ChevronRight size={12} aria-hidden="true" />
      <span aria-current="page">{current}</span>
    </nav>
  );
}

export function CatalogDetailFact({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <dl className="catalog-detail__fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </dl>
  );
}
