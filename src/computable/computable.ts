import { Exchange, NormalizedData, Disconnect } from '../types'

export type Computable<T extends NormalizedData> = {
  readonly sourceDataTypes: string[]
  compute(message: NormalizedData): IterableIterator<T>
}

export type ComputableFactory<T extends NormalizedData> = () => Computable<T>

function isDisconnect(message: any): message is Disconnect {
  return message.type === 'disconnect'
}

export async function* compute<T extends ComputableFactory<any>[], U extends NormalizedData>(
  messages: AsyncIterableIterator<U | Disconnect>,
  ...computables: T
): AsyncIterableIterator<T extends ComputableFactory<infer Z>[] ? U | Z | Disconnect : never> {
  const factory = new Computables(computables)

  for await (const message of messages) {
    // always pass through source message
    yield message as any

    if (isDisconnect(message)) {
      // reset all computables for given exchange if we've received disconnect for it
      factory.reset(message.exchange)
      continue
    }

    const id = message.name !== undefined ? `${message.symbol}:${message.name}` : message.symbol
    const computables = factory.getOrCreate(message.exchange, id)

    for (const computable of computables) {
      // any time new message arrives check if given computable
      // source data types include message type and
      // has new sample for such message timestamp, eg: time based trade bars
      if (computable.sourceDataTypes.includes(message.type)) {
        for (const computed of computable.compute(message)) {
          yield computed
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
