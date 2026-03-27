import { Writable } from 'stream'
import { getJSON, getRandomString, postJSON } from '../handy.ts'
import { Filter } from '../types.ts'
import { MultiConnectionRealTimeFeedBase, PoolingClientBase, RealTimeFeedBase } from './realtimefeed.ts'

const kucoinHttpOptions = {
  timeout: 10 * 1000,
  retry: {
    limit: 10,
    statusCodes: [418, 429, 500, 403],
    maxRetryAfter: 120 * 1000
  }
}

export class KucoinFuturesRealTimeFeed extends MultiConnectionRealTimeFeedBase {
  private _httpURL = 'https://api-futures.kucoin.com/api'

  protected *_getRealTimeFeeds(exchange: string, filters: Filter<string>[], timeoutIntervalMS?: number, onError?: (error: Error) => void) {
    const wsFilters = filters.filter((f) => f.channel !== 'contract/details')

    if (wsFilters.length > 0) {
      yield new KucoinFuturesSingleConnectionRealTimeFeed(exchange, wsFilters, this._httpURL, timeoutIntervalMS, onError)
    }

    const contractDetailsFilters = filters.filter((f) => f.channel === 'contract/details')
    if (contractDetailsFilters.length > 0) {
      yield new KucoinFuturesContractDetailsClient(exchange, this._httpURL)
    }
  }
}

export class KucoinFuturesSingleConnectionRealTimeFeed extends RealTimeFeedBase {
  constructor(
    exchange: string,
    filters: Filter<string>[],
    private readonly _httpURL: string,
    timeoutIntervalMS: number | undefined,
    onError?: (error: Error) => void
  ) {
    super(exchange, filters, timeoutIntervalMS, onError)
  }
  protected wssURL = ''

  protected async getWebSocketUrl() {
    const { data: body } = await postJSON<any>(`${this._httpURL}/v1/bullet-public`, { retry: 3, timeout: 10000 })

    return `${body.data.instanceServers[0].endpoint}?token=${body.data.token}&connectId=${getRandomString()}`
  }

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    return filters
      .filter((f) => f.channel !== 'contractMarket/level2Snapshot')
      .map((filter) => {
        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error('KucoinFuturesRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
        }

        return {
          id: getRandomString(),
          type: 'subscribe',
          topic: `/${filter.channel}:${filter.symbols.join(',')}`,
          response: true
        }
      })
  }

  protected async provideManualSnapshots(filters: Filter<string>[], shouldCancel: () => boolean) {
    const depthSnapshotFilter = filters.find((f) => f.channel === 'contractMarket/level2Snapshot')
    if (!depthSnapshotFilter) {
      return
    }

    this.debug('requesting manual snapshots for: %s', depthSnapshotFilter.symbols)
    for (let symbol of depthSnapshotFilter.symbols!) {
      if (shouldCancel()) {
        return
      }

      const { data } = await getJSON<any>(`${this._httpURL}/v1/level2/snapshot?symbol=${symbol}`, kucoinHttpOptions)

      const snapshot = {
        type: 'message',
        generated: true,
        topic: `/contractMarket/level2Snapshot:${symbol}`,
        subject: 'level2Snapshot',
        ...data
      }

      this.manualSnapshotsBuffer.push(snapshot)
    }

    this.debug('requested manual snapshots successfully for: %s ', depthSnapshotFilter.symbols)
  }

  protected messageIsError(message: any): boolean {
    return message.type === 'error'
  }

  protected sendCustomPing = () => {
    this.send({
      id: new Date().valueOf().toString(),
      type: 'ping'
    })
  }

  protected messageIsHeartbeat(msg: any) {
    return msg.type === 'pong'
  }
}

class KucoinFuturesContractDetailsClient extends PoolingClientBase {
  constructor(exchange: string, private readonly _httpURL: string) {
    super(exchange, 6)
  }

  protected async poolDataToStream(outputStream: Writable) {
    const { data: body } = await getJSON<any>(`${this._httpURL}/v1/contracts/active`, kucoinHttpOptions)

    for (const instrument of body.data) {
      const openInterestMessage = {
        topic: `/contract/details:${instrument.symbol}`,
        type: 'message',
        subject: 'contractDetails',
        generated: true,
        data: instrument
      }

      if (outputStream.writable) {
        outputStream.write(openInterestMessage)
      }
    }
  }
}
