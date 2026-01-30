import { createFileRoute, Link } from '@tanstack/react-router'
import { usePaginatedQuery } from 'convex-helpers/react'
import { api } from '../../../convex/_generated/api'
import { PageShell } from '../../components/PageShell'
import { ResourceCard } from '../../components/ResourceCard'
import { SectionHeader } from '../../components/SectionHeader'
import { Button, buttonVariants } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import type { PublicResource } from '../../lib/publicUser'

export const Route = createFileRoute('/extensions/')({
  component: ExtensionsIndex,
})

function ExtensionsIndex() {
  const {
    results: paginatedResults,
    status,
    loadMore,
  } = usePaginatedQuery(api.extensions.listPublicPage, {}, { initialNumItems: 24 })
  const isLoading = status === 'LoadingFirstPage'
  const canLoadMore = status === 'CanLoadMore'
  const isLoadingMore = status === 'LoadingMore'
  const items = paginatedResults as PublicResource[]

  return (
    <main className="py-10">
      <PageShell className="space-y-10">
        <SectionHeader
          title="Extensions"
          description={
            isLoading ? 'Loading extensions…' : 'Browse the extension catalog when it launches.'
          }
        />

        {isLoading ? (
          <Card className="p-6 text-sm text-muted-foreground">Loading extensions…</Card>
        ) : items.length === 0 ? (
          <Card className="space-y-4 p-6">
            <div className="space-y-1">
              <h2 className="font-display text-lg font-semibold">No extensions yet</h2>
              <p className="text-sm text-muted-foreground">
                There aren’t any extensions published right now. Check back soon for updates.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                to="/skills"
                search={{
                  q: undefined,
                  sort: undefined,
                  dir: undefined,
                  highlighted: undefined,
                  view: undefined,
                  focus: undefined,
                }}
                className={buttonVariants({ variant: 'outline' })}
              >
                Browse skills
              </Link>
              <Link to="/upload" search={{ updateSlug: undefined }} className={buttonVariants()}>
                Upload a skill
              </Link>
            </div>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {items.map((resource) => (
              <ResourceCard
                key={resource._id}
                type="extension"
                resource={resource}
                summaryFallback="Extension bundle."
                meta={
                  <span>
                    ⭐ {resource.stats.stars} stars · ⤓ {resource.stats.downloads} downloads
                  </span>
                }
              />
            ))}
          </div>
        )}

        {canLoadMore ? (
          <div className="text-center">
            <Button
              type="button"
              variant="outline"
              onClick={() => loadMore(24)}
              disabled={isLoadingMore}
            >
              {isLoadingMore ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        ) : null}
      </PageShell>
    </main>
  )
}
