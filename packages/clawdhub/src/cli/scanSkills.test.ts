/* @vitest-environment node */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findSkillFolders, getFallbackSkillRoots } from './scanSkills'

async function makeTmpDir() {
  return mkdtemp(join(tmpdir(), 'clawdhub-scan-'))
}

describe('scanSkills', () => {
  it('detects a single skill folder (root contains SKILL.md)', async () => {
    const root = await makeTmpDir()
    try {
      await writeFile(join(root, 'SKILL.md'), '# Skill\n', 'utf8')
      const found = await findSkillFolders(root)
      expect(found).toHaveLength(1)
      expect(found[0]?.folder).toBe(resolve(root))
      expect(found[0]?.slug).toBeTruthy()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('detects skills in a skills directory (subfolders)', async () => {
    const root = await makeTmpDir()
    try {
      const skillsDir = join(root, 'skills')
      const folder = join(skillsDir, 'cool-skill')
      await mkdir(folder, { recursive: true })
      await writeFile(join(folder, 'SKILL.md'), '# Skill\n', 'utf8')

      const found = await findSkillFolders(skillsDir)
      expect(found).toHaveLength(1)
      expect(found[0]?.slug).toBe('cool-skill')
      expect(found[0]?.folder).toBe(resolve(folder))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('ignores plural skills.md marker files', async () => {
    const root = await makeTmpDir()
    try {
      const folder = join(root, 'docs')
      await mkdir(folder, { recursive: true })
      await writeFile(join(folder, 'skills.md'), '# Docs\n', 'utf8')

      const found = await findSkillFolders(root)
      expect(found).toHaveLength(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('includes known legacy roots', () => {
    const roots = getFallbackSkillRoots('/tmp/anywhere')
    expect(roots.some((p) => p.endsWith('/clawdis/skills'))).toBe(true)
    expect(roots.some((p) => p.endsWith('/clawd/skills'))).toBe(true)
    expect(roots.some((p) => p.endsWith('/clawdbot/skills'))).toBe(true)
  })
})
