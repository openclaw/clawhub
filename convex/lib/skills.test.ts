import { describe, expect, it } from 'vitest'
import {
  buildEmbeddingText,
  getFrontmatterMetadata,
  getFrontmatterValue,
  hashSkillFiles,
  isKnownSpdx,
  isMacJunkPath,
  isTextFile,
  parseClawdisMetadata,
  parseFrontmatter,
  parseLicenseField,
  sanitizePath,
} from './skills'

describe('skills utils', () => {
  it('parses frontmatter', () => {
    const frontmatter = parseFrontmatter(`---\nname: demo\ndescription: Hello\n---\nBody`)
    expect(frontmatter.name).toBe('demo')
    expect(frontmatter.description).toBe('Hello')
  })

  it('handles missing or invalid frontmatter blocks', () => {
    expect(parseFrontmatter('nope')).toEqual({})
    expect(parseFrontmatter('---\nname: demo\nBody without end')).toEqual({})
  })

  it('strips quotes in frontmatter values', () => {
    const frontmatter = parseFrontmatter(`---\nname: "demo"\ndescription: 'Hello'\n---\nBody`)
    expect(frontmatter.name).toBe('demo')
    expect(frontmatter.description).toBe('Hello')
  })

  it('parses block scalars in frontmatter', () => {
    const folded = parseFrontmatter(
      `---\nname: demo\ndescription: >\n  Hello\n  world.\n\n  Next paragraph.\n---\nBody`,
    )
    expect(folded.description).toBe('Hello world.\nNext paragraph.')

    const literal = parseFrontmatter(
      `---\nname: demo\ndescription: |\n  Hello\n  world.\n---\nBody`,
    )
    expect(literal.description).toBe('Hello\nworld.')
  })

  it('keeps structured YAML values in frontmatter', () => {
    const frontmatter = parseFrontmatter(
      `---\nname: demo\ncount: 3\nnums: [1, 2]\nobj:\n  a: b\n---\nBody`,
    )
    expect(frontmatter.nums).toEqual([1, 2])
    expect(frontmatter.obj).toEqual({ a: 'b' })
    expect(frontmatter.name).toBe('demo')
    expect(frontmatter.count).toBe(3)
    expect(getFrontmatterValue(frontmatter, 'count')).toBeUndefined()
  })

  it('parses clawdis metadata', () => {
    const frontmatter = parseFrontmatter(
      `---\nmetadata: {"clawdis":{"requires":{"bins":["rg"]},"emoji":"🦞"}}\n---\nBody`,
    )
    const clawdis = parseClawdisMetadata(frontmatter)
    expect(clawdis?.emoji).toBe('🦞')
    expect(clawdis?.requires?.bins).toEqual(['rg'])
  })

  it('ignores invalid clawdis metadata', () => {
    const frontmatter = parseFrontmatter(`---\nmetadata: not-json\n---\nBody`)
    expect(parseClawdisMetadata(frontmatter)).toBeUndefined()
  })

  it('accepts metadata as YAML object (no JSON string)', () => {
    const frontmatter = parseFrontmatter(
      `---\nmetadata:\n  clawdis:\n    emoji: "🦞"\n    requires:\n      bins:\n        - rg\n---\nBody`,
    )
    expect(getFrontmatterMetadata(frontmatter)).toEqual({
      clawdis: { emoji: '🦞', requires: { bins: ['rg'] } },
    })
    const clawdis = parseClawdisMetadata(frontmatter)
    expect(clawdis?.emoji).toBe('🦞')
    expect(clawdis?.requires?.bins).toEqual(['rg'])
  })

  it('accepts clawdis as top-level YAML key', () => {
    const frontmatter = parseFrontmatter(
      `---\nclawdis:\n  emoji: "🦞"\n  requires:\n    anyBins: [rg, fd]\n---\nBody`,
    )
    const clawdis = parseClawdisMetadata(frontmatter)
    expect(clawdis?.emoji).toBe('🦞')
    expect(clawdis?.requires?.anyBins).toEqual(['rg', 'fd'])
  })

  it('accepts legacy metadata JSON string (quoted)', () => {
    const frontmatter = parseFrontmatter(
      `---\nmetadata: '{"clawdis":{"emoji":"🦞","requires":{"bins":["rg"]}}}'\n---\nBody`,
    )
    const metadata = getFrontmatterMetadata(frontmatter)
    expect(metadata).toEqual({ clawdis: { emoji: '🦞', requires: { bins: ['rg'] } } })
    const clawdis = parseClawdisMetadata(frontmatter)
    expect(clawdis?.emoji).toBe('🦞')
    expect(clawdis?.requires?.bins).toEqual(['rg'])
  })

  it('parses clawdis install specs and os', () => {
    const frontmatter = parseFrontmatter(
      `---\nmetadata: {"clawdis":{"install":[{"kind":"brew","formula":"rg"},{"kind":"nope"},{"kind":"node","package":"x"}],"os":"macos,linux","requires":{"anyBins":["rg","fd"]}}}\n---\nBody`,
    )
    const clawdis = parseClawdisMetadata(frontmatter)
    expect(clawdis?.install?.map((entry) => entry.kind)).toEqual(['brew', 'node'])
    expect(clawdis?.os).toEqual(['macos', 'linux'])
    expect(clawdis?.requires?.anyBins).toEqual(['rg', 'fd'])
  })

  it('parses clawdbot metadata with nix plugin pointer', () => {
    const frontmatter = parseFrontmatter(
      `---\nmetadata: {"clawdbot":{"nix":{"plugin":"github:clawdbot/nix-steipete-tools?dir=tools/peekaboo","systems":["aarch64-darwin"]}}}\n---\nBody`,
    )
    const clawdis = parseClawdisMetadata(frontmatter)
    expect(clawdis?.nix?.plugin).toBe('github:clawdbot/nix-steipete-tools?dir=tools/peekaboo')
    expect(clawdis?.nix?.systems).toEqual(['aarch64-darwin'])
  })

  it('parses clawdbot config requirements with example', () => {
    const frontmatter = parseFrontmatter(
      `---\nmetadata: {"clawdbot":{"config":{"requiredEnv":["PADEL_AUTH_FILE"],"stateDirs":[".config/padel"],"example":"config = { env = { PADEL_AUTH_FILE = \\"/run/agenix/padel-auth\\"; }; };"}}}\n---\nBody`,
    )
    const clawdis = parseClawdisMetadata(frontmatter)
    expect(clawdis?.config?.requiredEnv).toEqual(['PADEL_AUTH_FILE'])
    expect(clawdis?.config?.stateDirs).toEqual(['.config/padel'])
    expect(clawdis?.config?.example).toBe(
      'config = { env = { PADEL_AUTH_FILE = "/run/agenix/padel-auth"; }; };',
    )
  })

  it('parses cli help output', () => {
    const frontmatter = parseFrontmatter(
      `---\nmetadata: {"clawdbot":{"cliHelp":"padel --help\\nUsage: padel [command]\\n"}}\n---\nBody`,
    )
    const clawdis = parseClawdisMetadata(frontmatter)
    expect(clawdis?.cliHelp).toBe('padel --help\nUsage: padel [command]')
  })

  it('sanitizes file paths', () => {
    expect(sanitizePath('good/file.md')).toBe('good/file.md')
    expect(sanitizePath('../bad/file.md')).toBeNull()
    expect(sanitizePath('/rooted.txt')).toBe('rooted.txt')
    expect(sanitizePath('bad\\path.txt')).toBeNull()
    expect(sanitizePath('')).toBeNull()
  })

  it('detects text files', () => {
    expect(isTextFile('SKILL.md')).toBe(true)
    expect(isTextFile('image.png')).toBe(false)
    expect(isTextFile('note.txt', 'text/plain')).toBe(true)
    expect(isTextFile('data.any', 'application/json')).toBe(true)
    expect(isTextFile('data.json')).toBe(true)
  })

  it('detects mac junk paths', () => {
    expect(isMacJunkPath('.DS_Store')).toBe(true)
    expect(isMacJunkPath('folder/.DS_Store')).toBe(true)
    expect(isMacJunkPath('folder/._config.md')).toBe(true)
    expect(isMacJunkPath('__MACOSX/._SKILL.md')).toBe(true)
    expect(isMacJunkPath('docs/SKILL.md')).toBe(false)
    expect(isMacJunkPath('notes.md')).toBe(false)
  })

  it('builds embedding text', () => {
    const frontmatter = { name: 'Demo', description: 'Hello' }
    const text = buildEmbeddingText({
      frontmatter,
      readme: 'Readme body',
      otherFiles: [{ path: 'a.txt', content: 'File text' }],
    })
    expect(text).toContain('Demo')
    expect(text).toContain('Readme body')
    expect(text).toContain('a.txt')
  })

  it('truncates embedding text by maxChars', () => {
    const text = buildEmbeddingText({
      frontmatter: {},
      readme: 'x'.repeat(50),
      otherFiles: [],
      maxChars: 10,
    })
    expect(text.length).toBe(10)
  })

  it('truncates embedding text by default max chars', () => {
    const text = buildEmbeddingText({
      frontmatter: {},
      readme: 'x'.repeat(40_000),
      otherFiles: [],
    })
    expect(text.length).toBeLessThanOrEqual(12_000)
  })

  it('hashes skill files deterministically', async () => {
    const a = await hashSkillFiles([
      { path: 'b.txt', sha256: 'b' },
      { path: 'a.txt', sha256: 'a' },
    ])
    const b = await hashSkillFiles([
      { path: 'a.txt', sha256: 'a' },
      { path: 'b.txt', sha256: 'b' },
    ])
    expect(a).toBe(b)
  })
})

describe('parseClawdisMetadata — env/deps/author/links (#350)', () => {
  it('parses envVars from clawdis block', () => {
    const frontmatter = parseFrontmatter(`---
metadata:
  clawdis:
    envVars:
      - name: ANTHROPIC_API_KEY
        required: true
        description: API key for Claude
      - name: MAX_TURNS
        required: false
        description: Max turns per phase
---`)
    const meta = parseClawdisMetadata(frontmatter)
    expect(meta?.envVars).toHaveLength(2)
    expect(meta?.envVars?.[0]).toEqual({
      name: 'ANTHROPIC_API_KEY',
      required: true,
      description: 'API key for Claude',
    })
    expect(meta?.envVars?.[1]?.required).toBe(false)
  })

  it('parses dependencies from clawdis block', () => {
    const frontmatter = parseFrontmatter(`---
metadata:
  clawdis:
    dependencies:
      - name: securevibes
        type: pip
        version: ">=0.3.0"
        url: https://pypi.org/project/securevibes/
        repository: https://github.com/anshumanbh/securevibes
---`)
    const meta = parseClawdisMetadata(frontmatter)
    expect(meta?.dependencies).toHaveLength(1)
    expect(meta?.dependencies?.[0]).toEqual({
      name: 'securevibes',
      type: 'pip',
      version: '>=0.3.0',
      url: 'https://pypi.org/project/securevibes/',
      repository: 'https://github.com/anshumanbh/securevibes',
    })
  })

  it('parses author and links from clawdis block', () => {
    const frontmatter = parseFrontmatter(`---
metadata:
  clawdis:
    author: anshumanbh
    links:
      homepage: https://securevibes.ai
      repository: https://github.com/anshumanbh/securevibes
---`)
    const meta = parseClawdisMetadata(frontmatter)
    expect(meta?.author).toBe('anshumanbh')
    expect(meta?.links?.homepage).toBe('https://securevibes.ai')
    expect(meta?.links?.repository).toBe('https://github.com/anshumanbh/securevibes')
  })

  it('parses env/deps/author/links from top-level frontmatter (no clawdis block)', () => {
    const frontmatter = parseFrontmatter(`---
env:
  - name: MY_API_KEY
    required: true
    description: Main API key
dependencies:
  - name: requests
    type: pip
author: someuser
links:
  homepage: https://example.com
---`)
    const meta = parseClawdisMetadata(frontmatter)
    expect(meta?.envVars).toHaveLength(1)
    expect(meta?.envVars?.[0]?.name).toBe('MY_API_KEY')
    expect(meta?.dependencies).toHaveLength(1)
    expect(meta?.author).toBe('someuser')
    expect(meta?.links?.homepage).toBe('https://example.com')
  })

  it('handles string-only env arrays as required env vars', () => {
    const frontmatter = parseFrontmatter(`---
metadata:
  clawdis:
    envVars:
      - API_KEY
      - SECRET_TOKEN
---`)
    const meta = parseClawdisMetadata(frontmatter)
    expect(meta?.envVars).toHaveLength(2)
    expect(meta?.envVars?.[0]).toEqual({ name: 'API_KEY', required: true })
  })

  it('normalizes unknown dependency types to other', () => {
    const frontmatter = parseFrontmatter(`---
metadata:
  clawdis:
    dependencies:
      - name: sometool
        type: ruby
---`)
    const meta = parseClawdisMetadata(frontmatter)
    expect(meta?.dependencies?.[0]?.type).toBe('other')
  })

  it('returns undefined when no declarations present', () => {
    const frontmatter = parseFrontmatter(`---
name: simple-skill
description: A simple skill
---`)
    const meta = parseClawdisMetadata(frontmatter)
    expect(meta).toBeUndefined()
  })
})

describe('parseLicenseField', () => {
  it('parses simple SPDX string', () => {
    const frontmatter = parseFrontmatter(`---\nlicense: MIT\n---\nBody`)
    const license = parseLicenseField(frontmatter)
    expect(license).toEqual({ spdx: 'MIT' })
  })

  it('trims whitespace from SPDX string', () => {
    const frontmatter = parseFrontmatter(`---\nlicense: "  Apache-2.0  "\n---\nBody`)
    const license = parseLicenseField(frontmatter)
    expect(license).toEqual({ spdx: 'Apache-2.0' })
  })

  it('returns undefined for empty string', () => {
    const frontmatter = parseFrontmatter(`---\nlicense: ""\n---\nBody`)
    expect(parseLicenseField(frontmatter)).toBeUndefined()
  })

  it('parses PIL-aligned structured license object', () => {
    const frontmatter = parseFrontmatter(`---
license:
  spdx: Apache-2.0
  transferable: true
  commercialUse: true
  commercialAttribution: true
  derivativesAllowed: true
  derivativesAttribution: true
  derivativesApproval: false
  derivativesReciprocal: false
  uri: https://example.com/license
---
Body`)
    const license = parseLicenseField(frontmatter)
    expect(license).toEqual({
      spdx: 'Apache-2.0',
      transferable: true,
      commercialUse: true,
      commercialAttribution: true,
      derivativesAllowed: true,
      derivativesAttribution: true,
      derivativesApproval: false,
      derivativesReciprocal: false,
      uri: 'https://example.com/license',
    })
  })

  it('normalizes old "commercial" field to "commercialUse"', () => {
    const frontmatter = parseFrontmatter(`---
license:
  spdx: MIT
  commercial: true
---
Body`)
    const license = parseLicenseField(frontmatter)
    expect(license?.commercialUse).toBe(true)
    expect((license as Record<string, unknown>).commercial).toBeUndefined()
  })

  it('normalizes old "attribution: required" to split booleans', () => {
    const frontmatter = parseFrontmatter(`---
license:
  spdx: MIT
  attribution: required
---
Body`)
    const license = parseLicenseField(frontmatter)
    expect(license?.commercialAttribution).toBe(true)
    expect(license?.derivativesAttribution).toBe(true)
  })

  it('normalizes old "attribution: none" to false booleans', () => {
    const frontmatter = parseFrontmatter(`---
license:
  spdx: CC0-1.0
  attribution: none
---
Body`)
    const license = parseLicenseField(frontmatter)
    expect(license?.commercialAttribution).toBe(false)
    expect(license?.derivativesAttribution).toBe(false)
  })

  it('normalizes old "derivatives: allowed" to booleans', () => {
    const frontmatter = parseFrontmatter(`---
license:
  spdx: MIT
  derivatives: allowed
---
Body`)
    const license = parseLicenseField(frontmatter)
    expect(license?.derivativesAllowed).toBe(true)
    expect(license?.derivativesReciprocal).toBe(false)
  })

  it('normalizes old "derivatives: allowed-same-license" to reciprocal', () => {
    const frontmatter = parseFrontmatter(`---
license:
  spdx: GPL-3.0-only
  derivatives: allowed-same-license
---
Body`)
    const license = parseLicenseField(frontmatter)
    expect(license?.derivativesAllowed).toBe(true)
    expect(license?.derivativesReciprocal).toBe(true)
  })

  it('normalizes old "derivatives: not-allowed"', () => {
    const frontmatter = parseFrontmatter(`---
license:
  spdx: proprietary
  derivatives: not-allowed
---
Body`)
    const license = parseLicenseField(frontmatter)
    expect(license?.derivativesAllowed).toBe(false)
  })

  it('normalizes old "url" to "uri"', () => {
    const frontmatter = parseFrontmatter(`---
license:
  spdx: MIT
  url: https://example.com/license
---
Body`)
    const license = parseLicenseField(frontmatter)
    expect(license?.uri).toBe('https://example.com/license')
    expect((license as Record<string, unknown>).url).toBeUndefined()
  })

  it('prefers new PIL field names over old when both present', () => {
    const frontmatter = parseFrontmatter(`---
license:
  spdx: MIT
  commercial: false
  commercialUse: true
---
Body`)
    const license = parseLicenseField(frontmatter)
    expect(license?.commercialUse).toBe(true)
  })

  it('normalizes old structured license with all legacy fields', () => {
    const frontmatter = parseFrontmatter(`---
license:
  spdx: Apache-2.0
  commercial: true
  attribution: required
  derivatives: allowed
  url: https://example.com/license
---
Body`)
    const license = parseLicenseField(frontmatter)
    expect(license).toEqual({
      spdx: 'Apache-2.0',
      commercialUse: true,
      commercialAttribution: true,
      derivativesAttribution: true,
      derivativesAllowed: true,
      derivativesReciprocal: false,
      uri: 'https://example.com/license',
    })
  })

  it('parses object with only spdx field', () => {
    const frontmatter = parseFrontmatter(`---
license:
  spdx: GPL-3.0-only
---
Body`)
    const license = parseLicenseField(frontmatter)
    expect(license).toEqual({ spdx: 'GPL-3.0-only' })
  })

  it('returns undefined when license is absent', () => {
    const frontmatter = parseFrontmatter(`---\nname: demo\n---\nBody`)
    expect(parseLicenseField(frontmatter)).toBeUndefined()
  })

  it('returns undefined for object missing spdx', () => {
    const frontmatter = parseFrontmatter(`---
license:
  commercial: true
---
Body`)
    expect(parseLicenseField(frontmatter)).toBeUndefined()
  })

  it('returns undefined for boolean license', () => {
    const frontmatter = parseFrontmatter(`---\nlicense: true\n---\nBody`)
    expect(parseLicenseField(frontmatter)).toBeUndefined()
  })

  it('returns undefined for numeric license', () => {
    const frontmatter = parseFrontmatter(`---\nlicense: 42\n---\nBody`)
    expect(parseLicenseField(frontmatter)).toBeUndefined()
  })

  it('returns undefined for array license', () => {
    const frontmatter = parseFrontmatter(`---\nlicense: [MIT, Apache-2.0]\n---\nBody`)
    expect(parseLicenseField(frontmatter)).toBeUndefined()
  })

  it('rejects spdx string with embedded newlines', () => {
    expect(parseLicenseField({ license: 'MIT\nmalicious-line' })).toBeUndefined()
  })

  it('rejects spdx string with control characters', () => {
    expect(parseLicenseField({ license: 'MIT\x00' })).toBeUndefined()
  })

  it('rejects spdx string with spaces', () => {
    expect(parseLicenseField({ license: 'MIT License' })).toBeUndefined()
  })

  it('rejects object spdx with control characters', () => {
    expect(parseLicenseField({ license: { spdx: 'MIT\ninjected' } })).toBeUndefined()
  })

  it('drops non-https URI', () => {
    const frontmatter = parseFrontmatter(`---
license:
  spdx: MIT
  uri: http://example.com/license
---
Body`)
    const license = parseLicenseField(frontmatter)
    expect(license?.spdx).toBe('MIT')
    expect(license?.uri).toBeUndefined()
  })

  it('drops javascript: URI', () => {
    const frontmatter = parseFrontmatter(`---
license:
  spdx: MIT
  uri: "javascript:alert(1)"
---
Body`)
    const license = parseLicenseField(frontmatter)
    expect(license?.spdx).toBe('MIT')
    expect(license?.uri).toBeUndefined()
  })

  it('drops URI exceeding max length', () => {
    const longUri = `https://example.com/${'a'.repeat(2048)}`
    const frontmatter = parseFrontmatter(`---
license:
  spdx: MIT
  uri: "${longUri}"
---
Body`)
    const license = parseLicenseField(frontmatter)
    expect(license?.uri).toBeUndefined()
  })

  it('drops non-https URL via old field name', () => {
    const frontmatter = parseFrontmatter(`---
license:
  spdx: MIT
  url: http://example.com/license
---
Body`)
    const license = parseLicenseField(frontmatter)
    expect(license?.spdx).toBe('MIT')
    expect(license?.uri).toBeUndefined()
  })

  it('rejects SPDX string exceeding max length', () => {
    const longSpdx = 'A'.repeat(65)
    const frontmatter = parseFrontmatter(`---\nlicense: ${longSpdx}\n---\nBody`)
    expect(parseLicenseField(frontmatter)).toBeUndefined()
  })

  it('drops invalid old attribution value', () => {
    const frontmatter = parseFrontmatter(`---
license:
  spdx: MIT
  attribution: sometimes
---
Body`)
    const license = parseLicenseField(frontmatter)
    expect(license?.spdx).toBe('MIT')
    expect(license?.commercialAttribution).toBeUndefined()
    expect(license?.derivativesAttribution).toBeUndefined()
  })

  it('drops old "attribution: optional" (no PIL mapping)', () => {
    const frontmatter = parseFrontmatter(`---
license:
  spdx: MIT
  attribution: optional
---
Body`)
    const license = parseLicenseField(frontmatter)
    expect(license?.spdx).toBe('MIT')
    expect(license?.commercialAttribution).toBeUndefined()
    expect(license?.derivativesAttribution).toBeUndefined()
  })

  it('drops invalid old derivatives value', () => {
    const frontmatter = parseFrontmatter(`---
license:
  spdx: MIT
  derivatives: maybe
---
Body`)
    const license = parseLicenseField(frontmatter)
    expect(license?.spdx).toBe('MIT')
    expect(license?.derivativesAllowed).toBeUndefined()
  })

  it('drops non-boolean commercialUse value', () => {
    const frontmatter = parseFrontmatter(`---
license:
  spdx: MIT
  commercialUse: "yes"
---
Body`)
    const license = parseLicenseField(frontmatter)
    expect(license?.spdx).toBe('MIT')
    expect(license?.commercialUse).toBeUndefined()
  })

  it('drops non-boolean old commercial value', () => {
    const frontmatter = parseFrontmatter(`---
license:
  spdx: MIT
  commercial: "yes"
---
Body`)
    const license = parseLicenseField(frontmatter)
    expect(license?.spdx).toBe('MIT')
    expect(license?.commercialUse).toBeUndefined()
  })

  it('stores unknown SPDX identifiers as-is', () => {
    const frontmatter = parseFrontmatter(`---\nlicense: WTFPL\n---\nBody`)
    const license = parseLicenseField(frontmatter)
    expect(license).toEqual({ spdx: 'WTFPL' })
  })
})

describe('isKnownSpdx', () => {
  it('recognizes known identifiers', () => {
    expect(isKnownSpdx('MIT')).toBe(true)
    expect(isKnownSpdx('Apache-2.0')).toBe(true)
    expect(isKnownSpdx('GPL-3.0-only')).toBe(true)
    expect(isKnownSpdx('proprietary')).toBe(true)
  })

  it('rejects unknown identifiers', () => {
    expect(isKnownSpdx('WTFPL')).toBe(false)
    expect(isKnownSpdx('mit')).toBe(false)
    expect(isKnownSpdx('')).toBe(false)
  })
})
