import { createRootRoute, HeadContent, Scripts, useLocation } from "@tanstack/react-router";
import { Analytics } from "@vercel/analytics/react";
import { Toaster } from "sonner";
import { AppProviders } from "../components/AppProviders";
import { ClientOnly } from "../components/ClientOnly";
import { DeploymentDriftBanner } from "../components/DeploymentDriftBanner";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { Footer } from "../components/Footer";
import Header from "../components/Header";
import { getSiteDescription, getSiteMode, getSiteName, getSiteUrlForMode } from "../lib/site";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => {
    const mode = getSiteMode();
    const siteName = getSiteName(mode);
    const siteDescription = getSiteDescription(mode);
    const siteUrl = getSiteUrlForMode(mode);
    const ogImage = `${siteUrl}/og.png`;

    return {
      meta: [
        {
          charSet: "utf-8",
        },
        {
          name: "viewport",
          content: "width=device-width, initial-scale=1",
        },
        {
          title: siteName,
        },
        {
          name: "description",
          content: siteDescription,
        },
        {
          property: "og:site_name",
          content: siteName,
        },
        {
          property: "og:type",
          content: "website",
        },
        {
          property: "og:title",
          content: siteName,
        },
        {
          property: "og:description",
          content: siteDescription,
        },
        {
          property: "og:image",
          content: ogImage,
        },
        {
          property: "og:image:width",
          content: "1200",
        },
        {
          property: "og:image:height",
          content: "630",
        },
        {
          property: "og:image:alt",
          content: `${siteName} — ${siteDescription}`,
        },
        {
          name: "twitter:card",
          content: "summary_large_image",
        },
        {
          name: "twitter:title",
          content: siteName,
        },
        {
          name: "twitter:description",
          content: siteDescription,
        },
        {
          name: "twitter:image",
          content: ogImage,
        },
        {
          name: "twitter:image:alt",
          content: `${siteName} — ${siteDescription}`,
        },
      ],
      links: [
        {
          rel: "stylesheet",
          href: appCss,
        },
      ],
    };
  },

  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <AppProviders>
          <div className="app-shell">
            <Header />
            <ClientOnly>
              <DeploymentDriftBanner />
            </ClientOnly>
            <RouteErrorBoundary>{children}</RouteErrorBoundary>
            <Footer />
          </div>
          <Toaster
            position="bottom-right"
            toastOptions={{
              style: {
                background: "var(--surface)",
                color: "var(--ink)",
                border: "1px solid var(--line)",
                borderRadius: "var(--radius-md)",
                fontFamily: "var(--font-body)",
              },
            }}
          />
          <ClientOnly>
            <Analytics />
          </ClientOnly>
        </AppProviders>
        <Scripts />
      </body>
    </html>
  );
}

/** Resets the error boundary whenever the route pathname changes. */
function RouteErrorBoundary({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  return <ErrorBoundary resetKey={location.pathname}>{children}</ErrorBoundary>;
}
