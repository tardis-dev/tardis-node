import { jest } from '@jest/globals'
import { findInstrumentSymbols, getInstrumentInfo, init, type InstrumentInfoFilter } from '../dist/index.js'
import { describeLive } from './live.js'

function createFetchMock(...responses: Response[]) {
  const fetchMock = jest.fn<typeof fetch>()

  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response)
  }

  return fetchMock
}

describe('findInstrumentSymbols', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    init()
    jest.restoreAllMocks()
  })

  test('returns dataset ids and falls back to id when datasetId is omitted', async () => {
    global.fetch = createFetchMock(
      new Response(JSON.stringify([{ id: 'btcusdt', datasetId: 'BTCUSDT' }, { id: 'ethusdt' }]), { status: 200 })
    )
    init({ endpoint: 'https://example.com/v1' })

    await expect(findInstrumentSymbols(['binance'], { active: true }, 'datasetId')).resolves.toEqual([
      { exchange: 'binance', symbols: ['BTCUSDT', 'ethusdt'] }
    ])
  })

  test('rejects invalid selector values at runtime', async () => {
    await expect(findInstrumentSymbols(['binance'], { active: true }, 'nativeId' as any)).rejects.toThrow('Invalid selector')
  })
})

describeLive('instrument info live', () => {
  const bitmexXbtUsdPerpetualFilter: InstrumentInfoFilter = {
    baseCurrency: 'BTC',
    quoteCurrency: 'USD',
    type: 'perpetual',
    contractType: 'inverse_perpetual',
    underlyingType: 'native',
    active: true
  }

  afterEach(() => {
    init()
  })

  test('fetches public BitMEX instrument metadata', async () => {
    const instrument = await getInstrumentInfo('bitmex', 'XBTUSD')

    expect(instrument).toMatchObject({
      id: 'XBTUSD',
      datasetId: 'XBTUSD',
      exchange: 'bitmex',
      baseCurrency: 'BTC',
      quoteCurrency: 'USD',
      type: 'perpetual',
      contractType: 'inverse_perpetual',
      underlyingType: 'native',
      active: true
    })
  })

  test('finds public BitMEX symbol ids by metadata filter', async () => {
    await expect(findInstrumentSymbols(['bitmex'], bitmexXbtUsdPerpetualFilter)).resolves.toEqual([
      { exchange: 'bitmex', symbols: ['XBTUSD'] }
    ])
  })

  test('finds public BitMEX dataset ids by metadata filter', async () => {
    await expect(findInstrumentSymbols(['bitmex'], bitmexXbtUsdPerpetualFilter, 'datasetId')).resolves.toEqual([
      { exchange: 'bitmex', symbols: ['XBTUSD'] }
    ])
  })
})
