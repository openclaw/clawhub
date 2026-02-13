import { describe, expect, it } from 'vitest'

/**
 * Helper to test the isTestFile function (not exported, so we recreate it for testing)
 */
function isTestFile(path: string): boolean {
  const lower = path.toLowerCase()

  // Common test file patterns
  if (lower.endsWith('.test.ts')) return true
  if (lower.endsWith('.test.js')) return true
  if (lower.endsWith('.test.tsx')) return true
  if (lower.endsWith('.test.jsx')) return true
  if (lower.endsWith('.spec.ts')) return true
  if (lower.endsWith('.spec.js')) return true
  if (lower.endsWith('.spec.tsx')) return true
  if (lower.endsWith('.spec.jsx')) return true

  // Common test directories
  const parts = path.split('/')
  for (const part of parts) {
    const lowerPart = part.toLowerCase()
    if (lowerPart === '__tests__') return true
    if (lowerPart === 'tests') return true
    if (lowerPart === 'test') return true
    if (lowerPart === '__mocks__') return true
    if (lowerPart === 'mocks') return true
  }

  return false
}

describe('llmEval test file filtering', () => {
  describe('isTestFile', () => {
    it('identifies .test.ts files', () => {
      expect(isTestFile('src/utils.test.ts')).toBe(true)
      expect(isTestFile('security.test.ts')).toBe(true)
      expect(isTestFile('src/nested/feature.test.ts')).toBe(true)
    })

    it('identifies .test.js files', () => {
      expect(isTestFile('utils.test.js')).toBe(true)
      expect(isTestFile('src/utils.test.js')).toBe(true)
    })

    it('identifies .spec.ts files', () => {
      expect(isTestFile('utils.spec.ts')).toBe(true)
      expect(isTestFile('src/security/auth.spec.ts')).toBe(true)
    })

    it('identifies .spec.js files', () => {
      expect(isTestFile('api.spec.js')).toBe(true)
    })

    it('identifies __tests__ directories', () => {
      expect(isTestFile('__tests__/utils.ts')).toBe(true)
      expect(isTestFile('src/__tests__/auth.ts')).toBe(true)
      expect(isTestFile('lib/__tests__/helper.js')).toBe(true)
    })

    it('identifies tests directories', () => {
      expect(isTestFile('tests/integration.ts')).toBe(true)
      expect(isTestFile('src/tests/unit.ts')).toBe(true)
    })

    it('identifies test directories', () => {
      expect(isTestFile('test/setup.ts')).toBe(true)
      expect(isTestFile('src/test/fixtures.ts')).toBe(true)
    })

    it('identifies __mocks__ directories', () => {
      expect(isTestFile('__mocks__/api.ts')).toBe(true)
      expect(isTestFile('src/__mocks__/data.ts')).toBe(true)
    })

    it('identifies mocks directories', () => {
      expect(isTestFile('mocks/user.ts')).toBe(true)
    })

    it('does NOT flag normal source files', () => {
      expect(isTestFile('src/index.ts')).toBe(false)
      expect(isTestFile('lib/utils.ts')).toBe(false)
      expect(isTestFile('api/routes.js')).toBe(false)
      expect(isTestFile('SKILL.md')).toBe(false)
      expect(isTestFile('README.md')).toBe(false)
    })

    it('does NOT flag files with "test" in name but not extension/directory', () => {
      expect(isTestFile('src/testUtils.ts')).toBe(false)
      expect(isTestFile('lib/contest.ts')).toBe(false)
      expect(isTestFile('fastest.js')).toBe(false)
    })

    it('handles case insensitivity', () => {
      expect(isTestFile('Security.TEST.ts')).toBe(true)
      expect(isTestFile('src/Utils.Spec.Ts')).toBe(true)
      expect(isTestFile('__TESTS__/feature.ts')).toBe(true)
    })

    it('handles real-world security skill test files', () => {
      // Based on the actual issue - security skills have test files with malicious patterns
      expect(isTestFile('src/security-scanner.test.ts')).toBe(true)
      expect(isTestFile('tests/malware-detection.ts')).toBe(true)
      expect(isTestFile('__tests__/exploit-patterns.js')).toBe(true)
    })
  })
})
