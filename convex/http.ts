import { ApiRoutes } from 'clawdhub-schema'
import { httpRouter } from 'convex/server'
import { auth } from './auth'
import { downloadZip } from './downloads'
import {
  cliPublishHttp,
  cliUploadUrlHttp,
  cliWhoamiHttp,
  getSkillHttp,
  resolveSkillVersionHttp,
  searchSkillsHttp,
} from './httpApi'

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
  handler: searchSkillsHttp,
})

http.route({
  path: ApiRoutes.skill,
  method: 'GET',
  handler: getSkillHttp,
})

http.route({
  path: ApiRoutes.skillResolve,
  method: 'GET',
  handler: resolveSkillVersionHttp,
})

http.route({
  path: ApiRoutes.cliWhoami,
  method: 'GET',
  handler: cliWhoamiHttp,
})

http.route({
  path: ApiRoutes.cliUploadUrl,
  method: 'POST',
  handler: cliUploadUrlHttp,
})

http.route({
  path: ApiRoutes.cliPublish,
  method: 'POST',
  handler: cliPublishHttp,
})

export default http
