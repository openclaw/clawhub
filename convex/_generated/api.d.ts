/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as appMeta from "../appMeta.js";
import type * as auth from "../auth.js";
import type * as cliDeviceAuth from "../cliDeviceAuth.js";
import type * as commentModeration from "../commentModeration.js";
import type * as comments from "../comments.js";
import type * as crons from "../crons.js";
import type * as depRegistryScan from "../depRegistryScan.js";
import type * as devSeed from "../devSeed.js";
import type * as devSeedExtra from "../devSeedExtra.js";
import type * as downloadMetrics from "../downloadMetrics.js";
import type * as downloads from "../downloads.js";
import type * as emailsNode from "../emailsNode.js";
import type * as functions from "../functions.js";
import type * as githubAccountAgeBackfill from "../githubAccountAgeBackfill.js";
import type * as githubIdentity from "../githubIdentity.js";
import type * as githubImport from "../githubImport.js";
import type * as githubSkillSources from "../githubSkillSources.js";
import type * as githubSkillSync from "../githubSkillSync.js";
import type * as githubSkillSyncNode from "../githubSkillSyncNode.js";
import type * as http from "../http.js";
import type * as httpApi from "../httpApi.js";
import type * as httpApiV1 from "../httpApiV1.js";
import type * as httpApiV1_contentRightsV1 from "../httpApiV1/contentRightsV1.js";
import type * as httpApiV1_docsSessionV1 from "../httpApiV1/docsSessionV1.js";
import type * as httpApiV1_packagesV1 from "../httpApiV1/packagesV1.js";
import type * as httpApiV1_publishersV1 from "../httpApiV1/publishersV1.js";
import type * as httpApiV1_shared from "../httpApiV1/shared.js";
import type * as httpApiV1_skillsV1 from "../httpApiV1/skillsV1.js";
import type * as httpApiV1_starsV1 from "../httpApiV1/starsV1.js";
import type * as httpApiV1_transfersV1 from "../httpApiV1/transfersV1.js";
import type * as httpApiV1_usersV1 from "../httpApiV1/usersV1.js";
import type * as httpApiV1_whoamiV1 from "../httpApiV1/whoamiV1.js";
import type * as httpPreflight from "../httpPreflight.js";
import type * as leaderboards from "../leaderboards.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_apiTokenAuth from "../lib/apiTokenAuth.js";
import type * as lib_artifactModeration from "../lib/artifactModeration.js";
import type * as lib_badges from "../lib/badges.js";
import type * as lib_batching from "../lib/batching.js";
import type * as lib_changelog from "../lib/changelog.js";
import type * as lib_clawpack from "../lib/clawpack.js";
import type * as lib_commentScamPrompt from "../lib/commentScamPrompt.js";
import type * as lib_contentTypes from "../lib/contentTypes.js";
import type * as lib_devAuth from "../lib/devAuth.js";
import type * as lib_devSeed from "../lib/devSeed.js";
import type * as lib_emailRendering from "../lib/emailRendering.js";
import type * as lib_emails from "../lib/emails.js";
import type * as lib_embeddingVisibility from "../lib/embeddingVisibility.js";
import type * as lib_embeddings from "../lib/embeddings.js";
import type * as lib_githubAccount from "../lib/githubAccount.js";
import type * as lib_githubActionsOidc from "../lib/githubActionsOidc.js";
import type * as lib_githubAuth from "../lib/githubAuth.js";
import type * as lib_githubIdentity from "../lib/githubIdentity.js";
import type * as lib_githubImport from "../lib/githubImport.js";
import type * as lib_githubProfileSync from "../lib/githubProfileSync.js";
import type * as lib_githubSkillScans from "../lib/githubSkillScans.js";
import type * as lib_githubSkillSync from "../lib/githubSkillSync.js";
import type * as lib_globalStats from "../lib/globalStats.js";
import type * as lib_httpHeaders from "../lib/httpHeaders.js";
import type * as lib_httpRateLimit from "../lib/httpRateLimit.js";
import type * as lib_httpUtils from "../lib/httpUtils.js";
import type * as lib_installResolver from "../lib/installResolver.js";
import type * as lib_leaderboards from "../lib/leaderboards.js";
import type * as lib_manualOverrides from "../lib/manualOverrides.js";
import type * as lib_moderation from "../lib/moderation.js";
import type * as lib_moderationEngine from "../lib/moderationEngine.js";
import type * as lib_moderationReasonCodes from "../lib/moderationReasonCodes.js";
import type * as lib_observabilityEvents from "../lib/observabilityEvents.js";
import type * as lib_officialPublishers from "../lib/officialPublishers.js";
import type * as lib_openaiResponse from "../lib/openaiResponse.js";
import type * as lib_packageArtifacts from "../lib/packageArtifacts.js";
import type * as lib_packageRegistry from "../lib/packageRegistry.js";
import type * as lib_packageSearchDigest from "../lib/packageSearchDigest.js";
import type * as lib_packageSecurity from "../lib/packageSecurity.js";
import type * as lib_public from "../lib/public.js";
import type * as lib_publicRouteReservations from "../lib/publicRouteReservations.js";
import type * as lib_publishLimits from "../lib/publishLimits.js";
import type * as lib_publisherAbuseScoring from "../lib/publisherAbuseScoring.js";
import type * as lib_publisherCatalogDisplay from "../lib/publisherCatalogDisplay.js";
import type * as lib_publisherStats from "../lib/publisherStats.js";
import type * as lib_publishers from "../lib/publishers.js";
import type * as lib_recommendationScore from "../lib/recommendationScore.js";
import type * as lib_registryArtifactBackup from "../lib/registryArtifactBackup.js";
import type * as lib_reporting from "../lib/reporting.js";
import type * as lib_reservedHandles from "../lib/reservedHandles.js";
import type * as lib_reservedSlugs from "../lib/reservedSlugs.js";
import type * as lib_searchText from "../lib/searchText.js";
import type * as lib_securityPrompt from "../lib/securityPrompt.js";
import type * as lib_skillBackfill from "../lib/skillBackfill.js";
import type * as lib_skillCapabilityTags from "../lib/skillCapabilityTags.js";
import type * as lib_skillCards from "../lib/skillCards.js";
import type * as lib_skillFileAccess from "../lib/skillFileAccess.js";
import type * as lib_skillIcon from "../lib/skillIcon.js";
import type * as lib_skillPublish from "../lib/skillPublish.js";
import type * as lib_skillQuality from "../lib/skillQuality.js";
import type * as lib_skillSafety from "../lib/skillSafety.js";
import type * as lib_skillScanRequestFiles from "../lib/skillScanRequestFiles.js";
import type * as lib_skillSearchDigest from "../lib/skillSearchDigest.js";
import type * as lib_skillSlugValidator from "../lib/skillSlugValidator.js";
import type * as lib_skillStats from "../lib/skillStats.js";
import type * as lib_skillSummary from "../lib/skillSummary.js";
import type * as lib_skillZip from "../lib/skillZip.js";
import type * as lib_skills from "../lib/skills.js";
import type * as lib_staticPublishScan from "../lib/staticPublishScan.js";
import type * as lib_tokens from "../lib/tokens.js";
import type * as lib_userSearch from "../lib/userSearch.js";
import type * as lib_userSkillStats from "../lib/userSkillStats.js";
import type * as lib_webhooks from "../lib/webhooks.js";
import type * as llmEval from "../llmEval.js";
import type * as maintenance from "../maintenance.js";
import type * as managementDevSeed from "../managementDevSeed.js";
import type * as packageInspectorHttp from "../packageInspectorHttp.js";
import type * as packageInspectorNode from "../packageInspectorNode.js";
import type * as packagePublishTokens from "../packagePublishTokens.js";
import type * as packages from "../packages.js";
import type * as publisherAbuse from "../publisherAbuse.js";
import type * as publisherAbuseDevSeed from "../publisherAbuseDevSeed.js";
import type * as publishers from "../publishers.js";
import type * as rateLimits from "../rateLimits.js";
import type * as registryArtifactBackups from "../registryArtifactBackups.js";
import type * as registryArtifactBackupsNode from "../registryArtifactBackupsNode.js";
import type * as registryArtifactRestore from "../registryArtifactRestore.js";
import type * as registryArtifactRestoreMutations from "../registryArtifactRestoreMutations.js";
import type * as search from "../search.js";
import type * as securityDataset from "../securityDataset.js";
import type * as securityDatasetNode from "../securityDatasetNode.js";
import type * as securityScan from "../securityScan.js";
import type * as skillCards from "../skillCards.js";
import type * as skillStatEvents from "../skillStatEvents.js";
import type * as skillTransfers from "../skillTransfers.js";
import type * as skills from "../skills.js";
import type * as stars from "../stars.js";
import type * as statsMaintenance from "../statsMaintenance.js";
import type * as telemetry from "../telemetry.js";
import type * as tokens from "../tokens.js";
import type * as uploads from "../uploads.js";
import type * as users from "../users.js";
import type * as vt from "../vt.js";
import type * as webhooks from "../webhooks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  appMeta: typeof appMeta;
  auth: typeof auth;
  cliDeviceAuth: typeof cliDeviceAuth;
  commentModeration: typeof commentModeration;
  comments: typeof comments;
  crons: typeof crons;
  depRegistryScan: typeof depRegistryScan;
  devSeed: typeof devSeed;
  devSeedExtra: typeof devSeedExtra;
  downloadMetrics: typeof downloadMetrics;
  downloads: typeof downloads;
  emailsNode: typeof emailsNode;
  functions: typeof functions;
  githubAccountAgeBackfill: typeof githubAccountAgeBackfill;
  githubIdentity: typeof githubIdentity;
  githubImport: typeof githubImport;
  githubSkillSources: typeof githubSkillSources;
  githubSkillSync: typeof githubSkillSync;
  githubSkillSyncNode: typeof githubSkillSyncNode;
  http: typeof http;
  httpApi: typeof httpApi;
  httpApiV1: typeof httpApiV1;
  "httpApiV1/contentRightsV1": typeof httpApiV1_contentRightsV1;
  "httpApiV1/docsSessionV1": typeof httpApiV1_docsSessionV1;
  "httpApiV1/packagesV1": typeof httpApiV1_packagesV1;
  "httpApiV1/publishersV1": typeof httpApiV1_publishersV1;
  "httpApiV1/shared": typeof httpApiV1_shared;
  "httpApiV1/skillsV1": typeof httpApiV1_skillsV1;
  "httpApiV1/starsV1": typeof httpApiV1_starsV1;
  "httpApiV1/transfersV1": typeof httpApiV1_transfersV1;
  "httpApiV1/usersV1": typeof httpApiV1_usersV1;
  "httpApiV1/whoamiV1": typeof httpApiV1_whoamiV1;
  httpPreflight: typeof httpPreflight;
  leaderboards: typeof leaderboards;
  "lib/access": typeof lib_access;
  "lib/apiTokenAuth": typeof lib_apiTokenAuth;
  "lib/artifactModeration": typeof lib_artifactModeration;
  "lib/badges": typeof lib_badges;
  "lib/batching": typeof lib_batching;
  "lib/changelog": typeof lib_changelog;
  "lib/clawpack": typeof lib_clawpack;
  "lib/commentScamPrompt": typeof lib_commentScamPrompt;
  "lib/contentTypes": typeof lib_contentTypes;
  "lib/devAuth": typeof lib_devAuth;
  "lib/devSeed": typeof lib_devSeed;
  "lib/emailRendering": typeof lib_emailRendering;
  "lib/emails": typeof lib_emails;
  "lib/embeddingVisibility": typeof lib_embeddingVisibility;
  "lib/embeddings": typeof lib_embeddings;
  "lib/githubAccount": typeof lib_githubAccount;
  "lib/githubActionsOidc": typeof lib_githubActionsOidc;
  "lib/githubAuth": typeof lib_githubAuth;
  "lib/githubIdentity": typeof lib_githubIdentity;
  "lib/githubImport": typeof lib_githubImport;
  "lib/githubProfileSync": typeof lib_githubProfileSync;
  "lib/githubSkillScans": typeof lib_githubSkillScans;
  "lib/githubSkillSync": typeof lib_githubSkillSync;
  "lib/globalStats": typeof lib_globalStats;
  "lib/httpHeaders": typeof lib_httpHeaders;
  "lib/httpRateLimit": typeof lib_httpRateLimit;
  "lib/httpUtils": typeof lib_httpUtils;
  "lib/installResolver": typeof lib_installResolver;
  "lib/leaderboards": typeof lib_leaderboards;
  "lib/manualOverrides": typeof lib_manualOverrides;
  "lib/moderation": typeof lib_moderation;
  "lib/moderationEngine": typeof lib_moderationEngine;
  "lib/moderationReasonCodes": typeof lib_moderationReasonCodes;
  "lib/observabilityEvents": typeof lib_observabilityEvents;
  "lib/officialPublishers": typeof lib_officialPublishers;
  "lib/openaiResponse": typeof lib_openaiResponse;
  "lib/packageArtifacts": typeof lib_packageArtifacts;
  "lib/packageRegistry": typeof lib_packageRegistry;
  "lib/packageSearchDigest": typeof lib_packageSearchDigest;
  "lib/packageSecurity": typeof lib_packageSecurity;
  "lib/public": typeof lib_public;
  "lib/publicRouteReservations": typeof lib_publicRouteReservations;
  "lib/publishLimits": typeof lib_publishLimits;
  "lib/publisherAbuseScoring": typeof lib_publisherAbuseScoring;
  "lib/publisherCatalogDisplay": typeof lib_publisherCatalogDisplay;
  "lib/publisherStats": typeof lib_publisherStats;
  "lib/publishers": typeof lib_publishers;
  "lib/recommendationScore": typeof lib_recommendationScore;
  "lib/registryArtifactBackup": typeof lib_registryArtifactBackup;
  "lib/reporting": typeof lib_reporting;
  "lib/reservedHandles": typeof lib_reservedHandles;
  "lib/reservedSlugs": typeof lib_reservedSlugs;
  "lib/searchText": typeof lib_searchText;
  "lib/securityPrompt": typeof lib_securityPrompt;
  "lib/skillBackfill": typeof lib_skillBackfill;
  "lib/skillCapabilityTags": typeof lib_skillCapabilityTags;
  "lib/skillCards": typeof lib_skillCards;
  "lib/skillFileAccess": typeof lib_skillFileAccess;
  "lib/skillIcon": typeof lib_skillIcon;
  "lib/skillPublish": typeof lib_skillPublish;
  "lib/skillQuality": typeof lib_skillQuality;
  "lib/skillSafety": typeof lib_skillSafety;
  "lib/skillScanRequestFiles": typeof lib_skillScanRequestFiles;
  "lib/skillSearchDigest": typeof lib_skillSearchDigest;
  "lib/skillSlugValidator": typeof lib_skillSlugValidator;
  "lib/skillStats": typeof lib_skillStats;
  "lib/skillSummary": typeof lib_skillSummary;
  "lib/skillZip": typeof lib_skillZip;
  "lib/skills": typeof lib_skills;
  "lib/staticPublishScan": typeof lib_staticPublishScan;
  "lib/tokens": typeof lib_tokens;
  "lib/userSearch": typeof lib_userSearch;
  "lib/userSkillStats": typeof lib_userSkillStats;
  "lib/webhooks": typeof lib_webhooks;
  llmEval: typeof llmEval;
  maintenance: typeof maintenance;
  managementDevSeed: typeof managementDevSeed;
  packageInspectorHttp: typeof packageInspectorHttp;
  packageInspectorNode: typeof packageInspectorNode;
  packagePublishTokens: typeof packagePublishTokens;
  packages: typeof packages;
  publisherAbuse: typeof publisherAbuse;
  publisherAbuseDevSeed: typeof publisherAbuseDevSeed;
  publishers: typeof publishers;
  rateLimits: typeof rateLimits;
  registryArtifactBackups: typeof registryArtifactBackups;
  registryArtifactBackupsNode: typeof registryArtifactBackupsNode;
  registryArtifactRestore: typeof registryArtifactRestore;
  registryArtifactRestoreMutations: typeof registryArtifactRestoreMutations;
  search: typeof search;
  securityDataset: typeof securityDataset;
  securityDatasetNode: typeof securityDatasetNode;
  securityScan: typeof securityScan;
  skillCards: typeof skillCards;
  skillStatEvents: typeof skillStatEvents;
  skillTransfers: typeof skillTransfers;
  skills: typeof skills;
  stars: typeof stars;
  statsMaintenance: typeof statsMaintenance;
  telemetry: typeof telemetry;
  tokens: typeof tokens;
  uploads: typeof uploads;
  users: typeof users;
  vt: typeof vt;
  webhooks: typeof webhooks;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
