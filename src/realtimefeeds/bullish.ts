import { Filter } from '../types.ts'
import { MultiConnectionRealTimeFeedBase, RealTimeFeedBase } from './realtimefeed.ts'

type BullishSubscriptionTarget = {
  readonly topic: string
  readonly path: string
  readonly symbolParam?: 'symbol' | 'assetSymbol'
}

const BULLISH_SUBSCRIPTION_TARGETS: Record<string, BullishSubscriptionTarget> = {
  V1TALevel2: {
    topic: 'l2Orderbook',
    path: '/trading-api/v1/market-data/orderbook',
    symbolParam: 'symbol'
  },
  V1TALevel1: {
    topic: 'l1Orderbook',
    path: '/trading-api/v1/market-data/orderbook',
    symbolParam: 'symbol'
  },
  V1TAAnonymousTradeUpdate: {
    topic: 'anonymousTrades',
    path: '/trading-api/v1/market-data/trades',
    symbolParam: 'symbol'
  },
  V1TATickerResponse: {
    topic: 'tick',
    path: '/trading-api/v1/market-data/tick',
    symbolParam: 'symbol'
  },
  V1TAIndexPrice: {
    topic: 'indexPrice',
    path: '/trading-api/v1/index-data',
    symbolParam: 'assetSymbol'
  }
}

function getBullishSubscriptionTarget(channel: string) {
  const target = BULLISH_SUBSCRIPTION_TARGETS[channel]
  if (target === undefined) {
    throw new Error(`BullishRealTimeFeed unsupported channel ${channel}`)
  }

  return target
}

export class BullishRealTimeFeed extends MultiConnectionRealTimeFeedBase {
  protected *_getRealTimeFeeds(exchange: string, filters: Filter<string>[], timeoutIntervalMS?: number, onError?: (error: Error) => void) {
    for (const [path, pathFilters] of this.groupByPath(filters)) {
      yield new BullishSingleConnectionRealTimeFeed(exchange, path, pathFilters, timeoutIntervalMS, onError)
    }
  }

  private groupByPath(filters: Filter<string>[]) {
    const filtersByPath = new Map<string, Filter<string>[]>()

    for (const filter of filters) {
      const target = getBullishSubscriptionTarget(filter.channel)
      const pathFilters = filtersByPath.get(target.path) ?? []
      pathFilters.push(filter)
      filtersByPath.set(target.path, pathFilters)
    }

    return filtersByPath
  }
}

export class BullishSingleConnectionRealTimeFeed extends RealTimeFeedBase {
  protected wssURL = 'wss://api.exchange.bullish.com'
  private nextMessageId = 1

  constructor(
    exchange: string,
    private readonly path: string,
    filters: Filter<string>[],
    timeoutIntervalMS: number | undefined,
    onError?: (error: Error) => void
  ) {
    super(exchange, filters, timeoutIntervalMS, onError)
  }

  protected async getWebSocketUrl() {
    const baseURL = await super.getWebSocketUrl()
    return `${baseURL.replace(/\/$/, '')}${this.path}`
  }

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    return filters.flatMap((filter) => {
      const target = getBullishSubscriptionTarget(filter.channel)

      if (target.symbolParam == null) {
        return [
          {
            jsonrpc: '2.0',
            type: 'command',
            method: 'subscribe',
            id: (this.nextMessageId++).toString(),
            params: {
              topic: target.topic
            }
          }
        ]
      }

      if (!filter.symbols || filter.symbols.length === 0) {
        throw new Error('BullishRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
      }

      return filter.symbols.map((symbol) => {
        return {
          jsonrpc: '2.0',
          type: 'command',
          method: 'subscribe',
          id: (this.nextMessageId++).toString(),
          params: {
            topic: target.topic,
            [target.symbolParam!]: symbol
          }
        }
      })
    })
  }

  protected messageIsError(message: any): boolean {
    return message.error !== undefined && message.error !== null
  }

  protected sendCustomPing = () => {
    this.send({
      jsonrpc: '2.0',
      type: 'command',
      method: 'keepalivePing',
      id: (this.nextMessageId++).toString()
    })
  }

  protected messageIsHeartbeat(message: any) {
    return message.dataType === 'V1TAHeartbeat' || message.result?.message === 'Keep alive pong'
  }
}
