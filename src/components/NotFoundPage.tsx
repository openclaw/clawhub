import { Link } from "@tanstack/react-router";

export function NotFoundPage() {
  return (
    <main className="section not-found-page">
      <section className="card not-found-card">
        <span className="not-found-eyebrow">404 • Page not found</span>
        <div className="not-found-copy">
          <h1 className="section-title not-found-title">This page drifted out of reach.</h1>
          <p className="section-subtitle not-found-description">
            The link may be outdated, the URL may have a typo, or this page may have moved.
            Let&apos;s get you back to something useful.
          </p>
          <div className="not-found-actions">
            <Link to="/" className="btn btn-primary">
              Return home
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
