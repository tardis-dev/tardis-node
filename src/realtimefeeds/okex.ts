import { promisify } from 'util'
import zlib from 'zlib'
import { Filter } from '../types'
import { RealTimeFeedBase } from './realtimefeed'

const inflateRaw = promisify(zlib.inflateRaw)
const pongBuffer = Buffer.from('pong')

export class OkexRealTimeFeed extends RealTimeFeedBase {
  protected wssURL = 'wss://real.okex.com:8443/ws/v3'

  protected decompress = async (message: any) => {
    message = (await inflateRaw(message)) as Buffer
    if (message.equals(pongBuffer)) {
      return
    }

    return message
  }

  protected mapToSubscribeMessages(filters: Filter<string>[]): string | any[] {
    const args = filters
      .map(filter => {
        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error('OkexRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
        }
        return filter.symbols.map(symbol => {
          return `${filter.channel}:${symbol}`
        })
      })
      .flatMap(s => s)

    return [
      {
        op: 'subscribe',
        args
      }
    ]
  }

  protected messageIsError(message: any): boolean {
    return message.event === 'error'
  }
}
