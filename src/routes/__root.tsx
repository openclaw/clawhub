import { TanStackDevtools } from '@tanstack/react-devtools'
import { createRootRoute, HeadContent, Scripts } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { Analytics } from '@vercel/analytics/react'
import { AppProviders } from '../components/AppProviders'
import { ClientOnly } from '../components/ClientOnly'
import { DeploymentDriftBanner } from '../components/DeploymentDriftBanner'
import { Footer } from '../components/Footer'
import Header from '../components/Header'
import { t, useI18n } from '../i18n'
import { getSiteMode, getSiteUrlForMode } from '../lib/site'

import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => {
    const mode = getSiteMode()
    const siteName = mode === 'souls' ? t('site.soulsName') : t('site.skillsName')
    const siteDescription =
      mode === 'souls' ? t('site.soulsDescription') : t('site.skillsDescription')
    const siteUrl = getSiteUrlForMode(mode)
    const ogImage = `${siteUrl}/og.png`

    return {
      meta: [
        {
          charSet: 'utf-8',
        },
        {
          name: 'viewport',
          content: 'width=device-width, initial-scale=1',
        },
        {
          title: siteName,
        },
        {
          name: 'description',
          content: siteDescription,
        },
        {
          property: 'og:site_name',
          content: siteName,
        },
        {
          property: 'og:type',
          content: 'website',
        },
        {
          property: 'og:title',
          content: siteName,
        },
        {
          property: 'og:description',
          content: siteDescription,
        },
        {
          property: 'og:image',
          content: ogImage,
        },
        {
          property: 'og:image:width',
          content: '1200',
        },
        {
          property: 'og:image:height',
          content: '630',
        },
        {
          property: 'og:image:alt',
          content: `${siteName} — ${siteDescription}`,
        },
        {
          name: 'twitter:card',
          content: 'summary_large_image',
        },
        {
          name: 'twitter:title',
          content: siteName,
        },
        {
          name: 'twitter:description',
          content: siteDescription,
        },
        {
          name: 'twitter:image',
          content: ogImage,
        },
        {
          name: 'twitter:image:alt',
          content: `${siteName} — ${siteDescription}`,
        },
      ],
      links: [
        {
          rel: 'stylesheet',
          href: appCss,
        },
      ],
    }
  },

  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  const { locale } = useI18n()
  return (
    <html lang={locale}>
      <head>
        <HeadContent />
      </head>
      <body>
        <ClientOnly>
          <AppProviders>
            <div className="app-shell">
              <Header />
              <DeploymentDriftBanner />
              {children}
              <Footer />
            </div>
            <Analytics />
            {import.meta.env.DEV ? (
              <TanStackDevtools
                config={{
                  position: 'bottom-right',
                }}
                plugins={[
                  {
                    name: 'Tanstack Router',
                    render: <TanStackRouterDevtoolsPanel />,
                  },
                ]}
              />
            ) : null}
          </AppProviders>
        </ClientOnly>
        <Scripts />
      </body>
    </html>
  )
}
