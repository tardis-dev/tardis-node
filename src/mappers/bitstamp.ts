import { lowerCaseSymbols } from '../handy.ts'
import { BookChange, DerivativeTicker, Trade } from '../types.ts'
import { Mapper, PendingTickerInfoHelper } from './mapper.ts'
import { exchangeMappers } from './registry.ts'

// https://www.bitstamp.net/websocket/v2/

export const bitstampMappers = exchangeMappers({
  bitstamp: {
    trades: () => bitstampTradesMapper,
    bookChanges: () => new BitstampBookChangeMapper(),
    derivativeTickers: () => new BitstampDerivativeTickerMapper()
  }
})

const bitstampTradesMapper: Mapper<'bitstamp', Trade> = {
  canHandle(message: BitstampMessage) {
    if (message.data === undefined) {
      return false
    }

    return message.channel.startsWith('live_trades') && message.event === 'trade'
  },

  getFilters(symbols?: string[]) {
    symbols = lowerCaseSymbols(symbols)

    return [
      {
        channel: 'live_trades',
        symbols
      }
    ]
  },

  *map(bitstampTradeResponse: BitstampTrade, localTimestamp: Date): IterableIterator<Trade> {
    const bitstampTrade = bitstampTradeResponse.data
    const symbol = bitstampTradeResponse.channel.slice(bitstampTradeResponse.channel.lastIndexOf('_') + 1)
    const microtimestamp = Number(bitstampTrade.microtimestamp)
    const timestamp = new Date(microtimestamp / 1000)
    timestamp.μs = microtimestamp % 1000

    yield {
      type: 'trade',
      symbol: symbol.toUpperCase(),
      exchange: 'bitstamp',
      id: bitstampTrade.id_str ?? String(bitstampTrade.id),
      price: Number(bitstampTrade.price),
      amount: Number(bitstampTrade.amount),
      side: bitstampTrade.type === 0 ? 'buy' : 'sell',
      timestamp,
      localTimestamp
    }
  }
}

class BitstampDerivativeTickerMapper implements Mapper<'bitstamp', DerivativeTicker> {
  private readonly _pendingTickerInfoHelper = new PendingTickerInfoHelper()

  canHandle(message: BitstampMessage) {
    return (
      message.data !== undefined &&
      ((message.channel.startsWith('funding_rate_') && message.event === 'funding_rate_saved') ||
        (message.channel.startsWith('live_trades_') && message.channel.endsWith('-perp') && message.event === 'trade'))
    )
  }

  getFilters(symbols?: string[]) {
    symbols = lowerCaseSymbols(symbols)?.filter((symbol) => symbol.endsWith('-perp'))
    if (symbols?.length === 0) {
      return []
    }
    return [{ channel: 'funding_rate', symbols } as const, { channel: 'live_trades', symbols } as const]
  }

  *map(message: BitstampTrade | BitstampFundingRate, localTimestamp: Date): IterableIterator<DerivativeTicker> {
    const symbol = message.channel.slice(message.channel.lastIndexOf('_') + 1).toUpperCase()
    const ticker = this._pendingTickerInfoHelper.getPendingTickerInfo(symbol, 'bitstamp')
    if (message.event === 'trade') {
      // Funding messages own emission and timestamps; trades only update lastPrice.
      ticker.updateLastPrice(Number(message.data.price))
      return
    }

    ticker.updateFundingRate(Number(message.data.funding_rate))
    ticker.updateFundingTimestamp(new Date(Number(message.data.next_funding_time) * 1000))
    ticker.updateMarkPrice(Number(message.data.mark_price))
    ticker.updateIndexPrice(Number(message.data.index_price))
    ticker.updateTimestamp(new Date(Number(message.data.timestamp) * 1000))
    if (ticker.hasChanged()) {
      yield ticker.getSnapshot(localTimestamp)
    }
  }
}

class BitstampBookChangeMapper implements Mapper<'bitstamp', BookChange> {
  private readonly _symbolToDepthInfoMapping: { [key: string]: LocalDepthInfo } = {}

  canHandle(message: BitstampMessage) {
    if (message.data === undefined) {
      return false
    }

    return message.channel.startsWith('diff_order_book') && (message.event === 'data' || message.event === 'snapshot')
  }

  getFilters(symbols?: string[]) {
    symbols = lowerCaseSymbols(symbols)

    return [
      {
        channel: 'diff_order_book',
        symbols
      } as const
    ]
  }

  *map(message: BitstampDiffOrderBookSnapshot | BitstampDiffOrderBook, localTimestamp: Date): IterableIterator<BookChange> {
    const symbol = message.channel.slice(message.channel.lastIndexOf('_') + 1).toUpperCase()
    if (this._symbolToDepthInfoMapping[symbol] === undefined) {
      this._symbolToDepthInfoMapping[symbol] = {
        bufferedUpdates: []
      }
    }

    const symbolDepthInfo = this._symbolToDepthInfoMapping[symbol]
    const snapshotAlreadyProcessed = symbolDepthInfo.snapshotProcessed

    // first check if received message is snapshot and process it as such if it is
    if (message.event === 'snapshot') {
      // produce snapshot book_change

      let timestamp
      if (message.data.microtimestamp !== undefined) {
        const microtimestamp = Number(message.data.microtimestamp)
        timestamp = new Date(microtimestamp / 1000)
        timestamp.μs = microtimestamp % 1000
      } else {
        timestamp = new Date(Number(message.data.timestamp) * 1000)
      }

      yield {
        type: 'book_change',
        symbol,
        exchange: 'bitstamp',
        isSnapshot: true,
        bids: message.data.bids !== undefined ? message.data.bids.map(this._mapBookLevel) : [],
        asks: message.data.asks !== undefined ? message.data.asks.map(this._mapBookLevel) : [],
        timestamp,
        localTimestamp
      }

      //  mark given symbol depth info that has snapshot processed
      symbolDepthInfo.lastUpdateTimestamp = Number(message.data.timestamp)
      if (message.data.microtimestamp !== undefined) {
        symbolDepthInfo.lastUpdateMicroTimestamp = Number(message.data.microtimestamp)
      }
      symbolDepthInfo.snapshotProcessed = true

      // if there were any depth updates buffered, let's proccess those
      for (const update of symbolDepthInfo.bufferedUpdates) {
        const bookChange = this._mapBookDepthUpdate(update, localTimestamp, symbolDepthInfo, symbol)
        if (bookChange !== undefined) {
          yield bookChange
        }
      }
      // remove all buffered updates
      symbolDepthInfo.bufferedUpdates = []
    } else if (snapshotAlreadyProcessed) {
      // snapshot was already processed let's map the message as normal book_change
      const bookChange = this._mapBookDepthUpdate(message, localTimestamp, symbolDepthInfo, symbol)
      if (bookChange !== undefined) {
        yield bookChange
      }
    } else {
      // if snapshot hasn't been yet processed and we've got depthUpdate message, let's buffer it for later processing
      symbolDepthInfo.bufferedUpdates.push(message)
    }
  }

  private _mapBookDepthUpdate(
    bitstampBookUpdate: BitstampDiffOrderBook,
    localTimestamp: Date,
    depthInfo: LocalDepthInfo,
    symbol: string
  ): BookChange | undefined {
    const microtimestamp = Number(bitstampBookUpdate.data.microtimestamp)
    // skip all book updates that preceed book snapshot
    // REST API not always returned microtimestamps for initial order book snapshots
    // fallback to timestamp
    if (depthInfo.lastUpdateMicroTimestamp !== undefined && microtimestamp <= depthInfo.lastUpdateMicroTimestamp) {
      return
    } else if (Number(bitstampBookUpdate.data.timestamp) < depthInfo.lastUpdateTimestamp!) {
      return
    }

    const timestamp = new Date(microtimestamp / 1000)
    timestamp.μs = microtimestamp % 1000

    return {
      type: 'book_change',
      symbol,
      exchange: 'bitstamp',
      isSnapshot: false,
      bids: bitstampBookUpdate.data.bids !== undefined ? bitstampBookUpdate.data.bids.map(this._mapBookLevel) : [],
      asks: bitstampBookUpdate.data.asks !== undefined ? bitstampBookUpdate.data.asks.map(this._mapBookLevel) : [],
      timestamp: timestamp,
      localTimestamp
    }
  }

  private _mapBookLevel(level: BitstampBookLevel) {
    const price = Number(level[0])
    const amount = Number(level[1])
    return { price, amount }
  }
}

type BitstampMessage<Event extends string = string, Data = unknown> = {
  event: Event
  channel: string
  data: Data
}

type BitstampTrade = BitstampMessage<
  'trade',
  {
    microtimestamp: string
    amount: number
    price: number
    type: number
    id: number
    id_str?: string
  }
>
type BitstampFundingRate = BitstampMessage<
  'funding_rate_saved',
  {
    market: string
    funding_rate: string
    mark_price: string
    index_price: string
    timestamp: string
    next_funding_time: string
  }
>

type LocalDepthInfo = {
  bufferedUpdates: BitstampDiffOrderBook[]
  snapshotProcessed?: boolean
  lastUpdateTimestamp?: number
  lastUpdateMicroTimestamp?: number
}

type BitstampDiffOrderBook = BitstampMessage<
  'data',
  {
    timestamp: string
    microtimestamp: string
    bids: BitstampBookLevel[]
    asks: BitstampBookLevel[]
  }
>

type BitstampDiffOrderBookSnapshot = BitstampMessage<
  'snapshot',
  {
    timestamp: string
    microtimestamp?: string
    bids: BitstampBookLevel[]
    asks: BitstampBookLevel[]
  }
>

type BitstampBookLevel = [string, string]
