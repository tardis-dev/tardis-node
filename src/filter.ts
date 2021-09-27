import { NormalizedData, Disconnect, Trade } from './types'
import { CappedSet } from './handy'

export async function* filter<T extends NormalizedData | Disconnect>(messages: AsyncIterableIterator<T>, filter: (message: T) => boolean) {
  for await (const message of messages) {
    if (filter(message)) {
      yield message
    }
  }
}

export function uniqueTradesOnly<T extends NormalizedData | Disconnect>(
  {
    maxWindow,
    onDuplicateFound,
    skipStaleOlderThanSeconds
  }: {
    maxWindow: number
    skipStaleOlderThanSeconds?: number
    onDuplicateFound?: (trade: Trade) => void
  } = {
    maxWindow: 500
  }
) {
  const perSymbolQueues = {} as {
    [key: string]: CappedSet<string>
  }

  return (message: T) => {
    // pass trough any message that is not a trade
    if (message.type !== 'trade') {
      return true
    } else {
      const trade = message as unknown as Trade
      // pass trough trades that can't be uniquely identified
      // ignore index trades
      if (trade.id === undefined || trade.symbol.startsWith('.')) {
        return true
      } else {
        let alreadySeenTrades = perSymbolQueues[trade.symbol]

        if (alreadySeenTrades === undefined) {
          perSymbolQueues[trade.symbol] = new CappedSet<string>(maxWindow)
          alreadySeenTrades = perSymbolQueues[trade.symbol]
        }

        const isDuplicate = alreadySeenTrades.has(trade.id)
        const isStale =
          skipStaleOlderThanSeconds !== undefined &&
          trade.localTimestamp.valueOf() - trade.timestamp.valueOf() > skipStaleOlderThanSeconds * 1000

        if (isDuplicate || isStale) {
          if (onDuplicateFound !== undefined) {
            onDuplicateFound(trade)
          }
          // refresh duplicated key position so it's added back at the beginning of the queue
          alreadySeenTrades.remove(trade.id)
          alreadySeenTrades.add(trade.id)

          return false
        } else {
          alreadySeenTrades.add(trade.id)

          return true
        }
      }
    }
  }
}
