import { Mapper } from './mapper'
import { DeribitMapper } from './deribit'
import { BitmexMapper } from './bitmex'
import { OkexMapper } from './okex'
import { BitfinexMapper, BitfinexDerivativesMapper } from './bitfinex'
import { BinanceMapper, BinanceFuturesMapper } from './binance'
import { BinanceDexMapper } from './binancedex'
import { Exchange } from '../types'
import { CoinbaseMapper } from './coinbase'

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
  coinbase: CoinbaseMapper
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

export function setMapperFactory(exchange: Exchange, mapper: new () => Mapper) {
  exchangeMapperMap[exchange] = mapper
}
