import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Doc } from '../../convex/_generated/dataModel'
import { PageShell } from '../components/PageShell'
import { ResourceCard } from '../components/ResourceCard'
import { SectionHeader } from '../components/SectionHeader'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import type { PublicSkill } from '../lib/publicUser'

export const Route = createFileRoute('/stars')({
  component: Stars,
})

function Stars() {
  const me = useQuery(api.users.me) as Doc<'users'> | null | undefined
  const skills =
    (useQuery(api.stars.listByUser, me ? { userId: me._id, limit: 50 } : 'skip') as
      | PublicSkill[]
      | undefined) ?? []

  const toggleStar = useMutation(api.stars.toggle)

  if (!me) {
    return (
      <main className="py-10">
        <PageShell>
          <Card className="p-6 text-sm text-muted-foreground">Sign in to see your highlights.</Card>
        </PageShell>
      </main>
    )
  }

  return (
    <main className="py-10">
      <PageShell className="space-y-8">
        <SectionHeader
          title="Your highlights"
          description="Skills you’ve starred for quick access."
        />
        {skills.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground">No stars yet.</Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {skills.map((skill) => (
              <div key={skill._id} className="relative">
                <ResourceCard
                  type="skill"
                  resource={skill}
                  summaryFallback="No summary provided."
                  meta={<span>⭐ {skill.stats.stars} stars</span>}
                />
                <div className="absolute right-4 top-4">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      try {
                        await toggleStar({ skillId: skill._id })
                      } catch (error) {
                        console.error('Failed to unstar skill:', error)
                        window.alert('Unable to unstar this skill. Please try again.')
                      }
                    }}
                    aria-label={`Unstar ${skill.displayName}`}
                  >
                    Unstar
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </PageShell>
    </main>
  )
}
