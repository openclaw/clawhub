import { Fragment } from "react";
import { parseInlineCodeSummary } from "../lib/formatInlineCodeSummary";

type InlineCodeSummaryProps = {
  children: string;
};

export function InlineCodeSummary({ children }: InlineCodeSummaryProps) {
  const segments = parseInlineCodeSummary(children);

  return (
    <>
      {segments.map((segment, index) =>
        segment.type === "code" ? (
          <code key={index} className="skill-summary-inline-code">
            {segment.value}
          </code>
        ) : (
          <Fragment key={index}>{segment.value}</Fragment>
        ),
      )}
    </>
  );
}
