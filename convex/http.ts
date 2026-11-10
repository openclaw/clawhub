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
const listPackagesV1Http = lazyHttpAction(
  async () => (await import("./httpApiV1")).listPackagesV1Http,
);
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
http.route({
  path: "/api/internal/prepublication-reports",
  method: "POST",
  handler: retainPrepublicationReportHttp,
});
http.route({
  path: "/api/v1/search-insights/reports",
  method: "POST",
  handler: searchReportsV1Http,
});
http.route({
  pathPrefix: "/api/v1/search-insights/reports/",
  method: "GET",
  handler: searchReportsV1Http,
});
http.route({ path: "/api/v1/search-insights", method: "GET", handler: searchInsightsV1Http });

http.route({
  pathPrefix: "/api/v1/skill-icons/",
  method: "GET",
  handler: skillPresentationAssetHttp,
});

// Convex routes HEAD through the matching GET action and strips the body.
http.route({
  pathPrefix: "/api/v1/agent-skills/",
  method: "GET",
  handler: agentSkillsHttp,
});

http.route({
  path: ApiRoutes.download,
  method: "GET",
  handler: downloadZip,
});

http.route({
  path: "/api/internal/archive-download-metric",
  method: "POST",
  handler: recordArchiveDownloadMetric,
});

http.route({
  path: ApiRoutes.search,
  method: "GET",
  handler: searchSkillsV1Http,
});

http.route({
  path: ApiRoutes.resolve,
  method: "GET",
  handler: resolveSkillVersionV1Http,
});

http.route({
  path: ApiRoutes.skillsExport,
  method: "GET",
  handler: exportSkillsV1Http,
});

http.route({
  path: ApiRoutes.skills,
  method: "GET",
  handler: listSkillsV1Http,
});

http.route({
  path: ApiRoutes.trending,
  method: "GET",
  handler: trendingV1Http,
});

http.route({
  pathPrefix: `${ApiRoutes.skillScans}/`,
  method: "GET",
  handler: skillScanGetRouterV1Http,
});

http.route({
  path: ApiRoutes.packages,
  method: "GET",
  handler: listPackagesV1Http,
});

http.route({
  path: ApiRoutes.plugins,
  method: "GET",
  handler: listPluginsV1Http,
});

http.route({
  path: ApiRoutes.pluginOverview,
  method: "GET",
  handler: listPluginOverviewV1Http,
});

http.route({
  path: ApiRoutes.pluginCategories,
  method: "GET",
  handler: listPluginCategoriesV1Http,
});

http.route({
  path: ApiRoutes.pluginsExport,
  method: "GET",
  handler: exportPluginsV1Http,
});

http.route({
  path: ApiRoutes.codePlugins,
  method: "GET",
  handler: listCodePluginsV1Http,
});

http.route({
  path: ApiRoutes.bundlePlugins,
  method: "GET",
  handler: listBundlePluginsV1Http,
});

http.route({ pathPrefix: `${ApiRoutes.featured}/`, method: "GET", handler: featuredV1Http });
http.route({ pathPrefix: `${ApiRoutes.featured}/`, method: "POST", handler: featuredV1Http });

http.route({
  path: ApiRoutes.promotions,
  method: "GET",
  handler: listPromotionsV1Http,
});

http.route({
  pathPrefix: `${ApiRoutes.promotions}/`,
  method: "GET",
  handler: promotionsGetRouterV1Http,
});

http.route({
  path: ApiRoutes.promotions,
  method: "POST",
  handler: createPromotionV1Http,
});

http.route({
  pathPrefix: `${ApiRoutes.promotions}/`,
  method: "POST",
  handler: promotionsPostRouterV1Http,
});

http.route({
  path: ApiRoutes.catalogFeed,
  method: "GET",
  handler: catalogFeedV1Http,
});

http.route({
  path: ApiRoutes.catalogSkillsFeed,
  method: "GET",
  handler: catalogSkillsFeedV1Http,
});

http.route({
  path: ApiRoutes.catalogTemplatesFeed,
  method: "GET",
  handler: catalogTemplatesFeedV1Http,
});

http.route({
  path: ApiRoutes.promotionsFeed,
  method: "GET",
  handler: promotionsFeedV1Http,
});

http.route({
  pathPrefix: `${ApiRoutes.skills}/`,
  method: "GET",
  handler: skillsGetRouterV1Http,
});

http.route({
  pathPrefix: `${ApiRoutes.packages}/`,
  method: "GET",
  handler: packagesGetRouterV1Http,
});

http.route({
  pathPrefix: "/api/npm/",
  method: "GET",
  handler: npmMirrorGetHttp,
});

http.route({
  pathPrefix: `${ApiRoutes.plugins}/`,
  method: "GET",
  handler: pluginsGetRouterV1Http,
});

http.route({
  path: ApiRoutes.skills,
  method: "POST",
  handler: publishSkillV1Http,
});

http.route({
  path: ApiRoutes.skillScans,
  method: "POST",
  handler: skillScanSubmitV1Http,
});

http.route({
  path: `${ApiRoutes.skillScans}/batch`,
  method: "POST",
  handler: skillScanBatchSubmitV1Http,
});

http.route({
  path: `${ApiRoutes.skillScans}/batch/jobs`,
  method: "POST",
  handler: skillScanJobHistoryV1Http,
});

http.route({
  path: `${ApiRoutes.skillScans}/batch/status`,
  method: "POST",
  handler: skillScanBatchStatusV1Http,
});

http.route({
  path: ApiRoutes.packages,
  method: "POST",
  handler: publishPackageV1Http,
});

http.route({
  path: ApiRoutes.publishTokenMint,
  method: "POST",
  handler: mintPublishTokenV1Http,
});

http.route({
  pathPrefix: "/api/v1/publish/attempts/",
  method: "GET",
  handler: publishAttemptsGetRouterV1Http,
});

http.route({
  pathPrefix: "/api/v1/publish/attempts/",
  method: "POST",
  handler: recoverPackagePublishAttemptV1Http,
});

http.route({
  path: "/api/v1/package-inspector/claim",
  method: "POST",
  handler: packageInspectorClaimHttp,
});

http.route({ path: ApiRoutes.sdkUsage, method: "GET", handler: packageSdkUsageHttp });
http.route({
  path: ApiRoutes.sdkUsageCoverage,
  method: "GET",
  handler: packageSdkUsageCoverageHttp,
});
http.route({ path: ApiRoutes.sdkUsagePlugin, method: "GET", handler: packageSdkUsagePluginHttp });

http.route({
  path: "/api/v1/package-inspector/acknowledge",
  method: "POST",
  handler: packageInspectorAcknowledgeHttp,
});

http.route({
  path: "/api/v1/package-inspector/artifact",
  method: "GET",
  handler: packageInspectorArtifactHttp,
});

http.route({
  path: "/api/v1/package-inspector/results",
  method: "POST",
  handler: packageInspectorResultsHttp,
});

http.route({
  path: "/api/v1/package-inspector/notify",
  method: "POST",
  handler: packageInspectorNotifyHttp,
});

http.route({
  pathPrefix: `${ApiRoutes.packages}/`,
  method: "POST",
  handler: packagesPostRouterV1Http,
});

http.route({
  pathPrefix: `${ApiRoutes.packages}/`,
  method: "DELETE",
  handler: packagesDeleteRouterV1Http,
});

http.route({
  path: `${ApiRoutes.skills}/-/security-verdicts`,
  method: "POST",
  handler: skillSecurityVerdictsV1Http,
});

http.route({
  pathPrefix: `${ApiRoutes.skills}/`,
  method: "POST",
  handler: skillsPostRouterV1Http,
});

http.route({
  pathPrefix: `${ApiRoutes.skills}/`,
  method: "DELETE",
  handler: skillsDeleteRouterV1Http,
});

http.route({
  pathPrefix: `${ApiRoutes.stars}/`,
  method: "POST",
  handler: starsPostRouterV1Http,
});

http.route({
  pathPrefix: `${ApiRoutes.stars}/`,
  method: "DELETE",
  handler: starsDeleteRouterV1Http,
});

http.route({
  pathPrefix: `${ApiRoutes.transfers}/`,
  method: "GET",
  handler: transfersGetRouterV1Http,
});

http.route({
  path: ApiRoutes.publishers,
  method: "POST",
  handler: createPublisherV1Http,
});

http.route({
  path: ApiRoutes.whoami,
  method: "GET",
  handler: whoamiV1Http,
});

http.route({
  pathPrefix: `${ApiRoutes.contentRights}/`,
  method: "GET",
  handler: contentRightsV1Http,
});

http.route({
  path: "/api/v1/operator/skills-sh/catalog-test",
  method: "GET",
  handler: skillsShCatalogTestV1Http,
});

http.route({
  pathPrefix: "/api/v1/skills-sh/",
  method: "GET",
  handler: skillsShCatalogPublicV1Http,
});
http.route({
  pathPrefix: "/api/v1/skills-sh/",
  method: "POST",
  handler: skillsShCatalogPublicV1Http,
});

http.route({
  path: "/api/v1/operator/skills-sh/catalog-test",
  method: "POST",
  handler: skillsShCatalogTestV1Http,
});

http.route({
  path: "/api/v1/operator/skills-sh/mirror",
  method: "POST",
  handler: skillsShCatalogTestV1Http,
});

http.route({
  pathPrefix: `${ApiRoutes.contentRights}/`,
  method: "POST",
  handler: contentRightsV1Http,
});

http.route({
  path: "/api/cli/device/code",
  method: "POST",
  handler: cliDeviceCodeHttp,
});

http.route({
  path: "/api/cli/device/token",
  method: "POST",
  handler: cliDeviceTokenHttp,
});

http.route({
  path: "/api/v1/docs/session/verify",
  method: "GET",
  handler: verifyDocsSessionV1Http,
});

http.route({
  pathPrefix: `${ApiRoutes.users}/`,
  method: "POST",
  handler: usersPostRouterV1Http,
});

http.route({
  path: "/api/v1/users/ban-appeal-context",
  method: "GET",
  handler: banAppealContextV1Http,
});

http.route({
  pathPrefix: `${ApiRoutes.users}/`,
  method: "GET",
  handler: usersGetRouterV1Http,
});

http.route({
  path: ApiRoutes.users,
  method: "GET",
  handler: usersListV1Http,
});

http.route({
  pathPrefix: "/api/",
  method: "OPTIONS",
  handler: preflightHandler,
});

// TODO: remove legacy /api routes after deprecation window.
http.route({
  path: LegacyApiRoutes.download,
  method: "GET",
  handler: downloadZip,
});
http.route({
  path: LegacyApiRoutes.search,
  method: "GET",
  handler: searchSkillsHttp,
});

http.route({
  path: LegacyApiRoutes.skill,
  method: "GET",
  handler: getSkillHttp,
});

http.route({
  path: LegacyApiRoutes.skillResolve,
  method: "GET",
  handler: resolveSkillVersionHttp,
});

http.route({
  path: LegacyApiRoutes.cliWhoami,
  method: "GET",
  handler: cliWhoamiHttp,
});

http.route({
  path: LegacyApiRoutes.cliUploadUrl,
  method: "POST",
  handler: cliUploadUrlHttp,
});

http.route({
  path: LegacyApiRoutes.cliPublish,
  method: "POST",
  handler: cliPublishHttp,
});

http.route({
  path: LegacyApiRoutes.cliTelemetryInstall,
  method: "POST",
  handler: cliTelemetryInstallHttp,
});

http.route({
  path: LegacyApiRoutes.cliSkillDelete,
  method: "POST",
  handler: cliSkillDeleteHttp,
});

http.route({
  path: LegacyApiRoutes.cliSkillUndelete,
  method: "POST",
  handler: cliSkillUndeleteHttp,
});

export default http;
