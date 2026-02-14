import { strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { expandDroppedItems, expandFiles } from './uploadFiles'

function readWithFileReader(blob: Blob) {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('error', () => {
      reject(reader.error ?? new Error('Could not read blob.'))
    })
    reader.addEventListener('load', () => {
      resolve(reader.result as ArrayBuffer)
    })
    reader.readAsArrayBuffer(blob)
  })
}

describe('expandFiles (jsdom)', () => {
  it('expands zip archives using FileReader fallback', async () => {
    const zip = zipSync({
      'hetzner-cloud-skill/SKILL.md': new Uint8Array(strToU8('hello')),
      'hetzner-cloud-skill/notes.txt': new Uint8Array(strToU8('notes')),
    })
    const zipBytes = Uint8Array.from(zip).buffer
    const zipFile = new File([zipBytes], 'bundle.zip', { type: 'application/zip' })

    const readerBuffer = await readWithFileReader(zipFile)
    const entries = unzipSync(new Uint8Array(readerBuffer))
    expect(Object.keys(entries)).toEqual(
      expect.arrayContaining(['hetzner-cloud-skill/SKILL.md', 'hetzner-cloud-skill/notes.txt']),
    )

    const expanded = await expandFiles([zipFile])
    expect(expanded.map((file) => file.name)).toEqual(['SKILL.md', 'notes.txt'])
  })
})

describe('expandDroppedItems', () => {
  it('returns empty array when items is null', async () => {
    const result = await expandDroppedItems(null)
    expect(result).toEqual([])
  })

  it('returns empty array when items is empty', async () => {
    const items = {
      length: 0,
      [Symbol.iterator]: function* () {},
    } as unknown as DataTransferItemList
    const result = await expandDroppedItems(items)
    expect(result).toEqual([])
  })

  it('collects files from getAsFile when webkitGetAsEntry is unavailable', async () => {
    const file = new File(['hello'], 'test.md', { type: 'text/markdown' })
    const item = {
      getAsFile: () => file,
      webkitGetAsEntry: undefined,
    }
    const items = {
      length: 1,
      0: item,
      [Symbol.iterator]: function* () {
        yield item
      },
    } as unknown as DataTransferItemList
    const result = await expandDroppedItems(items)
    expect(result).toHaveLength(1)
    expect(result[0]?.name).toBe('test.md')
  })

  it('collects files via webkitGetAsEntry for file entries', async () => {
    const file = new File(['content'], 'SKILL.md', { type: 'text/markdown' })
    const fileEntry = {
      isFile: true,
      isDirectory: false,
      name: 'SKILL.md',
      fullPath: '/SKILL.md',
      file: (callback: (f: File) => void) => callback(file),
    }
    const item = {
      getAsFile: () => null,
      webkitGetAsEntry: () => fileEntry,
    }
    const items = {
      length: 1,
      0: item,
      [Symbol.iterator]: function* () {
        yield item
      },
    } as unknown as DataTransferItemList
    const result = await expandDroppedItems(items)
    expect(result).toHaveLength(1)
    expect(result[0]?.name).toBe('SKILL.md')
  })

  it('recursively collects files from directory entries', async () => {
    const file1 = new File(['hello'], 'README.md', { type: 'text/markdown' })
    const file2 = new File(['world'], 'notes.txt', { type: 'text/plain' })

    const fileEntry1 = {
      isFile: true,
      isDirectory: false,
      name: 'README.md',
      fullPath: '/mydir/README.md',
      file: (callback: (f: File) => void) => callback(file1),
    }
    const fileEntry2 = {
      isFile: true,
      isDirectory: false,
      name: 'notes.txt',
      fullPath: '/mydir/notes.txt',
      file: (callback: (f: File) => void) => callback(file2),
    }

    let readEntriesCalled = false
    const dirEntry = {
      isFile: false,
      isDirectory: true,
      name: 'mydir',
      fullPath: '/mydir',
      createReader: () => ({
        readEntries: (callback: (entries: unknown[]) => void) => {
          if (!readEntriesCalled) {
            readEntriesCalled = true
            callback([fileEntry1, fileEntry2])
          } else {
            callback([])
          }
        },
      }),
    }

    const item = {
      getAsFile: () => null,
      webkitGetAsEntry: () => dirEntry,
    }
    const items = {
      length: 1,
      0: item,
      [Symbol.iterator]: function* () {
        yield item
      },
    } as unknown as DataTransferItemList

    const result = await expandDroppedItems(items)
    expect(result).toHaveLength(2)
    expect(result.map((f) => f.name).sort()).toEqual(['mydir/README.md', 'mydir/notes.txt'])
  })

  it('skips entries that are neither files nor directories', async () => {
    const nonEntry = {
      isFile: false,
      isDirectory: false,
      name: 'unknown',
    }
    const item = {
      getAsFile: () => null,
      webkitGetAsEntry: () => nonEntry,
    }
    const items = {
      length: 1,
      0: item,
      [Symbol.iterator]: function* () {
        yield item
      },
    } as unknown as DataTransferItemList

    const result = await expandDroppedItems(items)
    expect(result).toEqual([])
  })
})
