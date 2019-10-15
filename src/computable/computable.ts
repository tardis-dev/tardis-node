import { DataType, MessageForDataType, Message, TradeBin, BookSnapshot, Disconnect, Exchange } from '../types'
import { TradeBinComputable } from './tradebin'
import { BookSnapshotComputable } from './booksnapshot'

type ComputableType =
  | {
      type: 'trade_bin'
      binBy: 'time' | 'volume' | 'ticks'
      binSize: number
      name?: string
    }
  | {
      type: 'book_snapshot'
      name?: string
      depth: number
      interval: number
    }

export async function* compute(messages: AsyncIterableIterator<Message | Disconnect>, ...types: ComputableType[]) {
  const factory = new Computables(types)

  for await (const message of messages) {
    // always pass through source message
    yield message

    if (message.type === 'disconnect') {
      // reset all computables for given exchange if we've received disconnect for it
      factory.reset(message.exchange)
      continue
    }

    const computables = factory.getOrCreate(message.exchange, message.symbol)

    for (const computable of computables) {
      // any time new message arrives check if given computable has
      // new sample for such message timestamp, eg: time based trade bars
      if (computable.hasNewSample(message.timestamp)) {
        yield computable.getSample(message.localTimestamp)
      }

      // update computable with new data if data types match
      // and check if such computable after update has new sample as well
      if (message.type === computable.sourceDataType) {
        computable.update(message)
        if (computable.hasNewSample(message.timestamp)) {
          yield computable.getSample(message.localTimestamp)
        }
      }
    }
  }
}

export type Computable<T, U extends DataType> = {
  readonly sourceDataType: U

  update(message: MessageForDataType[U]): void

  hasNewSample(timestamp: Date): boolean

  getSample(timestamp: Date): T
}

class Computables {
  private _computables: {
    [ex in Exchange]?: {
      [key: string]: Computable<TradeBin | BookSnapshot, any>[]
    }
  } = {}

  _computablesFactories: (() => Computable<TradeBin | BookSnapshot, any>)[]

  constructor(types: ComputableType[]) {
    this._computablesFactories = types.map(this._getFactory)
  }

  private _getFactory(type: ComputableType) {
    if (type.type === 'trade_bin') {
      let name = type.name
      if (name === undefined) {
        name = `${type.type}_${type.binSize}${type.binBy === 'time' ? 'ms' : type.binBy}`
      }

      return () => new TradeBinComputable(name!, type.binSize, type.binBy)
    }

    if (type.type === 'book_snapshot') {
      let name = type.name
      if (name === undefined) {
        name = `${type.type}_${type.depth}_${type.interval}ms`
      }

      return () => new BookSnapshotComputable(name!, type.depth, type.interval)
    }

    throw new Error(`Unknown computable type ${type}`)
  }

  getOrCreate(exchange: Exchange, symbol: string) {
    if (this._computables[exchange] === undefined) {
      this._computables[exchange] = {}
    }

    if (this._computables[exchange]![symbol] === undefined) {
      this._computables[exchange]![symbol] = this._computablesFactories.map(c => c())
    }

    return this._computables[exchange]![symbol]!
  }

  reset(exchange: Exchange) {
    this._computables[exchange] = undefined
  }
}
