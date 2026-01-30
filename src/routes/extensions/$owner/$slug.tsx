import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import { PageShell } from '../../../components/PageShell'
import { ResourceDetailShell } from '../../../components/ResourceDetailShell'
import { buttonVariants } from '../../../components/ui/button'
import { Card } from '../../../components/ui/card'

function toTitleCase(value: string) {
  return value
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export const Route = createFileRoute('/extensions/$owner/$slug')({
  component: ExtensionDetail,
})

function ExtensionDetail() {
  const { owner, slug } = Route.useParams()
  const resource = useQuery(api.extensions.getBySlug, { slug })
  const displayName = resource?.displayName ?? toTitleCase(slug)
  const summary = resource?.summary

  return (
    <main className="py-10">
      <PageShell className="space-y-8">
        <ResourceDetailShell
          title={displayName || 'Extension'}
          subtitle={`/${owner}/${slug}`}
          note={
            summary ?? 'Extensions are not available yet. This page is ready for future releases.'
          }
          stats={
            resource ? (
              <span>
                ⭐ {resource.stats.stars} · ⤓ {resource.stats.downloads} · {resource.stats.versions}{' '}
                v
              </span>
            ) : null
          }
          actions={
            <Link to="/extensions" className={buttonVariants({ variant: 'outline' })}>
              Back to extensions
            </Link>
          }
        />

        <Card className="space-y-2 p-6">
          <h2 className="font-display text-lg font-semibold">Coming soon</h2>
          <p className="text-sm text-muted-foreground">
            We’re building the extensions catalog. When it launches, this page will show the
            extension details, releases, and installation instructions.
          </p>
        </Card>
      </PageShell>
    </main>
  )
}
