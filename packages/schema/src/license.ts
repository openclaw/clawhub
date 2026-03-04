export type SkillLicense = {
  spdx: string
  transferable?: boolean
  commercialUse?: boolean
  commercialAttribution?: boolean
  derivativesAllowed?: boolean
  derivativesAttribution?: boolean
  derivativesApproval?: boolean
  derivativesReciprocal?: boolean
  uri?: string
}

export const KNOWN_SPDX_IDENTIFIERS = new Set([
  'MIT',
  'Apache-2.0',
  'GPL-2.0-only',
  'GPL-3.0-only',
  'LGPL-2.1-only',
  'LGPL-3.0-only',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'MPL-2.0',
  'AGPL-3.0-only',
  'Unlicense',
  'CC-BY-4.0',
  'CC-BY-SA-4.0',
  'CC-BY-NC-4.0',
  'CC-BY-NC-SA-4.0',
  'CC0-1.0',
  'proprietary',
])

export function isKnownSpdx(spdx: string): boolean {
  return KNOWN_SPDX_IDENTIFIERS.has(spdx)
}

export type LicensePreset = {
  transferable: boolean
  commercialUse: boolean
  commercialAttribution: boolean
  derivativesAllowed: boolean
  derivativesAttribution: boolean
  derivativesApproval: boolean
  derivativesReciprocal: boolean
  summary: string
}

export const LICENSE_PRESETS: Record<string, LicensePreset> = {
  'MIT': { transferable: true, commercialUse: true, commercialAttribution: true, derivativesAllowed: true, derivativesAttribution: true, derivativesApproval: false, derivativesReciprocal: false, summary: 'Permits commercial use, modification, and distribution with attribution.' },
  'Apache-2.0': { transferable: true, commercialUse: true, commercialAttribution: true, derivativesAllowed: true, derivativesAttribution: true, derivativesApproval: false, derivativesReciprocal: false, summary: 'Permits commercial use, modification, and distribution with attribution. Includes patent grant.' },
  'BSD-3-Clause': { transferable: true, commercialUse: true, commercialAttribution: true, derivativesAllowed: true, derivativesAttribution: true, derivativesApproval: false, derivativesReciprocal: false, summary: 'Permits commercial use, modification, and distribution with attribution.' },
  'ISC': { transferable: true, commercialUse: true, commercialAttribution: true, derivativesAllowed: true, derivativesAttribution: true, derivativesApproval: false, derivativesReciprocal: false, summary: 'Permits commercial use, modification, and distribution with attribution.' },
  'GPL-2.0-only': { transferable: true, commercialUse: true, commercialAttribution: true, derivativesAllowed: true, derivativesAttribution: true, derivativesApproval: false, derivativesReciprocal: true, summary: 'Permits commercial use. Derivatives must use the same license.' },
  'GPL-3.0-only': { transferable: true, commercialUse: true, commercialAttribution: true, derivativesAllowed: true, derivativesAttribution: true, derivativesApproval: false, derivativesReciprocal: true, summary: 'Permits commercial use. Derivatives must use the same license.' },
  'LGPL-2.1-only': { transferable: true, commercialUse: true, commercialAttribution: true, derivativesAllowed: true, derivativesAttribution: true, derivativesApproval: false, derivativesReciprocal: true, summary: 'Permits commercial use and linking. Modifications must use the same license.' },
  'LGPL-3.0-only': { transferable: true, commercialUse: true, commercialAttribution: true, derivativesAllowed: true, derivativesAttribution: true, derivativesApproval: false, derivativesReciprocal: true, summary: 'Permits commercial use and linking. Modifications must use the same license.' },
  'AGPL-3.0-only': { transferable: true, commercialUse: true, commercialAttribution: true, derivativesAllowed: true, derivativesAttribution: true, derivativesApproval: false, derivativesReciprocal: true, summary: 'Permits commercial use. Network use triggers copyleft. Derivatives must use the same license.' },
  'MPL-2.0': { transferable: true, commercialUse: true, commercialAttribution: true, derivativesAllowed: true, derivativesAttribution: true, derivativesApproval: false, derivativesReciprocal: true, summary: 'Permits commercial use. Modified files must use the same license.' },
  'BSD-2-Clause': { transferable: true, commercialUse: true, commercialAttribution: true, derivativesAllowed: true, derivativesAttribution: true, derivativesApproval: false, derivativesReciprocal: false, summary: 'Permits commercial use, modification, and distribution with attribution.' },
  'CC-BY-4.0': { transferable: true, commercialUse: true, commercialAttribution: true, derivativesAllowed: true, derivativesAttribution: true, derivativesApproval: false, derivativesReciprocal: false, summary: 'Permits commercial use and derivatives with attribution.' },
  'CC-BY-SA-4.0': { transferable: true, commercialUse: true, commercialAttribution: true, derivativesAllowed: true, derivativesAttribution: true, derivativesApproval: false, derivativesReciprocal: true, summary: 'Permits commercial use with attribution. Derivatives must use the same license.' },
  'CC-BY-NC-4.0': { transferable: true, commercialUse: false, commercialAttribution: true, derivativesAllowed: true, derivativesAttribution: true, derivativesApproval: false, derivativesReciprocal: false, summary: 'Non-commercial use only. Derivatives allowed with attribution.' },
  'CC-BY-NC-SA-4.0': { transferable: true, commercialUse: false, commercialAttribution: true, derivativesAllowed: true, derivativesAttribution: true, derivativesApproval: false, derivativesReciprocal: true, summary: 'Non-commercial use only. Derivatives must use the same license.' },
  'CC0-1.0': { transferable: true, commercialUse: true, commercialAttribution: false, derivativesAllowed: true, derivativesAttribution: false, derivativesApproval: false, derivativesReciprocal: false, summary: 'Public domain dedication. No restrictions.' },
  'Unlicense': { transferable: true, commercialUse: true, commercialAttribution: false, derivativesAllowed: true, derivativesAttribution: false, derivativesApproval: false, derivativesReciprocal: false, summary: 'Public domain dedication. No restrictions.' },
  'proprietary': { transferable: false, commercialUse: false, commercialAttribution: false, derivativesAllowed: false, derivativesAttribution: false, derivativesApproval: false, derivativesReciprocal: false, summary: 'All rights reserved. No commercial use, modification, or distribution.' },
}
