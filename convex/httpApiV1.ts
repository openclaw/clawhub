import { httpAction } from './_generated/server'

import {
  listSkillsV1Handler,
  publishSkillV1Handler,
  resolveSkillVersionV1Handler,
  searchSkillsV1Handler,
  skillsDeleteRouterV1Handler,
  skillsGetRouterV1Handler,
  skillsPostRouterV1Handler,
} from './httpApiV1/skillsV1'
import {
  listSoulsV1Handler,
  publishSoulV1Handler,
  soulsDeleteRouterV1Handler,
  soulsGetRouterV1Handler,
  soulsPostRouterV1Handler,
} from './httpApiV1/soulsV1'
import { starsDeleteRouterV1Handler, starsPostRouterV1Handler } from './httpApiV1/starsV1'
import { usersListV1Handler, usersPostRouterV1Handler } from './httpApiV1/usersV1'
import { whoamiV1Handler } from './httpApiV1/whoamiV1'

export const searchSkillsV1Http = httpAction(searchSkillsV1Handler)
export const resolveSkillVersionV1Http = httpAction(resolveSkillVersionV1Handler)
export const listSkillsV1Http = httpAction(listSkillsV1Handler)
export const skillsGetRouterV1Http = httpAction(skillsGetRouterV1Handler)
export const publishSkillV1Http = httpAction(publishSkillV1Handler)
export const skillsPostRouterV1Http = httpAction(skillsPostRouterV1Handler)
export const skillsDeleteRouterV1Http = httpAction(skillsDeleteRouterV1Handler)

export const listSoulsV1Http = httpAction(listSoulsV1Handler)
export const soulsGetRouterV1Http = httpAction(soulsGetRouterV1Handler)
export const publishSoulV1Http = httpAction(publishSoulV1Handler)
export const soulsPostRouterV1Http = httpAction(soulsPostRouterV1Handler)
export const soulsDeleteRouterV1Http = httpAction(soulsDeleteRouterV1Handler)

export const starsPostRouterV1Http = httpAction(starsPostRouterV1Handler)
export const starsDeleteRouterV1Http = httpAction(starsDeleteRouterV1Handler)

export const whoamiV1Http = httpAction(whoamiV1Handler)
export const usersPostRouterV1Http = httpAction(usersPostRouterV1Handler)
export const usersListV1Http = httpAction(usersListV1Handler)

export const __handlers = {
  searchSkillsV1Handler,
  resolveSkillVersionV1Handler,
  listSkillsV1Handler,
  skillsGetRouterV1Handler,
  publishSkillV1Handler,
  skillsPostRouterV1Handler,
  skillsDeleteRouterV1Handler,
  listSoulsV1Handler,
  soulsGetRouterV1Handler,
  publishSoulV1Handler,
  soulsPostRouterV1Handler,
  soulsDeleteRouterV1Handler,
  starsPostRouterV1Handler,
  starsDeleteRouterV1Handler,
  whoamiV1Handler,
  usersPostRouterV1Handler,
  usersListV1Handler,
}
