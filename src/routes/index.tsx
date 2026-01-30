import { createFileRoute, Link } from '@tanstack/react-router'
import { useAction, useQuery } from 'convex/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../convex/_generated/api'
import { InstallSwitcher } from '../components/InstallSwitcher'
import { PageShell } from '../components/PageShell'
import { ResourceCard } from '../components/ResourceCard'
import { SectionHeader } from '../components/SectionHeader'
import { buttonVariants } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { getSkillBadges } from '../lib/badges'
import type { PublicSkill, PublicSoul } from '../lib/publicUser'
import { getSiteMode } from '../lib/site'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  const mode = getSiteMode()
  return mode === 'souls' ? <OnlyCrabsHome /> : <SkillsHome />
}

function SkillsHome() {
  const highlighted =
    (useQuery(api.skills.list, {
      batch: 'highlighted',
      limit: 6,
    }) as PublicSkill[]) ?? []
  const latest = (useQuery(api.skills.list, { limit: 12 }) as PublicSkill[]) ?? []

  return (
    <main className="py-10">
      <PageShell className="space-y-12">
        <section className="rounded-[var(--radius)] border border-border bg-card p-8 shadow-sm md:p-10">
          <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
            <div className="space-y-4">
              <span className="inline-flex rounded-full border border-border bg-muted px-3 py-1 text-xs text-muted-foreground">
                Lobster-light. Agent-right.
              </span>
              <h1 className="font-display text-4xl font-semibold tracking-tight">
                MoltHub, the skill dock for sharp agents.
              </h1>
              <p className="text-sm text-muted-foreground">
                Upload AgentSkills bundles, version them like npm, and make them searchable with
                vectors. No gatekeeping, just signal.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link to="/upload" search={{ updateSlug: undefined }} className={buttonVariants()}>
                  Publish a skill
                </Link>
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
              </div>
            </div>
            <div className="rounded-[var(--radius)] border border-border bg-muted p-6">
              <div className="text-xs text-muted-foreground">
                Search skills. Versioned, rollback-ready.
              </div>
              <div className="mt-4">
                <InstallSwitcher exampleSlug="sonoscli" />
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-6">
          <SectionHeader
            title="Highlighted skills"
            description="Curated signal — highlighted for quick trust."
          />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {highlighted.length === 0 ? (
              <div className="rounded-[var(--radius)] border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
                No highlighted skills yet.
              </div>
            ) : (
              highlighted.map((skill) => (
                <ResourceCard
                  key={skill._id}
                  type="skill"
                  resource={skill}
                  summaryFallback="A fresh skill bundle."
                  badges={getSkillBadges(skill)}
                  meta={
                    <span>
                      ⭐ {skill.stats.stars} stars · ⤓ {skill.stats.downloads} downloads · ⤒{' '}
                      {skill.stats.installsAllTime ?? 0} installs
                    </span>
                  }
                />
              ))
            )}
          </div>
        </section>

        <section className="space-y-6">
          <SectionHeader
            title="Latest drops"
            description="Newest uploads across the registry."
            actions={
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
                See all skills
              </Link>
            }
          />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {latest.length === 0 ? (
              <div className="rounded-[var(--radius)] border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
                No skills yet. Be the first.
              </div>
            ) : (
              latest.map((skill) => (
                <ResourceCard
                  key={skill._id}
                  type="skill"
                  resource={skill}
                  summaryFallback="Agent-ready skill pack."
                  meta={
                    <span>
                      {skill.stats.versions} versions · ⤓ {skill.stats.downloads} downloads · ⤒{' '}
                      {skill.stats.installsAllTime ?? 0} installs
                    </span>
                  }
                />
              ))
            )}
          </div>
        </section>
      </PageShell>
    </main>
  )
}

function OnlyCrabsHome() {
  const navigate = Route.useNavigate()
  const ensureSoulSeeds = useAction(api.seed.ensureSoulSeeds)
  const latest = (useQuery(api.souls.list, { limit: 12 }) as PublicSoul[]) ?? []
  const [query, setQuery] = useState('')
  const seedEnsuredRef = useRef(false)
  const trimmedQuery = useMemo(() => query.trim(), [query])

  useEffect(() => {
    if (seedEnsuredRef.current) return
    seedEnsuredRef.current = true
    void ensureSoulSeeds({})
  }, [ensureSoulSeeds])

  return (
    <main className="py-10">
      <PageShell className="space-y-12">
        <section className="rounded-[var(--radius)] border border-border bg-card p-8 shadow-sm md:p-10">
          <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
            <div className="space-y-4">
              <span className="inline-flex rounded-full border border-border bg-muted px-3 py-1 text-xs text-muted-foreground">
                SOUL.md, shared.
              </span>
              <h1 className="font-display text-4xl font-semibold tracking-tight">
                SoulHub, where system lore lives.
              </h1>
              <p className="text-sm text-muted-foreground">
                Share SOUL.md bundles, version them like docs, and keep personal system lore in one
                public place.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link to="/upload" search={{ updateSlug: undefined }} className={buttonVariants()}>
                  Publish a soul
                </Link>
                <Link
                  to="/souls"
                  search={{
                    q: undefined,
                    sort: undefined,
                    dir: undefined,
                    view: undefined,
                    focus: undefined,
                  }}
                  className={buttonVariants({ variant: 'outline' })}
                >
                  Browse souls
                </Link>
              </div>
            </div>
            <div className="rounded-[var(--radius)] border border-border bg-muted p-6">
              <form
                className="flex items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  void navigate({
                    to: '/souls',
                    search: {
                      q: trimmedQuery || undefined,
                      sort: undefined,
                      dir: undefined,
                      view: undefined,
                      focus: undefined,
                    },
                  })
                }}
              >
                <span className="font-mono text-xs text-muted-foreground">/</span>
                <Input
                  placeholder="Search souls, prompts, or lore"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </form>
              <p className="mt-4 text-xs text-muted-foreground">
                Search souls. Versioned, readable, easy to remix.
              </p>
            </div>
          </div>
        </section>

        <section className="space-y-6">
          <SectionHeader
            title="Latest souls"
            description="Newest SOUL.md bundles across the hub."
          />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {latest.length === 0 ? (
              <div className="rounded-[var(--radius)] border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
                No souls yet. Be the first.
              </div>
            ) : (
              latest.map((soul) => (
                <ResourceCard
                  key={soul._id}
                  type="soul"
                  resource={soul}
                  summaryFallback="A SOUL.md bundle."
                  meta={
                    <span>
                      ⭐ {soul.stats.stars} stars · ⤓ {soul.stats.downloads} downloads ·{' '}
                      {soul.stats.versions} versions
                    </span>
                  }
                />
              ))
            )}
          </div>
          <div className="flex justify-end">
            <Link
              to="/souls"
              search={{
                q: undefined,
                sort: undefined,
                dir: undefined,
                view: undefined,
                focus: undefined,
              }}
              className={buttonVariants({ variant: 'outline' })}
            >
              See all souls
            </Link>
          </div>
        </section>
      </PageShell>
    </main>
  )
}
