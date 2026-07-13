import { Link } from "@tanstack/react-router";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import type { PointerEvent } from "react";
import { useEffect, useRef, useState } from "react";
import {
  FOOTER_ECOSYSTEM_PROJECTS,
  FOOTER_NAV_SECTIONS,
  FOOTER_PLATFORM_LINKS,
  type FooterEcosystemProject,
  OPENCLAW_CLAWHUB_DOCS_URL,
  OPENCLAW_ECOSYSTEM_URL,
  OPENCLAW_LOGO_URL,
  OPENCLAW_SITE_URL,
} from "../lib/nav-items";

const FOOTER_BRAND_MARK_SRC = "/logo-transparent.png";
const FOOTER_EASTER_ASCII = [
  "....:: clawhub/openclaw ::....  skills plugins publishers trust signals",
  ">>> install scan publish verify    @@ gateway @@ registry @@ agents @@",
  "  30 skills 12 plugins    /api/v1/skills   /owners   /audit   /ship",
  ":::: signed manifests ::::: moderated releases ::::: version history ::::",
  "  hooks runners slash-commands skill.md templates scanners review-bots",
  "openclaw ecosystem    crabbox clickclack crawler packs gateway plugins",
  "---- downloads installs stars lineage ownership docs package integrity",
  "  safe browse paths   verified gateways   publisher handles   org trust",
];
const FOOTER_EASTER_ASCII_FIELD = Array.from({ length: 44 }, (_, row) => {
  const a = FOOTER_EASTER_ASCII[row % FOOTER_EASTER_ASCII.length];
  const b = FOOTER_EASTER_ASCII[(row + 3) % FOOTER_EASTER_ASCII.length];
  const c = FOOTER_EASTER_ASCII[(row + 5) % FOOTER_EASTER_ASCII.length];
  return `${a}   ${b}   ${c}`;
}).join("\n");

function sectionId(title: string) {
  return `footer-section-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

const MOBILE_BREAKPOINT = 760;

function FooterSocialIcon({ icon }: { icon: "github" | "discord" }) {
  if (icon === "github") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        className="footer-col-link-icon"
        aria-hidden="true"
      >
        <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.25.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.16 1.18.92-.26 1.9-.38 2.88-.39.98 0 1.96.13 2.88.39 2.19-1.49 3.15-1.18 3.15-1.18.63 1.58.24 2.75.12 3.04.74.8 1.18 1.83 1.18 3.08 0 4.42-2.69 5.39-5.25 5.67.42.36.78 1.07.78 2.15 0 1.55-.01 2.8-.01 3.18 0 .31.21.67.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className="footer-col-link-icon"
      aria-hidden="true"
    >
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

function FooterEcoMark({
  project,
  decorative = false,
}: {
  project: FooterEcosystemProject;
  decorative?: boolean;
}) {
  const className = "footer-v2-eco-mark";
  const content = (
    <>
      <span className="footer-v2-eco-mark-logo" aria-hidden="true">
        <img src={project.logoUrl} alt="" width={28} height={28} loading="lazy" decoding="async" />
      </span>
      <span className="footer-v2-eco-mark-label">{project.label}</span>
    </>
  );

  if (decorative) {
    return <span className={className}>{content}</span>;
  }

  if (project.internal) {
    return (
      <Link to={project.href} className={className} title={project.blurb}>
        {content}
      </Link>
    );
  }

  return (
    <a
      className={className}
      href={project.href}
      target="_blank"
      rel="noreferrer"
      title={project.blurb}
    >
      {content}
    </a>
  );
}

function FooterEasterBackdrop() {
  const easterRef = useRef<HTMLDivElement>(null);

  // Scroll-driven parallax: as the reveal area below the footer scrolls into
  // view, drift the composition into place for a depth effect. 0 = hidden
  // below the fold, 1 = fully revealed.
  useEffect(() => {
    const el = easterRef.current;
    if (!el) return undefined;
    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      el.style.setProperty("--footer-easter-reveal", "1");
      return undefined;
    }

    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = el.getBoundingClientRect();
      const viewportH = window.innerHeight || 1;
      const progress = (viewportH - rect.top) / (rect.height || viewportH);
      el.style.setProperty("--footer-easter-reveal", String(Math.max(0, Math.min(1, progress))));
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--footer-easter-x", `${event.clientX - rect.left}px`);
    event.currentTarget.style.setProperty("--footer-easter-y", `${event.clientY - rect.top}px`);
    event.currentTarget.style.setProperty("--footer-easter-intensity", "1");
  };

  const handlePointerLeave = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.style.setProperty("--footer-easter-intensity", "0");
  };

  return (
    <div
      ref={easterRef}
      className="footer-v2-easter"
      aria-hidden="true"
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      <div className="footer-v2-easter-image footer-v2-easter-image--base" />
      <pre className="footer-v2-easter-ascii">{FOOTER_EASTER_ASCII_FIELD}</pre>
      <div className="footer-v2-easter-image footer-v2-easter-image--top" />
    </div>
  );
}

export function Footer() {
  const [openSections, setOpenSections] = useState<ReadonlySet<string>>(() => new Set());
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

  const year = new Date().getFullYear();
  const ecosystemProjects = FOOTER_ECOSYSTEM_PROJECTS.filter(
    (project) => project.label !== "ClawHub",
  );

  return (
    <footer className="site-footer site-footer-v2" role="contentinfo">
      <div className="site-footer-inner">
        <div className="footer-v2-main">
          <div className="footer-v2-brand">
            <Link to="/" className="footer-v2-brand-lockup">
              <img
                className="footer-v2-brand-mark"
                src={FOOTER_BRAND_MARK_SRC}
                alt=""
                width={22}
                height={22}
                loading="lazy"
                decoding="async"
              />
              <span className="footer-v2-brand-name">ClawHub</span>
            </Link>
            <p className="footer-v2-brand-tagline">
              Skills and plugins for OpenClaw agents. Part of the wider OpenClaw ecosystem.
            </p>
            <a
              className="footer-v2-eco-link"
              href={OPENCLAW_CLAWHUB_DOCS_URL}
              target="_blank"
              rel="noreferrer"
            >
              Explore docs
              <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          </div>

          <div className="footer-grid">
            {FOOTER_NAV_SECTIONS.map((section) => {
              const isOpen = openSections.has(section.title);
              const id = sectionId(section.title);
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
                      <ChevronDown
                        className="footer-col-toggle-icon"
                        size={16}
                        aria-hidden="true"
                      />
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
                            <a
                              key={item.label}
                              href={item.href}
                              target="_blank"
                              rel="noreferrer"
                              className={`footer-col-link-external${item.icon ? " footer-col-link-with-icon" : ""}`}
                            >
                              {item.icon ? <FooterSocialIcon icon={item.icon} /> : null}
                              {item.label}
                              <ArrowUpRight
                                className="footer-col-link-external-icon"
                                size={12}
                                aria-hidden="true"
                              />
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

        <div className="footer-v2-eco" aria-label="OpenClaw ecosystem">
          <p className="footer-v2-eco-label">
            Built alongside{" "}
            <span className="footer-v2-eco-label-accent">
              <img
                src={OPENCLAW_LOGO_URL}
                alt=""
                width={14}
                height={14}
                loading="lazy"
                decoding="async"
              />
              the OpenClaw ecosystem
            </span>
          </p>
          <div className="footer-v2-eco-marquee">
            <div className="footer-v2-eco-marks">
              <span className="footer-v2-eco-sequence">
                {ecosystemProjects.map((project) => (
                  <FooterEcoMark key={project.label} project={project} />
                ))}
                <span className="footer-v2-eco-all">
                  <a
                    className="footer-v2-eco-mark footer-v2-eco-mark-all"
                    href={OPENCLAW_ECOSYSTEM_URL}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className="footer-v2-eco-mark-label">All projects</span>
                    <ArrowUpRight size={13} aria-hidden="true" />
                  </a>
                </span>
              </span>
              <span
                className="footer-v2-eco-sequence footer-v2-eco-sequence-clone"
                aria-hidden="true"
              >
                {ecosystemProjects.map((project) => (
                  <FooterEcoMark key={project.label} project={project} decorative />
                ))}
                <span className="footer-v2-eco-mark footer-v2-eco-mark-all">
                  <span className="footer-v2-eco-mark-label">All projects</span>
                  <ArrowUpRight size={13} aria-hidden="true" />
                </span>
              </span>
            </div>
          </div>
        </div>

        <div className="footer-v2-bottom">
          <p className="footer-v2-copy">
            © {year}{" "}
            <Link to="/" className="footer-v2-copy-link">
              ClawHub
            </Link>
            {" / "}
            <a
              className="footer-v2-copy-link"
              href={OPENCLAW_SITE_URL}
              target="_blank"
              rel="noreferrer"
            >
              an OpenClaw project
              <ArrowUpRight
                className="footer-col-link-external-icon footer-v2-copy-link-icon"
                size={12}
                aria-hidden="true"
              />
            </a>
          </p>
          <p className="footer-v2-meta">
            {FOOTER_PLATFORM_LINKS.map((link, index) => (
              <span key={link.label}>
                {index > 0 ? (
                  <span className="footer-v2-meta-sep" aria-hidden="true">
                    ·
                  </span>
                ) : null}
                <a
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  className="footer-col-link-external"
                >
                  {link.label}
                  <ArrowUpRight
                    className="footer-col-link-external-icon"
                    size={12}
                    aria-hidden="true"
                  />
                </a>
              </span>
            ))}
          </p>
        </div>
      </div>
      <FooterEasterBackdrop />
    </footer>
  );
}
