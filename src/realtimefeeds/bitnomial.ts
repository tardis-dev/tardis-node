import { Filter } from '../types'
import { RealTimeFeedBase } from './realtimefeed'

export class BitnomialRealTimeFeed extends RealTimeFeedBase {
  protected wssURL = 'wss://bitnomial.com/exchange/ws'

  protected channelMappings = {
    book: ['book', 'level']
  }

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const channelsToSubscribe = filters
      .map((filter) => {
        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error('BitnomialRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
        }
        const subscribeToBookChannel = this.channelMappings.book.includes(filter.channel)
        let channel
        if (subscribeToBookChannel) {
          channel = 'book'
        } else {
          channel = filter.channel
        }

        return {
          name: channel,
          product_codes: filter.symbols
        }
      })
      .reduce((prev, current) => {
        const matchingExisting = prev.find((c) => c.name === current.name)
        if (matchingExisting !== undefined) {
          for (const symbol of current.product_codes) {
            if (matchingExisting.product_codes.includes(symbol) === false) {
              matchingExisting.product_codes.push(symbol)
            }
          }
        } else {
          prev.push(current)
        }

        return prev
      }, [] as { name: string; product_codes: string[] }[])

    return [
      {
        type: 'subscribe',
        product_codes: [],
        channels: channelsToSubscribe
      }
    ]
  }

  protected messageIsError(message: any): boolean {
    return message.type === 'error' || message.type === 'disconnect'
  }
}
