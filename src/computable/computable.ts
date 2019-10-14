import { DataType, MessageForDataType, Message, TradeBin, BookSnapshot } from '../types'
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

export async function* compute(messages: AsyncIterableIterator<Message>, ...types: ComputableType[]) {
  const factory = new Computables(types)

  for await (const message of messages) {
    // always pass through source message
    yield message

    const computables = factory.getOrCreate(message.symbol)
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
  private _computablesForSymbol: {
    [key: string]: Computable<TradeBin | BookSnapshot, any>[]
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

  getOrCreate(symbol: string) {
    if (this._computablesForSymbol[symbol] === undefined) {
      this._computablesForSymbol[symbol] = this._computablesFactories.map(c => c())
    }
    return this._computablesForSymbol[symbol]
  }
}
