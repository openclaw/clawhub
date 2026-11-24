import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { defaultUrlTransform } from "react-markdown";
import { resolveSkillReadmeHref } from "../lib/skillReadmeLinks";
import { MarkdownPreview } from "./MarkdownPreview";

type Props = {
  card: string | null;
  changelog?: string;
  version?: string;
  slug: string;
  ownerHandle: string | null;
  resolveHref?: (href: string) => string;
};

// The registry's generated skill card is separate from the publisher's SKILL.md.
export function SkillCatalogOverview({
  card,
  changelog,
  version,
  slug,
  ownerHandle,
  resolveHref,
}: Props) {
  const transform = (url: string, key: string) =>
    key === "href"
      ? resolveHref
        ? resolveHref(url)
        : resolveSkillReadmeHref(url, slug, ownerHandle, version)
      : defaultUrlTransform(url);
  return (
    <>
      {card?.trim() ? (
        <section className="skill-catalog-section">
          <h2>Skill card</h2>
          <SkillCatalogReadmeWell key={card}>
            <MarkdownPreview
              className="skill-catalog-markdown"
              highlight={false}
              urlTransform={transform}
            >
              {card}
            </MarkdownPreview>
          </SkillCatalogReadmeWell>
        </section>
      ) : null}
      {version && changelog?.trim() ? (
        <section className="skill-catalog-section">
          <h2>Latest: v{version}</h2>
          <MarkdownPreview
            className="skill-catalog-markdown"
            highlight={false}
            urlTransform={transform}
          >
            {changelog}
          </MarkdownPreview>
        </section>
      ) : null}
    </>
  );
}

function SkillCatalogReadmeWell({ children }: { children: React.ReactNode }) {
  const id = useId();
  const inner = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const element = inner.current;
    if (!element) return undefined;
    const measure = () => {
      const clamp = Number.parseFloat(
        getComputedStyle(element).getPropertyValue("--skill-readme-clamp"),
      );
      setOverflows(element.scrollHeight > clamp + 24);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="skill-catalog-well" data-clamped={overflows && !expanded}>
      <div id={id} className="skill-catalog-well-body">
        <div ref={inner} data-analytics-public-detail="">
          {children}
        </div>
      </div>
      {(overflows || expanded) && (
        <button
          type="button"
          aria-controls={id}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Show less" : "Show more"}
          {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
      )}
    </div>
  );
}
