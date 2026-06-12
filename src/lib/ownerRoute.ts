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
