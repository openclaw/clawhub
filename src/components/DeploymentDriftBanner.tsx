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
      style={{
        margin: "16px auto 0",
        width: "min(1100px, calc(100vw - 32px))",
        border: "1px solid #f59e0b",
        background: "#fff7ed",
        color: "#9a3412",
        borderRadius: "14px",
        padding: "12px 16px",
        fontSize: "0.95rem",
        lineHeight: 1.4,
      }}
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
