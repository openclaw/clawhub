export const OPENCLAW_TEMPLATE_SCOPE = "@openclaw/";

export function isOpenClawTemplateName(name: string) {
  return name.startsWith(OPENCLAW_TEMPLATE_SCOPE) && name.length > OPENCLAW_TEMPLATE_SCOPE.length;
}

export function isOpenClawTemplatePublisher(
  owner:
    | { kind?: string; handle?: string; deletedAt?: number; deactivatedAt?: number }
    | null
    | undefined,
) {
  return (
    owner?.kind === "org" &&
    owner.handle === "openclaw" &&
    owner.deletedAt === undefined &&
    owner.deactivatedAt === undefined
  );
}
