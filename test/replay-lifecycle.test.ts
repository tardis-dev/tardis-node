import { EventEmitter } from 'node:events'
import fs, { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, mock, test } from 'node:test'
import zlib, { constants, createGunzip, createZstdDecompress, gzipSync, unzipSync, zstdCompressSync } from 'node:zlib'
import { assert, errorMessageIncludes } from './assertions.ts'

type WorkerBehavior = (worker: MockWorker, payload: any) => void

const tempDirs: string[] = []
const createdReadStreams: fs.ReadStream[] = []
const createdDecoders: Array<ReturnType<typeof createGunzip> | ReturnType<typeof createZstdDecompress>> = []
const createdWorkers: MockWorker[] = []
let workerBehavior: WorkerBehavior = () => {}
let onBeforeTerminate: ((worker: MockWorker) => void) | undefined

class MockWorker extends EventEmitter {
  public terminated = false

  constructor(_url: URL, options: { workerData: any }) {
    super()
    createdWorkers.push(this)
    workerBehavior(this, options.workerData)
  }

  postMessage(signal: string) {
    if (signal === 'BEFORE_TERMINATE') {
      if (onBeforeTerminate !== undefined) {
        onBeforeTerminate(this)
      } else {
        setImmediate(() => this.emit('message', 'READY_TO_TERMINATE'))
      }
    }
  }

  async terminate() {
    this.terminated = true
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

const trackedCreateReadStream: typeof fs.createReadStream = (...args) => {
  const stream = fs.createReadStream(...args)
  createdReadStreams.push(stream)
  return stream
}

mock.module('node:fs', {
  exports: {
    ...fs,
    default: { ...fs, createReadStream: trackedCreateReadStream },
    createReadStream: trackedCreateReadStream
  }
})

const trackedCreateGunzip: typeof createGunzip = (...args) => {
  const stream = createGunzip(...args)
  createdDecoders.push(stream)
  return stream
}

const trackedCreateZstdDecompress: typeof createZstdDecompress = (...args) => {
  const stream = createZstdDecompress(...args)
  createdDecoders.push(stream)
  return stream
}

mock.module('zlib', {
  exports: {
    ...zlib,
    default: { ...zlib, createGunzip: trackedCreateGunzip, createZstdDecompress: trackedCreateZstdDecompress },
    constants,
    createGunzip: trackedCreateGunzip,
    createZstdDecompress: trackedCreateZstdDecompress,
    unzipSync
  }
})

const { replay } = await import('../dist/index.js')

afterEach(() => {
  createdReadStreams.length = 0
  createdDecoders.length = 0
  createdWorkers.length = 0
  workerBehavior = () => {}
  onBeforeTerminate = undefined

  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { force: true, recursive: true })
  }
})

const replayOptions = {
  exchange: 'binance' as const,
  from: '2026-07-01T00:00:00.000Z',
  to: '2026-07-01T00:01:00.000Z',
  filters: [{ channel: 'trade' as const }]
}

function makeSliceContent(lineCount: number) {
  let content = ''
  for (let i = 0; i < lineCount; i++) {
    content += `2026-07-01T00:00:00.0000000Z {"sequence":${i},"payload":"${'x'.repeat(256)}"}\n`
  }
  return Buffer.from(content)
}

for (const format of ['gzip', 'zstd'] as const) {
  test(`early break destroys read stream and ${format} decompressor`, async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), `tardis-node-early-break-${format}-`))
    tempDirs.push(tempDir)
    const slicePath = path.join(tempDir, format === 'gzip' ? 'slice.json.gz' : 'slice.json.zst')
    const raw = makeSliceContent(4000)
    writeFileSync(slicePath, format === 'gzip' ? gzipSync(raw) : zstdCompressSync(raw))

    workerBehavior = (worker, payload) => {
      setImmediate(() => {
        worker.emit('message', {
          sliceKey: payload.fromDate.toISOString(),
          slicePath,
          sliceSize: 1
        })
      })
    }

    for await (const { message } of replay(replayOptions)) {
      assert.strictEqual(message.sequence, 0)
      break
    }

    assert.strictEqual(createdReadStreams.length, 1)
    assert.strictEqual(createdDecoders.length, 1)

    const [readStream] = createdReadStreams
    const [decoder] = createdDecoders

    assert.strictEqual(readStream.destroyed, true)
    assert.strictEqual(readStream.closed, true)
    assert.strictEqual(decoder.destroyed, true)
  })

  test(`missing ${format} slice rejects replay instead of crashing with uncaught ENOENT`, async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), `tardis-node-missing-${format}-`))
    tempDirs.push(tempDir)
    const missingSlicePath = path.join(tempDir, format === 'gzip' ? 'missing.json.gz' : 'missing.json.zst')

    workerBehavior = (worker, payload) => {
      setImmediate(() => {
        worker.emit('message', {
          sliceKey: payload.fromDate.toISOString(),
          slicePath: missingSlicePath,
          sliceSize: 1
        })
      })
    }

    await assert.rejects(
      replay(replayOptions).next(),
      (error: unknown) => error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT'
    )
  })
}

test('graceful worker termination handles slice messages arriving before READY_TO_TERMINATE', async (context) => {
  // Freeze setTimeout so termination can complete only via READY_TO_TERMINATE, never via the 500ms timeout guard.
  context.mock.timers.enable({ apis: ['setTimeout'] })

  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'tardis-node-graceful-stop-'))
  tempDirs.push(tempDir)
  const slicePath = path.join(tempDir, 'slice.json.gz')
  writeFileSync(slicePath, gzipSync(makeSliceContent(10)))

  workerBehavior = (worker, payload) => {
    setImmediate(() => {
      worker.emit('message', {
        sliceKey: payload.fromDate.toISOString(),
        slicePath,
        sliceSize: 1
      })
    })
  }

  onBeforeTerminate = (worker) => {
    setImmediate(() => {
      // Simulate an in-flight slice message arriving ahead of the termination ack.
      worker.emit('message', {
        sliceKey: '2026-07-01T00:01:00.000Z',
        slicePath,
        sliceSize: 1
      })
      setImmediate(() => {
        worker.emit('message', 'READY_TO_TERMINATE')
      })
    })
  }

  const iterator = replay(replayOptions)
  const first = await iterator.next()
  assert.strictEqual(first.value?.message.sequence, 0)

  await iterator.return?.()

  assert.strictEqual(createdWorkers.length, 1)
  assert.strictEqual(createdWorkers[0].terminated, true)
})

test('worker error fails replay immediately without restarting or spawning another worker', async () => {
  workerBehavior = (worker) => {
    setImmediate(() => {
      worker.emit('error', new Error('socket hang up'))
      worker.emit('exit', 1)
    })
  }

  await assert.rejects(replay(replayOptions).next(), errorMessageIncludes('socket hang up'))
  assert.strictEqual(createdWorkers.length, 1)
})
