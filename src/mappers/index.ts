import { Mapper } from './mapper'
import { DeribitMapper } from './deribit'
import { Exchange } from '..'

export * from './mapper'

const exchangeMapperMap: {
  [key in Exchange]?: new (symbols: string[]) => Mapper<key>
} = {
  deribit: DeribitMapper
}

export function getMapper<T extends Exchange>({ exchange, symbols }: { exchange: T; symbols: string[] }) {
  if (exchangeMapperMap[exchange]) {
    return new exchangeMapperMap[exchange]!(symbols)
  }

  throw new Error(`not supported exchange ${exchange}`)
}
