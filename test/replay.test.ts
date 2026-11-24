import { once } from 'node:events'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, test } from 'node:test'
import os from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { assert, snapshot } from './assertions.ts'
import { useRealWaits } from './instant-waits.ts'
import { init, normalizeTrades, replay, replayNormalized } from '../dist/index.js'

describe('replay validation', () => {
  test('invalid args validation', async () => {
    await assert.rejects(replay({ exchange: 'binance', from: 'sdf', to: 'dsf', filters: [] }).next())

    await assert.rejects(replay({ exchange: 'binances' as any, from: '2019-05-05 00:00', to: '2019-05-05 00:05', filters: [] }).next())

    await assert.rejects(replay({ exchange: 'binance', from: '2019-06-05 00:00', to: '2019-05-05 00:05', filters: [] }).next())

    await assert.rejects(replay({ exchange: 'binance', from: '2019-06-05 00:00Z', to: '2019-05-05 00:05Z', filters: [] }).next())

    await assert.rejects(
      replay({ exchange: 'binance', from: '2019-04-05 00:00Z', to: '2019-05-05 00:05Z', filters: [{ channel: 'trades' as any }] }).next()
    )
  })

  test('invalid replayNormalized args validation', async () => {
    await assert.rejects(replayNormalized({ exchange: 'binance', symbols: ['btcusdt'], from: 'sdf', to: 'dsf' }, normalizeTrades).next())

    assert.throws(() =>
      replayNormalized(
        { exchange: 'binances' as any, symbols: ['btcusdt'], from: '2019-05-05 00:00', to: '2019-05-05 00:05' },
        normalizeTrades
      )
    )

    await assert.rejects(
      replayNormalized(
        { exchange: 'binance', symbols: ['btcusdt'], from: '2019-06-05 00:00', to: '2019-05-05 00:05' },
        normalizeTrades
      ).next()
    )

    await assert.rejects(
      replayNormalized(
        { exchange: 'binance', symbols: ['btcusdt'], from: '2019-06-05 00:00Z', to: '2019-05-05 00:05Z' },
        normalizeTrades
      ).next()
    )
  })

  test('replays and normalizes a fixed two-minute Coinbase slice from the Tardis API', { timeout: 60_000 }, async (context) => {
    useRealWaits(context)
    const cacheDir = mkdtempSync(path.join(os.tmpdir(), 'tardis-node-replay-e2e-'))
    const from = '2019-06-01T00:00:00.000Z'
    const to = '2019-06-01T00:02:00.000Z'

    try {
      init({ cacheDir })
      const rawMessages = []
      const normalizedMessages = []

      for await (const message of replay({
        exchange: 'coinbase',
        from,
        to,
        filters: [{ channel: 'match', symbols: ['ZEC-USDC'] }]
      })) {
        rawMessages.push(message)
      }

      for await (const message of replayNormalized({ exchange: 'coinbase', symbols: ['ZEC-USDC'], from, to }, normalizeTrades)) {
        normalizedMessages.push(message)
      }

      assert.ok(rawMessages.length > 0)
      assert.strictEqual(normalizedMessages.length, rawMessages.length)
      assert.ok(listFiles(cacheDir).some((filePath) => /\.json\.(?:gz|zst)$/.test(filePath)))
      snapshot({ rawMessages, normalizedMessages })
    } finally {
      init()
      rmSync(cacheDir, { force: true, recursive: true })
    }
  })

  for (const firstStatus of [200, 400] as const) {
    test(
      `overlaps boundary checks and fails with last slice error before yielding (first=${firstStatus})`,
      { timeout: 10_000 },
      async () => {
        const cacheDir = mkdtempSync(path.join(os.tmpdir(), 'tardis-node-boundary-'))
        let sawFirst = false
        let firstFinished = false
        let pendingLastResponse: ServerResponse | undefined
        let releaseTimer: ReturnType<typeof setTimeout> | undefined
        let deadlockTimer: ReturnType<typeof setTimeout> | undefined

        const sendLastResponse = (status: number, body: string) => {
          if (pendingLastResponse === undefined) {
            return
          }
          if (deadlockTimer !== undefined) {
            clearTimeout(deadlockTimer)
            deadlockTimer = undefined
          }
          const response = pendingLastResponse
          pendingLastResponse = undefined
          response.writeHead(status, { 'Content-Type': 'text/plain' }).end(body)
        }

        const scheduleLast401 = () => {
          if (!firstFinished || pendingLastResponse === undefined || releaseTimer !== undefined) {
            return
          }
          // When offset 0 succeeds, wait briefly after its response finishes so a premature publish would yield before the 401.
          const delayMs = firstStatus === 200 ? 400 : 0
          releaseTimer = setTimeout(() => {
            releaseTimer = undefined
            sendLastResponse(401, 'last denied')
          }, delayMs)
        }

        const server = createServer((request, response) => {
          const offset = new URL(request.url!, 'http://localhost').searchParams.get('offset')
          if (offset === '0') {
            sawFirst = true
            response.once('finish', () => {
              firstFinished = true
              scheduleLast401()
            })
            if (firstStatus === 200) {
              const body = gzipSync(Buffer.from('2026-07-01T00:00:00.0000000Z {"sequence":0}\n'))
              response
                .writeHead(200, {
                  'Content-Encoding': 'gzip',
                  'X-Slice-Size': 1,
                  'X-Suggested-Slice-Size': 1
                })
                .end(body)
            } else {
              response.writeHead(400, { 'Content-Type': 'text/plain' }).end('first denied')
            }
            return
          }

          if (offset === '2') {
            // Hold offset 2 until offset 0 arrives so sequential boundary checks fail instead of passing silently.
            pendingLastResponse = response
            deadlockTimer = setTimeout(() => {
              sendLastResponse(400, 'offset 0 never arrived concurrently')
            }, 3_000)
            scheduleLast401()
            return
          }

          response.writeHead(500).end(`unexpected offset ${offset}`)
        })

        server.listen(0, '127.0.0.1')
        await once(server, 'listening')

        try {
          init({
            endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
            cacheDir,
            dataFeedCompression: 'gzip'
          })

          const yielded = []
          await assert.rejects(
            async () => {
              for await (const message of replay({
                exchange: 'binance',
                from: '2026-07-01T00:00:00.000Z',
                to: '2026-07-01T00:03:00.000Z',
                filters: [{ channel: 'trade', symbols: ['btcusdt'] }]
              })) {
                yielded.push(message)
              }
            },
            (err: any) => {
              assert.ok(String(err?.message ?? err).includes('401'))
              assert.ok(String(err?.message ?? err).includes('last denied'))
              return true
            }
          )
          assert.strictEqual(sawFirst, true)
          assert.strictEqual(yielded.length, 0)
        } finally {
          if (releaseTimer !== undefined) {
            clearTimeout(releaseTimer)
          }
          if (deadlockTimer !== undefined) {
            clearTimeout(deadlockTimer)
          }
          init()
          await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
          rmSync(cacheDir, { force: true, recursive: true })
        }
      }
    )
  }

  test('fails immediately without retrying on unsupported content encoding in real worker', { timeout: 10_000 }, async (context) => {
    useRealWaits(context)
    const cacheDir = mkdtempSync(path.join(os.tmpdir(), 'tardis-node-unsupported-encoding-'))
    let requestsCount = 0
    const server = createServer((_request, response) => {
      requestsCount++
      response
        .writeHead(200, {
          'Content-Encoding': 'br',
          'X-Slice-Size': 1,
          'X-Suggested-Slice-Size': 1
        })
        .end('unsupported')
    })

    server.listen(0, '127.0.0.1')
    await once(server, 'listening')

    try {
      init({
        endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
        cacheDir
      })

      await assert.rejects(
        replay({
          exchange: 'binance',
          from: '2026-07-01T00:00:00.000Z',
          to: '2026-07-01T00:01:00.000Z',
          filters: [{ channel: 'trade', symbols: ['btcusdt'] }]
        }).next(),
        (err: unknown) => err instanceof Error && err.message.includes('Unsupported data feed content encoding: br')
      )
      assert.strictEqual(requestsCount, 1)
    } finally {
      init()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      rmSync(cacheDir, { force: true, recursive: true })
    }
  })
})

function listFiles(directory: string): string[] {
  if (existsSync(directory) === false) {
    return []
  }

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath]
  })
}
