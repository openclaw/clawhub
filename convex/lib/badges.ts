import type { Doc, Id } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'

type BadgeKind = Doc<'resourceBadges'>['kind']

export type ResourceBadgeMap = Partial<Record<BadgeKind, { byUserId: Id<'users'>; at: number }>>

export type ResourceBadgeSource = { badges?: ResourceBadgeMap | null }

type BadgeCtx = Pick<QueryCtx, 'db'>

export function isResourceHighlighted(resource: ResourceBadgeSource) {
  return Boolean(resource.badges?.highlighted)
}

export function isResourceOfficial(resource: ResourceBadgeSource) {
  return Boolean(resource.badges?.official)
}

export function isResourceDeprecated(resource: ResourceBadgeSource) {
  return Boolean(resource.badges?.deprecated)
}

export function buildBadgeMap(records: Doc<'resourceBadges'>[]): ResourceBadgeMap {
  return records.reduce<ResourceBadgeMap>((acc, record) => {
    acc[record.kind] = { byUserId: record.byUserId, at: record.at }
    return acc
  }, {})
}

export async function getResourceBadgeMap(
  ctx: BadgeCtx,
  resourceId: Id<'resources'>,
): Promise<ResourceBadgeMap> {
  const records = await ctx.db
    .query('resourceBadges')
    .withIndex('by_resource', (q) => q.eq('resourceId', resourceId))
    .collect()
  return buildBadgeMap(records)
}

export async function getResourceBadgeMaps(
  ctx: BadgeCtx,
  resourceIds: Array<Id<'resources'>>,
): Promise<Map<Id<'resources'>, ResourceBadgeMap>> {
  const entries = await Promise.all(
    resourceIds.map(
      async (resourceId) => [resourceId, await getResourceBadgeMap(ctx, resourceId)] as const,
    ),
  )
  return new Map(entries)
}
