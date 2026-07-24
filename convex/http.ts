import { ApiRoutes, LegacyApiRoutes } from "clawhub-schema";
import { httpRouter } from "convex/server";
import { agentSkillsHttp } from "./agentSkillsHttp";
import { auth } from "./auth";
import { downloadZip } from "./downloads";
import {
  cliPublishHttp,
  cliDeviceCodeHttp,
  cliDeviceTokenHttp,
  cliSkillDeleteHttp,
  cliSkillUndeleteHttp,
  cliTelemetryInstallHttp,
  cliUploadUrlHttp,
  cliWhoamiHttp,
  getSkillHttp,
  resolveSkillVersionHttp,
  searchSkillsHttp,
} from "./httpApi";
import {
  exportSkillsV1Http,
  exportPluginsV1Http,
  listBundlePluginsV1Http,
  listCodePluginsV1Http,
  listPackagesV1Http,
  listPluginsV1Http,
  listSkillsV1Http,
  mintPublishTokenV1Http,
  npmMirrorGetHttp,
  packagesDeleteRouterV1Http,
  packagesGetRouterV1Http,
  packagesPostRouterV1Http,
  pluginsGetRouterV1Http,
  createPublisherV1Http,
  publishPackageV1Http,
  publishSkillV1Http,
  resolveSkillVersionV1Http,
  searchSkillsV1Http,
  skillScanBatchStatusV1Http,
  skillScanBatchSubmitV1Http,
  skillScanGetRouterV1Http,
  skillScanSubmitV1Http,
  skillSecurityVerdictsV1Http,
  skillsDeleteRouterV1Http,
  skillsGetRouterV1Http,
  skillsPostRouterV1Http,
  starsDeleteRouterV1Http,
  starsPostRouterV1Http,
  transfersGetRouterV1Http,
  banAppealContextV1Http,
  createPromotionV1Http,
  listPromotionsV1Http,
  promotionsGetRouterV1Http,
  promotionsPostRouterV1Http,
  catalogSkillsFeedV1Http,
  promotionsFeedV1Http,
  usersGetRouterV1Http,
  usersListV1Http,
  usersPostRouterV1Http,
  verifyDocsSessionV1Http,
  whoamiV1Http,
  contentRightsV1Http,
  skillsShCatalogTestV1Http,
  skillsShCatalogPublicV1Http,
} from "./httpApiV1";
import { signedCatalogFeedChangesHttp } from "./httpApiV1/catalogFeedChanges";
import { signedCatalogFeedQueryHttp } from "./httpApiV1/catalogFeedQuery";
import {
  catalogFeedShardHttp,
  catalogSkillsFeedShardHttp,
  signedCatalogFeedShardRootHttp,
  signedCatalogSkillsFeedShardRootHttp,
} from "./httpApiV1/catalogFeedShards";
import { catalogFeedWithOptionalSigningV1Http } from "./httpApiV1/catalogFeedSigning";
import { preflightHandler } from "./httpPreflight";
import { installRateLimitedRoutes } from "./lib/httpRouteRateLimit";
import {
  packageInspectorArtifactHttp,
  packageInspectorClaimHttp,
  packageInspectorResultsHttp,
} from "./packageInspectorHttp";

const http = installRateLimitedRoutes(httpRouter());

auth.addHttpRoutes(http);

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
  handler: catalogFeedWithOptionalSigningV1Http,
});

http.route({
  path: ApiRoutes.catalogFeedChanges,
  method: "GET",
  handler: signedCatalogFeedChangesHttp,
});

http.route({
  path: ApiRoutes.catalogFeedQuery,
  method: "GET",
  handler: signedCatalogFeedQueryHttp,
});

http.route({
  path: ApiRoutes.catalogFeedShardRoot,
  method: "GET",
  handler: signedCatalogFeedShardRootHttp,
});

http.route({
  pathPrefix: `${ApiRoutes.catalogFeedShards}/`,
  method: "GET",
  handler: catalogFeedShardHttp,
});

http.route({
  path: ApiRoutes.catalogSkillsFeedShardRoot,
  method: "GET",
  handler: signedCatalogSkillsFeedShardRootHttp,
});

http.route({
  pathPrefix: `${ApiRoutes.catalogSkillsFeedShards}/`,
  method: "GET",
  handler: catalogSkillsFeedShardHttp,
});

http.route({
  path: ApiRoutes.catalogSkillsFeed,
  method: "GET",
  handler: catalogSkillsFeedV1Http,
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
  path: "/api/v1/package-inspector/claim",
  method: "POST",
  handler: packageInspectorClaimHttp,
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
  path: "/api/v1/operator/skills-sh/catalog-test",
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
