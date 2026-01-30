import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { useEffect, useState } from 'react'
import { api } from '../../../convex/_generated/api'
import type { Doc } from '../../../convex/_generated/dataModel'
import { PageShell } from '../../components/PageShell'
import { ResourceCard } from '../../components/ResourceCard'
import { SectionHeader } from '../../components/SectionHeader'
import { SkillCard } from '../../components/SkillCard'
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs'
import { getSkillBadges } from '../../lib/badges'
import type { PublicResource, PublicSkill, PublicSoul, PublicUser } from '../../lib/publicUser'
import { toCanonicalResourcePath } from '../../lib/resources'

export const Route = createFileRoute('/u/$handle')({
  component: UserProfile,
})

function UserProfile() {
  const { handle } = Route.useParams()
  const me = useQuery(api.users.me) as Doc<'users'> | null | undefined
  const user = useQuery(api.users.getByHandle, { handle }) as PublicUser | null | undefined
  const publishedSkills = useQuery(
    api.skills.list,
    user ? { ownerUserId: user._id, limit: 50 } : 'skip',
  ) as PublicSkill[] | undefined
  const publishedSouls = useQuery(
    api.souls.list,
    user ? { ownerUserId: user._id, limit: 50 } : 'skip',
  ) as PublicSoul[] | undefined
  const publishedExtensions = useQuery(
    api.extensions.listByOwner,
    user ? { ownerUserId: user._id, limit: 50 } : 'skip',
  ) as PublicResource[] | undefined
  const starredSkills = useQuery(
    api.stars.listByUser,
    user ? { userId: user._id, limit: 50 } : 'skip',
  ) as PublicSkill[] | undefined

  const isSelf = Boolean(me && user && me._id === user._id)
  const [tab, setTab] = useState<'stars' | 'installed'>('stars')
  const [includeRemoved, setIncludeRemoved] = useState(false)
  const installed = useQuery(
    api.telemetry.getMyInstalled,
    isSelf && tab === 'installed' ? { includeRemoved } : 'skip',
  ) as TelemetryResponse | null | undefined

  useEffect(() => {
    if (!isSelf && tab === 'installed') setTab('stars')
  }, [isSelf, tab])

  if (user === undefined) {
    return (
      <main className="py-10">
        <PageShell>
          <Card className="p-6 text-sm text-muted-foreground">Loading user…</Card>
        </PageShell>
      </main>
    )
  }

  if (user === null) {
    return (
      <main className="py-10">
        <PageShell>
          <Card className="p-6 text-sm text-muted-foreground">User not found.</Card>
        </PageShell>
      </main>
    )
  }

  const avatar = user.image
  const displayName = user.displayName ?? user.name ?? user.handle ?? 'User'
  const displayHandle = user.handle ?? user.name ?? handle
  const initial = displayName.charAt(0).toUpperCase()
  const isLoadingSkills = starredSkills === undefined
  const skills = starredSkills ?? []
  const isLoadingPublished =
    publishedSkills === undefined ||
    publishedSouls === undefined ||
    publishedExtensions === undefined
  const published = publishedSkills ?? []
  const publishedSoulList = publishedSouls ?? []
  const publishedExtensionList = publishedExtensions ?? []

  return (
    <main className="py-10">
      <PageShell className="space-y-8">
        <Card className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center">
          <Avatar className="h-16 w-16">
            {avatar ? <AvatarImage src={avatar} alt={displayName} /> : null}
            <AvatarFallback>{initial}</AvatarFallback>
          </Avatar>
          <div>
            <div className="text-xl font-semibold">{displayName}</div>
            <div className="text-sm text-muted-foreground">@{displayHandle}</div>
          </div>
        </Card>

        <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
          <TabsList>
            <TabsTrigger value="stars">Stars</TabsTrigger>
            {isSelf ? <TabsTrigger value="installed">Installed</TabsTrigger> : null}
          </TabsList>
          <TabsContent value="installed">
            <InstalledSection
              includeRemoved={includeRemoved}
              onToggleRemoved={() => setIncludeRemoved((value) => !value)}
              data={installed}
            />
          </TabsContent>
          <TabsContent value="stars" className="space-y-8">
            <section className="space-y-4">
              <SectionHeader title="Published" description="Projects published by this user." />
              {isLoadingPublished ? (
                <Card className="p-6 text-sm text-muted-foreground">Loading projects…</Card>
              ) : (
                <div className="space-y-6">
                  <div className="space-y-3">
                    <div className="text-sm font-semibold">Skills</div>
                    {published.length > 0 ? (
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {published.map((skill) => (
                          <SkillCard
                            key={skill._id}
                            skill={skill}
                            ownerHandle={user.handle ?? null}
                            badge={getSkillBadges(skill)}
                            summaryFallback="Agent-ready skill pack."
                            meta={
                              <span>
                                ⭐ {skill.stats.stars} stars · ⤓ {skill.stats.downloads} downloads ·
                                ⤒ {skill.stats.installsAllTime ?? 0} installs
                              </span>
                            }
                          />
                        ))}
                      </div>
                    ) : (
                      <Card className="p-4 text-sm text-muted-foreground">
                        No published skills yet.
                      </Card>
                    )}
                  </div>
                  <div className="space-y-3">
                    <div className="text-sm font-semibold">Souls</div>
                    {publishedSoulList.length > 0 ? (
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {publishedSoulList.map((soul) => (
                          <ResourceCard
                            key={soul._id}
                            type="soul"
                            resource={soul}
                            ownerHandle={user.handle ?? null}
                            summaryFallback="SOUL.md bundle."
                            meta={
                              <span>
                                ⭐ {soul.stats.stars} stars · ⤓ {soul.stats.downloads} downloads ·
                                {soul.stats.versions} versions
                              </span>
                            }
                          />
                        ))}
                      </div>
                    ) : (
                      <Card className="p-4 text-sm text-muted-foreground">
                        No published souls yet.
                      </Card>
                    )}
                  </div>
                  <div className="space-y-3">
                    <div className="text-sm font-semibold">Extensions</div>
                    {publishedExtensionList.length > 0 ? (
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {publishedExtensionList.map((extension) => (
                          <ResourceCard
                            key={extension._id}
                            type="extension"
                            resource={extension}
                            ownerHandle={user.handle ?? null}
                            summaryFallback="Extension bundle."
                            meta={
                              <span>
                                ⭐ {extension.stats.stars} stars · ⤓ {extension.stats.downloads}{' '}
                                downloads
                              </span>
                            }
                          />
                        ))}
                      </div>
                    ) : (
                      <Card className="p-4 text-sm text-muted-foreground">
                        No published extensions yet.
                      </Card>
                    )}
                  </div>
                </div>
              )}
            </section>

            <section className="space-y-4">
              <SectionHeader title="Stars" description="Skills this user has starred." />
              {isLoadingSkills ? (
                <Card className="p-6 text-sm text-muted-foreground">Loading stars…</Card>
              ) : skills.length === 0 ? (
                <Card className="p-6 text-sm text-muted-foreground">No stars yet.</Card>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {skills.map((skill) => (
                    <SkillCard
                      key={skill._id}
                      skill={skill}
                      badge={getSkillBadges(skill)}
                      summaryFallback="Agent-ready skill pack."
                      meta={
                        <span>
                          ⭐ {skill.stats.stars} stars · ⤓ {skill.stats.downloads} downloads · ⤒{' '}
                          {skill.stats.installsAllTime ?? 0} installs
                        </span>
                      }
                    />
                  ))}
                </div>
              )}
            </section>
          </TabsContent>
        </Tabs>
      </PageShell>
    </main>
  )
}

function InstalledSection(props: {
  includeRemoved: boolean
  onToggleRemoved: () => void
  data: TelemetryResponse | null | undefined
}) {
  const clearTelemetry = useMutation(api.telemetry.clearMyTelemetry)
  const [showRaw, setShowRaw] = useState(false)
  const data = props.data
  if (data === undefined) {
    return <Card className="p-6 text-sm text-muted-foreground">Loading telemetry…</Card>
  }

  if (data === null) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        Sign in to view your installed skills.
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Installed"
        description="Private view. Only you can see your folders/roots. Everyone else only sees aggregated install counts per skill."
      />
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={props.onToggleRemoved}>
          {props.includeRemoved ? 'Hide removed' : 'Show removed'}
        </Button>
        <Button type="button" variant="outline" onClick={() => setShowRaw((value) => !value)}>
          {showRaw ? 'Hide JSON' : 'Show JSON'}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            if (!window.confirm('Delete all telemetry data?')) return
            void clearTelemetry()
          }}
        >
          Delete telemetry
        </Button>
      </div>

      {showRaw ? (
        <Card className="p-4">
          <pre className="whitespace-pre-wrap text-xs font-mono">
            {JSON.stringify(data, null, 2)}
          </pre>
        </Card>
      ) : null}

      {data.roots.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">
          No telemetry yet. Run `molthub sync` from the CLI.
        </Card>
      ) : (
        <div className="space-y-4">
          {data.roots.map((root) => (
            <Card key={root.rootId} className="space-y-3 p-6">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-semibold">{root.label}</div>
                  <div className="text-xs text-muted-foreground">
                    Last sync {new Date(root.lastSeenAt).toLocaleString()}
                    {root.expiredAt ? ' · stale' : ''}
                  </div>
                </div>
                <Badge variant="secondary">{root.skills.length} skills</Badge>
              </div>
              {root.skills.length === 0 ? (
                <div className="text-sm text-muted-foreground">No skills found in this root.</div>
              ) : (
                <div className="space-y-2">
                  {root.skills.map((entry) => (
                    <div
                      key={`${root.rootId}:${entry.skill.slug}`}
                      className="flex items-center justify-between rounded-[var(--radius)] border border-border px-3 py-2 text-xs"
                    >
                      <a
                        className="font-medium"
                        href={toCanonicalResourcePath(
                          'skill',
                          String(entry.skill.ownerUserId),
                          entry.skill.slug,
                        )}
                      >
                        <span>{entry.skill.displayName}</span>
                        <span className="text-muted-foreground"> /{entry.skill.slug}</span>
                      </a>
                      <div className="text-muted-foreground font-mono">
                        {entry.lastVersion ? `v${entry.lastVersion}` : 'v?'}
                        {entry.removedAt ? ' · removed' : ''}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

type TelemetryResponse = {
  roots: Array<{
    rootId: string
    label: string
    firstSeenAt: number
    lastSeenAt: number
    expiredAt?: number
    skills: Array<{
      skill: {
        slug: string
        displayName: string
        summary?: string
        stats: unknown
        ownerUserId: string
      }
      firstSeenAt: number
      lastSeenAt: number
      lastVersion?: string
      removedAt?: number
    }>
  }>
  cutoffDays: number
}
