import { Writable } from 'stream'
import { setTimeout as sleep } from 'node:timers/promises'
import { batch, getJSON } from '../handy.ts'
import { Filter } from '../types.ts'
import { MultiConnectionRealTimeFeedBase, PoolingClientBase, RealTimeFeedBase } from './realtimefeed.ts'

export class WhiteBitRealTimeFeed extends MultiConnectionRealTimeFeedBase {
  protected readonly httpURL: string = 'https://whitebit.com/api/v4/public'

  protected *_getRealTimeFeeds(exchange: string, filters: Filter<string>[], timeoutIntervalMS?: number, onError?: (error: Error) => void) {
    filters = filters.map((filter) => ({
      ...filter,
      symbols: filter.symbols?.map((symbol) => symbol.toUpperCase())
    }))
    const webSocketFilters = filters.filter((filter) => filter.channel !== 'futures_update')
    for (const filter of webSocketFilters) {
      if (filter.symbols === undefined || filter.symbols.length === 0) {
        throw new Error('WhiteBitRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
      }
    }
    const webSocketSymbols = [...new Set(webSocketFilters.flatMap((filter) => filter.symbols!))]
    const spotSymbols = webSocketSymbols.filter((symbol) => !symbol.endsWith('_PERP'))
    const perpetualSymbols = webSocketSymbols.filter((symbol) => symbol.endsWith('_PERP'))
    let connectionIndex = 0

    for (const marketSymbols of [spotSymbols, perpetualSymbols]) {
      for (const group of batch(marketSymbols, 50)) {
        yield new WhiteBitWebSocketRealTimeFeed(
          exchange,
          webSocketFilters
            .map((filter) => ({ ...filter, symbols: filter.symbols!.filter((symbol) => group.includes(symbol)) }))
            .filter((filter) => filter.symbols.length > 0),
          timeoutIntervalMS,
          onError,
          connectionIndex++ * 50
        )
      }
    }

    const futuresFilters = filters.filter((filter) => filter.channel === 'futures_update')
    if (futuresFilters.length > 0) {
      const allFutures = futuresFilters.some((filter) => !filter.symbols?.length)
      yield new WhiteBitFuturesClient(
        exchange,
        allFutures ? [] : futuresFilters.flatMap((filter) => filter.symbols!),
        this.httpURL,
        onError
      )
    }
  }
}

export class WhiteBitWebSocketRealTimeFeed extends RealTimeFeedBase {
  protected readonly wssURL = 'wss://wss.whitebit.com/ws'
  private readonly _lastUpdateIds = new Map<string, number>()

  constructor(
    exchange: string,
    filters: Filter<string>[],
    timeoutIntervalMS: number | undefined,
    onError?: (error: Error) => void,
    private readonly _startDelayMS = 0
  ) {
    super(exchange, filters, timeoutIntervalMS, onError)
  }

  protected async getWebSocketUrl() {
    await sleep(this._startDelayMS)
    return super.getWebSocketUrl()
  }

  protected mapToSubscribeMessages(filters: Filter<string>[]) {
    this._lastUpdateIds.clear()
    let id = 0
    return filters.flatMap(({ channel, symbols }) => {
      const method = channel.replace('_update', '_subscribe')

      if (channel === 'depth_update') {
        return symbols!.map((symbol) => ({
          id: ++id,
          method,
          params: [symbol, 100, '0', true]
        }))
      }

      if (channel === 'bookTicker_update') {
        return symbols!.map((symbol) => ({
          id: ++id,
          method,
          params: [symbol]
        }))
      }

      return [
        {
          id: ++id,
          method,
          params: symbols!
        }
      ]
    })
  }

  protected messageIsError(message: { error?: unknown }) {
    return message.error !== undefined && message.error !== null
  }

  protected onMessage(message: { method?: string; params?: [boolean, { update_id: number; past_update_id?: number }, string] }) {
    if (message.method !== 'depth_update') {
      return
    }
    const [isSnapshot, book, symbol] = message.params!
    // Snapshot resets may jump over changes outside the subscribed depth; only deltas must link to the previous update.
    if (!isSnapshot && book.past_update_id !== this._lastUpdateIds.get(symbol)) {
      throw new Error(`WhiteBIT depth sequence gap for ${symbol}`)
    }
    this._lastUpdateIds.set(symbol, book.update_id)
  }
}

class WhiteBitFuturesClient extends PoolingClientBase {
  constructor(
    exchange: string,
    private readonly _symbols: string[],
    private readonly _httpURL: string,
    onError?: (error: Error) => void
  ) {
    super(exchange, 6, onError)
  }

  protected async poolDataToStream(outputStream: Writable) {
    const { data: response } = await getJSON<{ success: boolean; result: { ticker_id: string }[] }>(`${this._httpURL}/futures`, {
      timeout: 5000
    })
    if (!response.success) {
      throw new Error('WhiteBIT futures request was unsuccessful')
    }
    for (const market of response.result) {
      if (this._symbols.length > 0 && !this._symbols.includes(market.ticker_id)) {
        continue
      }
      if (outputStream.writable) {
        outputStream.write({ method: 'futures_update', params: [market.ticker_id, market], id: null, generated: true })
      }
    }
  }
}
