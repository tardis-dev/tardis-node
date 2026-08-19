import { afterEach, describe, test } from 'node:test'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { assert } from './assertions.ts'
import { findInstrumentSymbols, getInstrumentInfo, init, type InstrumentInfoFilter } from '../dist/index.js'
import { describeLive } from './live.ts'

describe('findInstrumentSymbols', () => {
  test('does not return unavailable datasets when datasetId is requested', async () => {
    let requestUrl: string | undefined
    const server = createServer((request, response) => {
      requestUrl = request.url
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify([{ id: 'btcusdt', datasetId: 'BTCUSDT' }, { id: 'ethusdt' }]))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as AddressInfo

    try {
      init({ endpoint: `http://127.0.0.1:${address.port}/v1` })

      assert.deepStrictEqual(await findInstrumentSymbols(['binance'], { active: true }, 'datasetId'), [
        { exchange: 'binance', symbols: ['BTCUSDT'] }
      ])
      const request = new URL(requestUrl ?? '', 'http://localhost')
      assert.strictEqual(request.pathname, '/v1/instruments/binance')
      assert.deepStrictEqual(JSON.parse(request.searchParams.get('filter') ?? ''), { active: true })
    } finally {
      init()
      await new Promise<void>((resolve, reject) => server.close((error) => (error === undefined ? resolve() : reject(error))))
    }
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

  test('fetches and filters public BitMEX instrument metadata', async () => {
    const instrument = await getInstrumentInfo('bitmex', 'XBTUSD')

    assert.partialDeepStrictEqual(instrument, {
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

    assert.deepStrictEqual(await findInstrumentSymbols(['bitmex'], bitmexXbtUsdPerpetualFilter), [
      { exchange: 'bitmex', symbols: ['XBTUSD'] }
    ])
    assert.deepStrictEqual(await findInstrumentSymbols(['bitmex'], bitmexXbtUsdPerpetualFilter, 'datasetId'), [
      { exchange: 'bitmex', symbols: ['XBTUSD'] }
    ])
  })
})
