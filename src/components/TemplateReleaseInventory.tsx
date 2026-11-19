import type { TemplateWorkspaceContents } from "../lib/templateDetail";
import type { TemplateDisplayInventory } from "../lib/templateDisplayInventory";

/** The named release contents are visible at document paint, without a file, icon, or hydration. */
export function TemplateReleaseInventory({
  inventory,
  workspace,
}: {
  inventory: TemplateDisplayInventory;
  workspace: TemplateWorkspaceContents;
}) {
  const { skills, integrations, automations } = inventory.contents;
  const names = (values: { name: string }[]) =>
    values.length === 0 ? "None" : values.map((row) => row.name).join(", ");
  return (
    <section className="template-release-inventory" aria-label="Included in this release">
      <h2>Included in this release</h2>
      <dl>
        <div>
          <dt>Skills</dt>
          <dd>{names([...skills, ...workspace.skills])}</dd>
        </div>
        <div>
          <dt>Plugins</dt>
          <dd>
            {names([...integrations.filter((row) => row.kind === "plugin"), ...workspace.plugins])}
          </dd>
        </div>
        {integrations.some((row) => row.kind === "mcpServer") ? (
          <div>
            <dt>MCP servers</dt>
            <dd>{names(integrations.filter((row) => row.kind === "mcpServer"))}</dd>
          </div>
        ) : null}
        <div>
          <dt>Automations</dt>
          <dd>
            {automations.length || workspace.heartbeat
              ? [
                  ...automations.map(
                    (row) =>
                      row.name +
                      " · " +
                      (row.enabled ? "Enabled" : "Paused") +
                      " · " +
                      row.schedule +
                      " · " +
                      row.timezone,
                  ),
                  ...(workspace.heartbeat ? ["Heartbeat checklist"] : []),
                ].join("; ")
              : "None"}
          </dd>
        </div>
      </dl>
    </section>
  );
}
