import { Disconnect, Exchange, NormalizedData } from '../types'

export type Computable<T extends NormalizedData> = {
  readonly sourceDataTypes: string[]
  compute(message: NormalizedData): IterableIterator<T>
}

export type ComputableFactory<T extends NormalizedData> = () => Computable<T>

async function* _compute<T extends ComputableFactory<any>[], U extends NormalizedData | Disconnect>(
  messages: AsyncIterableIterator<U>,
  ...computables: T
): AsyncIterableIterator<T extends ComputableFactory<infer Z>[] ? (U extends Disconnect ? U | Z | Disconnect : U | Z) : never> {
  try {
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

      const computablesMap = factory.getOrCreate(normalizedMessage.exchange, id)
      const computables = computablesMap[normalizedMessage.type]
      if (!computables) continue

      for (const computable of computables) {
        for (const computedMessage of computable.compute(normalizedMessage)) {
          yield computedMessage
        }
      }
    }
  } finally {
    messages.return!()
  }
}

export function compute<T extends ComputableFactory<any>[], U extends NormalizedData | Disconnect>(
  messages: AsyncIterableIterator<U>,
  ...computables: T
): AsyncIterableIterator<T extends ComputableFactory<infer Z>[] ? (U extends Disconnect ? U | Z | Disconnect : U | Z) : never> {
  let _iterator = _compute(messages, ...computables)

  if ((messages as any).__realtime__ === true) {
    ;(_iterator as any).__realtime__ = true
  }

  return _iterator
}

class Computables {
  private _computables: {
    [ex in Exchange]?: {
      [key: string]: { [dataType: string]: Computable<any>[] }
    }
  } = {}

  constructor(private readonly _computablesFactories: ComputableFactory<any>[]) {}

  getOrCreate(exchange: Exchange, id: string) {
    if (this._computables[exchange] === undefined) {
      this._computables[exchange] = {}
    }

    if (this._computables[exchange]![id] === undefined) {
      this._computables[exchange]![id] = createComputablesMap(this._computablesFactories.map((c) => c()))
    }

    return this._computables[exchange]![id]!
  }

  reset(exchange: Exchange) {
    this._computables[exchange] = undefined
  }
}

function createComputablesMap(computables: Computable<any>[]) {
  return computables.reduce((acc, computable) => {
    computable.sourceDataTypes.forEach((dataType) => {
      const existing = acc[dataType]
      if (!existing) {
        acc[dataType] = [computable]
      } else {
        acc[dataType].push(computable)
      }
    })
    return acc
  }, {} as { [dataType: string]: Computable<any>[] })
}
