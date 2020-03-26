import { Filter } from '../types'
import { RealTimeFeedBase } from './realtimefeed'

export class HitBtcRealTimeFeed extends RealTimeFeedBase {
  protected wssURL = 'wss://api.hitbtc.com/api/2/ws'

  protected channelMappings = {
    subscribeOrderbook: ['snapshotOrderbook', 'updateOrderbook'],
    subscribeTrades: ['updateTrades', 'snapshotTrades']
  }

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const subscriptions = filters
      .map((filter) => {
        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error('HitBtcRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
        }

        const subscribeToOrderBook = this.channelMappings.subscribeOrderbook.includes(filter.channel)
        const subscribeToTrades = this.channelMappings.subscribeTrades.includes(filter.channel)
        let method: string

        if (subscribeToOrderBook) {
          method = 'subscribeOrderbook'
        } else if (subscribeToTrades) {
          method = 'subscribeTrades'
        } else {
          throw new Error(`Invalid channel: ${filter.channel}`)
        }

        return filter.symbols.map((symbol) => {
          return {
            method,
            symbol
          }
        })
      })
      .flatMap((s) => s)
      .reduce((prev, current) => {
        const matchingExisting = prev.find((c) => c.method === current.method && c.symbol === current.symbol)
        if (matchingExisting === undefined) {
          prev.push(current)
        }

        return prev
      }, [] as { method: string; symbol: string }[])

    return subscriptions.map((subscription, index) => {
      return {
        method: subscription.method,
        params: {
          symbol: subscription.symbol
        },
        id: index + 1
      }
    })
  }

  protected messageIsError(message: any): boolean {
    return message.error !== undefined
  }
}
