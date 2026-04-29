import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { FOOTER_NAV_SECTIONS } from "../lib/nav-items";

function sectionId(title: string) {
  return `footer-section-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

export function Footer() {
  const [openSections, setOpenSections] = useState<ReadonlySet<string>>(() => new Set());

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

            return (
              <div key={section.title} className="footer-col">
                <h4 className="footer-col-title">
                  <button
                    type="button"
                    className="footer-col-toggle"
                    aria-controls={`${id}-links`}
                    aria-expanded={isOpen}
                    onClick={() => toggleSection(section.title)}
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
