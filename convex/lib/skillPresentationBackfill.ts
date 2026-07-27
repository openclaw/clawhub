import type { Doc } from "../_generated/dataModel";
import {
  isHostedSkillPresentationIconPath,
  resolveSkillPresentation,
  stripPresentationEmoji,
  type OpenAiSkillPresentation,
} from "./skillPresentation";
import { getFrontmatterMetadata, getFrontmatterValue } from "./skills";

export function resolveHistoricalSkillPresentation(args: {
  slug: string;
  currentDisplayName: string;
  currentSummary?: string;
  frontmatter: Doc<"skillVersions">["parsed"]["frontmatter"];
  openAi: OpenAiSkillPresentation;
}) {
  const skillDisplayName = getFrontmatterValue(args.frontmatter, "name")?.trim();
  const defaultDisplayName = resolveSkillPresentation({ slug: args.slug }).displayName;
  const publisherDisplayName = [skillDisplayName, defaultDisplayName].some(
    (candidate) =>
      candidate &&
      stripPresentationEmoji(candidate) === stripPresentationEmoji(args.currentDisplayName),
  )
    ? undefined
    : args.currentDisplayName;

  const frontmatterMetadata = getFrontmatterMetadata(args.frontmatter);
  const nestedDescription =
    frontmatterMetadata &&
    typeof frontmatterMetadata === "object" &&
    !Array.isArray(frontmatterMetadata) &&
    typeof (frontmatterMetadata as Record<string, unknown>).description === "string"
      ? ((frontmatterMetadata as Record<string, unknown>).description as string).trim()
      : undefined;
  const frontmatterDescription =
    nestedDescription || getFrontmatterValue(args.frontmatter, "description")?.trim();
  const currentSummary = args.currentSummary?.trim();
  const publisherSummary =
    currentSummary && currentSummary !== frontmatterDescription ? currentSummary : undefined;

  return resolveSkillPresentation({
    publisherDisplayName,
    publisherSummary,
    openAi: args.openAi,
    skillDisplayName,
    skillDescription: frontmatterDescription,
    slug: args.slug,
  });
}

export function preserveHistoricalHostedIcon(
  ...icons: Array<string | null | undefined>
): string | undefined {
  return icons.find((icon): icon is string => isHostedSkillPresentationIconPath(icon));
}
