import { wait } from '../handy'
import { Filter } from '../types'
import { RealTimeFeedBase } from './realtimefeed'

export class WooxRealTimeFeed extends RealTimeFeedBase {
  protected wssURL = 'wss://wss.woo.org/ws/stream/OqdphuyCtYWxwzhxyLLjOWNdFP7sQt8RPWzmb5xY'

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    return filters
      .filter((filter) => filter.channel !== 'orderbook')
      .map((filter) => {
        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error('WooxRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
        }

        return filter.symbols.map((symbol) => {
          return {
            id: `${symbol}@${filter.channel}`,
            topic: `${symbol}@${filter.channel}`,
            event: 'subscribe'
          }
        })
      })
      .flatMap((f) => f)
  }

  protected async provideManualSnapshots(filters: Filter<string>[], shouldCancel: () => boolean) {
    const orderbookFilter = filters.find((f) => f.channel === 'orderbook')
    if (!orderbookFilter) {
      return
    }

    await wait(200)

    for (let symbol of orderbookFilter.symbols!) {
      if (shouldCancel()) {
        return
      }

      this.send({
        id: `${symbol}@orderbook`,
        event: 'request',
        params: {
          type: 'orderbook',
          symbol
        }
      })

      await wait(1)
    }

    this.debug('sent orderbook requests for: %s', orderbookFilter.symbols)
  }

  protected messageIsError(message: any): boolean {
    return message.success === false || message.errorMsg !== undefined
  }

  protected messageIsHeartbeat(message: any): boolean {
    return message.event === 'ping'
  }

  protected onMessage(msg: any) {
    if (msg.event === 'ping') {
      this.send({
        event: 'ping'
      })
    }
  }
}
