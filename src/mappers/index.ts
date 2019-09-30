import { Mapper } from './mapper'
import { DeribitMapper } from './deribit'
import { Exchange } from '..'
import { BitmexMapper } from './bitmex'
import { OkexMapper } from './okex'
import { BitfinexMapper } from './bitfinex'
import { BinanceMapper } from './binance'

export * from './mapper'

const exchangeMapperMap: {
  [key in Exchange]?: new () => Mapper
} = {
  deribit: DeribitMapper,
  bitmex: BitmexMapper,
  okex: OkexMapper,
  bitfinex: BitfinexMapper,
  'bitfinex-derivatives': BitfinexMapper,
  binance: BinanceMapper,
  'binance-us': BinanceMapper,
  'binance-jersey': BinanceMapper
}

export function getMapper(exchange: Exchange) {
  if (exchangeMapperMap[exchange]) {
    return new exchangeMapperMap[exchange]!()
  }

  throw new Error(`not supported exchange ${exchange}`)
}
