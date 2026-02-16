import type { Doc } from '../../../convex/_generated/dataModel'
import type { PublicSkill, PublicUser } from '../../lib/publicUser'

export type SkillListEntry = {
  skill: PublicSkill
  latestVersion: {
    version: string
    createdAt: number
    changelog: string
    changelogSource?: 'auto' | 'user'
    parsed?: {
      clawdis?: {
        nix?: {
          plugin?: boolean
        }
      }
    }
  } | null
  ownerHandle?: string | null
  owner?: PublicUser | null
  searchScore?: number
}

export type SkillSearchEntry = {
  skill: PublicSkill
  version: Doc<'skillVersions'> | null
  score: number
  ownerHandle?: string | null
  owner?: PublicUser | null
}

export function buildSkillHref(skill: PublicSkill, ownerHandle?: string | null) {
  const owner = ownerHandle?.trim() || String(skill.ownerUserId)
  return `/${encodeURIComponent(owner)}/${encodeURIComponent(skill.slug)}`
}
