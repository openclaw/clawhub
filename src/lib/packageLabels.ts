import type { PackageFamily } from "clawhub-schema";

export function familyLabel(family: PackageFamily) {
  switch (family) {
    case "code-plugin":
      return "Code Plugin";
    case "bundle-plugin":
      return "Bundle Plugin";
    default:
      return "Skill";
  }
}
