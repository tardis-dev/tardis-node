import got from 'got'
import { unzipSync } from 'zlib'
import { Filter } from '../types'
import { RealTimeFeedBase, MultiConnectionRealTimeFeedBase, PoolingClientBase } from './realtimefeed'
import { wait, ONE_SEC_IN_MS, batch } from '../handy'
import { Writable } from 'stream'

abstract class HuobiRealTimeFeedBase extends MultiConnectionRealTimeFeedBase {
  protected abstract wssURL: string
  protected abstract httpURL: string
  protected abstract suffixes: { [key: string]: string }

  private _marketDataChannels = ['depth', 'detail', 'trade', 'bbo']
  private _notificationsChannels = ['funding_rate', 'liquidation_orders', 'contract_info']

  protected *_getRealTimeFeeds(exchange: string, filters: Filter<string>[], timeoutIntervalMS?: number, onError?: (error: Error) => void) {
    const marketByPriceFilters = filters.filter((f) => f.channel === 'mbp')

    if (marketByPriceFilters.length > 0) {
      // https://huobiapi.github.io/docs/spot/v1/en/#market-by-price-incremental-update
      const marketByPriceWSUrl = this.wssURL.replace('/ws', '/feed')
      yield new HuobiMarketDataRealTimeFeed(exchange, marketByPriceFilters, marketByPriceWSUrl, this.suffixes, timeoutIntervalMS, onError)
    }

    const basisFilters = filters.filter((f) => f.channel === 'basis')

    if (basisFilters.length > 0) {
      const basisWSURL = this.wssURL.replace('/ws', '/ws_index').replace('/swap-ws', '/ws_index')
      yield new HuobiMarketDataRealTimeFeed(exchange, basisFilters, basisWSURL, this.suffixes, timeoutIntervalMS, onError)
    }

    const marketDataFilters = filters.filter((f) => this._marketDataChannels.includes(f.channel))

    if (marketDataFilters.length > 0) {
      yield new HuobiMarketDataRealTimeFeed(exchange, marketDataFilters, this.wssURL, this.suffixes, timeoutIntervalMS, onError)
    }

    const notificationsFilters = filters.filter((f) => this._notificationsChannels.includes(f.channel))

    if (notificationsFilters.length > 0) {
      const notificationsWSURL = this.wssURL.replace('/swap-ws', '/swap-notification').replace('/ws', '/notification')

      yield new HuobiNotificationsRealTimeFeed(exchange, notificationsFilters, notificationsWSURL, timeoutIntervalMS, onError)
    }

    const openInterestFilters = filters.filter((f) => f.channel === 'open_interest')

    if (openInterestFilters.length > 0) {
      const instruments = openInterestFilters.flatMap((s) => s.symbols!)

      yield new HuobiOpenInterestClient(exchange, this.httpURL, instruments, this.getURLPath.bind(this))
    }
  }

  protected getURLPath(symbol: string) {
    return symbol
  }
}

class HuobiMarketDataRealTimeFeed extends RealTimeFeedBase {
  constructor(
    exchange: string,
    filters: Filter<string>[],
    protected wssURL: string,
    private readonly _suffixes: { [key: string]: string },
    timeoutIntervalMS: number | undefined,
    onError?: (error: Error) => void
  ) {
    super(exchange, filters, timeoutIntervalMS, onError)
  }

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    return filters
      .map((filter) => {
        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error('HuobiRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
        }

        return filter.symbols.map((symbol) => {
          const sub = `market.${symbol}.${filter.channel}${
            this._suffixes[filter.channel] !== undefined ? this._suffixes[filter.channel] : ''
          }`
          return {
            id: '1',
            sub,
            data_type: sub.endsWith('.high_freq') ? 'incremental' : undefined
          }
        })
      })
      .flatMap((s) => s)
  }

  protected async provideManualSnapshots(filters: Filter<string>[], shouldCancel: () => boolean) {
    const mbpFilter = filters.find((f) => f.channel === 'mbp')
    if (!mbpFilter) {
      return
    }

    await wait(1.5 * ONE_SEC_IN_MS)

    for (let symbol of mbpFilter.symbols!) {
      if (shouldCancel()) {
        return
      }

      this.send({
        id: '1',
        req: `market.${symbol}.mbp.150`
      })

      await wait(50)
    }

    this.debug('sent mbp.150 "req" for: %s', mbpFilter.symbols)
  }

  protected decompress = (message: any) => {
    message = unzipSync(message)

    return message as Buffer
  }

  protected messageIsError(message: any): boolean {
    if (message.status === 'error') {
      return true
    }
    return false
  }

  protected onMessage(message: any) {
    if (message.ping !== undefined) {
      this.send({
        pong: message.ping
      })
    }
  }

  protected messageIsHeartbeat(message: any) {
    return message.ping !== undefined
  }
}

class HuobiNotificationsRealTimeFeed extends RealTimeFeedBase {
  constructor(
    exchange: string,
    filters: Filter<string>[],
    protected wssURL: string,
    timeoutIntervalMS: number | undefined,
    onError?: (error: Error) => void
  ) {
    super(exchange, filters, timeoutIntervalMS, onError)
  }

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    return filters
      .map((filter) => {
        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error('HuobiNotificationsRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
        }

        return filter.symbols.map((symbol) => {
          return {
            op: 'sub',
            cid: '1',
            topic: `public.${symbol}.${filter.channel}`
          }
        })
      })
      .flatMap((s) => s)
  }

  protected decompress = (message: any) => {
    message = unzipSync(message)

    return message as Buffer
  }

  protected messageIsError(message: any): boolean {
    if (message.op === 'error' || message.op === 'close') {
      return true
    }

    const errorCode = message['err-code']
    if (errorCode !== undefined && errorCode !== 0) {
      return true
    }

    return false
  }

  protected onMessage(message: any) {
    if (message.op === 'ping') {
      this.send({
        op: 'pong',
        ts: message.ts
      })
    }
  }

  protected messageIsHeartbeat(message: any) {
    return message.ping !== undefined
  }
}

class HuobiOpenInterestClient extends PoolingClientBase {
  constructor(
    exchange: string,
    private readonly _httpURL: string,
    private readonly _instruments: string[],
    private readonly _getURLPath: (symbol: string) => string
  ) {
    super(exchange, 4)
  }

  protected async poolDataToStream(outputStream: Writable) {
    for (const instruments of batch(this._instruments, 10)) {
      await Promise.all(
        instruments.map(async (instrument) => {
          if (outputStream.destroyed) {
            return
          }
          const url = `${this._httpURL}/${this._getURLPath(instrument)}`
          const openInterestResponse = (await got.get(url, { timeout: 2000 }).json()) as any

          if (openInterestResponse.status !== 'ok') {
            throw new Error(`open interest response error:${JSON.stringify(openInterestResponse)}, url:${url}`)
          }

          const openInterestMessage = {
            ch: `market.${instrument}.open_interest`,
            generated: true,
            data: openInterestResponse.data,
            ts: openInterestResponse.ts
          }

          if (outputStream.writable) {
            outputStream.write(openInterestMessage)
          }
        })
      )
    }
  }
}

export class HuobiRealTimeFeed extends HuobiRealTimeFeedBase {
  protected wssURL = 'wss://api-aws.huobi.pro/ws'
  protected httpURL = 'https://api-aws.huobi.pro/v1'

  protected suffixes = {
    trade: '.detail',
    depth: '.step0',
    mbp: '.150'
  }
}

export class HuobiDMRealTimeFeed extends HuobiRealTimeFeedBase {
  protected wssURL = 'wss://api.hbdm.vn/ws'
  protected httpURL = 'https://api.hbdm.vn/api/v1'

  protected suffixes = {
    trade: '.detail',
    depth: '.size_150.high_freq',
    basis: '.1min.close'
  }

  private _contractTypeMap: { [key: string]: string } = {
    CW: 'this_week',
    NW: 'next_week',
    CQ: 'quarter',
    NQ: 'next_quarter'
  }

  protected getURLPath(symbol: string) {
    const split = symbol.split('_')
    const index = split[0]
    const contractType = this._contractTypeMap[split[1]]

    return `contract_open_interest?symbol=${index}&contract_type=${contractType}`
  }
}

export class HuobiDMSwapRealTimeFeed extends HuobiRealTimeFeedBase {
  protected wssURL = 'wss://api.hbdm.vn/swap-ws'
  protected httpURL = 'https://api.hbdm.vn/swap-api/v1'

  protected suffixes = {
    trade: '.detail',
    depth: '.size_150.high_freq',
    basis: '.1min.close'
  }

  protected getURLPath(symbol: string) {
    return `swap_open_interest?contract_code=${symbol}`
  }
}

export class HuobiDMLinearSwapRealTimeFeed extends HuobiRealTimeFeedBase {
  protected wssURL = 'wss://api.hbdm.vn/linear-swap-ws'
  protected httpURL = 'https://api.hbdm.vn/linear-swap-api/v1'

  protected suffixes = {
    trade: '.detail',
    depth: '.size_150.high_freq',
    basis: '.1min.close'
  }

  protected getURLPath(symbol: string) {
    return `swap_open_interest?contract_code=${symbol}`
  }
}
