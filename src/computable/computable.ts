import { Exchange, NormalizedData, Disconnect } from '../types'

export type Computable<T extends NormalizedData> = {
  readonly sourceDataTypes: string[]

  update(message: NormalizedData): void

  hasNewSample(timestamp: Date): boolean

  getSample(localTimestamp: Date): T
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

    const computables = factory.getOrCreate(message.exchange, message.symbol)
    const { localTimestamp, timestamp } = message

    for (const computable of computables) {
      // any time new message arrives check if given computable
      // source data types include message type and
      // has new sample for such message timestamp, eg: time based trade bars
      if (computable.sourceDataTypes.includes(message.type)) {
        if (computable.hasNewSample(timestamp)) {
          yield computable.getSample(localTimestamp)
        }

        // update computable with new data
        // and check if such computable after update has new sample as well
        computable.update(message)
        if (computable.hasNewSample(timestamp)) {
          yield computable.getSample(localTimestamp)
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
