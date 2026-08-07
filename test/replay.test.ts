import { describe, test } from 'node:test'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { assert, snapshot } from './assertions.ts'
import os from 'node:os'
import path from 'node:path'
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

  test('replays and normalizes a fixed two-minute Coinbase slice from the Tardis API', { timeout: 60_000 }, async () => {
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
