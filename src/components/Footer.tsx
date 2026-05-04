import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { FOOTER_NAV_SECTIONS } from "../lib/nav-items";

function sectionId(title: string) {
  return `footer-section-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

// Must match the `@media (max-width: 760px)` breakpoint in styles.css where
// `.footer-col-links` is hidden by default and shown only when [data-open="true"].
const MOBILE_BREAKPOINT = 760;

export function Footer() { // Removed "All Rights Reserved"
  const [openSections, setOpenSections] = useState<ReadonlySet<string>>(() => new Set());
  // Track whether the mobile disclosure behavior is active so aria-expanded matches
  // actual link visibility. Initialized to false (= desktop assumption) so that
  // SSR and the first client render agree: on desktop links are always visible and
  // aria-expanded=true is correct. On mobile, useEffect corrects this after hydration.
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      setIsMobile(false);
      return () => {};
    }

    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const toggleSection = (title: string) => {
    setOpenSections((current) => {
      const next = new Set(current);
      if (next.has(title)) {
        next.delete(title);
      } else {
        next.add(title);
      }
      return next;
    });
  };

  return (
    <footer className="site-footer" role="contentinfo">
      <div className="site-footer-inner">
        <div className="footer-grid">
          {FOOTER_NAV_SECTIONS.map((section) => {
            const isOpen = openSections.has(section.title);
            const id = sectionId(section.title);
            // On desktop the links are always visible; aria-expanded must be true.
            // On mobile the links are hidden/shown via the disclosure button.
            const ariaExpanded = isMobile ? isOpen : true;

            return (
              <div key={section.title} className="footer-col">
                <h4 className="footer-col-title">
                  <button
                    type="button"
                    className="footer-col-toggle"
                    aria-controls={`${id}-links`}
                    aria-expanded={ariaExpanded}
                    onClick={() => {
                      if (isMobile) toggleSection(section.title);
                    }}
                  >
                    <span>{section.title}</span>
                    <ChevronDown className="footer-col-toggle-icon" size={16} aria-hidden="true" />
                  </button>
                </h4>
                <div className="footer-col-links" id={`${id}-links`} data-open={isOpen}>
                  {section.items
                    .filter((item) => item.featureFlag !== false)
                    .map((item) => {
                      if (item.kind === "link") {
                        return (
                          <Link key={item.label} to={item.to} search={item.search ?? {}}>
                            {item.label}
                          </Link>
                        );
                      }
                      if (item.kind === "external") {
                        return (
                          <a key={item.label} href={item.href} target="_blank" rel="noreferrer">
                            {item.label}
                          </a>
                        );
                      }
                      return <span key={item.label}>{item.label}</span>;
                    })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </footer>
  );
}
