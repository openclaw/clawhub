import { defaultUrlTransform } from "react-markdown";
import { resolveSkillReadmeHref } from "../lib/skillReadmeLinks";
import { MarkdownPreview } from "./MarkdownPreview";

type Props = {
  changelog?: string;
  version?: string;
  slug: string;
  ownerHandle: string | null;
  resolveHref?: (href: string) => string;
};

export function SkillCatalogOverview({
  changelog,
  version,
  slug,
  ownerHandle,
  resolveHref,
}: Props) {
  if (!version || !changelog?.trim()) return null;
  return (
    <section className="skill-catalog-section">
      <h2>Latest: v{version}</h2>
      <MarkdownPreview
        className="skill-catalog-markdown"
        highlight={false}
        urlTransform={(url, key) =>
          key === "href"
            ? resolveHref
              ? resolveHref(url)
              : resolveSkillReadmeHref(url, slug, ownerHandle, version)
            : defaultUrlTransform(url)
        }
      >
        {changelog}
      </MarkdownPreview>
    </section>
  );
}
