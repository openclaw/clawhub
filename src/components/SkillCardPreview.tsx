import { useMemo } from "react";
import type { UrlTransform } from "react-markdown";
import {
  normalizeSkillCardTitle,
  parseSkillCardSections,
  type SkillCardSection,
} from "../lib/skillCardSections";
import { MarkdownPreview } from "./MarkdownPreview";

type SkillCardPreviewProps = {
  content: string;
  urlTransform?: UrlTransform;
};

type MetadataField = {
  label: string;
  markdown: string;
};

type RiskPair = {
  risk: string;
  mitigation: string;
};

type OutputField = {
  label: string;
  value: string;
};

const BREAK_RE = /<br\s*\/?>/giu;
const USAGE_POSTURES = [
  {
    pattern: /this skill is ready for commercial\/non-commercial use\.?/iu,
    label: "Commercial / non-commercial",
  },
  {
    pattern: /this skill is for research and development only\.?/iu,
    label: "Research and development",
  },
  {
    pattern: /this skill is for demonstration purposes and not for production usage\.?/iu,
    label: "Demonstration only",
  },
] as const;

function sectionKey(section: SkillCardSection) {
  return normalizeSkillCardTitle(section.title).toLowerCase();
}

function findSection(sections: SkillCardSection[], predicate: (key: string) => boolean) {
  return sections.find((section) => predicate(sectionKey(section)));
}

function plainLines(markdown: string) {
  return markdown
    .replace(BREAK_RE, "\n")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function splitDescription(markdown: string) {
  let usage: string | null = null;
  let description = markdown.replace(BREAK_RE, "\n");

  for (const posture of USAGE_POSTURES) {
    if (!posture.pattern.test(description)) continue;
    usage = posture.label;
    description = description.replace(posture.pattern, "");
    break;
  }

  return {
    description: description
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n\n"),
    usage,
  };
}

function parseRiskPairs(markdown: string) {
  const pairs: RiskPair[] = [];
  let current: Partial<RiskPair> = {};

  for (const line of plainLines(markdown)) {
    if (/^risk:\s*/iu.test(line)) {
      if (current.risk) pairs.push({ risk: current.risk, mitigation: current.mitigation ?? "" });
      current = { risk: line.replace(/^risk:\s*/iu, "") };
      continue;
    }
    if (/^mitigation:\s*/iu.test(line)) {
      current.mitigation = line.replace(/^mitigation:\s*/iu, "");
    }
  }

  if (current.risk) pairs.push({ risk: current.risk, mitigation: current.mitigation ?? "" });
  return pairs;
}

function parseOutputFields(markdown: string) {
  const fields: OutputField[] = [];
  for (const line of plainLines(markdown)) {
    const match = /^\*\*(.+?):\*\*\s*\[?(.*?)\]?\s*$/u.exec(line);
    if (!match) continue;
    const rawLabel = match[1].trim().toLowerCase();
    const label = rawLabel.startsWith("output type")
      ? "Types"
      : rawLabel === "output format"
        ? "Format"
        : rawLabel === "output parameters"
          ? "Parameters"
          : rawLabel.includes("other properties")
            ? "Side effects"
            : match[1].trim();
    fields.push({ label, value: match[2].trim() });
  }
  return fields;
}

function metadataLabel(section: SkillCardSection) {
  const key = sectionKey(section);
  if (key.includes("license")) return "License";
  if (key.includes("deployment geography")) return "Geography";
  if (key.includes("skill version")) return "Version";
  return section.title;
}

export function SkillCardPreview({ content, urlTransform }: SkillCardPreviewProps) {
  const model = useMemo(() => {
    const sections = parseSkillCardSections(content);
    const title = sections.find((section) => section.level === 1);
    const description = findSection(sections, (key) => key === "description");
    const publisher = findSection(sections, (key) => key === "publisher");
    const license = findSection(sections, (key) => key.includes("license"));
    const geography = findSection(sections, (key) => key.includes("deployment geography"));
    const version = findSection(sections, (key) => key.includes("skill version"));
    const useCase = findSection(sections, (key) => key === "use case");
    const risks = findSection(sections, (key) => key.includes("known risks"));
    const ethics = findSection(sections, (key) => key.includes("ethical considerations"));
    const output = findSection(sections, (key) => key === "skill output");
    const references = findSection(sections, (key) => key.startsWith("reference"));
    const knownSections = new Set(
      [
        title,
        description,
        publisher,
        license,
        geography,
        version,
        useCase,
        risks,
        ethics,
        output,
        references,
      ].filter(Boolean),
    );
    const descriptionParts = splitDescription(description?.body ?? "");
    const metadata: MetadataField[] = [publisher, version, license, geography]
      .filter((section): section is SkillCardSection => Boolean(section?.body))
      .map((section) => ({ label: metadataLabel(section), markdown: section.body }));
    if (descriptionParts.usage) {
      metadata.push({ label: "Use", markdown: descriptionParts.usage });
    }

    return {
      title,
      description: descriptionParts.description,
      metadata,
      useCase,
      risks,
      riskPairs: risks ? parseRiskPairs(risks.body) : [],
      ethics,
      output,
      outputFields: output ? parseOutputFields(output.body) : [],
      references,
      other: sections.filter((section) => !knownSections.has(section)),
    };
  }, [content]);

  return (
    <div className="skill-card-document">
      {model.title ? (
        <header className="skill-card-document-title">
          <MarkdownPreview
            className="skill-card-document-title-markdown"
            highlight={false}
            urlTransform={urlTransform}
          >
            {`${"#".repeat(model.title.level)} ${model.title.title}${
              model.title.body ? `\n\n${model.title.body}` : ""
            }`}
          </MarkdownPreview>
        </header>
      ) : null}

      {model.description ? (
        <section className="skill-card-overview" aria-labelledby="skill-card-overview-title">
          <h2 id="skill-card-overview-title" className="skill-card-section-header">
            Overview
          </h2>
          <MarkdownPreview
            className="skill-card-section-markdown"
            highlight={false}
            urlTransform={urlTransform}
          >
            {model.description}
          </MarkdownPreview>
        </section>
      ) : null}

      {model.metadata.length > 0 ? (
        <dl className="skill-card-meta-grid" aria-label="Skill metadata">
          {model.metadata.map((field) => (
            <div className="skill-card-meta-row" key={field.label}>
              <dt className="skill-card-meta-label">{field.label}</dt>
              <dd className="skill-card-meta-value">
                <MarkdownPreview
                  className="skill-card-meta-markdown"
                  highlight={false}
                  urlTransform={urlTransform}
                >
                  {field.markdown}
                </MarkdownPreview>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {model.useCase ? (
        <section className="skill-card-section" aria-labelledby="skill-card-use-case-title">
          <h2 id="skill-card-use-case-title" className="skill-card-section-header">
            Use Case
          </h2>
          <MarkdownPreview
            className="skill-card-section-markdown"
            highlight={false}
            urlTransform={urlTransform}
          >
            {model.useCase.body}
          </MarkdownPreview>
        </section>
      ) : null}

      {model.risks || model.ethics ? (
        <section className="skill-card-review" aria-labelledby="skill-card-review-title">
          <h2 id="skill-card-review-title" className="skill-card-section-header">
            Review Before Use
          </h2>
          {model.riskPairs.length > 0 ? (
            <div className="skill-card-risk-list">
              {model.riskPairs.map((pair) => (
                <article className="skill-card-risk-pair" key={`${pair.risk}:${pair.mitigation}`}>
                  <div className="skill-card-risk-row skill-card-risk-row-risk">
                    <span className="skill-card-review-label">Risk</span>
                    <MarkdownPreview
                      className="skill-card-risk-copy"
                      highlight={false}
                      urlTransform={urlTransform}
                    >
                      {pair.risk}
                    </MarkdownPreview>
                  </div>
                  {pair.mitigation ? (
                    <div className="skill-card-risk-row skill-card-risk-row-mitigation">
                      <span className="skill-card-review-label">Mitigation</span>
                      <MarkdownPreview
                        className="skill-card-risk-copy"
                        highlight={false}
                        urlTransform={urlTransform}
                      >
                        {pair.mitigation}
                      </MarkdownPreview>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          ) : model.risks ? (
            <MarkdownPreview
              className="skill-card-section-markdown"
              highlight={false}
              urlTransform={urlTransform}
            >
              {model.risks.body}
            </MarkdownPreview>
          ) : null}
          {model.ethics ? (
            <div className="skill-card-ethics">
              <h3>Ethical considerations</h3>
              <MarkdownPreview
                className="skill-card-section-markdown"
                highlight={false}
                urlTransform={urlTransform}
              >
                {model.ethics.body}
              </MarkdownPreview>
            </div>
          ) : null}
        </section>
      ) : null}

      {model.output ? (
        <section className="skill-card-output" aria-labelledby="skill-card-output-title">
          <h2 id="skill-card-output-title" className="skill-card-section-header">
            Output &amp; Behavior
          </h2>
          {model.outputFields.length > 0 ? (
            <dl className="skill-card-output-grid">
              {model.outputFields.map((field) => (
                <div className="skill-card-output-row" key={field.label}>
                  <dt>{field.label}</dt>
                  <dd>
                    {field.label === "Types" ? (
                      <span className="skill-card-output-types">
                        {field.value.split(/\s*,\s*/u).map((type) => (
                          <span key={type}>{type}</span>
                        ))}
                      </span>
                    ) : (
                      field.value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <MarkdownPreview
              className="skill-card-section-markdown"
              highlight={false}
              urlTransform={urlTransform}
            >
              {model.output.body}
            </MarkdownPreview>
          )}
        </section>
      ) : null}

      {model.references ? (
        <section className="skill-card-references" aria-labelledby="skill-card-references-title">
          <h2 id="skill-card-references-title" className="skill-card-section-header">
            References
          </h2>
          <MarkdownPreview
            className="skill-card-section-markdown"
            highlight={false}
            urlTransform={urlTransform}
          >
            {model.references.body}
          </MarkdownPreview>
        </section>
      ) : null}

      {model.other.map((section) => (
        <section
          className="skill-card-section"
          key={`${section.title}:${section.body.slice(0, 48)}`}
        >
          {section.title ? <h2 className="skill-card-section-header">{section.title}</h2> : null}
          <MarkdownPreview
            className="skill-card-section-markdown"
            highlight={false}
            urlTransform={urlTransform}
          >
            {section.body}
          </MarkdownPreview>
        </section>
      ))}
    </div>
  );
}
