import { getOpenClawExtensionPackageName } from "./openClawExtensionSlugs";

const OWNER_ROUTE_HANDLE_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]{0,38}[a-zA-Z0-9])?$/;
const OWNER_ROUTE_SCOPE_PATTERN = /^@[a-zA-Z0-9](?:[a-zA-Z0-9._-]{0,38}[a-zA-Z0-9])?$/;

function isOwnerRouteIdSegment(owner: string) {
  return owner.startsWith("users:") || owner.startsWith("publishers:");
}

export function isOwnerRouteHandleSegment(owner: string) {
  return OWNER_ROUTE_HANDLE_PATTERN.test(owner);
}

export function isOwnerRouteScopeSegment(owner: string) {
  return OWNER_ROUTE_SCOPE_PATTERN.test(owner);
}

export function isOwnerRouteHandleOrIdSegment(owner: string) {
  return isOwnerRouteHandleSegment(owner) || isOwnerRouteIdSegment(owner);
}

function routeSegment(value: string) {
  return encodeURIComponent(value.trim().replace(/^@+/, ""));
}

export function buildPublisherProfileHref(handle: string) {
  return isLegacyPublisherProfileHandle(handle)
    ? `/user/${routeSegment(handle)}`
    : `/${routeSegment(handle)}`;
}

export function buildPublisherApiFeedHref(publisherId: string) {
  return `/api/v1/publishers/${encodeURIComponent(publisherId.trim())}/feed`;
}

export function isLegacyPublisherProfileHandle(handle: string) {
  return Boolean(getOpenClawExtensionPackageName(handle));
}

export function buildSkillDetailHref(owner: string, slug: string) {
  return `/${routeSegment(owner)}/skills/${routeSegment(slug)}`;
}

export function buildSkillSecurityAuditHref(owner: string, slug: string) {
  return `${buildSkillDetailHref(owner, slug)}/security-audit`;
}

export function buildSkillSettingsHref(owner: string, slug: string) {
  return `${buildSkillDetailHref(owner, slug)}/settings`;
}
