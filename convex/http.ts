import { ApiRoutes, LegacyApiRoutes } from "clawhub-schema";
import { httpRouter } from "convex/server";
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
  catalogFeedV1Http,
  catalogSkillsFeedV1Http,
  usersGetRouterV1Http,
  usersListV1Http,
  usersPostRouterV1Http,
  verifyDocsSessionV1Http,
  whoamiV1Http,
  contentRightsV1Http,
} from "./httpApiV1";
import { preflightHandler } from "./httpPreflight";
import {
  packageInspectorArtifactHttp,
  packageInspectorClaimHttp,
  packageInspectorResultsHttp,
} from "./packageInspectorHttp";

const http = httpRouter();

auth.addHttpRoutes(http);

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
