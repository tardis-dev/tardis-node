import { RealTimeStreamBase } from './realtimestream'
import { Filter } from '../types'

export class BitmexRealTimeStream extends RealTimeStreamBase {
  protected readonly wssURL = 'wss://www.bitmex.com/realtime'

  protected mapToSubscribeMessages(filters: Filter<string>[]) {
    return filters
      .map(filter => {
        if (!filter.symbols || filter.symbols.length === 0) {
          return [
            {
              op: 'subscribe',
              args: [filter.channel]
            }
          ]
        }
        const subscribeMessages = []
        for (const symbolsBatch of batch(filter.symbols, 10)) {
          subscribeMessages.push({
            op: 'subscribe',
            args: symbolsBatch.map(s => `${filter.channel}:${s}`)
          })
        }

        return subscribeMessages
      })
      .flatMap(s => s)
  }

  protected messageIsError(message: any): boolean {
    if (message.error !== undefined) {
      return true
    }

    if ('subscribe' in message && message.success === false) {
      return true
    }
    return false
  }
}

function* batch(symbols: string[], batchSize: number) {
  for (let i = 0; i < symbols.length; i += batchSize) {
    yield symbols.slice(i, i + batchSize)
  }
}
