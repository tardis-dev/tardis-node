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
  [key in Exchange]?: new () => Mapper
} = {
  deribit: DeribitMapper,
  bitmex: BitmexMapper,
  okex: OkexMapper,
  bitfinex: BitfinexMapper,
  'bitfinex-derivatives': BitfinexDerivativesMapper,
  binance: BinanceMapper,
  'binance-us': BinanceMapper,
  'binance-jersey': BinanceMapper,
  'binance-dex': BinanceDexMapper,
  'binance-futures': BinanceFuturesMapper,
  coinbase: CoinbaseMapper,
  bitflyer: BitflyerMapper,
  bitstamp: BitstampMapper,
  cryptofacilities: CryptofacilitiesMapper,
  ftx: FtxMapper,
  gemini: GeminiMapper,
  kraken: KrakenMapper
}

export function getMapperFactory(exchange: Exchange): new () => Mapper {
  if (exchangeMapperMap[exchange]) {
    return exchangeMapperMap[exchange]!
  }

  throw new Error(`not supported exchange ${exchange}`)
}

export function createMapper(exchange: Exchange) {
  const MapperClass = getMapperFactory(exchange)

  return new MapperClass()
}

export function setMapperFactory(exchange: Exchange, mapperFactory: new () => Mapper) {
  exchangeMapperMap[exchange] = mapperFactory
}
