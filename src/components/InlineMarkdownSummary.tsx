import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type InlineMarkdownSummaryProps = {
  children: string;
};

export function InlineMarkdownSummary({ children }: InlineMarkdownSummaryProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      // Summaries live inside a paragraph: keep only inline formatting, never HTML or images.
      allowedElements={["a", "strong", "em", "del", "code", "br"]}
      unwrapDisallowed
      skipHtml
      components={{
        code: ({ children: code }) => <code className="skill-summary-inline-code">{code}</code>,
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
