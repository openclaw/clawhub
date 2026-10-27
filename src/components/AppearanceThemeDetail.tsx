import { Link } from "@tanstack/react-router";
import type { ThemeRelease } from "clawhub-schema";
import { ArrowLeft, Palette, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchAppearanceTheme } from "../lib/appearance";
import { Button } from "./ui/button";

export function AppearanceThemeDetail({
  owner,
  slug,
  version,
}: {
  owner: string;
  slug: string;
  version?: string;
}) {
  const [item, setItem] = useState<ThemeRelease | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setItem(null);
    setError(null);
    const timer = setTimeout(
      () => controller.abort(new Error("Request timed out. Please retry.")),
      10_000,
    );
    void Promise.race([
      fetchAppearanceTheme(owner, slug, version, controller.signal),
      new Promise<never>((_, reject) =>
        controller.signal.addEventListener("abort", () => reject(controller.signal.reason), {
          once: true,
        }),
      ),
    ])
      .then((release) => {
        if (current) setItem(release);
      })
      .catch((cause: unknown) => {
        if (current) setError(cause instanceof Error ? cause.message : "Unable to load theme.");
      })
      .finally(() => clearTimeout(timer));
    return () => {
      current = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [owner, slug, version, attempt]);
  return (
    <main className="section appearance-page">
      <Link to="/~appearance" className="appearance-detail-link">
        <ArrowLeft size={16} aria-hidden="true" /> All themes
      </Link>
      {!item && !error ? <p role="status">Loading theme…</p> : null}
      {error ? (
        <div className="appearance-message" role="alert">
          <h1>Theme unavailable</h1>
          <p>{error}</p>
          <Button variant="secondary" onClick={() => setAttempt((value) => value + 1)}>
            Retry
          </Button>
        </div>
      ) : null}
      {item ? (
        <>
          <header className="appearance-heading">
            <span className="appearance-eyebrow">
              <Palette size={16} aria-hidden="true" /> DATA-ONLY THEME
            </span>
            <h1>{item.name}</h1>
            <p>{item.description}</p>
            <p className="appearance-author">
              @{item.author.handle} · v{item.version}
            </p>
          </header>
          <section className="appearance-guide" aria-label="Install theme">
            <ShieldCheck size={23} aria-hidden="true" />
            <div>
              <h2>Install through OpenClaw Appearance</h2>
              <p>
                In OpenClaw, open Appearance settings, find <strong>{item.id}</strong>, and choose
                version <strong>{item.version}</strong>. This is theme data, not an executable
                plugin. ClawHub does not install it into your running OpenClaw.
              </p>
            </div>
          </section>
          <div className="appearance-palette-grid">
            {(["light", "dark"] as const).map((mode) => {
              const palette = item.definition[mode];
              if (!palette) return null;
              return (
                <section key={mode} className="appearance-palette card">
                  <h2>{mode === "light" ? "Light palette" : "Dark palette"}</h2>
                  <div
                    className="appearance-palette-preview"
                    style={{
                      backgroundColor: palette.background,
                      color: palette.foreground,
                      borderColor: palette.border,
                    }}
                  >
                    <div
                      style={{
                        backgroundColor: palette.card,
                        color: palette["card-foreground"],
                        borderColor: palette.border,
                      }}
                    >
                      <span>OpenClaw</span>
                      <h3>A little more you.</h3>
                      <p>Your conversations, with a fresh look.</p>
                      <span
                        className="appearance-preview-button"
                        style={{
                          backgroundColor: palette.primary,
                          color: palette["primary-foreground"],
                        }}
                      >
                        New conversation
                      </span>
                    </div>
                  </div>
                  <ul className="appearance-swatches">
                    {(["background", "foreground", "primary", "accent", "border"] as const).map(
                      (key) => (
                        <li key={key}>
                          <span style={{ backgroundColor: palette[key] }} aria-hidden="true" />
                          <span>{key}</span>
                          <code>{palette[key]}</code>
                        </li>
                      ),
                    )}
                  </ul>
                </section>
              );
            })}
          </div>
          <details className="appearance-definition card">
            <summary>Version details and normalized definition</summary>
            <dl>
              <dt>Theme</dt>
              <dd>{item.id}</dd>
              <dt>Version</dt>
              <dd>{item.version}</dd>
              <dt>SHA-256</dt>
              <dd>
                <code>{item.sha256}</code>
              </dd>
            </dl>
            <pre>{JSON.stringify(item.definition, null, 2)}</pre>
          </details>
        </>
      ) : null}
    </main>
  );
}
