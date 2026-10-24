import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import os from 'node:os'
import path from 'node:path'
import { gzipSync, zstdCompressSync } from 'node:zlib'
import { init, replay } from '../dist/index.js'
import { assert } from './assertions.ts'

for (const compression of ['zstd', 'gzip'] as const) {
  test(`replays every minute using Accept-Encoding: ${compression}`, { timeout: 10_000 }, async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'tardis-node-compression-'))
    const requests: { query: URLSearchParams; encoding: string | undefined }[] = []
    const server = createServer((request, response) => {
      const query = new URL(request.url!, 'http://localhost').searchParams
      requests.push({ query, encoding: request.headers['accept-encoding'] })
      const offset = Number(query.get('offset'))
      const sliceSize = Number(query.get('sliceSize') ?? 1)
      const minutes = Array.from({ length: sliceSize }, (_, index) => {
        const minute = offset + index
        return Buffer.from(`2026-07-01T00:0${minute}:00.0000000Z {"sequence":${minute}}\n`)
      })
      const body =
        compression === 'gzip' ? gzipSync(Buffer.concat(minutes)) : Buffer.concat(minutes.map((minute) => zstdCompressSync(minute)))
      response
        .writeHead(200, {
          'Content-Encoding': compression,
          'X-Slice-Size': sliceSize,
          'X-Suggested-Slice-Size': 2
        })
        .end(body)
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')

    try {
      init({
        endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
        cacheDir: tempDir,
        dataFeedCompression: compression
      })
      for (let attempt = 0; attempt < 2; attempt++) {
        const sequences = []
        for await (const { message } of replay({
          exchange: 'binance',
          from: '2026-07-01T00:00:00.000Z',
          to: '2026-07-01T00:04:00.000Z',
          filters: [{ channel: 'trade', symbols: ['btcusdt'] }]
        })) {
          sequences.push(message.sequence)
        }
        assert.deepStrictEqual(sequences, [0, 1, 2, 3])
        assert.strictEqual(requests.length, attempt === 0 ? 3 : 5)
      }

      assert.deepStrictEqual(
        requests.slice(3).map(({ query }) => query.get('offset')),
        ['3', '0']
      )
      assert.ok(requests.some(({ query }) => query.get('sliceSize') === '2'))
      for (const { query, encoding } of requests) {
        assert.strictEqual(query.has('compression'), false)
        assert.strictEqual(encoding, compression === 'gzip' ? 'gzip' : 'zstd, gzip')
      }
    } finally {
      init()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      rmSync(tempDir, { force: true, recursive: true })
    }
  })
}
