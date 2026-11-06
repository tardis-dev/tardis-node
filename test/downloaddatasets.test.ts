import { describe, test } from 'node:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type RequestListener, type ServerResponse } from 'node:http'
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

const RANGE_SIZE = 64 * 1024 * 1024
const LARGE_DATASET_PATH = 'deribit_trades_2024-01-01_BTC-PERPETUAL.csv.gz'

function createTempDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'tardis-node-download-datasets-'))
}

function sendRange(request: IncomingMessage, response: ServerResponse, body: Buffer, headers: Record<string, string> = {}) {
  const [start, end] = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range!)!.slice(1).map(Number)
  if (start >= body.length) {
    response.writeHead(416).end()
    return
  }
  const lastByte = Math.min(end, body.length - 1)
  response
    .writeHead(206, { ...headers, 'content-range': `bytes ${start}-${lastByte}/${body.length}`, 'content-length': lastByte - start + 1 })
    .end(body.subarray(start, lastByte + 1))
}

async function listen(handler: RequestListener) {
  const server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error === undefined ? resolve() : reject(error))))
  }
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

describe('downloadDatasets in byte ranges', () => {
  test('downloads a large dataset in byte ranges through the API', async () => {
    const dataset = randomBytes(2 * RANGE_SIZE + 1000)
    const ranges: (string | undefined)[] = []
    const api = await listen((request, response) => {
      ranges.push(request.headers.range)
      sendRange(request, response, dataset)
    })
    const tempDir = createTempDir()

    try {
      init({ datasetsEndpoint: `${api.url}/v1`, apiKey: 'api-key' })
      await downloadDatasets({ ...LIVE_DATASET, downloadDir: tempDir })

      assert.strictEqual(readFileSync(path.join(tempDir, LARGE_DATASET_PATH)).equals(dataset), true)
      assert.strictEqual(ranges[0], `bytes=0-${RANGE_SIZE - 1}`)
      assert.deepStrictEqual(
        ranges.slice(1).sort(),
        [`bytes=${RANGE_SIZE}-${2 * RANGE_SIZE - 1}`, `bytes=${2 * RANGE_SIZE}-${3 * RANGE_SIZE - 1}`].sort()
      )
    } finally {
      init()
      rmSync(tempDir, { force: true, recursive: true })
      await api.close()
    }
  })

  test('reuses a storage redirect for the remaining ranges and renews it after it expires, past a failed renewal', async () => {
    const dataset = randomBytes(2 * RANGE_SIZE + 1000)
    const apiAuthorizations: (string | undefined)[] = []
    const storageAuthorizations: (string | undefined)[] = []
    const storage = await listen((request, response) => {
      storageAuthorizations.push(request.headers.authorization)
      if (request.url === '/dataset?signature=first' && request.headers.range !== `bytes=0-${RANGE_SIZE - 1}`) {
        response.writeHead(403).end('Request has expired')
        return
      }
      sendRange(request, response, dataset)
    })
    const api = await listen((request, response) => {
      apiAuthorizations.push(request.headers.authorization)
      if (apiAuthorizations.length === 2) {
        response.writeHead(500, { 'content-type': 'application/json' }).end('{"code":100,"message":"Internal error"}')
        return
      }
      response
        .writeHead(302, { location: `${storage.url}/dataset?signature=${apiAuthorizations.length === 1 ? 'first' : 'renewed'}` })
        .end()
    })
    const tempDir = createTempDir()

    try {
      init({ datasetsEndpoint: `${api.url}/v1`, apiKey: 'api-key' })
      await downloadDatasets({ ...LIVE_DATASET, downloadDir: tempDir })

      assert.strictEqual(readFileSync(path.join(tempDir, LARGE_DATASET_PATH)).equals(dataset), true)
      // The first range, then one range for the failed renewal and one for the renewal, all with the key.
      assert.deepStrictEqual(apiAuthorizations, ['Bearer api-key', 'Bearer api-key', 'Bearer api-key'])
      assert.deepStrictEqual(new Set(storageAuthorizations), new Set([undefined]))
    } finally {
      init()
      rmSync(tempDir, { force: true, recursive: true })
      await api.close()
      await storage.close()
    }
  })

  test('fails with the API error when the API refuses to renew an expired storage redirect', async () => {
    const dataset = randomBytes(2 * RANGE_SIZE + 1000)
    let apiRequests = 0
    const storage = await listen((request, response) => {
      if (request.headers.range !== `bytes=0-${RANGE_SIZE - 1}`) {
        response.writeHead(403).end('Request has expired')
        return
      }
      sendRange(request, response, dataset)
    })
    const api = await listen((_, response) => {
      apiRequests++
      if (apiRequests === 1) {
        response.writeHead(302, { location: `${storage.url}/dataset` }).end()
        return
      }
      response.writeHead(401, { 'content-type': 'application/json' }).end('{"code":11,"message":"Invalid API key"}')
    })
    const tempDir = createTempDir()

    try {
      init({ datasetsEndpoint: `${api.url}/v1`, apiKey: 'api-key' })
      await assert.rejects(downloadDatasets({ ...LIVE_DATASET, downloadDir: tempDir }), { status: 401 })
      assert.strictEqual(apiRequests, 2)
    } finally {
      init()
      rmSync(tempDir, { force: true, recursive: true })
      await api.close()
      await storage.close()
    }
  })

  test('waits for Retry-After when a range is rate limited', async () => {
    const dataset = randomBytes(RANGE_SIZE + 1000)
    const requests: { request: string; at: number }[] = []
    const api = await listen((request, response) => {
      requests.push({ request: `${request.url} ${request.headers.range}`, at: performance.now() })
      if (requests.length === 2) {
        response.writeHead(429, { 'Retry-After': '1' }).end('rate limited')
        return
      }
      sendRange(request, response, dataset)
    })
    const tempDir = createTempDir()

    try {
      init({ datasetsEndpoint: `${api.url}/v1`, apiKey: 'api-key' })
      await downloadDatasets({ ...LIVE_DATASET, downloadDir: tempDir })

      assert.strictEqual(readFileSync(path.join(tempDir, LARGE_DATASET_PATH)).equals(dataset), true)
      const datasetUrl = '/v1/deribit/trades/2024/01/01/BTC-PERPETUAL.csv.gz'
      const secondRange = `bytes=${RANGE_SIZE}-${2 * RANGE_SIZE - 1}`
      assert.deepStrictEqual(
        requests.map(({ request }) => request),
        [`${datasetUrl} bytes=0-${RANGE_SIZE - 1}`, `${datasetUrl} ${secondRange}`, `${datasetUrl}?retryAttempt=1 ${secondRange}`]
      )
      const retryDelayMS = requests[2].at - requests[1].at
      assert.ok(retryDelayMS >= 950 && retryDelayMS < 5000, `retried after ${retryDelayMS} ms`)
    } finally {
      init()
      rmSync(tempDir, { force: true, recursive: true })
      await api.close()
    }
  })

  test('with verifyMd5, downloads the dataset again when its ranges do not match the announced MD5', async () => {
    const dataset = randomBytes(RANGE_SIZE + 1000)
    const md5 = createHash('md5').update(dataset).digest('hex')
    const ranges: (string | undefined)[] = []
    const api = await listen((request, response) => {
      ranges.push(request.headers.range)
      const corrupted = ranges.length === 2 ? Buffer.concat([dataset.subarray(0, RANGE_SIZE), randomBytes(1000)]) : dataset
      sendRange(request, response, corrupted, { 'x-md5': `"${md5}"` })
    })
    const tempDir = createTempDir()

    try {
      init({ datasetsEndpoint: `${api.url}/v1`, apiKey: 'api-key' })
      await downloadDatasets({ ...LIVE_DATASET, downloadDir: tempDir, verifyMd5: true })

      assert.strictEqual(readFileSync(path.join(tempDir, LARGE_DATASET_PATH)).equals(dataset), true)
      const firstRange = `bytes=0-${RANGE_SIZE - 1}`
      const secondRange = `bytes=${RANGE_SIZE}-${2 * RANGE_SIZE - 1}`
      assert.deepStrictEqual(ranges, [firstRange, secondRange, firstRange, secondRange])
    } finally {
      init()
      rmSync(tempDir, { force: true, recursive: true })
      await api.close()
    }
  })

  test('with verifyMd5, keeps a dataset whose storage ETag is multipart and not a file MD5', async () => {
    let requests = 0
    const api = await listen((request, response) => {
      requests++
      sendRange(request, response, Buffer.from('dataset'), { etag: '"0123456789abcdef0123456789abcdef-3"' })
    })
    const tempDir = createTempDir()

    try {
      init({ datasetsEndpoint: `${api.url}/v1` })
      await downloadDatasets({ ...LIVE_DATASET, downloadDir: tempDir, verifyMd5: true })

      assert.strictEqual(requests, 1)
      assert.strictEqual(readFileSync(path.join(tempDir, LARGE_DATASET_PATH), 'utf8'), 'dataset')
    } finally {
      init()
      rmSync(tempDir, { force: true, recursive: true })
      await api.close()
    }
  })

  for (const [change, exportedAgainSize] of [
    ['larger', 2 * RANGE_SIZE + 2000],
    ['smaller', RANGE_SIZE + 1000],
    ['with the same size', 2 * RANGE_SIZE + 1000]
  ] as const) {
    test(`starts over when the dataset is exported again ${change} during download`, async () => {
      const exported = randomBytes(2 * RANGE_SIZE + 1000)
      const exportedAgain = randomBytes(exportedAgainSize)
      let requests = 0
      const api = await listen((request, response) => {
        requests++
        const dataset = requests === 1 ? exported : exportedAgain
        // Only an export with the same size depends on the announced MD5; the others must start over on the size alone.
        const headers: Record<string, string> =
          exportedAgainSize === exported.length ? { 'x-md5': `"${createHash('md5').update(dataset).digest('hex')}"` } : {}
        sendRange(request, response, dataset, headers)
      })
      const tempDir = createTempDir()

      try {
        init({ datasetsEndpoint: `${api.url}/v1`, apiKey: 'api-key' })
        await downloadDatasets({ ...LIVE_DATASET, downloadDir: tempDir })

        assert.strictEqual(readFileSync(path.join(tempDir, LARGE_DATASET_PATH)).equals(exportedAgain), true)
      } finally {
        init()
        rmSync(tempDir, { force: true, recursive: true })
        await api.close()
      }
    })
  }
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
