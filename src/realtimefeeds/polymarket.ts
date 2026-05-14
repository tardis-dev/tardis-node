import { Filter } from '../types.ts'
import { MultiConnectionRealTimeFeedBase, RealTimeFeedBase, RealTimeFeedIterable } from './realtimefeed.ts'

export class PolymarketRealTimeFeed extends MultiConnectionRealTimeFeedBase {
  private readonly clobChannels = new Set(['book', 'price_change', 'last_trade_price', 'best_bid_ask', 'tick_size_change'])
  private readonly sportsChannel = 'sport_result'

  protected *_getRealTimeFeeds(
    exchange: string,
    filters: Filter<string>[],
    timeoutIntervalMS?: number,
    onError?: (error: Error) => void
  ): IterableIterator<RealTimeFeedIterable> {
    const clobFilters: Filter<string>[] = []
    const sportsFilters: Filter<string>[] = []

    for (const filter of filters) {
      if (this.clobChannels.has(filter.channel)) {
        clobFilters.push(filter)
      } else if (filter.channel === this.sportsChannel) {
        sportsFilters.push(filter)
      } else {
        throw new Error(`PolymarketRealTimeFeed unsupported channel ${filter.channel}`)
      }
    }

    if (clobFilters.length > 0) {
      if (clobFilters.every((filter) => filter.symbols === undefined || filter.symbols.length === 0)) {
        throw new Error('PolymarketRealTimeFeed requires explicitly specified symbols when subscribing to CLOB live feed')
      }

      yield new PolymarketClobRealTimeFeed(exchange, clobFilters, timeoutIntervalMS, onError)
    }
    if (sportsFilters.length > 0) {
      yield new PolymarketSportsRealTimeFeed(exchange, sportsFilters, timeoutIntervalMS, onError)
    }
  }
}

export class PolymarketClobRealTimeFeed extends RealTimeFeedBase {
  protected wssURL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market'
  private readonly pongMessage = Buffer.from('{"__pong__":true}')

  protected decompress = (msg: Buffer): Buffer => {
    if (msg.toString() === 'PONG') {
      return this.pongMessage
    }
    return msg
  }

  protected messageIsHeartbeat(msg: any) {
    return msg.__pong__ === true
  }

  protected sendCustomPing = () => {
    this.sendRaw('PING')
  }

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    return [
      {
        type: 'market',
        assets_ids: [...new Set(filters.flatMap((f) => f.symbols ?? []))],
        initial_dump: true,
        level: 2,
        custom_feature_enabled: true
      }
    ]
  }

  protected messageIsError(message: any): boolean {
    return typeof message.error === 'string'
  }
}

export class PolymarketSportsRealTimeFeed extends RealTimeFeedBase {
  protected wssURL = 'wss://sports-api.polymarket.com/ws'
  private readonly serverPingMessage = Buffer.from('{"__server_ping__":true}')

  protected decompress = (msg: Buffer): Buffer => {
    if (msg.toString() === 'ping') {
      return this.serverPingMessage
    }
    return msg
  }

  protected messageIsHeartbeat(msg: any) {
    return msg.__server_ping__ === true
  }

  protected onMessage(msg: any) {
    if (msg.__server_ping__ === true) {
      this.sendRaw('pong')
    }
  }

  protected mapToSubscribeMessages(_filters: Filter<string>[]): any[] {
    return []
  }

  protected messageIsError(message: any): boolean {
    return typeof message.error === 'string'
  }
}
