import { useQueries } from "convex/react";
import { Component, useEffect, type ReactNode } from "react";
import { api } from "../../convex/_generated/api";
import { getDeploymentDriftInfo } from "../lib/deploymentDrift";
import { getRuntimeEnv } from "../lib/runtimeEnv";

const DEPLOYMENT_INFO_QUERY = {
  deploymentInfo: {
    query: api.appMeta.getDeploymentInfo,
    args: {},
  },
} as const;

function getFrontendBuildSha() {
  return getRuntimeEnv("VITE_APP_BUILD_SHA") ?? null;
}

type DeploymentDriftBannerBoundaryProps = {
  children: ReactNode;
};

type DeploymentDriftBannerBoundaryState = {
  hasError: boolean;
};

class DeploymentDriftBannerBoundary extends Component<
  DeploymentDriftBannerBoundaryProps,
  DeploymentDriftBannerBoundaryState
> {
  state: DeploymentDriftBannerBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError() {
    return {
      hasError: true,
    };
  }

  componentDidCatch(error: unknown) {
    console.error("Deployment drift banner crashed", error);
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

function DeploymentDriftBannerContent() {
  const deploymentInfoResult = useQueries(DEPLOYMENT_INFO_QUERY).deploymentInfo;
  const deploymentInfo = deploymentInfoResult instanceof Error ? null : deploymentInfoResult;
  const drift = getDeploymentDriftInfo({
    expectedBuildSha: getFrontendBuildSha(),
    actualBuildSha: deploymentInfo?.appBuildSha ?? null,
  });

  useEffect(() => {
    if (deploymentInfoResult instanceof Error) {
      console.warn("Deployment drift check unavailable", deploymentInfoResult);
      return;
    }
    if (!drift.hasMismatch) return;
    console.error("Deployment drift detected", drift);
  }, [deploymentInfoResult, drift]);

  if (!drift.hasMismatch) return null;

  return (
    <div
      role="alert"
      className="mx-auto mt-4 w-[min(1100px,calc(100vw-32px))] rounded-[14px] border border-status-warning-fg/40 bg-status-warning-bg px-4 py-3 text-[0.95rem] leading-[1.4] text-status-warning-fg"
    >
      Deploy mismatch detected. Frontend expects backend build <code>{drift.expectedBuildSha}</code>{" "}
      but Convex reports <code>{drift.actualBuildSha}</code>.
    </div>
  );
}

export function DeploymentDriftBanner() {
  return (
    <DeploymentDriftBannerBoundary>
      <DeploymentDriftBannerContent />
    </DeploymentDriftBannerBoundary>
  );
}
