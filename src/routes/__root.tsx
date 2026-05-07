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
  notFoundComponent: NotFoundPage,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var d=document.documentElement,s='clawhub-theme-selection',k='clawhub-theme',n='clawhub-theme-name',l='clawdhub-theme',c='clawhub-custom-theme',p='clawhub-preferences';var defaults={theme:'claw',mode:'system'};var storageKeys=[c,p,s,k,n,l];var cookieKeys=[c,p,s,k,n,l];function hasCookie(name){if(!document.cookie)return false;return document.cookie.split(';').some(function(part){return part.trim().indexOf(name+'=')===0})}function clearCookie(name){document.cookie=name+'=; Max-Age=0; path=/';document.cookie=name+'=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'}function cleanupDom(){var style=document.getElementById('clawhub-custom-theme-style');if(style)style.remove();var fonts=document.getElementById('clawhub-custom-theme-fonts');if(fonts)fonts.remove();d.classList.remove('theme-custom','high-contrast','reduce-motion');delete d.dataset.density;delete d.dataset.animation;d.style.removeProperty('--code-font-size')}var reset=false;try{if(localStorage.getItem(c)||localStorage.getItem(p))reset=true;var raw=localStorage.getItem(s);if(raw){try{var parsed=JSON.parse(raw);if(parsed&&parsed.theme&&parsed.theme!=='claw')reset=true}catch(e){reset=true}}var storedName=localStorage.getItem(n);if(storedName&&storedName!=='claw')reset=true;var storedMode=localStorage.getItem(k);if(storedMode&&['system','light','dark'].indexOf(storedMode)<0)reset=true;var legacy=localStorage.getItem(l);if(legacy&&['system','light','dark'].indexOf(legacy)<0)reset=true}catch(e){}if(cookieKeys.some(hasCookie))reset=true;if(reset){try{storageKeys.forEach(function(key){localStorage.removeItem(key)});localStorage.setItem(s,JSON.stringify(defaults));localStorage.setItem(k,defaults.mode);localStorage.setItem(n,defaults.theme)}catch(e){}cookieKeys.forEach(clearCookie);cleanupDom()}var sel;try{var stored=localStorage.getItem(s);if(stored){sel=JSON.parse(stored)}}catch(e){}if(!sel){var m=localStorage.getItem(k),t=localStorage.getItem(n);if(m||t){sel={theme:t||'claw',mode:m||'system'}}else{var lg=localStorage.getItem(l);if(lg){var map={dark:'dark',light:'light',system:'system'};sel={theme:'claw',mode:map[lg]||'system'}}}}if(!sel)sel=defaults;var themes=['claw'],modes=['system','light','dark'];if(themes.indexOf(sel.theme)<0)sel.theme='claw';if(modes.indexOf(sel.mode)<0)sel.mode='system';var resolved=sel.mode==='system'?(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):sel.mode;d.dataset.theme=resolved;d.dataset.themeResolved=resolved;d.dataset.themeMode=sel.mode;d.dataset.themeFamily=sel.theme;if(resolved==='dark')d.classList.add('dark');else d.classList.remove('dark')}catch(e){}})()`,
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

function NotFoundPage() {
  return (
    <main className="border-b border-[color:var(--line)] bg-[color:var(--bg)]">
      <section className="mx-auto flex w-full max-w-[1120px] flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14 lg:py-16">
        <div className="flex max-w-[840px] flex-col gap-4">
          <div className="flex flex-col gap-4">
            <h1 className="font-display text-4xl font-black leading-[0.98] text-[color:var(--ink)] sm:text-5xl">
              We couldn't find that page.
            </h1>
            <p className="max-w-xl text-base leading-7 text-[color:var(--ink-soft)] sm:text-lg">
              We couldn't find a skill, plugin, or profile at this URL. Try search, browse the
              catalog, or publish the thing you expected to see here.
            </p>
          </div>
        </div>

        <img
          src="/404-lobster-detective.jpg"
          alt="A lobster detective inspecting an empty 404 package crate."
          className="aspect-[16/9] w-full max-w-[920px] rounded-[var(--r-md)] border border-[color:var(--line)] object-cover object-left shadow-[var(--shadow-hover)]"
          loading="lazy"
        />
      </section>
    </main>
  );
}
