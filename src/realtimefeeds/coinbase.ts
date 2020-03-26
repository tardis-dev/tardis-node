import { Filter } from '../types'
import { RealTimeFeedBase } from './realtimefeed'

export class CoinbaseRealTimeFeed extends RealTimeFeedBase {
  protected wssURL = 'wss://ws-feed.pro.coinbase.com'

  // map from coinbase subscribe 'channels' to more granular channels that tardis uses

  protected channelMappings = {
    full: ['received', 'open', 'done', 'match', 'change', 'full_snapshot'],
    level2: ['snapshot', 'l2update'],
    matches: ['match', 'last_match'],
    ticker: ['ticker']
  }

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const channelsToSubscribe = filters
      .map((filter) => {
        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error('CoinbaseRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
        }

        const subscribeToFullChannel =
          filters.filter((f) => this.channelMappings.full.includes(f.channel) && f.channel !== 'match').length > 0
        const subscribeToLevel2Channel = this.channelMappings.level2.includes(filter.channel)
        const subscribeToMatchesChannel = this.channelMappings.matches.includes(filter.channel)
        let channel

        if (subscribeToFullChannel) {
          channel = 'full'
        } else if (subscribeToLevel2Channel) {
          channel = 'level2'
        } else if (subscribeToMatchesChannel) {
          channel = 'matches'
        } else {
          channel = 'ticker'
        }

        return {
          name: channel,
          product_ids: filter.symbols
        }
      })
      .reduce((prev, current) => {
        const matchingExisting = prev.find((c) => c.name === current.name)
        if (matchingExisting !== undefined) {
          for (const symbol of current.product_ids) {
            if (matchingExisting.product_ids.includes(symbol) === false) {
              matchingExisting.product_ids.push(symbol)
            }
          }
        } else {
          prev.push(current)
        }

        return prev
      }, [] as { name: string; product_ids: string[] }[])

    return [
      {
        type: 'subscribe',
        channels: channelsToSubscribe
      }
    ]
  }

  protected messageIsError(message: any): boolean {
    return message.type === 'error'
  }
}
