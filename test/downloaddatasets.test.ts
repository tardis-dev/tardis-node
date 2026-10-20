import { describe, test } from 'node:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { assert } from './assertions.ts'
import os from 'os'
import path from 'path'
import { gunzipSync } from 'node:zlib'
import { downloadDatasets, sanitizeForFilename } from '../dist/downloaddatasets.js'
import { init } from '../dist/options.js'
import { describeLive } from './live.ts'

const LIVE_DATASET: Parameters<typeof downloadDatasets>[0] = {
  exchange: 'deribit' as const,
  dataTypes: ['trades'],
  symbols: ['BTC-PERPETUAL'],
  from: '2024-01-01',
  to: '2024-01-02'
}

function createTempDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'tardis-node-download-datasets-'))
}

describe('sanitizeForFilename', () => {
  test('replaces filesystem-invalid characters', () => {
    assert.strictEqual(sanitizeForFilename('a?b/c:d*e<f>g|h"i\\j'), 'a-b-c-d-e-f-g-h-i-j')
  })

  test('leaves normal symbols unchanged', () => {
    assert.strictEqual(sanitizeForFilename('BTCUSDT'), 'BTCUSDT')
    assert.strictEqual(sanitizeForFilename('BTC-USDT'), 'BTC-USDT')
    assert.strictEqual(sanitizeForFilename('BTC_USDT'), 'BTC_USDT')
  })
})

describe('downloadDatasets', () => {
  test('uses a filesystem-safe symbol and leaves an existing file untouched', async () => {
    const tempDir = createTempDir()
    const existingFile = path.join(tempDir, 'deribit_trades_2024-01-01_BTC-USD.csv.gz')

    try {
      writeFileSync(existingFile, 'existing')

      await downloadDatasets({
        ...LIVE_DATASET,
        symbols: ['BTC/USD'],
        downloadDir: tempDir,
        skipIfExists: true
      })

      assert.strictEqual(readFileSync(existingFile, 'utf8'), 'existing')
    } finally {
      rmSync(tempDir, { force: true, recursive: true })
    }
  })

  test('uses the datasets endpoint and API key set by init()', async () => {
    const requests: { url: string | undefined; authorization: string | undefined }[] = []
    const server = createServer((request, response) => {
      requests.push({ url: request.url, authorization: request.headers.authorization })
      response.writeHead(200).end('dataset')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as AddressInfo
    const tempDir = createTempDir()

    try {
      init({ datasetsEndpoint: `http://127.0.0.1:${address.port}/v1`, apiKey: 'init-api-key' })

      await downloadDatasets({ ...LIVE_DATASET, downloadDir: tempDir })

      assert.deepStrictEqual(requests, [
        { url: '/v1/deribit/trades/2024/01/01/BTC-PERPETUAL.csv.gz', authorization: 'Bearer init-api-key' }
      ])
      assert.strictEqual(readFileSync(path.join(tempDir, 'deribit_trades_2024-01-01_BTC-PERPETUAL.csv.gz'), 'utf8'), 'dataset')
    } finally {
      init()
      rmSync(tempDir, { force: true, recursive: true })
      await new Promise<void>((resolve, reject) => server.close((error) => (error === undefined ? resolve() : reject(error))))
    }
  })
})

describeLive('downloadDatasets live', () => {
  test('downloads public first-day-of-month dataset without api key', { timeout: 60_000 }, async () => {
    const tempDir = createTempDir()
    const filePath = path.join(tempDir, 'deribit_trades_2024-01-01_BTC-PERPETUAL.csv.gz')

    try {
      await downloadDatasets({
        ...LIVE_DATASET,
        downloadDir: tempDir
      })

      assert.strictEqual(existsSync(filePath), true)

      const decompressed = gunzipSync(readFileSync(filePath)).toString('utf8')
      const [header, firstRow] = decompressed.trim().split('\n')

      assert.strictEqual(header, 'exchange,symbol,timestamp,local_timestamp,id,side,price,amount')
      assert.strictEqual(firstRow.startsWith('deribit,BTC-PERPETUAL,'), true)
    } finally {
      rmSync(tempDir, { force: true, recursive: true })
    }
  })

  test('uses custom filename for live download', { timeout: 60_000 }, async () => {
    const tempDir = createTempDir()
    const seenSymbols: string[] = []
    const customFilePath = path.join(tempDir, 'custom/live-file.csv.gz')

    try {
      await downloadDatasets({
        ...LIVE_DATASET,
        downloadDir: tempDir,
        getFilename: ({ symbol }) => {
          seenSymbols.push(symbol)
          return 'custom/live-file.csv.gz'
        }
      })

      assert.deepStrictEqual(seenSymbols, ['BTC-PERPETUAL'])
      assert.strictEqual(existsSync(customFilePath), true)
    } finally {
      rmSync(tempDir, { force: true, recursive: true })
    }
  })
})
