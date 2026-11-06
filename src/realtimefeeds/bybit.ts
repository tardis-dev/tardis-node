import { batch } from '../handy.ts'
import type { BybitV5OrderBookMessage } from '../mappers/bybit.ts'
import { Filter } from '../types.ts'
import { RealTimeFeedBase, MultiConnectionRealTimeFeedBase, type SequenceInfo } from './realtimefeed.ts'

export class BybitRealTimeDataFeed extends MultiConnectionRealTimeFeedBase {
  protected *_getRealTimeFeeds(
    exchange: string,
    filters: Filter<string>[],
    timeoutIntervalMS?: number,
    validateSequence?: boolean,
    onError?: (error: Error) => void
  ) {
    const linearContractsFilters = filters.reduce(
      this._only((s) => s.endsWith('USDT') || s.includes('-') || s.endsWith('PERP')),
      [] as Filter<string>[]
    )

    const inverseContractsFilters = filters.reduce(
      this._only((s) => s.endsWith('USDT') === false && s.includes('-') === false && s.endsWith('PERP') === false),
      [] as Filter<string>[]
    )

    if (linearContractsFilters.length > 0) {
      yield new BybitLinearRealTimeDataFeed(exchange, linearContractsFilters, timeoutIntervalMS, validateSequence, onError)
    }

    if (inverseContractsFilters.length > 0) {
      yield new BybitInverseRealTimeDataFeed(exchange, inverseContractsFilters, timeoutIntervalMS, validateSequence, onError)
    }
  }

  private _only(filter: (symbol: string) => boolean) {
    return (prev: Filter<string>[], current: Filter<string>) => {
      if (!current.symbols || current.symbols.length === 0) {
        throw new Error('BybitRealTimeDataFeed requires explicitly specified symbols when subscribing to live feed')
      }

      const symbols = current.symbols.filter(filter)
      if (symbols.length > 0) {
        prev.push({
          channel: current.channel,
          symbols
        })
      }
      return prev
    }
  }
}

abstract class BybitSingleConnectionRealTimeDataFeed extends RealTimeFeedBase {
  protected abstract readonly wssURL: string

  protected getSequence({ topic, type, data }: BybitV5OrderBookMessage): SequenceInfo | undefined {
    if (topic?.startsWith('orderbook.')) {
      const full = topic.startsWith('orderbook.full.')
      if (full && type !== 'delta') {
        return undefined
      }
      return {
        key: full ? data.s : topic,
        sequenceId: data.u,
        previousSequenceId: !full && (type === 'snapshot' || data.u === 1) ? null : data.u - 1
      }
    }

    return undefined
  }

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const args = filters
      .map((filter) => {
        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error('BybitRealTimeDataFeed requires explicitly specified symbols when subscribing to live feed')
        }

        return filter.symbols!.map((symbol) => {
          return `${filter.channel}.${symbol}`
        })
      })
      .flatMap((f) => f)

    return [...batch(args, 10)].map((argBatch) => {
      return {
        op: 'subscribe',
        args: argBatch
      }
    })
  }

  protected messageIsError(message: any): boolean {
    return message.success === false
  }

  protected sendCustomPing = () => {
    this.send({ op: 'ping' })
  }

  protected messageIsHeartbeat(msg: any) {
    return msg.ret_msg === 'pong' || msg.op == 'pong'
  }
}

class BybitLinearRealTimeDataFeed extends BybitSingleConnectionRealTimeDataFeed {
  protected wssURL: string = 'wss://stream.bybit.com/v5/public/linear'
}

class BybitInverseRealTimeDataFeed extends BybitSingleConnectionRealTimeDataFeed {
  protected wssURL: string = 'wss://stream.bybit.com/v5/public/inverse'
}

export class BybitSpotRealTimeDataFeed extends BybitSingleConnectionRealTimeDataFeed {
  protected wssURL: string = 'wss://stream.bybit.com/v5/public/spot'
}

export class BybitSpreadRealTimeDataFeed extends BybitSingleConnectionRealTimeDataFeed {
  protected wssURL: string = 'wss://stream.bybit.com/v5/public/spread'
}

export class BybitOptionsRealTimeDataFeed extends BybitSingleConnectionRealTimeDataFeed {
  protected wssURL: string = 'wss://stream.bybit.com/v5/public/option'

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const args = filters
      .map((filter) => {
        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error('BybitRealTimeDataFeed requires explicitly specified symbols when subscribing to live feed')
        }

        if (filter.channel === 'publicTrade') {
          const baseCoins = [...new Set(filter.symbols.map((s) => s.split('-')[0]))]
          return baseCoins.map((symbol) => {
            return `${filter.channel}.${symbol}`
          })
        }

        return filter.symbols!.map((symbol) => {
          return `${filter.channel}.${symbol}`
        })
      })
      .flatMap((f) => f)

    return [...batch(args, 10)].map((argBatch) => {
      return {
        op: 'subscribe',
        args: argBatch
      }
    })
  }
}
