import type { Id } from "../_generated/dataModel";
import { getClientIp } from "./httpRateLimit";
import { hashToken } from "./tokens";

const DAY_MS = 86_400_000;

type DownloadIdentityKind = "user" | "ip";

type DownloadIdentity = {
  identityKind: DownloadIdentityKind;
  identityValue: string;
};

export function getDownloadIdentity(
  request: Request,
  userId: string | null,
): DownloadIdentity | null {
  if (userId) return { identityKind: "user", identityValue: userId };
  const ip = getClientIp(request);
  if (!ip) return null;
  return { identityKind: "ip", identityValue: ip };
}

export async function buildDownloadMetricArgs(params: {
  target: { kind: "skill"; id: Id<"skills"> } | { kind: "package"; id: Id<"packages"> };
  identity: DownloadIdentity;
  now: number;
}) {
  return {
    target: params.target,
    identityKind: params.identity.identityKind,
    identityHash: await hashToken(
      `${params.identity.identityKind}:${params.identity.identityValue}`,
    ),
    dayStart: Math.floor(params.now / DAY_MS) * DAY_MS,
    occurredAt: params.now,
  };
}
