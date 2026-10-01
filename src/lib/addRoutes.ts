export type AddKind = "skill" | "plugin";
export type AddMethod = "github" | "manual" | "upload";

export function addSearchParams(params: {
  kind?: AddKind;
  ownerHandle?: string;
  method?: AddMethod;
}) {
  return {
    kind: params.kind ?? ("skill" as const),
    ownerHandle: params.ownerHandle,
    method: params.method,
  };
}
