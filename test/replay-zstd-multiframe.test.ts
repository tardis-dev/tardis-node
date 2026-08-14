import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { mock, test } from 'node:test'
import os from 'node:os'
import path from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { assert } from './assertions.ts'

const tempDirs: string[] = []

class MockWorker extends EventEmitter {
  constructor(_url: URL, options: { workerData: { fromDate: Date } }) {
    super()

    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'tardis-node-zstd-multiframe-'))
    tempDirs.push(tempDir)
    const slicePath = path.join(tempDir, 'slice.json.zst')
    const firstFrame = zstdCompressSync(Buffer.from('2026-07-01T00:00:00.0000000Z {"sequence":1}\n'))
    const secondFrame = zstdCompressSync(Buffer.from('2026-07-01T00:01:00.0000000Z {"sequence":2}\n'))
    writeFileSync(slicePath, Buffer.concat([firstFrame, secondFrame]))

    setImmediate(() => {
      this.emit('message', {
        sliceKey: options.workerData.fromDate.toISOString(),
        slicePath,
        sliceSize: 2
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

const { replay } = await import('../dist/index.js')

test('replays every frame from a multi-frame zstd slice', async () => {
  try {
    const sequences = []
    for await (const { message } of replay({
      exchange: 'binance',
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-01T00:02:00.000Z',
      filters: []
    })) {
      sequences.push(message.sequence)
    }

    assert.deepStrictEqual(sequences, [1, 2])
  } finally {
    for (const tempDir of tempDirs.splice(0)) {
      rmSync(tempDir, { force: true, recursive: true })
    }
  }
})
