import { buildRegistryOgSvg, type RegistryOgCommand, type RegistryOgStat } from "./registryOgSvg";

export type SkillOgSvgParams = {
  markDataUrl: string;
  watermarkDataUrl?: string | null;
  avatarDataUrl?: string | null;
  avatarShape?: "circle" | "rounded";
  avatarFit?: "cover" | "contain";
  title: string;
  description: string;
  ownerLabel: string;
  versionLabel: string;
  installCommand?: RegistryOgCommand | null;
  stats?: RegistryOgStat[];
};

export function buildSkillOgSvg(params: SkillOgSvgParams) {
  return buildRegistryOgSvg({
    markDataUrl: params.markDataUrl,
    watermarkDataUrl: params.watermarkDataUrl,
    avatarDataUrl: params.avatarDataUrl,
    avatarShape: params.avatarShape ?? "circle",
    avatarFit: params.avatarFit,
    surfaceLabel: "Skill",
    eyebrow: params.ownerLabel,
    title: params.title,
    description: params.description,
    installCommand: params.installCommand,
    stats:
      params.stats && params.stats.length > 0
        ? params.stats
        : [
            { value: params.ownerLabel, label: "Publisher" },
            { value: params.versionLabel, label: "Version" },
          ],
  });
}
