import { Filter } from '../types.ts'
import { RealTimeFeedBase } from './realtimefeed.ts'

export class KrakenRealTimeFeed extends RealTimeFeedBase {
  private readonly channels = new Set(['trade', 'book', 'ticker'])
  protected wssURL = 'wss://ws.kraken.com/v2'

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    return filters.flatMap(({ channel, symbols }): any[] => {
      if (!symbols || symbols.length === 0) {
        throw new Error('KrakenRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
      }

      if (!this.channels.has(channel)) {
        throw new Error(`KrakenRealTimeFeed unsupported channel ${channel}`)
      }

      return [
        {
          method: 'subscribe',
          params: {
            channel,
            symbol: symbols,
            ...(channel === 'ticker' ? { event_trigger: 'bbo' } : {}),
            ...(channel === 'book' ? { depth: 1000 } : {})
          }
        }
      ]
    })
  }

  protected messageIsError(message: any): boolean {
    return message.errorMessage !== undefined || message.success === false
  }

  protected messageIsHeartbeat(message: any): boolean {
    return message.event === 'heartbeat' || message.channel === 'heartbeat'
  }
}
