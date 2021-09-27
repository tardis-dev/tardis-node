import { Filter } from '../types'
import { RealTimeFeedBase } from './realtimefeed'

export class GateIORealTimeFeed extends RealTimeFeedBase {
  protected readonly wssURL = 'wss://ws.gate.io/v3/'

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const id = 1
    const payload = filters.map((filter) => {
      if (!filter.symbols || filter.symbols.length === 0) {
        throw new Error('GateIORealTimeFeed requires explicitly specified symbols when subscribing to live feed')
      }

      if (filter.channel === 'depth') {
        return {
          id,
          method: `${filter.channel}.subscribe`,
          params: filter.symbols.map((s) => {
            return [s, 30, '0']
          })
        }
      } else {
        return {
          id,
          method: `${filter.channel}.subscribe`,
          params: filter.symbols
        }
      }
    })

    return payload
  }

  protected messageIsError(message: any): boolean {
    if (message.error !== null && message.error !== undefined) {
      return true
    }

    return false
  }
}
