import { ApiRoutes, LegacyApiRoutes } from "clawhub-schema/routes";
import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { installRateLimitedRoutes } from "./lib/httpRouteRateLimit";
import { lazyHttpAction } from "./lib/lazyHttpAction";
import { get as templateOverviewHttp } from "./templateOverviewHttp";

const agentSkillsHttp = lazyHttpAction(
  async () => (await import("./agentSkillsHttp")).agentSkillsHttp,
);
const downloadAnalyticsHttp = lazyHttpAction(
  async () => (await import("./downloadAnalyticsHttp")).handle,
);
const downloadZip = lazyHttpAction(async () => (await import("./downloads")).downloadZip);
const recordArchiveDownloadMetric = lazyHttpAction(
  async () => (await import("./downloads")).recordArchiveDownloadMetric,
);
const cliPublishHttp = lazyHttpAction(async () => (await import("./httpApi")).cliPublishHttp);
const cliDeviceCodeHttp = lazyHttpAction(async () => (await import("./httpApi")).cliDeviceCodeHttp);
const cliDeviceTokenHttp = lazyHttpAction(
  async () => (await import("./httpApi")).cliDeviceTokenHttp,
);
const cliSkillDeleteHttp = lazyHttpAction(
  async () => (await import("./httpApi")).cliSkillDeleteHttp,
);
const cliSkillUndeleteHttp = lazyHttpAction(
  async () => (await import("./httpApi")).cliSkillUndeleteHttp,
);
const cliTelemetryInstallHttp = lazyHttpAction(
  async () => (await import("./httpApi")).cliTelemetryInstallHttp,
);
const cliUploadUrlHttp = lazyHttpAction(async () => (await import("./httpApi")).cliUploadUrlHttp);
const cliWhoamiHttp = lazyHttpAction(async () => (await import("./httpApi")).cliWhoamiHttp);
const getSkillHttp = lazyHttpAction(async () => (await import("./httpApi")).getSkillHttp);
const resolveSkillVersionHttp = lazyHttpAction(
  async () => (await import("./httpApi")).resolveSkillVersionHttp,
);
const searchSkillsHttp = lazyHttpAction(async () => (await import("./httpApi")).searchSkillsHttp);
const featuredV1Http = lazyHttpAction(async () => (await import("./httpApiV1")).featuredV1Http);
const searchInsightsV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).searchInsightsV1Http,
);
const searchReportsV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).searchReportsV1Http,
);
const exportSkillsV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).exportSkillsV1Http,
);
const exportPluginsV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).exportPluginsV1Http,
);
const listBundlePluginsV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).listBundlePluginsV1Http,
);
const listCodePluginsV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).listCodePluginsV1Http,
);
const listPackagesV1Http = lazyHttpAction(async () => (await import("./packageListHttp")).get);
const listPluginsV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).listPluginsV1Http,
);
const listPluginOverviewV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).listPluginOverviewV1Http,
);
const listPluginCategoriesV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).listPluginCategoriesV1Http,
);
const listSkillsV1Http = lazyHttpAction(async () => (await import("./httpApiV1")).listSkillsV1Http);
const trendingV1Http = lazyHttpAction(async () => (await import("./httpApiV1")).trendingV1Http);
const mintPublishTokenV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).mintPublishTokenV1Http,
);
const npmMirrorGetHttp = lazyHttpAction(async () => (await import("./httpApiV1")).npmMirrorGetHttp);
const packagesDeleteRouterV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).packagesDeleteRouterV1Http,
);
const packagesGetRouterV1Http = lazyHttpAction(async () => (await import("./packageReadHttp")).get);
const packagesPostRouterV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).packagesPostRouterV1Http,
);
const pluginsGetRouterV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).pluginsGetRouterV1Http,
);
const createPublisherV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).createPublisherV1Http,
);
const publishPackageV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).publishPackageV1Http,
);
const publishAttemptsGetRouterV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).publishAttemptsGetRouterV1Http,
);
const recoverPackagePublishAttemptV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).recoverPackagePublishAttemptV1Http,
);
const publishSkillV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).publishSkillV1Http,
);
const resolveSkillVersionV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).resolveSkillVersionV1Http,
);
const searchSkillsV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).searchSkillsV1Http,
);
const skillScanBatchStatusV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).skillScanBatchStatusV1Http,
);
const skillScanJobHistoryV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).skillScanJobHistoryV1Http,
);
const skillScanBatchSubmitV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).skillScanBatchSubmitV1Http,
);
const skillScanGetRouterV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).skillScanGetRouterV1Http,
);
const skillScanSubmitV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).skillScanSubmitV1Http,
);
const skillSecurityVerdictsV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).skillSecurityVerdictsV1Http,
);
const skillsDeleteRouterV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).skillsDeleteRouterV1Http,
);
const skillsGetRouterV1Http = lazyHttpAction(async () => (await import("./skillReadHttp")).get);
const skillsPostRouterV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).skillsPostRouterV1Http,
);
const starsDeleteRouterV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).starsDeleteRouterV1Http,
);
const starsPostRouterV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).starsPostRouterV1Http,
);
const transfersGetRouterV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).transfersGetRouterV1Http,
);
const banAppealContextV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).banAppealContextV1Http,
);
const createPromotionV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).createPromotionV1Http,
);
const listPromotionsV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).listPromotionsV1Http,
);
const promotionsGetRouterV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).promotionsGetRouterV1Http,
);
const promotionsPostRouterV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).promotionsPostRouterV1Http,
);
const catalogFeedV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).catalogFeedV1Http,
);
const catalogSkillsFeedV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).catalogSkillsFeedV1Http,
);
const catalogTemplatesFeedV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).catalogTemplatesFeedV1Http,
);
const promotionsFeedV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).promotionsFeedV1Http,
);
const usersGetRouterV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).usersGetRouterV1Http,
);
const usersListV1Http = lazyHttpAction(async () => (await import("./httpApiV1")).usersListV1Http);
const usersPostRouterV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).usersPostRouterV1Http,
);
const verifyDocsSessionV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).verifyDocsSessionV1Http,
);
const whoamiV1Http = lazyHttpAction(async () => (await import("./httpApiV1")).whoamiV1Http);
const contentRightsV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).contentRightsV1Http,
);
const skillsShCatalogTestV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).skillsShCatalogTestV1Http,
);
const skillsShCatalogPublicV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).skillsShCatalogPublicV1Http,
);
const preflightHandler = lazyHttpAction(
  async () => (await import("./httpPreflight")).preflightHandler,
);
const packageInspectorAcknowledgeHttp = lazyHttpAction(
  async () => (await import("./packageInspectorHttp")).packageInspectorAcknowledgeHttp,
);
const packageInspectorArtifactHttp = lazyHttpAction(
  async () => (await import("./packageInspectorHttp")).packageInspectorArtifactHttp,
);
const packageInspectorClaimHttp = lazyHttpAction(
  async () => (await import("./packageInspectorHttp")).packageInspectorClaimHttp,
);
const packageInspectorNotifyHttp = lazyHttpAction(
  async () => (await import("./packageInspectorHttp")).packageInspectorNotifyHttp,
);
const packageInspectorResultsHttp = lazyHttpAction(
  async () => (await import("./packageInspectorHttp")).packageInspectorResultsHttp,
);
const packageSdkUsageHttp = lazyHttpAction(
  async () => (await import("./packageSdkUsageHttp")).packageSdkUsageHttp,
);
const packageSdkUsageCoverageHttp = lazyHttpAction(
  async () => (await import("./packageSdkUsageHttp")).packageSdkUsageCoverageHttp,
);
const packageSdkUsagePluginHttp = lazyHttpAction(
  async () => (await import("./packageSdkUsageHttp")).packageSdkUsagePluginHttp,
);
const retainPrepublicationReportHttp = lazyHttpAction(
  async () => (await import("./prepublicationReports")).retainHttp,
);
const skillPresentationAssetHttp = lazyHttpAction(
  async () => (await import("./skillPresentationAssetsHttp")).skillPresentationAssetHttp,
);

const http = installRateLimitedRoutes(httpRouter());

http.route({ path: "/api/v1/templates/overview", method: "GET", handler: templateOverviewHttp });

http.route({
  path: "/api/v1/admin/download-analytics",
  method: "GET",
  handler: downloadAnalyticsHttp,
});
http.route({
  path: "/api/v1/admin/download-analytics",
  method: "POST",
  handler: downloadAnalyticsHttp,
});
auth.addHttpRoutes(http);
for (const [path, method, handler] of [
  [{ path: "/api/internal/prepublication-reports" }, "POST", retainPrepublicationReportHttp],
  [{ path: "/api/v1/search-insights/reports" }, "POST", searchReportsV1Http],
  [{ pathPrefix: "/api/v1/search-insights/reports/" }, "GET", searchReportsV1Http],
  [{ path: "/api/v1/search-insights" }, "GET", searchInsightsV1Http],
  [{ pathPrefix: "/api/v1/skill-icons/" }, "GET", skillPresentationAssetHttp],
  // Convex routes HEAD through the matching GET action and strips the body.
  [{ pathPrefix: "/api/v1/agent-skills/" }, "GET", agentSkillsHttp],
  [{ path: ApiRoutes.download }, "GET", downloadZip],
  [{ path: "/api/internal/archive-download-metric" }, "POST", recordArchiveDownloadMetric],
  [{ path: ApiRoutes.search }, "GET", searchSkillsV1Http],
  [{ path: ApiRoutes.resolve }, "GET", resolveSkillVersionV1Http],
  [{ path: ApiRoutes.skillsExport }, "GET", exportSkillsV1Http],
  [{ path: ApiRoutes.skills }, "GET", listSkillsV1Http],
  [{ path: ApiRoutes.trending }, "GET", trendingV1Http],
  [{ pathPrefix: `${ApiRoutes.skillScans}/` }, "GET", skillScanGetRouterV1Http],
  [{ path: ApiRoutes.packages }, "GET", listPackagesV1Http],
  [{ path: ApiRoutes.plugins }, "GET", listPluginsV1Http],
  [{ path: ApiRoutes.pluginOverview }, "GET", listPluginOverviewV1Http],
  [{ path: ApiRoutes.pluginCategories }, "GET", listPluginCategoriesV1Http],
  [{ path: ApiRoutes.pluginsExport }, "GET", exportPluginsV1Http],
  [{ path: ApiRoutes.codePlugins }, "GET", listCodePluginsV1Http],
  [{ path: ApiRoutes.bundlePlugins }, "GET", listBundlePluginsV1Http],
  [{ pathPrefix: `${ApiRoutes.featured}/` }, "GET", featuredV1Http],
  [{ pathPrefix: `${ApiRoutes.featured}/` }, "POST", featuredV1Http],
  [{ path: ApiRoutes.promotions }, "GET", listPromotionsV1Http],
  [{ pathPrefix: `${ApiRoutes.promotions}/` }, "GET", promotionsGetRouterV1Http],
  [{ path: ApiRoutes.promotions }, "POST", createPromotionV1Http],
  [{ pathPrefix: `${ApiRoutes.promotions}/` }, "POST", promotionsPostRouterV1Http],
  [{ path: ApiRoutes.catalogFeed }, "GET", catalogFeedV1Http],
  [{ path: ApiRoutes.catalogSkillsFeed }, "GET", catalogSkillsFeedV1Http],
  [{ path: ApiRoutes.catalogTemplatesFeed }, "GET", catalogTemplatesFeedV1Http],
  [{ path: ApiRoutes.promotionsFeed }, "GET", promotionsFeedV1Http],
  [{ pathPrefix: `${ApiRoutes.skills}/` }, "GET", skillsGetRouterV1Http],
  [{ pathPrefix: `${ApiRoutes.packages}/` }, "GET", packagesGetRouterV1Http],
  [{ pathPrefix: "/api/npm/" }, "GET", npmMirrorGetHttp],
  [{ pathPrefix: `${ApiRoutes.plugins}/` }, "GET", pluginsGetRouterV1Http],
  [{ path: ApiRoutes.skills }, "POST", publishSkillV1Http],
  [{ path: ApiRoutes.skillScans }, "POST", skillScanSubmitV1Http],
  [{ path: `${ApiRoutes.skillScans}/batch` }, "POST", skillScanBatchSubmitV1Http],
  [{ path: `${ApiRoutes.skillScans}/batch/jobs` }, "POST", skillScanJobHistoryV1Http],
  [{ path: `${ApiRoutes.skillScans}/batch/status` }, "POST", skillScanBatchStatusV1Http],
  [{ path: ApiRoutes.packages }, "POST", publishPackageV1Http],
  [{ path: ApiRoutes.publishTokenMint }, "POST", mintPublishTokenV1Http],
  [{ pathPrefix: "/api/v1/publish/attempts/" }, "GET", publishAttemptsGetRouterV1Http],
  [{ pathPrefix: "/api/v1/publish/attempts/" }, "POST", recoverPackagePublishAttemptV1Http],
  [{ path: "/api/v1/package-inspector/claim" }, "POST", packageInspectorClaimHttp],
  [{ path: ApiRoutes.sdkUsage }, "GET", packageSdkUsageHttp],
  [{ path: ApiRoutes.sdkUsageCoverage }, "GET", packageSdkUsageCoverageHttp],
  [{ path: ApiRoutes.sdkUsagePlugin }, "GET", packageSdkUsagePluginHttp],
  [{ path: "/api/v1/package-inspector/acknowledge" }, "POST", packageInspectorAcknowledgeHttp],
  [{ path: "/api/v1/package-inspector/artifact" }, "GET", packageInspectorArtifactHttp],
  [{ path: "/api/v1/package-inspector/results" }, "POST", packageInspectorResultsHttp],
  [{ path: "/api/v1/package-inspector/notify" }, "POST", packageInspectorNotifyHttp],
  [{ pathPrefix: `${ApiRoutes.packages}/` }, "POST", packagesPostRouterV1Http],
  [{ pathPrefix: `${ApiRoutes.packages}/` }, "DELETE", packagesDeleteRouterV1Http],
  [{ path: `${ApiRoutes.skills}/-/security-verdicts` }, "POST", skillSecurityVerdictsV1Http],
  [{ pathPrefix: `${ApiRoutes.skills}/` }, "POST", skillsPostRouterV1Http],
  [{ pathPrefix: `${ApiRoutes.skills}/` }, "DELETE", skillsDeleteRouterV1Http],
  [{ pathPrefix: `${ApiRoutes.stars}/` }, "POST", starsPostRouterV1Http],
  [{ pathPrefix: `${ApiRoutes.stars}/` }, "DELETE", starsDeleteRouterV1Http],
  [{ pathPrefix: `${ApiRoutes.transfers}/` }, "GET", transfersGetRouterV1Http],
  [{ path: ApiRoutes.publishers }, "POST", createPublisherV1Http],
  [{ path: ApiRoutes.whoami }, "GET", whoamiV1Http],
  [{ pathPrefix: `${ApiRoutes.contentRights}/` }, "GET", contentRightsV1Http],
  [{ path: "/api/v1/operator/skills-sh/catalog-test" }, "GET", skillsShCatalogTestV1Http],
  [{ pathPrefix: "/api/v1/skills-sh/" }, "GET", skillsShCatalogPublicV1Http],
  [{ pathPrefix: "/api/v1/skills-sh/" }, "POST", skillsShCatalogPublicV1Http],
  [{ path: "/api/v1/operator/skills-sh/catalog-test" }, "POST", skillsShCatalogTestV1Http],
  [{ path: "/api/v1/operator/skills-sh/mirror" }, "POST", skillsShCatalogTestV1Http],
  [{ pathPrefix: `${ApiRoutes.contentRights}/` }, "POST", contentRightsV1Http],
  [{ path: "/api/cli/device/code" }, "POST", cliDeviceCodeHttp],
  [{ path: "/api/cli/device/token" }, "POST", cliDeviceTokenHttp],
  [{ path: "/api/v1/docs/session/verify" }, "GET", verifyDocsSessionV1Http],
  [{ pathPrefix: `${ApiRoutes.users}/` }, "POST", usersPostRouterV1Http],
  [{ path: "/api/v1/users/ban-appeal-context" }, "GET", banAppealContextV1Http],
  [{ pathPrefix: `${ApiRoutes.users}/` }, "GET", usersGetRouterV1Http],
  [{ path: ApiRoutes.users }, "GET", usersListV1Http],
  [{ pathPrefix: "/api/" }, "OPTIONS", preflightHandler],
  // TODO: remove legacy /api routes after deprecation window.
  [{ path: LegacyApiRoutes.download }, "GET", downloadZip],
  [{ path: LegacyApiRoutes.search }, "GET", searchSkillsHttp],
  [{ path: LegacyApiRoutes.skill }, "GET", getSkillHttp],
  [{ path: LegacyApiRoutes.skillResolve }, "GET", resolveSkillVersionHttp],
  [{ path: LegacyApiRoutes.cliWhoami }, "GET", cliWhoamiHttp],
  [{ path: LegacyApiRoutes.cliUploadUrl }, "POST", cliUploadUrlHttp],
  [{ path: LegacyApiRoutes.cliPublish }, "POST", cliPublishHttp],
  [{ path: LegacyApiRoutes.cliTelemetryInstall }, "POST", cliTelemetryInstallHttp],
  [{ path: LegacyApiRoutes.cliSkillDelete }, "POST", cliSkillDeleteHttp],
  [{ path: LegacyApiRoutes.cliSkillUndelete }, "POST", cliSkillUndeleteHttp],
] as const) {
  http.route({ ...path, method, handler });
}

export default http;
