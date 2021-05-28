import { Filter } from '../types'
import { RealTimeFeedBase } from './realtimefeed'

export class SerumRealTimeFeed extends RealTimeFeedBase {
  protected wssURL = 'wss://api.serum-vial.dev/v1/ws'

  protected channelMappings = {
    trades: ['recent_trades', 'trade'],
    level1: ['quote'],
    level2: ['l2snapshot', 'l2update'],
    level3: ['l3snapshot', 'open', 'fill', 'change', 'done']
  }

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const subs = filters
      .map((filter) => {
        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error('SerumRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
        }

        const subscribeToL3Channel = filters.filter((f) => this.channelMappings.level3.includes(f.channel)).length > 0
        const subscribeToL2Channel = this.channelMappings.level2.includes(filter.channel)
        const subscribeToL1Channel = this.channelMappings.level1.includes(filter.channel)

        let channel

        if (subscribeToL3Channel) {
          channel = 'level3'
        } else if (subscribeToL2Channel) {
          channel = 'level2'
        } else if (subscribeToL1Channel) {
          channel = 'level3'
        } else {
          channel = 'trades'
        }

        return {
          op: 'subscribe',
          channel,
          markets: filter.symbols
        }
      })
      .reduce((prev, current) => {
        const matchingExisting = prev.find((c) => c.channel === current.channel)
        if (matchingExisting !== undefined) {
          for (const market of current.markets) {
            if (matchingExisting.markets.includes(market) === false) {
              matchingExisting.markets.push(market)
            }
          }
        } else {
          prev.push(current)
        }

        return prev
      }, [] as { channel: string; markets: string[] }[])

    return subs
  }

  protected messageIsError(message: any): boolean {
    return message.type === 'error'
  }
}
