import type { ClawdisSkillMetadata } from "clawhub-schema";
import type { ReactNode } from "react";
import { formatInstallCommand, formatInstallLabel } from "./skillDetailUtils";

type SkillInstallCardProps = {
  clawdis: ClawdisSkillMetadata | undefined;
  osLabels: string[];
};

export type SkillInstallTabId = "runtime" | "dependencies" | "install" | "links";

type SkillInstallTab = {
  id: SkillInstallTabId;
  label: string;
  panel: ReactNode;
};

function SkillInstallMetadataPanel({ children }: { children: ReactNode }) {
  return <div className="skill-admin-panel skill-install-metadata-panel">{children}</div>;
}

function SkillInstallMetadataRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="skill-admin-row skill-install-metadata-row">
      <div className="skill-admin-row-copy">
        <h3>{title}</h3>
        {typeof description === "string" ? <p>{description}</p> : description}
      </div>
      {children ? <div className="skill-install-metadata-value">{children}</div> : null}
    </div>
  );
}

export function buildSkillInstallTabs({
  clawdis,
  osLabels,
}: SkillInstallCardProps): SkillInstallTab[] {
  const requirements = clawdis?.requires;
  const installSpecs = clawdis?.install ?? [];
  const envVars = clawdis?.envVars ?? [];
  const dependencies = clawdis?.dependencies ?? [];
  const links = clawdis?.links;
  const hasRuntimeRequirements = Boolean(
    osLabels.length ||
    requirements?.bins?.length ||
    requirements?.anyBins?.length ||
    requirements?.env?.length ||
    requirements?.config?.length ||
    clawdis?.primaryEnv ||
    envVars.length,
  );
  const hasInstallSpecs = installSpecs.length > 0;
  const hasDependencies = dependencies.length > 0;
  const hasLinks = Boolean(links?.homepage || links?.repository || links?.documentation);

  if (!hasRuntimeRequirements && !hasInstallSpecs && !hasDependencies && !hasLinks) {
    return [];
  }

  const tabs: SkillInstallTab[] = [];

  if (hasRuntimeRequirements) {
    tabs.push({
      id: "runtime",
      label: "Runtime",
      panel: (
        <div className="skill-install-tab-panel runtime-requirements-panel">
          <SkillInstallMetadataPanel>
            {osLabels.length ? (
              <SkillInstallMetadataRow title="OS" description={osLabels.join(" · ")} />
            ) : null}
            {requirements?.bins?.length ? (
              <SkillInstallMetadataRow title="Bins" description={requirements.bins.join(", ")} />
            ) : null}
            {requirements?.anyBins?.length ? (
              <SkillInstallMetadataRow
                title="Any bin"
                description={requirements.anyBins.join(", ")}
              />
            ) : null}
            {requirements?.env?.length ? (
              <SkillInstallMetadataRow title="Env" description={requirements.env.join(", ")} />
            ) : null}
            {requirements?.config?.length ? (
              <SkillInstallMetadataRow
                title="Config"
                description={requirements.config.join(", ")}
              />
            ) : null}
            {clawdis?.primaryEnv ? (
              <SkillInstallMetadataRow title="Primary env" description={clawdis.primaryEnv} />
            ) : null}
            {envVars.length > 0 ? (
              <SkillInstallMetadataRow title="Environment variables">
                <div className="skill-install-env-list">
                  {envVars.map((env, index) => (
                    <div key={`${env.name}-${index}`} className="skill-install-env-row">
                      <code>{env.name}</code>
                      {env.required === false ? (
                        <span>optional</span>
                      ) : env.required === true ? (
                        <span>required</span>
                      ) : null}
                      {env.description ? <p>{env.description}</p> : null}
                    </div>
                  ))}
                </div>
              </SkillInstallMetadataRow>
            ) : null}
          </SkillInstallMetadataPanel>
        </div>
      ),
    });
  }

  if (hasDependencies) {
    tabs.push({
      id: "dependencies",
      label: "Dependencies",
      panel: (
        <div className="skill-install-tab-panel">
          <SkillInstallMetadataPanel>
            {dependencies.map((dep, index) => (
              <SkillInstallMetadataRow
                key={`${dep.name}-${index}`}
                title={dep.name}
                description={
                  dep.url ? (
                    <a href={dep.url} target="_blank" rel="noopener noreferrer">
                      {dep.url}
                    </a>
                  ) : dep.repository ? (
                    <a href={dep.repository} target="_blank" rel="noopener noreferrer">
                      {dep.repository}
                    </a>
                  ) : null
                }
              >
                <span>
                  {dep.type}
                  {dep.version ? ` ${dep.version}` : ""}
                </span>
                {dep.repository && dep.repository !== dep.url ? (
                  <a href={dep.repository} target="_blank" rel="noopener noreferrer">
                    Source
                  </a>
                ) : null}
              </SkillInstallMetadataRow>
            ))}
          </SkillInstallMetadataPanel>
        </div>
      ),
    });
  }

  if (hasInstallSpecs) {
    tabs.push({
      id: "install",
      label: "Install",
      panel: (
        <div className="skill-install-tab-panel">
          <SkillInstallMetadataPanel>
            {installSpecs.map((spec, index) => {
              const command = formatInstallCommand(spec);
              return (
                <SkillInstallMetadataRow
                  key={`${spec.id ?? spec.kind}-${index}`}
                  title={spec.label ?? formatInstallLabel(spec)}
                  description={spec.bins?.length ? `Bins: ${spec.bins.join(", ")}` : undefined}
                >
                  {command ? (
                    <pre className="hero-install-code skill-install-command">
                      <code>{command}</code>
                    </pre>
                  ) : null}
                </SkillInstallMetadataRow>
              );
            })}
          </SkillInstallMetadataPanel>
        </div>
      ),
    });
  }

  if (hasLinks) {
    tabs.push({
      id: "links",
      label: "Links",
      panel: (
        <div className="skill-install-tab-panel">
          <SkillInstallMetadataPanel>
            {links?.homepage ? (
              <SkillInstallMetadataRow title="Homepage">
                <a
                  href={links.homepage}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all"
                >
                  {links.homepage}
                </a>
              </SkillInstallMetadataRow>
            ) : null}
            {links?.repository ? (
              <SkillInstallMetadataRow title="Repository">
                <a
                  href={links.repository}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all"
                >
                  {links.repository}
                </a>
              </SkillInstallMetadataRow>
            ) : null}
            {links?.documentation ? (
              <SkillInstallMetadataRow title="Docs">
                <a href={links.documentation} target="_blank" rel="noopener noreferrer">
                  {links.documentation}
                </a>
              </SkillInstallMetadataRow>
            ) : null}
          </SkillInstallMetadataPanel>
        </div>
      ),
    });
  }

  return tabs;
}
