import { buildRegistryOgSvg, type RegistryOgCommand, type RegistryOgStat } from "./registryOgSvg";

export type PluginOgSvgParams = {
  markDataUrl: string;
  watermarkDataUrl?: string | null;
  avatarDataUrl?: string | null;
  title: string;
  description: string;
  packageName: string;
  ownerLabel: string;
  installCommand?: RegistryOgCommand | null;
  stats?: RegistryOgStat[];
};

export function buildPluginOgSvg(params: PluginOgSvgParams) {
  return buildRegistryOgSvg({
    markDataUrl: params.markDataUrl,
    watermarkDataUrl: params.watermarkDataUrl,
    avatarDataUrl: params.avatarDataUrl,
    avatarShape: "rounded",
    avatarFit: "contain",
    surfaceLabel: "Plugin",
    eyebrow: params.ownerLabel,
    title: params.title,
    description: params.description,
    installCommand: params.installCommand,
    stats:
      params.stats && params.stats.length > 0
        ? params.stats
        : [
            { value: params.packageName, label: "Package" },
            { value: params.ownerLabel, label: "Publisher" },
          ],
  });
}
