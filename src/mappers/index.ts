import { Mapper } from './mapper'
import { DeribitMapper } from './deribit'
import { BitmexMapper } from './bitmex'
import { OkexMapper } from './okex'
import { BitfinexMapper, BitfinexDerivativesMapper } from './bitfinex'
import { BinanceMapper, BinanceFuturesMapper } from './binance'
import { BinanceDexMapper } from './binancedex'
import { Exchange } from '../types'
import { CoinbaseMapper } from './coinbase'
import { BitflyerMapper } from './bitflyer'
import { BitstampMapper } from './bitstamp'
import { CryptofacilitiesMapper } from './cryptofacilities'
import { FtxMapper } from './ftx'
import { GeminiMapper } from './gemini'
import { KrakenMapper } from './kraken'

export { Mapper } from './mapper'

const exchangeMapperMap: {
  [key in Exchange]?: () => Mapper
} = {
  deribit: () => new DeribitMapper('deribit'),
  bitmex: () => new BitmexMapper('bitmex'),
  okex: () => new OkexMapper('okex'),
  bitfinex: () => new BitfinexMapper('bitfinex'),
  'bitfinex-derivatives': () => new BitfinexDerivativesMapper('bitfinex-derivatives'),
  binance: () => new BinanceMapper('binance'),
  'binance-us': () => new BinanceMapper('binance-us'),
  'binance-jersey': () => new BinanceMapper('binance-jersey'),
  'binance-dex': () => new BinanceDexMapper('binance-dex'),
  'binance-futures': () => new BinanceFuturesMapper('binance-futures'),
  coinbase: () => new CoinbaseMapper('coinbase'),
  bitflyer: () => new BitflyerMapper('bitflyer'),
  bitstamp: () => new BitstampMapper('bitstamp'),
  cryptofacilities: () => new CryptofacilitiesMapper('cryptofacilities'),
  ftx: () => new FtxMapper('ftx'),
  gemini: () => new GeminiMapper('gemini'),
  kraken: () => new KrakenMapper('kraken')
}

export function getMapperFactory(exchange: Exchange): () => Mapper {
  if (exchangeMapperMap[exchange]) {
    return exchangeMapperMap[exchange]!
  }

  throw new Error(`not supported exchange ${exchange}`)
}

export function createMapper(exchange: Exchange) {
  const MapperFactory = getMapperFactory(exchange)

  return MapperFactory()
}

export function setMapperFactory(exchange: Exchange, mapperFactory: () => Mapper) {
  exchangeMapperMap[exchange] = mapperFactory
}
