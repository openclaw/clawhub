import type { Doc } from '../_generated/dataModel'

function isScannerSuspiciousReason(reason: string | undefined) {
  if (!reason) return false
  return reason.startsWith('scanner.') && reason.endsWith('.suspicious')
}

export function isSkillSuspicious(
  skill: Pick<Doc<'skills'>, 'moderationFlags' | 'moderationReason'>,
) {
  if (skill.moderationFlags?.includes('flagged.suspicious')) return true
  return isScannerSuspiciousReason(skill.moderationReason)
}
