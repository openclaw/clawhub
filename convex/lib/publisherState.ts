import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { hasOfficialPublisherRow } from "./officialPublishers";

type DbCtx = Pick<QueryCtx | MutationCtx, "db">;

type PublisherStateCandidate =
  | Pick<Doc<"publishers">, "_id" | "kind" | "linkedUserId" | "deletedAt" | "deactivatedAt">
  | null
  | undefined;

export type PublisherClaimState = "unclaimed" | "claimed";
export type PublisherOfficialState = "notOfficial" | "official";
export type PublisherRestrictionState = "active" | "deactivated" | "deleted" | "missing";

type PublisherMemberRole = Doc<"publisherMembers">["role"];

const CLAIM_MEMBER_ROLE_SCAN_LIMIT = 20;
const ORG_CLAIM_ROLES: PublisherMemberRole[] = ["owner", "admin", "publisher"];

export type PublisherStateFacts = {
  claimState: PublisherClaimState;
  officialState: PublisherOfficialState;
  restrictionState: PublisherRestrictionState;
};

function publisherRestrictionState(publisher: PublisherStateCandidate): PublisherRestrictionState {
  if (!publisher) return "missing";
  if (publisher.deletedAt) return "deleted";
  if (publisher.deactivatedAt) return "deactivated";
  return "active";
}

async function hasActiveUser(ctx: DbCtx, userId: Doc<"users">["_id"]): Promise<boolean> {
  const user = await ctx.db.get(userId);
  return Boolean(user && !user.deletedAt && !user.deactivatedAt);
}

async function hasActiveMemberForRole(
  ctx: DbCtx,
  publisherId: Doc<"publishers">["_id"],
  role: PublisherMemberRole,
): Promise<boolean> {
  const members = await ctx.db
    .query("publisherMembers")
    .withIndex("by_publisher_and_role", (q) => q.eq("publisherId", publisherId).eq("role", role))
    .take(CLAIM_MEMBER_ROLE_SCAN_LIMIT);

  for (const member of members) {
    if (await hasActiveUser(ctx, member.userId)) return true;
  }

  if (members.length >= CLAIM_MEMBER_ROLE_SCAN_LIMIT) return true;
  return false;
}

async function hasActiveMemberForAnyRole(
  ctx: DbCtx,
  publisherId: Doc<"publishers">["_id"],
  roles: PublisherMemberRole[],
): Promise<boolean> {
  for (const role of roles) {
    if (await hasActiveMemberForRole(ctx, publisherId, role)) return true;
  }
  return false;
}

async function publisherClaimState(
  ctx: DbCtx,
  publisher: PublisherStateCandidate,
): Promise<PublisherClaimState> {
  if (!publisher) return "unclaimed";
  if (publisher.kind === "user" && publisher.linkedUserId) {
    return (await hasActiveUser(ctx, publisher.linkedUserId)) ? "claimed" : "unclaimed";
  }

  const claimed =
    publisher.kind === "user"
      ? await hasActiveMemberForRole(ctx, publisher._id, "owner")
      : await hasActiveMemberForAnyRole(ctx, publisher._id, ORG_CLAIM_ROLES);
  return claimed ? "claimed" : "unclaimed";
}

export async function getPublisherStateFacts(
  ctx: DbCtx,
  publisher: PublisherStateCandidate,
  options?: { official?: boolean },
): Promise<PublisherStateFacts> {
  const official =
    options?.official ?? (publisher ? await hasOfficialPublisherRow(ctx, publisher._id) : false);
  return {
    claimState: await publisherClaimState(ctx, publisher),
    officialState: official ? "official" : "notOfficial",
    restrictionState: publisherRestrictionState(publisher),
  };
}
