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

const OG_IMAGE_VERSION = "20260420-12";

export const Route = createRootRoute({
  head: () => {
    const mode = getSiteMode();
    const siteName = getSiteName(mode);
    const siteTitle = mode === "souls" ? siteName : "ClawHub | The OpenClaw Registry";
    const siteDescription = getSiteDescription(mode);
    const siteUrl = getSiteUrlForMode(mode);
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
          title: siteTitle,
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
        {
          rel: "icon",
          href: "/favicon.svg",
          type: "image/svg+xml",
        },
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
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var d=document.documentElement,s='clawhub-theme-selection',k='clawhub-theme',n='clawhub-theme-name',l='clawdhub-theme';var sel;try{var raw=localStorage.getItem(s);if(raw){sel=JSON.parse(raw)}}catch(e){}if(!sel){var m=localStorage.getItem(k),t=localStorage.getItem(n);if(m||t){sel={theme:t||'claw',mode:m||'system'}}else{var lg=localStorage.getItem(l);if(lg){var map={dark:'dark',light:'light',system:'system',defaultTheme:'dark',docsTheme:'light',lightTheme:'dark',landingTheme:'dark',newTheme:'dark',openknot:'dark',fieldmanual:'dark',clawdash:'light'};sel={theme:'claw',mode:map[lg]||'system'}}}}if(!sel)sel={theme:'claw',mode:'system'};var themes=['claw'],modes=['system','light','dark'];if(themes.indexOf(sel.theme)<0)sel.theme='claw';if(modes.indexOf(sel.mode)<0)sel.mode='system';var resolved=sel.mode==='system'?(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):sel.mode;d.dataset.theme=resolved;d.dataset.themeResolved=resolved;d.dataset.themeMode=sel.mode;d.dataset.themeFamily=sel.theme;if(resolved==='dark')d.classList.add('dark');else d.classList.remove('dark')}catch(e){}})()`,
          }}
        />
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
