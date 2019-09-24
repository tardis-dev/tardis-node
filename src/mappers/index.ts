import { Mapper } from './mapper'
import { DeribitMapper } from './deribit'
import { Exchange } from '..'
import { BitmexMapper } from './bitmex'

export * from './mapper'

const exchangeMapperMap: {
  [key in Exchange]?: new () => Mapper<key>
} = {
  deribit: DeribitMapper,
  bitmex: BitmexMapper
}

export function getMapper(exchange: Exchange) {
  if (exchangeMapperMap[exchange]) {
    return new exchangeMapperMap[exchange]!()
  }

  throw new Error(`not supported exchange ${exchange}`)
}
