import { EXCHANGE_CHANNELS_INFO } from '../consts.ts'
import { Filter } from '../types.ts'
import { MultiConnectionRealTimeFeedBase, RealTimeFeedBase, RealTimeFeedIterable } from './realtimefeed.ts'

const PAXOS_CHANNELS = EXCHANGE_CHANNELS_INFO.paxos
type PaxosChannel = (typeof EXCHANGE_CHANNELS_INFO.paxos)[number]

export class PaxosRealTimeFeed extends MultiConnectionRealTimeFeedBase {
  protected *_getRealTimeFeeds(
    exchange: string,
    filters: Filter<string>[],
    timeoutIntervalMS?: number,
    onError?: (error: Error) => void
  ): IterableIterator<RealTimeFeedIterable> {
    for (const channel of PAXOS_CHANNELS) {
      const channelFilters = filters.filter((filter) => filter.channel === channel)
      if (channelFilters.length === 0) {
        continue
      }

      yield new PaxosChannelRealTimeFeed(exchange, channelFilters, timeoutIntervalMS, onError)
    }
  }
}

export class PaxosChannelRealTimeFeed extends RealTimeFeedBase {
  protected readonly wssURL = 'wss://ws.paxos.com'

  constructor(
    exchange: string,
    private readonly _paxosFilters: Filter<string>[],
    timeoutIntervalMS: number | undefined,
    onError: ((error: Error) => void) | undefined
  ) {
    super(exchange, _paxosFilters, timeoutIntervalMS, onError)
  }

  protected mapToSubscribeMessages(_filters: Filter<string>[]): any[] {
    return []
  }

  protected async getWebSocketUrl() {
    const channel = this._paxosFilters[0].channel as PaxosChannel
    const symbols = getSymbols(this._paxosFilters)
    const channelUrl = `${await super.getWebSocketUrl()}/${channel}`
    return symbols?.length === 1 ? `${channelUrl}/${symbols[0]}` : channelUrl
  }

  protected messageIsError(message: any): boolean {
    return message.error !== undefined
  }
}

function getSymbols(filters: Filter<string>[]) {
  const symbols = new Set<string>()

  for (const filter of filters) {
    if (filter.symbols === undefined || filter.symbols.length === 0) {
      return undefined
    }

    for (const symbol of filter.symbols) {
      symbols.add(symbol)
    }
  }

  if (symbols.size === 0) {
    return undefined
  }

  return [...symbols].sort()
}
