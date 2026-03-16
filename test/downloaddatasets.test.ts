import { downloadDatasets, sanitizeForFilename } from '../dist'

// mock the download function from handy module to capture URLs and paths without making real HTTP requests
const downloadCalls: { url: string; downloadPath: string }[] = []

jest.mock('../dist/handy', () => {
  const actual = jest.requireActual('../dist/handy')
  return {
    ...actual,
    download: async (opts: { url: string; downloadPath: string }) => {
      downloadCalls.push({ url: opts.url, downloadPath: opts.downloadPath })
    }
  }
})

// mock existsSync to always return false so downloads are not skipped
jest.mock('fs-extra', () => {
  const actual = jest.requireActual('fs-extra')
  return {
    ...actual,
    existsSync: () => false
  }
})

describe('sanitizeForFilename', () => {
  test('replaces question marks', () => {
    expect(sanitizeForFilename('??USDT')).toBe('--USDT')
  })

  test('replaces backslash', () => {
    expect(sanitizeForFilename('A\\B')).toBe('A-B')
  })

  test('replaces forward slash', () => {
    expect(sanitizeForFilename('BTC/USD')).toBe('BTC-USD')
  })

  test('replaces asterisk, angle brackets, pipe, double quote', () => {
    expect(sanitizeForFilename('a*b<c>d|e"f')).toBe('a-b-c-d-e-f')
  })

  test('leaves normal symbols unchanged', () => {
    expect(sanitizeForFilename('BTCUSDT')).toBe('BTCUSDT')
    expect(sanitizeForFilename('BTC-USDT')).toBe('BTC-USDT')
    expect(sanitizeForFilename('BTC_USDT')).toBe('BTC_USDT')
  })
})

describe('downloadDatasets URL encoding and filename sanitization', () => {
  beforeEach(() => {
    downloadCalls.length = 0
  })

  test('URL-encodes special characters in symbol for API request', async () => {
    await downloadDatasets({
      exchange: 'bitget-futures' as any,
      dataTypes: ['derivative_ticker'],
      symbols: ['??USDT'],
      from: '2026-03-13',
      to: '2026-03-14',
      apiKey: 'test'
    })

    expect(downloadCalls.length).toBe(1)
    // URL should contain %3F%3F (encoded ??) not literal ??
    expect(downloadCalls[0].url).toContain('%3F%3FUSDT')
    expect(downloadCalls[0].url).not.toContain('???')
  })

  test('sanitizes special characters in default filename', async () => {
    await downloadDatasets({
      exchange: 'bitget-futures' as any,
      dataTypes: ['derivative_ticker'],
      symbols: ['??USDT'],
      from: '2026-03-13',
      to: '2026-03-14',
      apiKey: 'test'
    })

    expect(downloadCalls.length).toBe(1)
    // filename should have ?? replaced with --
    expect(downloadCalls[0].downloadPath).toContain('--USDT')
    expect(downloadCalls[0].downloadPath).not.toContain('??')
  })

  test('normal symbols are not mangled in URL', async () => {
    await downloadDatasets({
      exchange: 'binance-futures' as any,
      dataTypes: ['trades'],
      symbols: ['BTCUSDT'],
      from: '2026-03-13',
      to: '2026-03-14',
      apiKey: 'test'
    })

    expect(downloadCalls.length).toBe(1)
    expect(downloadCalls[0].url).toContain('/BTCUSDT.csv.gz')
    expect(downloadCalls[0].downloadPath).toContain('BTCUSDT')
  })

  test('colon and slash in symbols are normalized to dash (existing behavior)', async () => {
    await downloadDatasets({
      exchange: 'binance' as any,
      dataTypes: ['trades'],
      symbols: ['BTC/USDT', 'BTC:USDT'],
      from: '2026-03-13',
      to: '2026-03-14',
      apiKey: 'test'
    })

    expect(downloadCalls.length).toBe(2)
    expect(downloadCalls[0].url).toContain('/BTC-USDT.csv.gz')
    expect(downloadCalls[1].url).toContain('/BTC-USDT.csv.gz')
  })

  test('custom getFilename receives original (unsanitized) symbol', async () => {
    const receivedSymbols: string[] = []

    await downloadDatasets({
      exchange: 'bitget-futures' as any,
      dataTypes: ['derivative_ticker'],
      symbols: ['??USDT'],
      from: '2026-03-13',
      to: '2026-03-14',
      apiKey: 'test',
      getFilename: (opts) => {
        receivedSymbols.push(opts.symbol)
        return `custom_${opts.symbol}.csv.gz`
      }
    })

    // custom getFilename should get the symbol after /: normalization but before filename sanitization
    // so it gets ??USDT (uppercased, but ? not stripped — user's responsibility to handle in custom fn)
    expect(receivedSymbols[0]).toBe('??USDT')
  })
})
