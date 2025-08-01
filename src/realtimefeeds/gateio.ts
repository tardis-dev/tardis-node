import { httpClient } from '../handy'
import { Filter } from '../types'
import { RealTimeFeedBase } from './realtimefeed'

export class GateIORealTimeFeed extends RealTimeFeedBase {
  protected readonly wssURL = 'wss://api.gateio.ws/ws/v4/'
  protected httpURL = 'https://api.gateio.ws/api/v4'

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const payload = filters.map((filter) => {
      if (!filter.symbols || filter.symbols.length === 0) {
        throw new Error('GateIORealTimeFeed requires explicitly specified symbols when subscribing to live feed')
      }

      if (filter.channel === 'obu') {
        return filter.symbols!.map((symbol) => {
          return {
            time: new Date().valueOf(),
            channel: `spot.${filter.channel}`,
            event: 'subscribe',
            payload: [`ob.${symbol}.400`]
          }
        })
      } else {
        return filter.symbols!.map((symbol) => {
          return {
            time: new Date().valueOf(),
            channel: `spot.${filter.channel}`,
            event: 'subscribe',
            method: `${filter.channel}.subscribe`,
            payload: [symbol]
          }
        })
      }
    })

    return payload.flatMap((f) => f)
  }

  protected messageIsError(message: any): boolean {
    if (message.error !== null && message.error !== undefined) {
      return true
    }

    return false
  }
}
