import type { ClawdisSkillMetadata } from "clawhub-schema";
import { formatInstallCommand, formatInstallLabel } from "./skillDetailUtils";
import { Badge } from "./ui/badge";

type SkillInstallCardProps = {
  clawdis: ClawdisSkillMetadata | undefined;
  osLabels: string[];
};

export function SkillInstallCard({ clawdis, osLabels }: SkillInstallCardProps) {
  const requirements = clawdis?.requires;
  const installSpecs = clawdis?.install ?? [];
  const envVars = clawdis?.envVars ?? [];
  const dependencies = clawdis?.dependencies ?? [];
  const links = clawdis?.links;
  const hasRuntimeRequirements = Boolean(
    clawdis?.emoji ||
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
    return null;
  }

  return (
    <div className="skill-hero-content">
      <div className="skill-hero-panels">
        {hasRuntimeRequirements ? (
          <div className="skill-panel runtime-requirements-panel">
            <h3 className="section-title text-[1rem] m-0">Runtime requirements</h3>
            <div className="skill-panel-body">
              {clawdis?.emoji ? <Badge>{clawdis.emoji} Clawdis</Badge> : null}
              {osLabels.length ? (
                <div className="stat">
                  <strong>OS</strong>
                  <span>{osLabels.join(" · ")}</span>
                </div>
              ) : null}
              {requirements?.bins?.length ? (
                <div className="stat">
                  <strong>Bins</strong>
                  <span>{requirements.bins.join(", ")}</span>
                </div>
              ) : null}
              {requirements?.anyBins?.length ? (
                <div className="stat">
                  <strong>Any bin</strong>
                  <span>{requirements.anyBins.join(", ")}</span>
                </div>
              ) : null}
              {requirements?.env?.length ? (
                <div className="stat">
                  <strong>Env</strong>
                  <span>{requirements.env.join(", ")}</span>
                </div>
              ) : null}
              {requirements?.config?.length ? (
                <div className="stat">
                  <strong>Config</strong>
                  <span>{requirements.config.join(", ")}</span>
                </div>
              ) : null}
              {clawdis?.primaryEnv ? (
                <div className="stat">
                  <strong>Primary env</strong>
                  <span>{clawdis.primaryEnv}</span>
                </div>
              ) : null}
              {envVars.length > 0 ? (
                <div className="stat">
                  <strong>Environment variables</strong>
                  <div className="flex flex-col gap-1 mt-1">
                    {envVars.map((env, index) => (
                      <div key={`${env.name}-${index}`} className="flex items-baseline gap-2">
                        <code className="text-[0.85rem]">{env.name}</code>
                        {env.required === false ? (
                          <span className="text-ink-soft text-[0.75rem]">optional</span>
                        ) : env.required === true ? (
                          <span className="text-ink-accent text-[0.75rem]">required</span>
                        ) : null}
                        {env.description ? (
                          <span className="text-ink-soft text-[0.8rem]">— {env.description}</span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        {hasDependencies ? (
          <div className="skill-panel">
            <h3 className="section-title text-[1rem] m-0">Dependencies</h3>
            <div className="skill-panel-body">
              {dependencies.map((dep, index) => (
                <div key={`${dep.name}-${index}`} className="stat">
                  <div>
                    <strong>{dep.name}</strong>
                    <span className="text-ink-soft text-[0.85rem] ml-2">
                      {dep.type}
                      {dep.version ? ` ${dep.version}` : ""}
                    </span>
                    {dep.url ? (
                      <div className="text-[0.8rem] break-all">
                        <a href={dep.url} target="_blank" rel="noopener noreferrer">
                          {dep.url}
                        </a>
                      </div>
                    ) : null}
                    {dep.repository && dep.repository !== dep.url ? (
                      <div className="text-[0.8rem]">
                        <a href={dep.repository} target="_blank" rel="noopener noreferrer">
                          Source
                        </a>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {hasInstallSpecs ? (
          <div className="skill-panel">
            <h3 className="section-title text-[1rem] m-0">Install</h3>
            <div className="skill-panel-body">
              {installSpecs.map((spec, index) => {
                const command = formatInstallCommand(spec);
                return (
                  <div key={`${spec.id ?? spec.kind}-${index}`} className="stat">
                    <div>
                      <strong>{spec.label ?? formatInstallLabel(spec)}</strong>
                      {spec.bins?.length ? (
                        <div className="text-ink-soft text-[0.85rem]">
                          Bins: {spec.bins.join(", ")}
                        </div>
                      ) : null}
                      {command ? <code>{command}</code> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
        {hasLinks ? (
          <div className="skill-panel">
            <h3 className="section-title text-[1rem] m-0">Links</h3>
            <div className="skill-panel-body">
              {links?.homepage ? (
                <div className="stat">
                  <strong>Homepage</strong>
                  <a
                    href={links.homepage}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all"
                  >
                    {links.homepage}
                  </a>
                </div>
              ) : null}
              {links?.repository ? (
                <div className="stat">
                  <strong>Repository</strong>
                  <a
                    href={links.repository}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all"
                  >
                    {links.repository}
                  </a>
                </div>
              ) : null}
              {links?.documentation ? (
                <div className="stat">
                  <strong>Docs</strong>
                  <a href={links.documentation} target="_blank" rel="noopener noreferrer">
                    {links.documentation}
                  </a>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
