import { useState } from 'react'
import { LICENSE_PRESETS, type SkillLicense } from 'clawhub-schema'

type LicenseSelectorProps = {
  value: SkillLicense | undefined
  onChange: (license: SkillLicense | undefined) => void
  frontmatterLicense?: SkillLicense | undefined
}

const LICENSE_GROUPS = [
  {
    label: 'Permissive',
    options: [
      { value: 'MIT', label: 'MIT', hint: '' },
      { value: 'Apache-2.0', label: 'Apache 2.0', hint: '' },
      { value: 'BSD-3-Clause', label: 'BSD 3-Clause', hint: '' },
      { value: 'ISC', label: 'ISC', hint: '' },
    ],
  },
  {
    label: 'Copyleft',
    options: [
      { value: 'GPL-3.0-only', label: 'GPL 3.0', hint: '' },
      { value: 'AGPL-3.0-only', label: 'AGPL 3.0', hint: 'network copyleft' },
      { value: 'MPL-2.0', label: 'MPL 2.0', hint: 'file-level copyleft' },
    ],
  },
  {
    label: 'Creative Commons',
    options: [
      { value: 'CC-BY-4.0', label: 'CC BY 4.0', hint: 'attribution' },
      { value: 'CC-BY-SA-4.0', label: 'CC BY-SA 4.0', hint: 'attribution + share-alike' },
      { value: 'CC-BY-NC-4.0', label: 'CC BY-NC 4.0', hint: 'non-commercial' },
      { value: 'CC-BY-NC-SA-4.0', label: 'CC BY-NC-SA 4.0', hint: 'non-commercial + share-alike' },
      { value: 'CC0-1.0', label: 'CC0 1.0', hint: 'public domain' },
    ],
  },
  {
    label: 'Other',
    options: [
      { value: 'Unlicense', label: 'Unlicense', hint: 'public domain' },
      { value: 'proprietary', label: 'Proprietary', hint: 'all rights reserved' },
      { value: '__custom__', label: 'Custom...', hint: '' },
    ],
  },
] as const

const MAX_SPDX_LENGTH = 64
const MAX_URI_LENGTH = 2048

export function LicenseSelector({ value, onChange, frontmatterLicense }: LicenseSelectorProps) {
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [customSpdx, setCustomSpdx] = useState('')
  const [transferable, setTransferable] = useState(true)
  const [commercialUse, setCommercialUse] = useState(true)
  const [commercialAttribution, setCommercialAttribution] = useState(true)
  const [derivativesAllowed, setDerivativesAllowed] = useState(true)
  const [derivativesAttribution, setDerivativesAttribution] = useState(true)
  const [derivativesApproval, setDerivativesApproval] = useState(false)
  const [derivativesReciprocal, setDerivativesReciprocal] = useState(false)
  const [licenseUri, setLicenseUri] = useState('')

  const selectedSpdx = value?.spdx ?? ''
  const isStandardLicense = selectedSpdx && selectedSpdx !== '__custom__' && LICENSE_PRESETS[selectedSpdx]
  const preset = selectedSpdx ? LICENSE_PRESETS[selectedSpdx] : undefined
  const showConflict = frontmatterLicense && value && frontmatterLicense.spdx !== value.spdx

  function handleSelectChange(spdxValue: string) {
    if (spdxValue === '') {
      onChange(undefined)
      setShowAdvanced(false)
      return
    }

    if (spdxValue === '__custom__') {
      setShowAdvanced(true)
      setCustomSpdx('')
      setTransferable(true)
      setCommercialUse(true)
      setCommercialAttribution(true)
      setDerivativesAllowed(true)
      setDerivativesAttribution(true)
      setDerivativesApproval(false)
      setDerivativesReciprocal(false)
      setLicenseUri('')
      onChange(undefined)
      return
    }

    setShowAdvanced(false)
    onChange({ spdx: spdxValue })
  }

  function handleAdvancedToggle() {
    if (showAdvanced) {
      setShowAdvanced(false)
    } else {
      if (preset) {
        setCustomSpdx(selectedSpdx)
        setTransferable(preset.transferable)
        setCommercialUse(preset.commercialUse)
        setCommercialAttribution(preset.commercialAttribution)
        setDerivativesAllowed(preset.derivativesAllowed)
        setDerivativesAttribution(preset.derivativesAttribution)
        setDerivativesApproval(preset.derivativesApproval)
        setDerivativesReciprocal(preset.derivativesReciprocal)
        setLicenseUri('')
      }
      setShowAdvanced(true)
    }
  }

  function updateAdvancedLicense(updates: Partial<{
    spdx: string
    transferable: boolean
    commercialUse: boolean
    commercialAttribution: boolean
    derivativesAllowed: boolean
    derivativesAttribution: boolean
    derivativesApproval: boolean
    derivativesReciprocal: boolean
    uri: string
  }>) {
    const spdx = updates.spdx ?? customSpdx
    const xfer = updates.transferable ?? transferable
    const commUse = updates.commercialUse ?? commercialUse
    const commAttr = updates.commercialAttribution ?? commercialAttribution
    const derivAllowed = updates.derivativesAllowed ?? derivativesAllowed
    const derivAttr = updates.derivativesAttribution ?? derivativesAttribution
    const derivApproval = updates.derivativesApproval ?? derivativesApproval
    const derivReciprocal = updates.derivativesReciprocal ?? derivativesReciprocal
    const uri = updates.uri ?? licenseUri

    if (updates.spdx !== undefined) setCustomSpdx(updates.spdx)
    if (updates.transferable !== undefined) setTransferable(updates.transferable)
    if (updates.commercialUse !== undefined) setCommercialUse(updates.commercialUse)
    if (updates.commercialAttribution !== undefined) setCommercialAttribution(updates.commercialAttribution)
    if (updates.derivativesAllowed !== undefined) setDerivativesAllowed(updates.derivativesAllowed)
    if (updates.derivativesAttribution !== undefined) setDerivativesAttribution(updates.derivativesAttribution)
    if (updates.derivativesApproval !== undefined) setDerivativesApproval(updates.derivativesApproval)
    if (updates.derivativesReciprocal !== undefined) setDerivativesReciprocal(updates.derivativesReciprocal)
    if (updates.uri !== undefined) setLicenseUri(updates.uri)

    const trimmedSpdx = spdx.trim()
    if (!trimmedSpdx || trimmedSpdx.length > MAX_SPDX_LENGTH) {
      onChange(undefined)
      return
    }

    const license: SkillLicense = {
      spdx: trimmedSpdx,
      transferable: xfer,
      commercialUse: commUse,
      commercialAttribution: commAttr,
      derivativesAllowed: derivAllowed,
      derivativesAttribution: derivAttr,
      derivativesApproval: derivApproval,
      derivativesReciprocal: derivReciprocal,
    }
    const trimmedUri = uri.trim()
    if (trimmedUri && trimmedUri.startsWith('https://') && trimmedUri.length <= MAX_URI_LENGTH) {
      license.uri = trimmedUri
    }
    onChange(license)
  }

  const selectValue = showAdvanced ? '__custom__' : (selectedSpdx || '')

  return (
    <div>
      <label className="form-label" htmlFor="license">
        License
      </label>
      <select
        className="form-input"
        id="license"
        value={selectValue}
        onChange={(e) => handleSelectChange(e.target.value)}
      >
        <option value="">No license declaration</option>
        {LICENSE_GROUPS.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}{opt.hint ? ` (${opt.hint})` : ''}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {preset && !showAdvanced ? (
        <div className="stat" style={{ marginTop: 4 }}>
          {preset.summary}
        </div>
      ) : null}

      {isStandardLicense ? (
        <button
          className="btn btn-ghost"
          type="button"
          onClick={handleAdvancedToggle}
          style={{ marginTop: 4, fontSize: '0.82rem' }}
        >
          {showAdvanced ? 'Hide advanced terms' : 'Advanced terms'}
        </button>
      ) : null}

      {showConflict ? (
        <div className="stat" role="status" style={{ marginTop: 4 }}>
          Your SKILL.md declares license: {frontmatterLicense.spdx}. The form selection will
          override it.
        </div>
      ) : null}

      {showAdvanced ? (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>
            <label className="form-label" htmlFor="license-spdx">
              SPDX Identifier
            </label>
            <input
              className="form-input"
              id="license-spdx"
              type="text"
              maxLength={MAX_SPDX_LENGTH}
              value={customSpdx}
              onChange={(e) => updateAdvancedLicense({ spdx: e.target.value })}
              placeholder="e.g. MIT, Apache-2.0, or custom identifier"
            />
          </div>

          <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
            <legend className="form-label">Transfer & Commercial</legend>
            <label style={{ display: 'block', marginBottom: 2 }}>
              <input
                type="checkbox"
                checked={transferable}
                onChange={(e) => updateAdvancedLicense({ transferable: e.target.checked })}
              />{' '}
              Transferable
            </label>
            <label style={{ display: 'block', marginBottom: 2 }}>
              <input
                type="checkbox"
                checked={commercialUse}
                onChange={(e) => updateAdvancedLicense({ commercialUse: e.target.checked })}
              />{' '}
              Commercial use permitted
            </label>
            <label style={{ display: 'block', marginBottom: 2, opacity: commercialUse ? 1 : 0.5 }}>
              <input
                type="checkbox"
                checked={commercialAttribution}
                disabled={!commercialUse}
                onChange={(e) => updateAdvancedLicense({ commercialAttribution: e.target.checked })}
              />{' '}
              Commercial attribution required
            </label>
          </fieldset>

          <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
            <legend className="form-label">Derivatives</legend>
            <label style={{ display: 'block', marginBottom: 2 }}>
              <input
                type="checkbox"
                checked={derivativesAllowed}
                onChange={(e) => updateAdvancedLicense({ derivativesAllowed: e.target.checked })}
              />{' '}
              Derivatives allowed
            </label>
            <label style={{ display: 'block', marginBottom: 2, opacity: derivativesAllowed ? 1 : 0.5 }}>
              <input
                type="checkbox"
                checked={derivativesAttribution}
                disabled={!derivativesAllowed}
                onChange={(e) => updateAdvancedLicense({ derivativesAttribution: e.target.checked })}
              />{' '}
              Derivatives attribution required
            </label>
            <label style={{ display: 'block', marginBottom: 2, opacity: derivativesAllowed ? 1 : 0.5 }}>
              <input
                type="checkbox"
                checked={derivativesApproval}
                disabled={!derivativesAllowed}
                onChange={(e) => updateAdvancedLicense({ derivativesApproval: e.target.checked })}
              />{' '}
              Derivatives require approval
            </label>
            <label style={{ display: 'block', marginBottom: 2, opacity: derivativesAllowed ? 1 : 0.5 }}>
              <input
                type="checkbox"
                checked={derivativesReciprocal}
                disabled={!derivativesAllowed}
                onChange={(e) => updateAdvancedLicense({ derivativesReciprocal: e.target.checked })}
              />{' '}
              Derivatives must use same license (copyleft)
            </label>
          </fieldset>

          <div>
            <label className="form-label" htmlFor="license-uri">
              License URI
            </label>
            <input
              className="form-input"
              id="license-uri"
              type="url"
              maxLength={MAX_URI_LENGTH}
              value={licenseUri}
              onChange={(e) => updateAdvancedLicense({ uri: e.target.value })}
              placeholder="https://example.com/LICENSE"
            />
            {licenseUri && !licenseUri.trim().startsWith('https://') ? (
              <div className="stat" style={{ marginTop: 2, color: 'var(--error, #c0392b)' }}>
                URI must start with https://
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
