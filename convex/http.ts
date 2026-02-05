import { ApiRoutes, LegacyApiRoutes } from 'clawhub-schema'
import { httpRouter } from 'convex/server'
import { auth } from './auth'
import { downloadZip } from './downloads'
import {
  cliPublishHttp,
  cliSkillDeleteHttp,
  cliSkillUndeleteHttp,
  cliTelemetrySyncHttp,
  cliUploadUrlHttp,
  cliWhoamiHttp,
  getSkillHttp,
  resolveSkillVersionHttp,
  searchSkillsHttp,
} from './httpApi'
import {
  listSkillsV1Http,
  listSoulsV1Http,
  publishSkillV1Http,
  publishSoulV1Http,
  resolveSkillVersionV1Http,
  searchSkillsV1Http,
  skillsDeleteRouterV1Http,
  skillsGetRouterV1Http,
  skillsPostRouterV1Http,
  soulsDeleteRouterV1Http,
  soulsGetRouterV1Http,
  soulsPostRouterV1Http,
  starsDeleteRouterV1Http,
  starsPostRouterV1Http,
  usersListV1Http,
  usersPostRouterV1Http,
  whoamiV1Http,
  preflightHandler,
} from './httpApiV1'

const http = httpRouter()

auth.addHttpRoutes(http)

http.route({
  path: ApiRoutes.download,
  method: 'GET',
  handler: downloadZip,
})

http.route({
  path: ApiRoutes.search,
  method: 'GET',
  handler: searchSkillsV1Http,
})

http.route({
  path: ApiRoutes.resolve,
  method: 'GET',
  handler: resolveSkillVersionV1Http,
})

http.route({
  path: ApiRoutes.skills,
  method: 'GET',
  handler: listSkillsV1Http,
})

http.route({
  pathPrefix: `${ApiRoutes.skills}/`,
  method: 'GET',
  handler: skillsGetRouterV1Http,
})

http.route({
  path: ApiRoutes.skills,
  method: 'POST',
  handler: publishSkillV1Http,
})

http.route({
  pathPrefix: `${ApiRoutes.skills}/`,
  method: 'POST',
  handler: skillsPostRouterV1Http,
})

http.route({
  pathPrefix: `${ApiRoutes.skills}/`,
  method: 'DELETE',
  handler: skillsDeleteRouterV1Http,
})

http.route({
  pathPrefix: `${ApiRoutes.stars}/`,
  method: 'POST',
  handler: starsPostRouterV1Http,
})

http.route({
  pathPrefix: `${ApiRoutes.stars}/`,
  method: 'DELETE',
  handler: starsDeleteRouterV1Http,
})

http.route({
  path: ApiRoutes.whoami,
  method: 'GET',
  handler: whoamiV1Http,
})

http.route({
  pathPrefix: `${ApiRoutes.users}/`,
  method: 'POST',
  handler: usersPostRouterV1Http,
})

http.route({
  path: ApiRoutes.users,
  method: 'GET',
  handler: usersListV1Http,
})

http.route({
  path: ApiRoutes.souls,
  method: 'GET',
  handler: listSoulsV1Http,
})

http.route({
  pathPrefix: `${ApiRoutes.souls}/`,
  method: 'GET',
  handler: soulsGetRouterV1Http,
})

http.route({
  path: ApiRoutes.souls,
  method: 'POST',
  handler: publishSoulV1Http,
})

http.route({
  pathPrefix: `${ApiRoutes.souls}/`,
  method: 'POST',
  handler: soulsPostRouterV1Http,
})

http.route({
  pathPrefix: `${ApiRoutes.souls}/`,
  method: 'DELETE',
  handler: soulsDeleteRouterV1Http,
})

http.route({
  pathPrefix: '/api/',
  method: 'OPTIONS',
  handler: preflightHandler,
})

// TODO: remove legacy /api routes after deprecation window.
http.route({
  path: LegacyApiRoutes.download,
  method: 'GET',
  handler: downloadZip,
})
http.route({
  path: LegacyApiRoutes.search,
  method: 'GET',
  handler: searchSkillsHttp,
})

http.route({
  path: LegacyApiRoutes.skill,
  method: 'GET',
  handler: getSkillHttp,
})

http.route({
  path: LegacyApiRoutes.skillResolve,
  method: 'GET',
  handler: resolveSkillVersionHttp,
})

http.route({
  path: LegacyApiRoutes.cliWhoami,
  method: 'GET',
  handler: cliWhoamiHttp,
})

http.route({
  path: LegacyApiRoutes.cliUploadUrl,
  method: 'POST',
  handler: cliUploadUrlHttp,
})

http.route({
  path: LegacyApiRoutes.cliPublish,
  method: 'POST',
  handler: cliPublishHttp,
})

http.route({
  path: LegacyApiRoutes.cliTelemetrySync,
  method: 'POST',
  handler: cliTelemetrySyncHttp,
})

http.route({
  path: LegacyApiRoutes.cliSkillDelete,
  method: 'POST',
  handler: cliSkillDeleteHttp,
})

http.route({
  path: LegacyApiRoutes.cliSkillUndelete,
  method: 'POST',
  handler: cliSkillUndeleteHttp,
})

export default http
