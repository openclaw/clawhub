import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { toPublicPublisher, type PublicPublisher } from "./public";
import {
  getPublisherByHandle,
  getPublisherMembership,
  normalizePublisherHandle,
} from "./publishers";
import { getLatestActiveReservedHandle } from "./reservedHandles";

const LEGACY_OFFICIAL_ORG_HANDLES = ["openclaw"] as const;
const RESERVED_OWNER_VERIFIED_OFFICIAL_ORG_HANDLES = ["nvidia"] as const;
const OFFICIAL_ORG_HANDLES = [
  ...LEGACY_OFFICIAL_ORG_HANDLES,
  ...RESERVED_OWNER_VERIFIED_OFFICIAL_ORG_HANDLES,
] as const;
const LEGACY_OFFICIAL_ORG_HANDLE_SET = new Set<string>(LEGACY_OFFICIAL_ORG_HANDLES);
const RESERVED_OWNER_VERIFIED_OFFICIAL_ORG_HANDLE_SET = new Set<string>(
  RESERVED_OWNER_VERIFIED_OFFICIAL_ORG_HANDLES,
);

type DbCtx = Pick<QueryCtx | MutationCtx, "db">;

type OfficialPublisherCandidate = Pick<
  Doc<"publishers">,
  | "_id"
  | "_creationTime"
  | "kind"
  | "handle"
  | "displayName"
  | "image"
  | "bio"
  | "linkedUserId"
  | "deletedAt"
  | "deactivatedAt"
>;

export function isReservedOwnerVerifiedOfficialOrgHandle(
  handle: string | undefined | null,
): boolean {
  const normalizedHandle = normalizePublisherHandle(handle);
  return Boolean(
    normalizedHandle && RESERVED_OWNER_VERIFIED_OFFICIAL_ORG_HANDLE_SET.has(normalizedHandle),
  );
}

async function isOfficialOrgPublisher(
  ctx: DbCtx,
  publisher: OfficialPublisherCandidate,
): Promise<boolean> {
  const handle = normalizePublisherHandle(publisher.handle);
  if (!handle) return false;
  if (LEGACY_OFFICIAL_ORG_HANDLE_SET.has(handle)) return true;
  if (!RESERVED_OWNER_VERIFIED_OFFICIAL_ORG_HANDLE_SET.has(handle)) return false;

  const reservation = await getLatestActiveReservedHandle(ctx, handle);
  if (!reservation) return false;

  // Security-sensitive: newly official handles must be bound to an admin-created
  // reservation, not just any public org that claimed the handle first.
  const ownerMembership = await getPublisherMembership(
    ctx,
    publisher._id,
    reservation.rightfulOwnerUserId,
  );
  return ownerMembership?.role === "owner";
}

export async function isOfficialPublisher(
  ctx: DbCtx,
  publisher: OfficialPublisherCandidate | null | undefined,
): Promise<boolean> {
  if (!publisher || publisher.deletedAt || publisher.deactivatedAt) return false;
  if (publisher.kind === "org") return await isOfficialOrgPublisher(ctx, publisher);
  if (!publisher.linkedUserId) return false;

  for (const officialOrgHandle of OFFICIAL_ORG_HANDLES) {
    const officialOrg = await getPublisherByHandle(ctx, officialOrgHandle);
    if (!officialOrg || officialOrg.deletedAt || officialOrg.deactivatedAt) continue;
    const membership = await getPublisherMembership(ctx, officialOrg._id, publisher.linkedUserId);
    if (!membership) continue;
    if (!(await isOfficialOrgPublisher(ctx, officialOrg))) continue;
    return true;
  }

  return false;
}

export async function toPublicPublisherWithOfficial(
  ctx: DbCtx,
  publisher: Doc<"publishers"> | null | undefined,
): Promise<PublicPublisher | null> {
  const official = await isOfficialPublisher(ctx, publisher);
  return toPublicPublisher(publisher, { official });
}
