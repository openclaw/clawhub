import { useMemo } from "react";
import type { UrlTransform } from "react-markdown";
import { groupSkillCardSections, parseSkillCardSections } from "../lib/skillCardSections";
import { MarkdownPreview } from "./MarkdownPreview";

type SkillCardPreviewProps = {
  content: string;
  urlTransform?: UrlTransform;
};

export function SkillCardPreview({ content, urlTransform }: SkillCardPreviewProps) {
  const groups = useMemo(() => groupSkillCardSections(parseSkillCardSections(content)), [content]);

  return (
    <div className="skill-card-document">
      {groups.map((group, index) => {
        if (group.kind === "title") {
          const { section } = group;
          const titleMarkdown = section.title
            ? `${"#".repeat(section.level)} ${section.title}${section.body ? `\n\n${section.body}` : ""}`
            : section.body;
          return (
            <div className="skill-card-document-title" key={`title-${index}`}>
              <MarkdownPreview
                className="skill-card-document-title-markdown"
                highlight={false}
                urlTransform={urlTransform}
              >
                {titleMarkdown}
              </MarkdownPreview>
            </div>
          );
        }

        if (group.kind === "meta") {
          return (
            <div
              className="skill-card-meta-panel"
              key={`meta-${group.sections[0]?.title ?? index}`}
            >
              <dl className="skill-card-meta-grid">
                {group.sections.map((section) => (
                  <div className="skill-card-meta-row" key={section.title}>
                    <dt className="skill-card-meta-label">{section.title}</dt>
                    <dd className="skill-card-meta-value">
                      <MarkdownPreview
                        className="skill-card-meta-markdown"
                        highlight={false}
                        urlTransform={urlTransform}
                      >
                        {section.body}
                      </MarkdownPreview>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        }

        const { section } = group;
        const headingTag = section.level === 3 ? "h3" : "h2";
        const Heading = headingTag;
        return (
          <article
            className="skill-card-section"
            key={`prose-${section.title || index}`}
            aria-labelledby={`skill-card-section-${index}`}
          >
            {section.title ? (
              <Heading className="skill-card-section-header" id={`skill-card-section-${index}`}>
                {section.title}
              </Heading>
            ) : null}
            <MarkdownPreview
              className="skill-card-section-markdown"
              highlight={false}
              urlTransform={urlTransform}
            >
              {section.body}
            </MarkdownPreview>
          </article>
        );
      })}
    </div>
  );
}
