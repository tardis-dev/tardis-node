import { RealTimeStream } from './realtimestream'
import { Exchange } from '../types'
import { BitmexRealTimeStream } from './bitmex'
import { BinanceRealTimeStream, BinanceJerseyRealTimeStream, BinanceUSRealTimeStream } from './binance'

export * from './realtimestream'

const realTimeStreamsMap: {
  [key in Exchange]?: new () => RealTimeStream
} = {
  bitmex: BitmexRealTimeStream,
  binance: BinanceRealTimeStream,
  'binance-jersey': BinanceJerseyRealTimeStream,
  'binance-us': BinanceUSRealTimeStream
}

export function getRealTimeStreamFactory(exchange: Exchange): new () => RealTimeStream {
  if (realTimeStreamsMap[exchange]) {
    return realTimeStreamsMap[exchange]!
  }

  throw new Error(`not supported exchange ${exchange}`)
}

export function createRealTimeStream(exchange: Exchange) {
  const RealTimeStreamClass = getRealTimeStreamFactory(exchange)

  return new RealTimeStreamClass()
}

export function setRealTimeStreamFactory(exchange: Exchange, realTimStreamFactory: new () => RealTimeStream) {
  realTimeStreamsMap[exchange] = realTimStreamFactory
}
