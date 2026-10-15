import {
  collectPluginApiRetirements,
  type PluginApiRetirement,
} from "../../convex/lib/pluginApiRetirements";
import { Alert, AlertDescription } from "./ui/alert";

export function PluginApiRetirementNotice({
  retirements,
  id,
}: {
  retirements: PluginApiRetirement[];
  id?: string;
}) {
  const groups = new Map<string, PluginApiRetirement[]>();
  for (const retirement of collectPluginApiRetirements(
    retirements.map((entry) => ({ ...entry, deprecated: true })),
  )) {
    const group = groups.get(retirement.removeAfter) ?? [];
    group.push(retirement);
    groups.set(retirement.removeAfter, group);
  }
  if (groups.size === 0) return null;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Alert
      variant="info"
      role="region"
      aria-label="OpenClaw API updates"
      id={id}
      className="plugin-api-retirement-notice"
    >
      {Array.from(groups, ([removeAfter, entries]) => {
        const date = new Date(`${removeAfter}T00:00:00Z`).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          timeZone: "UTC",
        });
        const replacement = entries[0].replacement;
        const replacements =
          entries.length === 1 && /^[\w./$-]+$/.test(replacement)
            ? replacement
            : "the replacement APIs below";
        return (
          <div key={removeAfter}>
            <AlertDescription>
              {removeAfter >= today
                ? `Uses OpenClaw APIs that retire on ${date}. It keeps working until then; the author can update to ${replacements}.`
                : `Uses OpenClaw APIs with a retirement date of ${date}. The author can update to ${replacements}.`}
            </AlertDescription>
            <details>
              <summary>API details</summary>
              <dl>
                {entries.map((entry) => (
                  <div key={`${entry.deprecatedApi}:${entry.replacement}`}>
                    <dt>
                      <code>{entry.deprecatedApi}</code>
                    </dt>
                    <dd>{entry.replacement}</dd>
                  </div>
                ))}
              </dl>
            </details>
          </div>
        );
      })}
    </Alert>
  );
}
