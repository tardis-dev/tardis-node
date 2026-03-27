import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'os'
import path from 'path'
import { gunzipSync } from 'node:zlib'
import { downloadDatasets, sanitizeForFilename } from '../dist/downloaddatasets.js'
import { describeLive } from './live.js'

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
    expect(sanitizeForFilename('a?b/c:d*e<f>g|h"i\\j')).toBe('a-b-c-d-e-f-g-h-i-j')
  })

  test('leaves normal symbols unchanged', () => {
    expect(sanitizeForFilename('BTCUSDT')).toBe('BTCUSDT')
    expect(sanitizeForFilename('BTC-USDT')).toBe('BTC-USDT')
    expect(sanitizeForFilename('BTC_USDT')).toBe('BTC_USDT')
  })
})

describe('downloadDatasets', () => {
  test('skipIfExists leaves existing file untouched', async () => {
    const tempDir = createTempDir()
    const existingFile = path.join(tempDir, 'deribit_trades_2024-01-01_BTC-PERPETUAL.csv.gz')

    try {
      writeFileSync(existingFile, 'existing')

      await downloadDatasets({
        ...LIVE_DATASET,
        downloadDir: tempDir,
        skipIfExists: true
      })

      expect(readFileSync(existingFile, 'utf8')).toBe('existing')
    } finally {
      rmSync(tempDir, { force: true, recursive: true })
    }
  })
})

describeLive('downloadDatasets live', () => {
  test('downloads public first-day-of-month dataset without api key', async () => {
    const tempDir = createTempDir()
    const filePath = path.join(tempDir, 'deribit_trades_2024-01-01_BTC-PERPETUAL.csv.gz')

    try {
      await downloadDatasets({
        ...LIVE_DATASET,
        downloadDir: tempDir
      })

      expect(existsSync(filePath)).toBe(true)

      const decompressed = gunzipSync(readFileSync(filePath)).toString('utf8')
      const [header, firstRow] = decompressed.trim().split('\n')

      expect(header).toBe('exchange,symbol,timestamp,local_timestamp,id,side,price,amount')
      expect(firstRow.startsWith('deribit,BTC-PERPETUAL,')).toBe(true)
    } finally {
      rmSync(tempDir, { force: true, recursive: true })
    }
  }, 60_000)

  test('uses custom filename for live download', async () => {
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

      expect(seenSymbols).toEqual(['BTC-PERPETUAL'])
      expect(existsSync(customFilePath)).toBe(true)
    } finally {
      rmSync(tempDir, { force: true, recursive: true })
    }
  }, 60_000)
})
