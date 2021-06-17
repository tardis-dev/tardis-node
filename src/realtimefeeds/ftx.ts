import { Writable } from 'stream'

import { Filter } from '../types'
import { RealTimeFeedBase, PoolingClientBase, MultiConnectionRealTimeFeedBase } from './realtimefeed'
import { batch, httpClient } from '../handy'

abstract class FTXRealTimeFeedBase extends MultiConnectionRealTimeFeedBase {
  protected abstract wssURL: string
  protected abstract httpURL: string

  protected *_getRealTimeFeeds(exchange: string, filters: Filter<string>[], timeoutIntervalMS?: number, onError?: (error: Error) => void) {
    const wsFilters = filters.filter((f) => f.channel !== 'instrument')

    if (wsFilters.length > 0) {
      yield new FtxSingleConnectionRealTimeFeed(exchange, wsFilters, this.wssURL, timeoutIntervalMS, onError)
    }

    const instrumentInfoFilters = filters.filter((f) => f.channel === 'instrument')
    if (instrumentInfoFilters.length > 0) {
      const instruments = instrumentInfoFilters.flatMap((s) => s.symbols!)

      if (instruments.length > 0) {
        yield new FTXInstrumentInfoClient(exchange, this.httpURL, instruments)
      }
    }
  }
}

class FtxSingleConnectionRealTimeFeed extends RealTimeFeedBase {
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
          throw new Error('FtxRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
        }

        return filter.symbols.map((symbol) => {
          return {
            op: 'subscribe',
            channel: filter.channel,
            market: symbol
          }
        })
      })
      .flatMap((c) => c)
  }

  protected messageIsError(message: any): boolean {
    return message.type === 'error'
  }
}

class FTXInstrumentInfoClient extends PoolingClientBase {
  constructor(exchange: string, private readonly _httpURL: string, private readonly _instruments: string[]) {
    super(exchange, 3)
  }

  protected async poolDataToStream(outputStream: Writable) {
    for (const instruments of batch(this._instruments, 10)) {
      await Promise.all(
        instruments.map(async (instrument) => {
          if (outputStream.destroyed) {
            return
          }

          const responses = await Promise.all([
            httpClient.get(`${this._httpURL}/futures/${instrument}/stats`, { timeout: 10000 }).json() as any,
            httpClient.get(`${this._httpURL}/futures/${instrument}`, { timeout: 10000 }).json() as any
          ])

          if (responses.some((r) => r.success === false)) {
            return
          }

          const instrumentMessage = {
            channel: 'instrument',
            generated: true,
            market: instrument,
            type: 'update',
            data: {
              stats: responses[0].result,
              info: responses[1].result
            }
          }

          if (outputStream.writable) {
            outputStream.write(instrumentMessage)
          }
        })
      )
    }
  }
}

export class FtxRealTimeFeed extends FTXRealTimeFeedBase {
  protected wssURL = 'wss://ftx.com/ws'
  protected httpURL = 'https://ftx.com/api'
}

export class FtxUSRealTimeFeed extends FTXRealTimeFeedBase {
  protected wssURL = 'wss://ftx.us/ws/'
  protected httpURL = 'https://ftx.us/api'
}
