import { randomUUID } from 'node:crypto'
import { Filter } from '../types.ts'
import { RealTimeFeedBase } from './realtimefeed.ts'

export class BithumbRealTimeFeed extends RealTimeFeedBase {
  protected readonly wssURL = 'wss://ws-api.bithumb.com/websocket/v1'
  private readonly channels = new Set(['trade', 'orderbook', 'ticker'])

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const subscriptions = filters.map((filter) => {
      if (!this.channels.has(filter.channel)) {
        throw new Error(`BithumbRealTimeFeed unsupported channel ${filter.channel}`)
      }

      if (!filter.symbols || filter.symbols.length === 0) {
        throw new Error('BithumbRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
      }

      const subscription = {
        type: filter.channel,
        codes: filter.symbols
      }

      return filter.channel === 'orderbook' ? { ...subscription, level: 1 } : subscription
    })

    return [[{ ticket: randomUUID() }, ...subscriptions, { format: 'DEFAULT' }]]
  }

  protected messageIsError(message: any): boolean {
    return message.error !== undefined
  }
}
