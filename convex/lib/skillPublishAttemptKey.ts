import type { Id } from "../_generated/dataModel";

export function buildSkillPublishAttemptIdempotencyKey(args: {
  userId: Id<"users">;
  ownerPublisherId?: Id<"publishers">;
  slug: string;
  version: string;
  fingerprint: string;
}) {
  const ownerScope = args.ownerPublisherId
    ? `publisher:${args.ownerPublisherId}`
    : `user:${args.userId}`;
  return ["skill", ownerScope, args.slug, args.version, args.fingerprint].join(":");
}
