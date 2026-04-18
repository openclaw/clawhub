import { Link } from "@tanstack/react-router";
import { FOOTER_NAV_SECTIONS } from "../lib/nav-items";
export function Footer() {
  return (
    <footer className="site-footer" role="contentinfo">
      <div className="site-footer-inner">
        <div className="footer-grid">
          {FOOTER_NAV_SECTIONS.map((section) => (
            <div key={section.title} className="footer-col">
              <h4 className="footer-col-title">{section.title}</h4>
              {section.items.filter((item) => item.featureFlag !== false).map((item) => {
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
                // kind === "text"
                return <span key={item.label}>{item.label}</span>;
              })}
            </div>
          ))}
        </div>
      </div>
    </footer>
  );
}
