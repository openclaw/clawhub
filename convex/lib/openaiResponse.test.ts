import { describe, expect, it } from 'vitest'
import { extractResponseText } from './openaiResponse'

describe('extractResponseText', () => {
  it('returns null for invalid payload shapes', () => {
    expect(extractResponseText(null)).toBeNull()
    expect(extractResponseText({})).toBeNull()
    expect(extractResponseText({ output: {} })).toBeNull()
  })

  it('extracts output_text chunks from message content', () => {
    const payload = {
      output: [
        { type: 'reasoning', content: [] },
        {
          type: 'message',
          content: [
            { type: 'output_text', text: 'First line' },
            { type: 'output_text', text: 'Second line' },
          ],
        },
      ],
    }

    expect(extractResponseText(payload)).toBe('First line\nSecond line')
  })

  it('ignores blank and non-output_text parts', () => {
    const payload = {
      output: [
        {
          type: 'message',
          content: [
            { type: 'input_text', text: 'ignored' },
            { type: 'output_text', text: '   ' },
            { type: 'output_text', text: 'kept' },
          ],
        },
      ],
    }

    expect(extractResponseText(payload)).toBe('kept')
  })
})
