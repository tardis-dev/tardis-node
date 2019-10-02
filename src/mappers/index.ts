import { Mapper } from './mapper'
import { DeribitMapper } from './deribit'
import { BitmexMapper } from './bitmex'
import { OkexMapper } from './okex'
import { BitfinexMapper, BitfinexDerivativesMapper } from './bitfinex'
import { BinanceMapper, BinanceFuturesMapper } from './binance'
import { BinanceDexMapper } from './binancedex'
import { Exchange } from '../types'

export * from './mapper'

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
  'binance-futures': BinanceFuturesMapper
}

export function getMapper(exchange: Exchange) {
  if (exchangeMapperMap[exchange]) {
    return new exchangeMapperMap[exchange]!()
  }

  throw new Error(`not supported exchange ${exchange}`)
}

export function setMapper(exchange: Exchange, mapper: new () => Mapper) {
  exchangeMapperMap[exchange] = mapper
}
