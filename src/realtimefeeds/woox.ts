import { getJSON } from '../handy.ts'
import { Filter } from '../types.ts'
import { RealTimeFeedBase } from './realtimefeed.ts'

const ORDER_BOOK_DEPTH = 50

export class WooxRealTimeFeed extends RealTimeFeedBase {
  protected wssURL = 'wss://wss.woox.io/v3/public'
  protected readonly httpURL = 'https://api.woox.io'

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const symbolToTopics = new Map<string, string[]>()

    filters
      .filter((filter) => filter.channel !== 'orderbook')
      .forEach((filter) => {
        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error('WooxRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
        }

        filter.symbols.forEach((symbol) => {
          const topics = symbolToTopics.get(symbol) ?? []
          topics.push(buildTopic(symbol, filter.channel))
          symbolToTopics.set(symbol, topics)
        })
      })

    return Array.from(symbolToTopics.entries()).map(([symbol, topics]) => ({
      id: symbol,
      cmd: 'subscribe',
      params: topics
    }))
  }

  protected async provideManualSnapshots(filters: Filter<string>[], shouldCancel: () => boolean) {
    const orderbookFilter = filters.find((f) => f.channel === 'orderbook')
    if (!orderbookFilter?.symbols) {
      return
    }

    for (let symbol of orderbookFilter.symbols!) {
      if (shouldCancel()) {
        return
      }

      const response = await getJSON<WooxOrderBookSnapshotResponse>(
        `${this.httpURL}/v3/public/orderbook?symbol=${symbol}&maxLevel=${ORDER_BOOK_DEPTH}`
      )

      if (response.data.success === false) {
        throw new Error(`Woox orderbook snapshot request failed: ${JSON.stringify(response.data)}`)
      }

      this.manualSnapshotsBuffer.push({
        topic: buildTopic(symbol, 'orderbook'),
        ts: response.data.timestamp,
        generated: true,
        data: response.data.data
      })
    }

    this.debug('fetched orderbook snapshots for: %s', orderbookFilter.symbols)
  }

  protected messageIsError(message: any): boolean {
    return message.success === false || message.errorMsg !== undefined || message.cmd === 'ERROR'
  }

  protected messageIsHeartbeat(message: any): boolean {
    return message.event === 'ping' || message.cmd === 'PING'
  }

  protected onMessage(msg: any) {
    if (msg.event === 'ping') {
      this.send({
        event: 'ping'
      })
    }
    if (msg.cmd === 'PING') {
      this.send({
        cmd: 'PONG'
      })
    }
  }
}

function buildTopic(symbol: string, channel: string) {
  if (channel === 'orderbook' || channel === 'orderbookupdate') {
    return `${channel}@${symbol}@${ORDER_BOOK_DEPTH}`
  }

  return `${channel}@${symbol}`
}

type WooxOrderBookSnapshotResponse = {
  success: boolean
  timestamp: number
  data: {
    asks: WooxOrderBookSnapshotLevel[]
    bids: WooxOrderBookSnapshotLevel[]
  }
}

type WooxOrderBookSnapshotLevel = {
  price: string
  quantity: string
}
