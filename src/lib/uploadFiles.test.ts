/* @vitest-environment node */
import { gzipSync, strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { expandFiles, expandFilesWithReport } from './uploadFiles'

if (typeof File === 'undefined') {
  class NodeFile extends Blob {
    name: string
    lastModified: number

    constructor(parts: BlobPart[], name: string, options?: FilePropertyBag) {
      super(parts, options)
      this.name = name
      this.lastModified = options?.lastModified ?? Date.now()
    }
  }
  // @ts-expect-error Node test environment polyfill
  globalThis.File = NodeFile
}

function buildTar(entries: Array<{ name: string; content: string }>) {
  const blocks: Uint8Array[] = []
  for (const entry of entries) {
    const content = strToU8(entry.content)
    const header = new Uint8Array(512)
    writeString(header, entry.name, 0, 100)
    writeString(header, '0000777', 100, 8)
    writeString(header, '0000000', 108, 8)
    writeString(header, '0000000', 116, 8)
    writeString(header, content.length.toString(8).padStart(11, '0'), 124, 12)
    writeString(header, '00000000000', 136, 12)
    header[156] = '0'.charCodeAt(0)
    writeString(header, 'ustar', 257, 6)
    for (let i = 148; i < 156; i += 1) {
      header[i] = 32
    }
    let sum = 0
    for (const byte of header) sum += byte
    writeString(header, sum.toString(8).padStart(6, '0'), 148, 6)
    header[154] = 0
    header[155] = 32
    blocks.push(header)
    blocks.push(content)
    const pad = (512 - (content.length % 512)) % 512
    if (pad) blocks.push(new Uint8Array(pad))
  }
  blocks.push(new Uint8Array(1024))
  const total = blocks.reduce((sum, block) => sum + block.length, 0)
  const buffer = new Uint8Array(total)
  let offset = 0
  for (const block of blocks) {
    buffer.set(block, offset)
    offset += block.length
  }
  return buffer
}

function writeString(target: Uint8Array, value: string, start: number, length: number) {
  const bytes = strToU8(value)
  target.set(bytes.subarray(0, length), start)
}

describe('expandFiles', () => {
  it('expands zip archives into files', async () => {
    const zip = zipSync({
      'SKILL.md': strToU8('hello'),
      'docs/readme.txt': strToU8('doc'),
    })
    const zipFile = new File([Uint8Array.from(zip).buffer], 'pack.zip', { type: 'application/zip' })
    const result = await expandFiles([zipFile])
    expect(result.map((file) => file.name)).toEqual(['SKILL.md', 'docs/readme.txt'])
  })

  it('unwraps top-level folders in zip archives', async () => {
    const zip = zipSync({
      'hetzner-cloud-skill/SKILL.md': strToU8('hello'),
      'hetzner-cloud-skill/docs/readme.txt': strToU8('doc'),
      '__MACOSX/._SKILL.md': strToU8('junk'),
      'hetzner-cloud-skill/._notes.txt': strToU8('junk3'),
      'hetzner-cloud-skill/.DS_Store': strToU8('junk2'),
      'hetzner-cloud-skill/screenshot.png': strToU8('not-really-a-png'),
    })
    const zipFile = new File([Uint8Array.from(zip).buffer], 'pack.zip', { type: 'application/zip' })
    const result = await expandFiles([zipFile])
    expect(result.map((file) => file.name)).toEqual(['SKILL.md', 'docs/readme.txt'])
    const png = result.find((file) => file.name.endsWith('.png'))
    expect(png).toBeUndefined()
  })

  it('filters mac junk files and reports ignored paths', async () => {
    const report = await expandFilesWithReport([
      new File(['hello'], 'SKILL.md', { type: 'text/markdown' }),
      new File(['junk'], '.DS_Store', { type: 'application/octet-stream' }),
      new File(['junk'], '._notes.md', { type: 'text/plain' }),
    ])

    expect(report.files.map((file) => file.name)).toEqual(['SKILL.md'])
    expect(report.ignoredMacJunkPaths).toEqual(['.DS_Store', '._notes.md'])
  })

  it('expands gzipped tar archives into files', async () => {
    const tar = buildTar([
      { name: 'SKILL.md', content: 'hi' },
      { name: 'notes.txt', content: 'yo' },
    ])
    const tgz = gzipSync(tar)
    const tgzFile = new File([Uint8Array.from(tgz).buffer], 'bundle.tgz', {
      type: 'application/gzip',
    })
    const result = await expandFiles([tgzFile])
    expect(result.map((file) => file.name)).toEqual(['SKILL.md', 'notes.txt'])
  })

  it('unwraps top-level folders in tar.gz archives', async () => {
    const tar = buildTar([
      { name: 'skill-folder/SKILL.md', content: 'hi' },
      { name: 'skill-folder/notes.txt', content: 'yo' },
    ])
    const tgz = gzipSync(tar)
    const tgzFile = new File([Uint8Array.from(tgz).buffer], 'bundle.tgz', {
      type: 'application/gzip',
    })
    const result = await expandFiles([tgzFile])
    expect(result.map((file) => file.name)).toEqual(['SKILL.md', 'notes.txt'])
  })

  it('expands .gz single files', async () => {
    const gz = gzipSync(strToU8('content'))
    const gzFile = new File([Uint8Array.from(gz).buffer], 'skill.md.gz', {
      type: 'application/gzip',
    })
    const result = await expandFiles([gzFile])
    expect(result.map((file) => file.name)).toEqual(['skill.md'])
  })
})
