import { Link } from "@tanstack/react-router";
import { getSiteName } from "../lib/site";

export function Footer() {
  const siteName = getSiteName();
  return (
    <footer className="site-footer" role="contentinfo">
      <div className="site-footer-inner">
        <div className="site-footer-divider" aria-hidden="true" />
        <div className="footer-grid">
          <div className="footer-col">
            <h4 className="footer-col-title">Browse</h4>
            <Link
              to="/skills"
              search={{
                q: undefined,
                sort: undefined,
                dir: undefined,
                highlighted: undefined,
                nonSuspicious: undefined,
                view: undefined,
                focus: undefined,
              }}
            >
              Skills
            </Link>
            <Link to="/plugins">Plugins</Link>
            <Link to="/souls">Souls</Link>
            <Link to="/users">Users</Link>
            <Link
              to="/skills"
              search={{
                q: undefined,
                sort: undefined,
                dir: undefined,
                highlighted: true,
                nonSuspicious: undefined,
                view: undefined,
                focus: undefined,
              }}
            >
              Staff Picks
            </Link>
            <Link to="/search" search={{ q: undefined, type: undefined }}>
              Search
            </Link>
          </div>
          <div className="footer-col">
            <h4 className="footer-col-title">Publish</h4>
            <Link to="/publish-skill" search={{ updateSlug: undefined }}>
              Publish Skill
            </Link>
            <Link
              to="/publish-plugin"
              search={{
                ownerHandle: undefined,
                name: undefined,
                displayName: undefined,
                family: undefined,
                nextVersion: undefined,
                sourceRepo: undefined,
              }}
            >
              Publish Plugin
            </Link>
            <a href="https://github.com/openclaw/clawhub" target="_blank" rel="noreferrer">
              Documentation
            </a>
          </div>
          <div className="footer-col">
            <h4 className="footer-col-title">Community</h4>
            <a href="https://github.com/openclaw/clawhub" target="_blank" rel="noreferrer">
              GitHub
            </a>
            <Link to="/about">About</Link>
            <a href="https://openclaw.ai" target="_blank" rel="noreferrer">
              OpenClaw
            </a>
          </div>
          <div className="footer-col">
            <h4 className="footer-col-title">Platform</h4>
            <span>MIT Licensed</span>
            <a href="https://vercel.com" target="_blank" rel="noreferrer">
              Deployed on Vercel
            </a>
            <a href="https://www.convex.dev" target="_blank" rel="noreferrer">
              Powered by Convex
            </a>
          </div>
        </div>
        <div className="footer-bottom">
          <span>
            {siteName} — An{" "}
            <a href="https://openclaw.ai" target="_blank" rel="noreferrer">
              OpenClaw
            </a>{" "}
            project by{" "}
            <a href="https://steipete.me" target="_blank" rel="noreferrer">
              Peter Steinberger
            </a>
          </span>
        </div>
      </div>
    </footer>
  );
}
