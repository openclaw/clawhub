import type { ActionCtx } from '../_generated/server'
import { requireApiTokenUser } from '../lib/apiTokenAuth'
import { applyRateLimit } from '../lib/httpRateLimit'
import { json, text } from './shared'

export async function whoamiV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, 'read')
  if (!rate.ok) return rate.response

  try {
    const { user } = await requireApiTokenUser(ctx, request)
    return json(
      {
        user: {
          handle: user.handle ?? null,
          displayName: user.displayName ?? null,
          image: user.image ?? null,
        },
      },
      200,
      rate.headers,
    )
  } catch {
    return text('Unauthorized', 401, rate.headers)
  }
}
