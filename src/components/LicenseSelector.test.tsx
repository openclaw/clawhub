/* @vitest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LicenseSelector } from './LicenseSelector'

describe('LicenseSelector', () => {
  it('renders with default "No license declaration"', () => {
    const onChange = vi.fn()
    render(<LicenseSelector value={undefined} onChange={onChange} />)
    const select = screen.getByLabelText('License') as HTMLSelectElement
    expect(select.value).toBe('')
  })

  it('calls onChange with spdx when MIT is selected', () => {
    const onChange = vi.fn()
    render(<LicenseSelector value={undefined} onChange={onChange} />)
    const select = screen.getByLabelText('License') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'MIT' } })
    expect(onChange).toHaveBeenCalledWith({ spdx: 'MIT' })
  })

  it('calls onChange with undefined when "No license declaration" is selected', () => {
    const onChange = vi.fn()
    render(<LicenseSelector value={{ spdx: 'MIT' }} onChange={onChange} />)
    const select = screen.getByLabelText('License') as HTMLSelectElement
    fireEvent.change(select, { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith(undefined)
  })

  it('shows summary line when standard license is selected', () => {
    const onChange = vi.fn()
    render(<LicenseSelector value={{ spdx: 'MIT' }} onChange={onChange} />)
    expect(screen.getByText(/Permits commercial use, modification, and distribution/)).toBeTruthy()
  })

  it('shows advanced panel with PIL-aligned controls when Custom is selected', () => {
    const onChange = vi.fn()
    render(<LicenseSelector value={undefined} onChange={onChange} />)
    const select = screen.getByLabelText('License') as HTMLSelectElement
    fireEvent.change(select, { target: { value: '__custom__' } })
    expect(screen.getByLabelText('SPDX Identifier')).toBeTruthy()
    expect(screen.getByLabelText('License URI')).toBeTruthy()
    expect(screen.getByText('Transferable')).toBeTruthy()
    expect(screen.getByText('Commercial use permitted')).toBeTruthy()
    expect(screen.getByText('Commercial attribution required')).toBeTruthy()
    expect(screen.getByText('Derivatives allowed')).toBeTruthy()
    expect(screen.getByText('Derivatives attribution required')).toBeTruthy()
    expect(screen.getByText('Derivatives require approval')).toBeTruthy()
    expect(screen.getByText(/Derivatives must use same license/)).toBeTruthy()
  })

  it('outputs PIL-aligned structured object from advanced panel', () => {
    const onChange = vi.fn()
    render(<LicenseSelector value={undefined} onChange={onChange} />)
    const select = screen.getByLabelText('License') as HTMLSelectElement
    fireEvent.change(select, { target: { value: '__custom__' } })

    const spdxInput = screen.getByLabelText('SPDX Identifier') as HTMLInputElement
    fireEvent.change(spdxInput, { target: { value: 'My-License' } })

    const lastCall = onChange.mock.calls.at(-1)?.[0]
    expect(lastCall?.spdx).toBe('My-License')
    expect(lastCall).toHaveProperty('commercialUse')
    expect(lastCall).toHaveProperty('derivativesAllowed')
    expect(lastCall).toHaveProperty('transferable')
    expect(lastCall).not.toHaveProperty('commercial')
    expect(lastCall).not.toHaveProperty('attribution')
    expect(lastCall).not.toHaveProperty('derivatives')
  })

  it('shows frontmatter conflict note when licenses differ', () => {
    const onChange = vi.fn()
    render(
      <LicenseSelector
        value={{ spdx: 'MIT' }}
        onChange={onChange}
        frontmatterLicense={{ spdx: 'Apache-2.0' }}
      />,
    )
    expect(screen.getByText(/Your SKILL.md declares license: Apache-2.0/)).toBeTruthy()
  })

  it('does not show conflict note when licenses match', () => {
    const onChange = vi.fn()
    render(
      <LicenseSelector
        value={{ spdx: 'MIT' }}
        onChange={onChange}
        frontmatterLicense={{ spdx: 'MIT' }}
      />,
    )
    expect(screen.queryByText(/Your SKILL.md declares license/)).toBeNull()
  })

  it('shows URI validation warning for non-https URIs', () => {
    const onChange = vi.fn()
    render(<LicenseSelector value={undefined} onChange={onChange} />)
    const select = screen.getByLabelText('License') as HTMLSelectElement
    fireEvent.change(select, { target: { value: '__custom__' } })

    const spdxInput = screen.getByLabelText('SPDX Identifier') as HTMLInputElement
    fireEvent.change(spdxInput, { target: { value: 'MIT' } })

    const uriInput = screen.getByLabelText('License URI') as HTMLInputElement
    fireEvent.change(uriInput, { target: { value: 'http://example.com' } })

    expect(screen.getByText('URI must start with https://')).toBeTruthy()
  })

  it('disables derivative sub-options when derivativesAllowed is unchecked', () => {
    const onChange = vi.fn()
    render(<LicenseSelector value={undefined} onChange={onChange} />)
    const select = screen.getByLabelText('License') as HTMLSelectElement
    fireEvent.change(select, { target: { value: '__custom__' } })

    // Fill in SPDX so the form is active
    const spdxInput = screen.getByLabelText('SPDX Identifier') as HTMLInputElement
    fireEvent.change(spdxInput, { target: { value: 'Test' } })

    // Uncheck derivativesAllowed
    const derivCheckbox = screen.getByLabelText('Derivatives allowed') as HTMLInputElement
    fireEvent.click(derivCheckbox)

    // Sub-options should be disabled
    expect((screen.getByLabelText('Derivatives attribution required') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText('Derivatives require approval') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText(/Derivatives must use same license/) as HTMLInputElement).disabled).toBe(true)
  })
})
