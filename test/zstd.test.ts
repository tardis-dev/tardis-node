import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import { constants, createZstdCompress, zstdCompressSync } from 'node:zlib'
import { createZstdDecompressionStream } from '../dist/zstd.js'
import { assert } from './assertions.ts'

test('streams every frame from a standard concatenated zstd file', async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'tardis-node-zstd-'))
  const slicePath = path.join(tempDir, 'slice.json.zst')
  const contents = [Buffer.from('first\n'), Buffer.alloc(0), randomBytes(300_000), Buffer.alloc(300_000), Buffer.from('\nlast\n')]
  const frames = [
    zstdCompressSync(contents[0]),
    zstdCompressSync(contents[1]),
    await compressAsStream(contents[2]),
    zstdCompressSync(contents[3], { params: { [constants.ZSTD_c_checksumFlag]: 1 } }),
    zstdCompressSync(contents[4])
  ]
  writeFileSync(slicePath, Buffer.concat(frames))

  try {
    assert.deepStrictEqual(await decompress(slicePath), Buffer.concat(contents))
  } finally {
    rmSync(tempDir, { force: true, recursive: true })
  }
})

test('rejects a truncated zstd frame', async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'tardis-node-zstd-'))
  const slicePath = path.join(tempDir, 'slice.json.zst')
  const frame = zstdCompressSync(randomBytes(300_000), { params: { [constants.ZSTD_c_checksumFlag]: 1 } })
  writeFileSync(slicePath, frame.subarray(0, frame.length - 2))

  try {
    await assert.rejects(decompress(slicePath), /Truncated zstd frame/)
  } finally {
    rmSync(tempDir, { force: true, recursive: true })
  }
})

async function compressAsStream(contents: Buffer) {
  const compressor = createZstdCompress()
  Readable.from([contents]).pipe(compressor)
  const chunks = []
  for await (const chunk of compressor) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function decompress(path: string) {
  const chunks = []
  for await (const chunk of createZstdDecompressionStream(path, 257)) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}
