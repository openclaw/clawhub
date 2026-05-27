import { Badge } from "./ui/badge";

type ApiKeyRequiredBadgeProps = {
  /**
   * Whether the skill version requires the user to supply an API key (or
   * equivalent secret) at install/run time. The badge renders only when this
   * is strictly `true`; `false` and `undefined` (not analyzed yet, analysis
   * failed, or feature disabled) deliberately render nothing so visitors are
   * never misled about a skill's secret requirements.
   */
  apiKeyRequired: boolean | undefined;
};

export function ApiKeyRequiredBadge({ apiKeyRequired }: ApiKeyRequiredBadgeProps) {
  if (apiKeyRequired !== true) return null;
  return (
    <Badge
      variant="warning"
      className="api-key-required-badge min-h-0 rounded-[4px] px-2 py-0.5 text-[0.72rem] leading-[1.3]"
      title="This skill needs you to provide an API key (or equivalent secret) to run."
      aria-label="API key required"
      data-testid="api-key-required-badge"
    >
      <span aria-hidden="true">🔑</span>
      API key required
    </Badge>
  );
}
