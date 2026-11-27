import { Writable } from 'stream'
import { unzipSync } from 'zlib'
import { EXCHANGE_CHANNELS_INFO } from '../consts.ts'
import { getJSON, wait } from '../handy.ts'
import { Filter } from '../types.ts'
import { MultiConnectionRealTimeFeedBase, PoolingClientBase, RealTimeFeedBase, Sequence } from './realtimefeed.ts'

export class BingxRealTimeFeed extends RealTimeFeedBase {
  protected readonly wssURL: string = 'wss://open-api-ws.bingx.com/market'
  protected decompress = unzipSync

  protected mapToSubscribeMessages(filters: Filter<string>[]) {
    let id = 0
    const subscriptions = filters.flatMap(({ channel, symbols }) => {
      if (!symbols?.length) {
        throw new Error('BingX requires explicitly specified symbols for live subscriptions')
      }

      if (!(EXCHANGE_CHANNELS_INFO[this._exchange as 'bingx' | 'bingx-futures'] as readonly string[]).includes(channel)) {
        throw new Error(`Unsupported BingX channel: ${channel}`)
      }

      return symbols.map((symbol) => ({
        id: String(++id),
        reqType: 'sub',
        dataType: `${symbol}@${channel}`
      }))
    })

    if (subscriptions.length > 200) {
      throw new Error('BingX allows at most 200 topics per WebSocket connection')
    }

    return subscriptions
  }

  protected parseMessage(message: Buffer) {
    return message.toString() === 'Ping' ? 'Ping' : super.parseMessage(message)
  }

  protected messageIsError(message: any) {
    return message.code !== undefined && message.code !== 0
  }

  protected messageIsHeartbeat(message: any) {
    return message === 'Ping' || message?.ping !== undefined
  }

  protected onMessage(message: any) {
    if (message === 'Ping') {
      this.sendRaw('Pong')
    } else if (message?.ping !== undefined) {
      this.send({ pong: message.ping, time: message.time })
    }
  }

  protected getSequence(message: any): Sequence | undefined {
    if (message.dataType?.endsWith('@incrDepth') && message.data !== undefined) {
      return {
        key: message.dataType,
        sequence: message.data.lastUpdateId,
        previousSequence: message.data.action === 'all' ? undefined : message.data.lastUpdateId - 1
      }
    }
    return undefined
  }
}

class BingxFuturesWebSocketFeed extends BingxRealTimeFeed {
  protected readonly wssURL = 'wss://open-api-swap.bingx.com/swap-market'

  protected override getSequence(): undefined {
    // Futures lastUpdateId skips values even on matching parallel connections.
    return undefined
  }
}

export class BingxFuturesRealTimeFeed extends MultiConnectionRealTimeFeedBase {
  protected readonly httpURL: string = 'https://open-api.bingx.com'

  protected *_getRealTimeFeeds(
    exchange: string,
    filters: Filter<string>[],
    timeoutIntervalMS?: number,
    onError?: (error: Error) => void,
    validateSequence?: boolean
  ) {
    for (const { channel, symbols } of filters) {
      if (!symbols?.length) {
        throw new Error('BingX requires explicitly specified symbols for live subscriptions')
      }
      if (!(EXCHANGE_CHANNELS_INFO['bingx-futures'] as readonly string[]).includes(channel)) {
        throw new Error(`Unsupported BingX channel: ${channel}`)
      }
    }
    const wsFilters = filters.filter(({ channel }) => channel !== 'premiumIndex' && channel !== 'openInterest')
    if (wsFilters.length) {
      yield new BingxFuturesWebSocketFeed(exchange, wsFilters, timeoutIntervalMS, onError, validateSequence)
    }
    const premiumIndexSymbols = new Set(filters.filter((f) => f.channel === 'premiumIndex').flatMap((f) => f.symbols!))
    if (premiumIndexSymbols.size) {
      yield new BingxFuturesPremiumIndexClient(exchange, premiumIndexSymbols, this.httpURL, onError)
    }
    const openInterestSymbols = [...new Set(filters.filter((f) => f.channel === 'openInterest').flatMap((f) => f.symbols!))]
    if (openInterestSymbols.length) {
      yield new BingxFuturesOpenInterestClient(exchange, openInterestSymbols, this.httpURL, onError)
    }
  }
}

class BingxFuturesPremiumIndexClient extends PoolingClientBase {
  private _pollStarted = 0

  constructor(
    exchange: string,
    private readonly _symbols: ReadonlySet<string>,
    private readonly _httpURL: string,
    onError?: (error: Error) => void
  ) {
    super(exchange, 6, onError)
  }

  protected getPoolingDelayMS() {
    return Math.max(0, 6000 - (Date.now() - this._pollStarted))
  }

  protected async poolDataToStream(output: Writable) {
    this._pollStarted = Date.now()
    const { data: response } = await getJSON<BingxResponse<{ symbol: string }[]>>(`${this._httpURL}/openApi/swap/v2/quote/premiumIndex`, {
      timeout: 5000
    })
    // if (response.code !== 0 || !Array.isArray(response.data)) {
    //   throw new Error(`BingX premiumIndex: ${response.code} ${response.msg}`)
    // }
    for (const data of response.data) {
      if (!output.destroyed && this._symbols.has(data.symbol)) {
        output.write({
          code: 0,
          dataType: `${data.symbol}@premiumIndex`,
          generated: true,
          data
        })
      }
    }
  }
}

class BingxFuturesOpenInterestClient extends PoolingClientBase {
  private _pollStarted = 0

  constructor(
    exchange: string,
    private readonly _symbols: string[],
    private readonly _httpURL: string,
    onError?: (error: Error) => void
  ) {
    super(exchange, 30, onError)
  }

  protected getPoolingDelayMS() {
    return Math.max(0, 30000 - (Date.now() - this._pollStarted))
  }

  protected async poolDataToStream(output: Writable) {
    this._pollStarted = Date.now()
    const activeSymbols = await this._getOpenInterestSymbols()
    // The public market-data REST limit is 500 requests per 10 seconds per IP.
    for (const symbol of this._symbols.filter((symbol) => activeSymbols.has(symbol))) {
      if (output.destroyed) return
      try {
        const { data: response } = await getJSON<BingxResponse<{ symbol: string; openInterest: string; time: number }>>(
          `${this._httpURL}/openApi/swap/v2/quote/openInterest?symbol=${encodeURIComponent(symbol)}`,
          { timeout: 5000 }
        )
        // Paused contracts still stream WebSocket data but have no REST open interest.
        if (response.code !== 109415) {
          if (!response.data?.openInterest) {
            throw new Error(`BingX openInterest ${symbol}: ${response.code} ${response.msg}`)
          }
          if (!output.destroyed) {
            output.write({
              code: 0,
              dataType: `${symbol}@openInterest`,
              generated: true,
              data: response.data
            })
          }
        }
      } catch (error) {
        this.onError?.(error instanceof Error ? error : new Error(String(error)))
      }

      if (!output.destroyed) {
        await wait(25)
      }
    }
  }

  private async _getOpenInterestSymbols() {
    const { data: response } = await getJSON<BingxResponse<{ symbol: string; status: number }[]>>(
      `${this._httpURL}/openApi/swap/v2/quote/contracts`,
      { timeout: 5000 }
    )
    return new Set(response.data.filter((contract) => contract.status === 1).map((contract) => contract.symbol))
  }
}

type BingxResponse<T> = {
  code: number
  msg: string
  data: T
}
