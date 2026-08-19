import { test } from 'node:test'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { assert } from './assertions.ts'
import { init, replay } from '../dist/index.js'
import type { ReplayOptions } from '../dist/index.js'
import { describeLive } from './live.ts'

describeLive('replay live', () => {
  test('replays real data using a multi-minute data feed slice', { timeout: 1000 * 60 * 10 }, async () => {
    const cacheDir = mkdtempSync(path.join(os.tmpdir(), 'tardis-node-replay-slices-'))

    try {
      init({ cacheDir })

      const messages = []
      for await (const { message } of replay({
        exchange: 'bitmex',
        from: '2019-05-01T00:00:00.000Z',
        to: '2019-05-01T00:12:00.000Z',
        filters: [
          {
            channel: 'trade',
            symbols: ['ETHUSD']
          }
        ],
        skipDecoding: true
      })) {
        messages.push(message)
      }

      const cacheFiles = listFiles(cacheDir)
      const multiMinuteSliceFiles = cacheFiles.filter((filePath) => /\.size-(?:[2-9]|10)\.json\.(?:gz|zst)$/.test(filePath))

      assert.ok(messages.length > 0)
      assert.ok(multiMinuteSliceFiles.length > 0)

      const cacheFilesAfterFirstReplay = cacheFiles.sort()
      for await (const _ of replay({
        exchange: 'bitmex',
        from: '2019-05-01T00:00:00.000Z',
        to: '2019-05-01T00:12:00.000Z',
        filters: [
          {
            channel: 'trade',
            symbols: ['ETHUSD']
          }
        ],
        skipDecoding: true
      })) {
      }

      assert.deepStrictEqual(listFiles(cacheDir).sort(), cacheFilesAfterFirstReplay)
    } finally {
      init()
      rmSync(cacheDir, { force: true, recursive: true })
    }
  })

  test(
    'replays raw Binance data feed with microseconds and disconnects and matches manual decode of raw feed',
    { timeout: 1000 * 60 * 10 },
    async () => {
      const replayOptions: ReplayOptions<'binance'> = {
        exchange: 'binance',
        from: '2019-06-01T00:00:00.000Z',
        to: '2019-06-01T00:02:00.000Z',
        filters: [
          {
            channel: 'trade',
            symbols: ['batpax']
          }
        ]
      }

      const decodedMessages = []
      const decodedTimestamps = []
      let decodedDisconnects = 0

      for await (const replayMessage of replay({ ...replayOptions, withMicroseconds: true, withDisconnects: true })) {
        if (replayMessage === undefined) {
          decodedDisconnects++
          continue
        }

        decodedMessages.push(replayMessage.message)
        decodedTimestamps.push({
          iso: replayMessage.localTimestamp.toISOString(),
          μs: (replayMessage.localTimestamp as Date & { μs?: number }).μs
        })
      }

      const rawMessages = []
      const rawTimestamps = []
      let rawDisconnects = 0

      for await (const replayMessage of replay({
        ...replayOptions,
        skipDecoding: true,
        withMicroseconds: true,
        withDisconnects: true
      })) {
        if (replayMessage === undefined) {
          rawDisconnects++
          continue
        }

        rawMessages.push(JSON.parse(replayMessage.message.toString()))
        const localTimestampString = replayMessage.localTimestamp.toString()
        rawTimestamps.push({
          iso: new Date(localTimestampString).toISOString(),
          μs: Number(localTimestampString.slice(23, 26))
        })
      }

      assert.deepStrictEqual(decodedDisconnects, rawDisconnects)
      assert.deepStrictEqual(decodedMessages, rawMessages)
      assert.deepStrictEqual(decodedTimestamps, rawTimestamps)
    }
  )

  test('unauthorizedAccess', { timeout: 20 * 1000 }, async () => {
    const dataFeedWithUnautorizedAccesss = replay({
      exchange: 'binance',
      from: '2019-05-01 23:00',
      to: '2019-05-02 00:06',
      filters: [
        {
          channel: 'trade'
        }
      ]
    })
    await assert.rejects(
      async () => {
        for await (const _ of dataFeedWithUnautorizedAccesss) {
        }
      },
      (error) => typeof error === 'object' && error !== null && 'status' in error
    )
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
