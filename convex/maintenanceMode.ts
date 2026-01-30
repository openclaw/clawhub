import { v } from 'convex/values'
import { internal } from './_generated/api'
import { action, internalMutation, internalQuery, query } from './_generated/server'
import { assertRole, requireUserFromAction } from './lib/access'

const MAINTENANCE_KEY = 'site'

export type MaintenanceStatus = {
  enabled: boolean
  message?: string
  updatedAt: number
}

export const getMaintenanceStatusInternal = internalQuery({
  args: {},
  handler: async (ctx): Promise<MaintenanceStatus> => {
    const entry = await ctx.db
      .query('maintenance')
      .withIndex('by_key', (q) => q.eq('key', MAINTENANCE_KEY))
      .unique()
    if (!entry) {
      return { enabled: false, message: undefined, updatedAt: 0 }
    }
    return {
      enabled: entry.enabled,
      message: entry.message ?? undefined,
      updatedAt: entry.updatedAt,
    }
  },
})

export const getMaintenanceStatus = query({
  args: {},
  handler: async (ctx) => {
    return ctx.runQuery(internal.maintenanceMode.getMaintenanceStatusInternal)
  },
})

export const setMaintenanceStatusInternal = internalMutation({
  args: {
    enabled: v.boolean(),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<MaintenanceStatus> => {
    const existing = await ctx.db
      .query('maintenance')
      .withIndex('by_key', (q) => q.eq('key', MAINTENANCE_KEY))
      .unique()
    const now = Date.now()
    if (existing) {
      await ctx.db.patch(existing._id, {
        enabled: args.enabled,
        message: args.message ?? undefined,
        updatedAt: now,
      })
      return { enabled: args.enabled, message: args.message ?? undefined, updatedAt: now }
    }

    await ctx.db.insert('maintenance', {
      key: MAINTENANCE_KEY,
      enabled: args.enabled,
      message: args.message ?? undefined,
      updatedAt: now,
    })
    return { enabled: args.enabled, message: args.message ?? undefined, updatedAt: now }
  },
})

export const setMaintenanceStatus: ReturnType<typeof action> = action({
  args: {
    enabled: v.boolean(),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUserFromAction(ctx)
    assertRole(user, ['admin'])
    return ctx.runMutation(internal.maintenanceMode.setMaintenanceStatusInternal, args)
  },
})
