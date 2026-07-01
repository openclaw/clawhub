import {
  createRootRoute,
  HeadContent,
  redirect,
  Scripts,
  useLocation,
  useRouter,
} from "@tanstack/react-router";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { useEffect } from "react";
import { Toaster } from "sonner";
import { AppProviders } from "../components/AppProviders";
import { ClientOnly } from "../components/ClientOnly";
import { DeploymentDriftBanner } from "../components/DeploymentDriftBanner";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { Footer } from "../components/Footer";
import { GenericNotFoundPage } from "../components/GenericNotFoundPage";
import Header from "../components/Header";
import {
  BANNED_ACCOUNT_PATH,
  isBannedAccountAuthError,
  normalizeAuthErrorMessage,
} from "../lib/authErrorMessage";
import { HOME_APP_IMAGE_ICON_PRELOADS } from "../lib/homeApps";
import { getClawHubSiteUrl, SITE_DESCRIPTION, SITE_NAME } from "../lib/site";
import { getThemeModeFromCookieHeader, normalizeThemeMode } from "../lib/themeCookie";
import appCss from "../styles.css?url";

const OG_IMAGE_VERSION = "20260624-1";

export const Route = createRootRoute({
  beforeLoad: ({ location }) => {
    if (location.pathname === BANNED_ACCOUNT_PATH) return;
    const authError = getAuthErrorDescription(location);
    if (!authError) return;
    const message = normalizeAuthErrorMessage(authError, "");
    if (!isBannedAccountAuthError(message)) return;

    throw redirect({
      to: BANNED_ACCOUNT_PATH,
      replace: true,
    });
  },
  head: () => {
    const siteName = SITE_NAME;
    const siteDescription = SITE_DESCRIPTION;
    const siteUrl = getClawHubSiteUrl();
    const ogImage = `${siteUrl}/og.png?v=${OG_IMAGE_VERSION}`;

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
        ...HOME_APP_IMAGE_ICON_PRELOADS.map((href) => ({
          rel: "preload",
          href,
          as: "image",
          type: "image/svg+xml",
        })),
        {
          rel: "icon",
          href: "/favicon.ico",
          type: "image/x-icon",
        },
        {
          rel: "apple-touch-icon",
          href: "/logo192.png",
        },
        {
          rel: "manifest",
          href: "/manifest.json",
        },
      ],
    };
  },

  shellComponent: RootDocument,
  notFoundComponent: GenericNotFoundPage,
});

function getAuthErrorDescription(location: { search?: unknown; searchStr?: string }) {
  const fromSearch =
    getSearchStringValue(location.search, "error_description") ??
    getSearchStringValue(location.search, "error");
  if (fromSearch) return fromSearch;
  if (!location.searchStr) return null;
  const params = new URLSearchParams(location.searchStr);
  return params.get("error_description")?.trim() || params.get("error")?.trim() || null;
}

function getSearchStringValue(search: unknown, key: string) {
  if (!search || typeof search !== "object") return null;
  const value = (search as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function RootDocument({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const initialThemeMode = normalizeThemeMode(
    (router.options.context as { initialThemeMode?: unknown } | undefined)?.initialThemeMode ??
      (typeof document === "undefined" ? undefined : getThemeModeFromCookieHeader(document.cookie)),
  );
  const initialResolvedTheme = initialThemeMode === "system" ? undefined : initialThemeMode;

  useEffect(() => {
    document.documentElement.dataset.clawhubHydrated = "true";
  }, []);

  const showAnalytics =
    typeof window !== "undefined" &&
    !["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);

  return (
    <html
      className={initialThemeMode === "dark" ? "dark" : undefined}
      data-theme={initialResolvedTheme}
      data-theme-family="claw"
      data-theme-mode={initialThemeMode}
      data-theme-resolved={initialResolvedTheme}
      lang="en"
      suppressHydrationWarning
    >
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
            {showAnalytics ? (
              <>
                <Analytics />
                <SpeedInsights />
              </>
            ) : null}
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
