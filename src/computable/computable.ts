import { Exchange, NormalizedData, Disconnect } from '../types'

export type Computable<T extends NormalizedData> = {
  readonly sourceDataTypes: string[]
  compute(message: NormalizedData): IterableIterator<T>
}

export type ComputableFactory<T extends NormalizedData> = () => Computable<T>

export async function* compute<T extends ComputableFactory<any>[], U extends NormalizedData | Disconnect>(
  messages: AsyncIterableIterator<U>,
  ...computables: T
): AsyncIterableIterator<T extends ComputableFactory<infer Z>[] ? (U extends Disconnect ? (U | Z | Disconnect) : U | Z) : never> {
  const factory = new Computables(computables)

  for await (const message of messages) {
    // always pass through source message
    yield message as any

    if (message.type === 'disconnect') {
      // reset all computables for given exchange if we've received disconnect for it
      factory.reset(message.exchange)
      continue
    }
    const normalizedMessage = message as NormalizedData
    const id = normalizedMessage.name !== undefined ? `${normalizedMessage.symbol}:${normalizedMessage.name}` : normalizedMessage.symbol

    const computables = factory.getOrCreate(normalizedMessage.exchange, id)

    const sourceDataForSubsequentComputables: NormalizedData[] = []

    for (const computable of computables) {
      if (computable.sourceDataTypes.includes(normalizedMessage.type)) {
        for (const computedMessage of computable.compute(normalizedMessage)) {
          sourceDataForSubsequentComputables.push(computedMessage)
          yield computedMessage
        }
      }

      // as long as previous computables computed new messages we need to pass those to subsequent ones as those may relay
      // on previously computed computables as a source of their own computation
      // for example order book impbalance computable may relay on book_snapshot computable as it's source
      if (sourceDataForSubsequentComputables.length > 0) {
        for (const sourceComputable of sourceDataForSubsequentComputables) {
          if (computable.sourceDataTypes.includes(sourceComputable.type)) {
            for (const computedMessage of computable.compute(sourceComputable)) {
              sourceDataForSubsequentComputables.push(computedMessage)
              yield computedMessage
            }
          }
        }
      }
    }
  }
}

class Computables {
  private _computables: {
    [ex in Exchange]?: {
      [key: string]: Computable<any>[]
    }
  } = {}

  constructor(private readonly _computablesFactories: ComputableFactory<any>[]) {}

  getOrCreate(exchange: Exchange, id: string) {
    if (this._computables[exchange] === undefined) {
      this._computables[exchange] = {}
    }

    if (this._computables[exchange]![id] === undefined) {
      this._computables[exchange]![id] = this._computablesFactories.map(c => c())
    }

    return this._computables[exchange]![id]!
  }

  reset(exchange: Exchange) {
    this._computables[exchange] = undefined
  }
}
