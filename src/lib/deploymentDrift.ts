export type DeploymentDriftInfo = {
  expectedBuildSha: string | null;
  actualBuildSha: string | null;
  hasMismatch: boolean;
};

function normalizeBuildSha(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function getDeploymentDriftInfo(params: {
  expectedBuildSha: string | null | undefined;
  actualBuildSha: string | null | undefined;
}): DeploymentDriftInfo {
  const expectedBuildSha = normalizeBuildSha(params.expectedBuildSha);
  const actualBuildSha = normalizeBuildSha(params.actualBuildSha);
  return {
    expectedBuildSha,
    actualBuildSha,
    hasMismatch: Boolean(expectedBuildSha && actualBuildSha && expectedBuildSha !== actualBuildSha),
  };
}
