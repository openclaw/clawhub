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

type EnvVarDeclaration = NonNullable<ClawdisSkillMetadata["envVars"]>[number];
type SkillInstallSpec = NonNullable<ClawdisSkillMetadata["install"]>[number];
type EnvironmentStatus = "required" | "optional" | "not declared";

type EnvironmentRow = {
  name: string;
  status: EnvironmentStatus;
  description?: string;
  isPrimary: boolean;
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

function uniqueValues(values: string[] | undefined) {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function RequirementHeader({ title }: { title: string }) {
  return <h3 className="requirements-panel-title">{title}</h3>;
}

function RequirementSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="requirements-section">
      <h4>{title}</h4>
      {children}
    </section>
  );
}

function TokenList({ items }: { items: string[] }) {
  return (
    <div className="requirements-token-list">
      {items.map((item) => (
        <span key={item} className="requirements-token">
          {item}
        </span>
      ))}
    </div>
  );
}

function AlternativeTokenList({ items }: { items: string[] }) {
  return (
    <div className="requirements-token-list requirements-token-list-alternatives">
      {items.map((item, index) => (
        <span key={item} className="requirements-token-group">
          {index > 0 ? <span className="requirements-token-separator">or</span> : null}
          <span className="requirements-token">{item}</span>
        </span>
      ))}
    </div>
  );
}

function mergeEnvironmentStatus(
  current: EnvironmentStatus | undefined,
  next: EnvironmentStatus,
): EnvironmentStatus {
  if (current === "required" || next === "required") return "required";
  if (current === "optional" || next === "optional") return "optional";
  return "not declared";
}

function buildEnvironmentRows({
  requiredEnv,
  envVars,
  primaryEnv,
}: {
  requiredEnv: string[];
  envVars: EnvVarDeclaration[];
  primaryEnv?: string;
}) {
  const rows = new Map<string, EnvironmentRow>();

  const upsert = (
    rawName: string | undefined,
    values: Partial<Omit<EnvironmentRow, "name">> & { status?: EnvironmentStatus },
  ) => {
    const name = rawName?.trim();
    if (!name) return;
    const existing = rows.get(name);
    rows.set(name, {
      name,
      status: mergeEnvironmentStatus(existing?.status, values.status ?? "not declared"),
      description: values.description ?? existing?.description,
      isPrimary: existing?.isPrimary || values.isPrimary === true,
    });
  };

  for (const name of requiredEnv) {
    upsert(name, { status: "required" });
  }
  for (const env of envVars) {
    upsert(env.name, {
      status:
        env.required === true ? "required" : env.required === false ? "optional" : "not declared",
      description: env.description,
    });
  }
  upsert(primaryEnv, { isPrimary: true });

  return [...rows.values()];
}

function EnvironmentRows({ rows }: { rows: EnvironmentRow[] }) {
  return (
    <div className="requirements-env-list">
      {rows.map((row) => (
        <div key={row.name} className="requirements-env-row">
          <div className="requirements-env-main">
            <code>{row.name}</code>
            <span
              className={`requirements-badge requirements-badge-${row.status.replace(" ", "-")}`}
            >
              {row.status}
            </span>
            {row.isPrimary ? (
              <span className="requirements-badge requirements-badge-primary">
                primary credential
              </span>
            ) : null}
          </div>
          {row.description ? <p>{row.description}</p> : null}
        </div>
      ))}
    </div>
  );
}

function RuntimeRequirementsPanel({
  clawdis,
  osLabels,
}: {
  clawdis: ClawdisSkillMetadata;
  osLabels: string[];
}) {
  const requirements = clawdis.requires;
  const requiredBins = uniqueValues(requirements?.bins);
  const alternativeBins = uniqueValues(requirements?.anyBins);
  const configPaths = uniqueValues(requirements?.config);
  const requiredEnv = uniqueValues(requirements?.env);
  const envRows = buildEnvironmentRows({
    requiredEnv,
    envVars: clawdis.envVars ?? [],
    primaryEnv: clawdis.primaryEnv,
  });
  const hasRequiredBins = requiredBins.length > 0;
  const hasAlternativeBins = alternativeBins.length > 0;
  const hasBothToolGroups = hasRequiredBins && hasAlternativeBins;

  return (
    <>
      <RequirementHeader title="Requirements" />
      {osLabels.length ? (
        <RequirementSection title="Platform">
          <TokenList items={osLabels} />
        </RequirementSection>
      ) : null}
      {hasBothToolGroups ? (
        <RequirementSection title="Tools">
          <div className="requirements-subsection">
            <h5>All required</h5>
            <TokenList items={requiredBins} />
          </div>
          <div className="requirements-subsection">
            <h5>At least one required</h5>
            <AlternativeTokenList items={alternativeBins} />
          </div>
        </RequirementSection>
      ) : hasRequiredBins ? (
        <RequirementSection title={requiredBins.length === 1 ? "Required tool" : "Required tools"}>
          <TokenList items={requiredBins} />
        </RequirementSection>
      ) : hasAlternativeBins ? (
        <RequirementSection title="At least one required">
          <AlternativeTokenList items={alternativeBins} />
        </RequirementSection>
      ) : null}
      {configPaths.length ? (
        <RequirementSection title="Configuration">
          <div className="requirements-path-list">
            {configPaths.map((path) => (
              <code key={path} className="requirements-path-token">
                {path}
              </code>
            ))}
          </div>
        </RequirementSection>
      ) : null}
      {envRows.length ? (
        <RequirementSection title="Credentials & environment">
          <EnvironmentRows rows={envRows} />
        </RequirementSection>
      ) : null}
    </>
  );
}

function InstallSpecSection({ spec, index }: { spec: SkillInstallSpec; index: number }) {
  const command = formatInstallCommand(spec);
  const bins = uniqueValues(spec.bins);
  const title = spec.label ?? formatInstallLabel(spec);

  return (
    <RequirementSection title={title}>
      <div className="requirements-install-row">
        {command ? (
          <pre className="requirements-code-block">
            <code>{command}</code>
          </pre>
        ) : null}
        {bins.length ? (
          <div className="requirements-subsection">
            <h5>{bins.length === 1 ? "Binary" : "Binaries"}</h5>
            <TokenList items={bins} />
          </div>
        ) : null}
        {!command && !bins.length ? (
          <p className="requirements-muted">Install declaration {index + 1}</p>
        ) : null}
      </div>
    </RequirementSection>
  );
}

function InstallSpecsPanel({ installSpecs }: { installSpecs: SkillInstallSpec[] }) {
  return (
    <>
      <RequirementHeader title="Install" />
      {installSpecs.map((spec, index) => (
        <InstallSpecSection key={`${spec.id ?? spec.kind}-${index}`} spec={spec} index={index} />
      ))}
    </>
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
      label: "Requirements",
      panel: clawdis ? <RuntimeRequirementsPanel clawdis={clawdis} osLabels={osLabels} /> : null,
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
      panel: <InstallSpecsPanel installSpecs={installSpecs} />,
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
