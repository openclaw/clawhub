import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { Plus, Upload } from 'lucide-react'
import { api } from '../../convex/_generated/api'
import type { Doc } from '../../convex/_generated/dataModel'
import { PageShell } from '../components/PageShell'
import { ResourceCard } from '../components/ResourceCard'
import { SectionHeader } from '../components/SectionHeader'
import { buttonVariants } from '../components/ui/button'
import { Card } from '../components/ui/card'
import type { PublicResource, PublicSkill, PublicSoul } from '../lib/publicUser'
import { getResourceLink } from '../lib/resources'

export const Route = createFileRoute('/dashboard')({
  component: Dashboard,
})

function Dashboard() {
  const me = useQuery(api.users.me) as Doc<'users'> | null | undefined
  const mySkills = useQuery(
    api.skills.list,
    me?._id ? { ownerUserId: me._id, limit: 100 } : 'skip',
  ) as PublicSkill[] | undefined
  const mySouls = useQuery(
    api.souls.list,
    me?._id ? { ownerUserId: me._id, limit: 100 } : 'skip',
  ) as PublicSoul[] | undefined
  const myExtensions = useQuery(
    api.extensions.listByOwner,
    me?._id ? { ownerUserId: me._id, limit: 100 } : 'skip',
  ) as PublicResource[] | undefined

  if (!me) {
    return (
      <main className="py-10">
        <PageShell>
          <Card className="p-6 text-sm text-muted-foreground">
            Sign in to access your dashboard.
          </Card>
        </PageShell>
      </main>
    )
  }

  const skills = mySkills ?? []
  const souls = mySouls ?? []
  const extensions = myExtensions ?? []
  const ownerHandle = me.handle ?? me.name ?? me.displayName ?? me._id

  return (
    <main className="py-10">
      <PageShell className="space-y-10">
        <SectionHeader
          title="My projects"
          description="Manage your published skills, souls, and extensions."
          actions={
            <Link to="/upload" search={{ updateSlug: undefined }} className={buttonVariants()}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Upload new project
            </Link>
          }
        />

        <section className="space-y-4">
          <SectionHeader title="Skills" description="Skill bundles you own." />
          {skills.length === 0 ? (
            <Card className="space-y-3 p-6 text-center">
              <div className="text-lg font-semibold">No skills yet</div>
              <p className="text-sm text-muted-foreground">
                Upload your first skill to share it with the community.
              </p>
              <Link to="/upload" search={{ updateSlug: undefined }} className={buttonVariants()}>
                <Upload className="h-4 w-4" aria-hidden="true" />
                Upload a skill
              </Link>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {skills.map((skill) => (
                <ResourceCard
                  key={skill._id}
                  type="skill"
                  resource={skill}
                  ownerHandle={ownerHandle}
                  href={getResourceLink('skill', skill, skill.slug, ownerHandle)}
                  summaryFallback="No summary provided."
                  meta={
                    <span>
                      ⤓ {skill.stats.downloads} downloads · ★ {skill.stats.stars} stars ·{' '}
                      {skill.stats.versions} versions
                    </span>
                  }
                />
              ))}
            </div>
          )}
        </section>

        <section className="space-y-4">
          <SectionHeader title="Souls" description="SOUL.md bundles you own." />
          {souls.length === 0 ? (
            <Card className="p-6 text-sm text-muted-foreground">No souls yet.</Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {souls.map((soul) => (
                <ResourceCard
                  key={soul._id}
                  type="soul"
                  resource={soul}
                  ownerHandle={ownerHandle}
                  href={getResourceLink('soul', soul, soul.slug, ownerHandle)}
                  summaryFallback="SOUL.md bundle."
                  meta={
                    <span>
                      ⤓ {soul.stats.downloads} downloads · ★ {soul.stats.stars} stars ·{' '}
                      {soul.stats.versions} versions
                    </span>
                  }
                />
              ))}
            </div>
          )}
        </section>

        <section className="space-y-4">
          <SectionHeader title="Extensions" description="Extensions you own." />
          {extensions.length === 0 ? (
            <Card className="p-6 text-sm text-muted-foreground">No extensions yet.</Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {extensions.map((extension) => (
                <ResourceCard
                  key={extension._id}
                  type="extension"
                  resource={extension}
                  ownerHandle={ownerHandle}
                  href={getResourceLink('extension', extension, extension.slug, ownerHandle)}
                  summaryFallback="Extension bundle."
                  meta={
                    <span>
                      ⤓ {extension.stats.downloads} downloads · ★ {extension.stats.stars} stars
                    </span>
                  }
                />
              ))}
            </div>
          )}
        </section>
      </PageShell>
    </main>
  )
}
