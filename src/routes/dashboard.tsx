import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { Clock, Package, Plus, Upload } from 'lucide-react'
import { api } from '../../convex/_generated/api'
import type { Doc } from '../../convex/_generated/dataModel'
import type { PublicSkill } from '../lib/publicUser'

type DashboardSkill = PublicSkill & { pendingReview?: boolean }

export const Route = createFileRoute('/dashboard')({
  component: Dashboard,
})

function Dashboard() {
  const me = useQuery(api.users.me) as Doc<'users'> | null | undefined
  const mySkills = useQuery(
    api.skills.list,
    me?._id ? { ownerUserId: me._id, limit: 100 } : 'skip',
  ) as DashboardSkill[] | undefined

  if (!me) {
    return (
      <main className="section">
        <div className="card">Sign in to access your dashboard.</div>
      </main>
    )
  }

  const skills = mySkills ?? []
  const ownerHandle = me.handle ?? me.name ?? me.displayName ?? me._id

  return (
    <main className="section">
      <div className="dashboard-header">
        <h1 className="section-title" style={{ margin: 0 }}>
          My Skills
        </h1>
        <Link to="/upload" search={{ updateSlug: undefined }} className="btn btn-primary">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Upload New Skill
        </Link>
      </div>

      {skills.length === 0 ? (
        <div className="card dashboard-empty">
          <Package className="dashboard-empty-icon" aria-hidden="true" />
          <h2>No skills yet</h2>
          <p>Upload your first skill to share it with the community.</p>
          <Link to="/upload" search={{ updateSlug: undefined }} className="btn btn-primary">
            <Upload className="h-4 w-4" aria-hidden="true" />
            Upload a Skill
          </Link>
        </div>
      ) : (
        <div className="dashboard-grid">
          {skills.map((skill) => (
            <SkillCard key={skill._id} skill={skill} ownerHandle={ownerHandle} />
          ))}
        </div>
      )}
    </main>
  )
}

function SkillCard({ skill, ownerHandle }: { skill: DashboardSkill; ownerHandle: string | null }) {
  return (
    <div className="dashboard-skill-card">
      <div className="dashboard-skill-info">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <Link
            to="/$owner/$slug"
            params={{ owner: ownerHandle ?? 'unknown', slug: skill.slug }}
            className="dashboard-skill-name"
          >
            {skill.displayName}
          </Link>
          <span className="dashboard-skill-slug">/{skill.slug}</span>
          {skill.pendingReview ? (
            <span className="tag tag-pending">
              <Clock className="h-3 w-3" aria-hidden="true" />
              Scanning
            </span>
          ) : null}
        </div>
        {skill.summary && <p className="dashboard-skill-description">{skill.summary}</p>}
        <div className="dashboard-skill-stats">
          <span>⤓ {skill.stats.downloads}</span>
          <span>★ {skill.stats.stars}</span>
          <span>{skill.stats.versions} v</span>
        </div>
      </div>
      <div className="dashboard-skill-actions">
        <Link to="/upload" search={{ updateSlug: skill.slug }} className="btn btn-sm">
          <Upload className="h-3 w-3" aria-hidden="true" />
          New Version
        </Link>
        <Link
          to="/$owner/$slug"
          params={{ owner: ownerHandle ?? 'unknown', slug: skill.slug }}
          className="btn btn-ghost btn-sm"
        >
          View
        </Link>
      </div>
    </div>
  )
}
