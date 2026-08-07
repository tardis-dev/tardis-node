import { afterEach, mock, test } from 'node:test'
import { EventEmitter, once } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Transform } from 'node:stream'
import zlib, { constants, createZstdDecompress, unzipSync } from 'node:zlib'
import { assert } from './assertions.ts'

const tempDirs: string[] = []
let feed = ''
let decompressor: Transform

class MockWorker extends EventEmitter {
  constructor(_url: URL, options: { workerData: any }) {
    super()

    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'tardis-node-replay-batching-errors-'))
    tempDirs.push(tempDir)
    const slicePath = path.join(tempDir, 'slice.json.gz')
    writeFileSync(slicePath, feed)

    setImmediate(() => {
      this.emit('message', {
        sliceKey: options.workerData.fromDate.toISOString(),
        slicePath,
        sliceSize: 1
      })
    })
  }

  postMessage(signal: string) {
    if (signal === 'BEFORE_TERMINATE') {
      setImmediate(() => this.emit('message', 'READY_TO_TERMINATE'))
    }
  }

  async terminate() {
    return 0
  }
}

mock.module('worker_threads', {
  exports: {
    Worker: MockWorker,
    isMainThread: true,
    parentPort: undefined,
    workerData: undefined
  }
})

function createControlledGunzip() {
  decompressor = new Transform({
    transform(chunk, _encoding, callback) {
      callback(undefined, chunk)
    },
    // Keep the stream open so the test controls when the later decompression error occurs.
    flush() {}
  })
  return decompressor
}

mock.module('zlib', {
  exports: {
    default: { ...zlib, createGunzip: createControlledGunzip },
    constants,
    createGunzip: createControlledGunzip,
    createZstdDecompress,
    unzipSync
  }
})

const { replay } = await import('../dist/index.js')

afterEach(() => {
  decompressor.destroy()
  feed = ''
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { force: true, recursive: true })
  }
})

const options = {
  exchange: 'binance' as const,
  from: '2026-07-01T00:00:00.000Z',
  to: '2026-07-01T00:01:00.000Z',
  filters: []
}

function line(sequence: number) {
  return `2026-07-01T00:00:00.000000${sequence}Z ${JSON.stringify({ sequence })}`
}

test('drains a received batch before surfacing a later decompression error', async () => {
  feed = `${line(1)}\n${line(2)}\n`
  const iterator = replay(options)

  assert.partialDeepStrictEqual(await iterator.next(), { value: { message: { sequence: 1 } } })

  const streamError = new Error('decompression failed')
  const errorEmitted = once(decompressor, 'error')
  decompressor.destroy(streamError)
  await errorEmitted

  assert.partialDeepStrictEqual(await iterator.next(), { value: { message: { sequence: 2 } } })
  await assert.rejects(iterator.next(), (error) => error === streamError)
})
