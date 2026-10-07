import { asNumberOrUndefined, parseISODateWithMicroseconds, upperCaseSymbols } from '../handy.ts'
import { BookChange, BookTicker, DerivativeTicker, Trade } from '../types.ts'
import { Mapper, PendingTickerInfoHelper } from './mapper.ts'
import { exchangeMappers } from './registry.ts'

export const coinbaseDerivativesMappers = exchangeMappers({
  'coinbase-derivatives': {
    trades: () => new CoinbaseDerivativesTradesMapper(),
    bookChanges: () => new CoinbaseDerivativesBookChangeMapper(),
    bookTickers: () => new CoinbaseDerivativesBookTickerMapper(),
    derivativeTickers: () => new CoinbaseDerivativesTickerMapper()
  }
})

class CoinbaseDerivativesTradesMapper implements Mapper<'coinbase-derivatives', Trade> {
  canHandle(message: CoinbaseDerivativesTrade) {
    return message.channel === 'market_trades'
  }

  getFilters(symbols?: string[]) {
    return [{ channel: 'market_trades', symbols: upperCaseSymbols(symbols) } as const]
  }

  *map(message: CoinbaseDerivativesTrade, localTimestamp: Date): IterableIterator<Trade> {
    for (const event of message.events) {
      if (event.type !== 'update') {
        continue
      }

      for (const trade of event.trades) {
        yield {
          type: 'trade',
          exchange: 'coinbase-derivatives',
          symbol: trade.product_id,
          id: trade.trade_id,
          price: Number(trade.price),
          amount: Number(trade.size),
          side: trade.side === 'BUY' ? 'sell' : 'buy',
          timestamp: parseISODateWithMicroseconds(trade.time),
          localTimestamp
        }
      }
    }
  }
}

class CoinbaseDerivativesBookChangeMapper implements Mapper<'coinbase-derivatives', BookChange> {
  canHandle(message: CoinbaseDerivativesBook) {
    return message.channel === 'l2_data'
  }

  getFilters(symbols?: string[]) {
    return [{ channel: 'l2_data', symbols: upperCaseSymbols(symbols) } as const]
  }

  *map(message: CoinbaseDerivativesBook, localTimestamp: Date): IterableIterator<BookChange> {
    for (const event of message.events) {
      yield {
        type: 'book_change',
        exchange: 'coinbase-derivatives',
        symbol: event.product_id,
        isSnapshot: event.type === 'snapshot',
        bids: event.updates.filter((u) => u.side === 'bid').map(this.mapBookLevel),
        asks: event.updates.filter((u) => u.side === 'offer').map(this.mapBookLevel),
        timestamp: parseISODateWithMicroseconds(
          event.updates.length > 0 ? event.updates[event.updates.length - 1].event_time : message.timestamp
        ),
        localTimestamp
      }
    }
  }

  private mapBookLevel(update: CoinbaseDerivativesBook['events'][number]['updates'][number]) {
    return {
      price: Number(update.price_level),
      amount: Number(update.new_quantity)
    }
  }
}

class CoinbaseDerivativesBookTickerMapper implements Mapper<'coinbase-derivatives', BookTicker> {
  canHandle(message: CoinbaseDerivativesTicker) {
    return message.channel === 'ticker'
  }

  getFilters(symbols?: string[]) {
    return [{ channel: 'ticker', symbols: upperCaseSymbols(symbols) } as const]
  }

  *map(message: CoinbaseDerivativesTicker, localTimestamp: Date): IterableIterator<BookTicker> {
    for (const event of message.events)
      for (const ticker of event.tickers) {
        const bidPrice = asNumberOrUndefined(ticker.best_bid)
        const askPrice = asNumberOrUndefined(ticker.best_ask)

        if (bidPrice === undefined && askPrice === undefined) {
          continue
        }

        yield {
          type: 'book_ticker',
          exchange: 'coinbase-derivatives',
          symbol: ticker.product_id,
          bidPrice,
          bidAmount: asNumberOrUndefined(ticker.best_bid_quantity),
          askPrice,
          askAmount: asNumberOrUndefined(ticker.best_ask_quantity),
          timestamp: parseISODateWithMicroseconds(message.timestamp),
          localTimestamp
        }
      }
  }
}

class CoinbaseDerivativesTickerMapper implements Mapper<'coinbase-derivatives', DerivativeTicker> {
  private readonly pending = new PendingTickerInfoHelper()

  canHandle(message: CoinbaseDerivativesProducts | CoinbaseDerivativesTicker) {
    return message.channel === 'products' || message.channel === 'ticker'
  }

  getFilters(symbols?: string[]) {
    return [
      { channel: 'products', symbols: upperCaseSymbols(symbols) } as const,
      { channel: 'ticker', symbols: upperCaseSymbols(symbols) } as const
    ]
  }

  *map(message: CoinbaseDerivativesProducts | CoinbaseDerivativesTicker, localTimestamp: Date) {
    if (message.channel === 'ticker') {
      for (const event of message.events)
        for (const ticker of event.tickers) {
          const info = this.pending.getPendingTickerInfo(ticker.product_id, 'coinbase-derivatives')
          info.updateLastPrice(asNumberOrUndefined(ticker.price))
          info.updateTimestamp(parseISODateWithMicroseconds(message.timestamp))
          if (info.hasChanged()) {
            yield info.getSnapshot(localTimestamp)
          }
        }
      return
    }

    for (const product of message.events) {
      const info = this.pending.getPendingTickerInfo(product.product_id, 'coinbase-derivatives')

      const details = product.future_product_details
      info.updateOpenInterest(asNumberOrUndefined(details.open_interest))
      info.updateFundingRate(asNumberOrUndefined(details.funding_rate))
      info.updateIndexPrice(asNumberOrUndefined(details.index_price))
      // funding_time identifies the published rate, not the next funding event. No mark price is supplied.
      info.updateTimestamp(localTimestamp)

      if (info.hasChanged()) {
        yield info.getSnapshot(localTimestamp)
      }
    }
  }
}

type CoinbaseDerivativesMessage<Channel extends string, Event> = {
  channel: Channel
  events: Event[]
}

type CoinbaseDerivativesTrade = CoinbaseDerivativesMessage<
  'market_trades',
  {
    type: CoinbaseDerivativesMessageType
    trades: {
      product_id: string
      trade_id: string
      price: string
      size: string
      side: 'BUY' | 'SELL'
      time: string
    }[]
  }
>
type CoinbaseDerivativesBook = CoinbaseDerivativesMessage<
  'l2_data',
  {
    type: CoinbaseDerivativesMessageType
    product_id: string
    updates: {
      side: 'bid' | 'offer'
      price_level: string
      new_quantity: string
      event_time: string
    }[]
  }
> & { timestamp: string }

type CoinbaseDerivativesTicker = CoinbaseDerivativesMessage<
  'ticker',
  {
    tickers: {
      product_id: string
      price: string
      best_bid?: string
      best_ask?: string
      best_bid_quantity?: string
      best_ask_quantity?: string
    }[]
  }
> & { timestamp: string }

type CoinbaseDerivativesProducts = CoinbaseDerivativesMessage<
  'products',
  {
    product_id: string
    future_product_details: {
      open_interest: string
      funding_rate: string
      index_price: string
    }
  }
> & { generated: true }

type CoinbaseDerivativesMessageType = 'snapshot' | 'update'
