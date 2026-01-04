/* @vitest-environment node */

import { describe, expect, it } from 'vitest'
import * as schema from '.'
import { isTextContentType, TEXT_FILE_EXTENSION_SET } from './textFiles'

describe('clawdhub-schema textFiles', () => {
  it('exports text-file extension set', () => {
    expect(TEXT_FILE_EXTENSION_SET.has('md')).toBe(true)
    expect(TEXT_FILE_EXTENSION_SET.has('exe')).toBe(false)
  })

  it('detects text content types with parameters', () => {
    expect(isTextContentType('text/plain; charset=utf-8')).toBe(true)
    expect(isTextContentType('application/json; charset=utf-8')).toBe(true)
    expect(isTextContentType('application/octet-stream')).toBe(false)
  })

  it('re-exports helpers from index', () => {
    expect(typeof schema.isTextContentType).toBe('function')
    expect(schema.isTextContentType('application/markdown')).toBe(true)
  })
})
