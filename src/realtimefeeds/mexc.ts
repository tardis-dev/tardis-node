import { Filter } from '../types.ts'
import { RealTimeFeedBase } from './realtimefeed.ts'

type ProtobufWireType = 0 | 1 | 2 | 3 | 4 | 5

export class MexcRealTimeFeed extends RealTimeFeedBase {
  protected readonly wssURL = 'wss://wbs-api.mexc.com/ws'
  private readonly channels = new Set([
    'spot@public.aggre.deals.v3.api.pb@10ms',
    'spot@public.aggre.depth.v3.api.pb@10ms',
    'spot@public.aggre.bookTicker.v3.api.pb@100ms'
  ])

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const filtersWithSymbols = filters.map<Required<Filter<string>>>((filter) => {
      if (!this.channels.has(filter.channel)) {
        throw new Error(`MexcRealTimeFeed unsupported channel ${filter.channel}`)
      }

      if (!filter.symbols || filter.symbols.length === 0) {
        throw new Error('MexcRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
      }

      return filter as Required<Filter<string>>
    })

    return [
      {
        method: 'SUBSCRIPTION',
        params: filtersWithSymbols.flatMap((filter) => filter.symbols.map((symbol) => `${filter.channel}@${symbol.toUpperCase()}`))
      }
    ]
  }

  protected parseMessage(message: Buffer): any {
    if (message.length > 0 && message[0] === 123) {
      return JSON.parse(message.toString())
    }

    return decodePushDataV3ApiWrapper(message)
  }

  protected messageIsError(message: any): boolean {
    return message.code !== undefined && message.code !== 0
  }

  protected messageIsHeartbeat(message: any) {
    return message.msg === 'PONG'
  }

  protected sendCustomPing = () => {
    this.send({ method: 'PING' })
  }
}

function decodePushDataV3ApiWrapper(buffer: Buffer) {
  const reader = new ProtobufReader(buffer)
  const message: Record<string, any> = {}

  while (!reader.done) {
    const { fieldNumber, wireType } = reader.readTag()

    if (fieldNumber === 1 && wireType === 2) {
      message.channel = reader.readString()
    } else if (fieldNumber === 3 && wireType === 2) {
      message.symbol = reader.readString()
    } else if (fieldNumber === 4 && wireType === 2) {
      message.symbolId = reader.readString()
    } else if (fieldNumber === 5 && wireType === 0) {
      message.createTime = reader.readInt64String()
    } else if (fieldNumber === 6 && wireType === 0) {
      message.sendTime = reader.readInt64String()
    } else if (fieldNumber === 313 && wireType === 2) {
      message.publicAggreDepths = decodePublicAggreDepths(reader.readBytes())
    } else if (fieldNumber === 314 && wireType === 2) {
      message.publicAggreDeals = decodePublicAggreDeals(reader.readBytes())
    } else if (fieldNumber === 315 && wireType === 2) {
      message.publicAggreBookTicker = decodePublicAggreBookTicker(reader.readBytes())
    } else {
      reader.skip(wireType)
    }
  }

  return message
}

function decodePublicAggreDeals(buffer: Uint8Array) {
  const reader = new ProtobufReader(buffer)
  const message: { deals: any[]; eventType?: string } = { deals: [] }

  while (!reader.done) {
    const { fieldNumber, wireType } = reader.readTag()
    if (fieldNumber === 1 && wireType === 2) {
      message.deals.push(decodePublicAggreDeal(reader.readBytes()))
    } else if (fieldNumber === 2 && wireType === 2) {
      message.eventType = reader.readString()
    } else {
      reader.skip(wireType)
    }
  }

  return message
}

function decodePublicAggreDeal(buffer: Uint8Array) {
  const reader = new ProtobufReader(buffer)
  const message: Record<string, any> = {}

  while (!reader.done) {
    const { fieldNumber, wireType } = reader.readTag()
    if (fieldNumber === 1 && wireType === 2) {
      message.price = reader.readString()
    } else if (fieldNumber === 2 && wireType === 2) {
      message.quantity = reader.readString()
    } else if (fieldNumber === 3 && wireType === 0) {
      message.tradeType = reader.readVarintNumber()
    } else if (fieldNumber === 4 && wireType === 0) {
      message.time = reader.readInt64String()
    } else {
      reader.skip(wireType)
    }
  }

  return message
}

function decodePublicAggreDepths(buffer: Uint8Array) {
  const reader = new ProtobufReader(buffer)
  const message: { asks: any[]; bids: any[]; eventType?: string; fromVersion?: string; toVersion?: string } = { asks: [], bids: [] }

  while (!reader.done) {
    const { fieldNumber, wireType } = reader.readTag()
    if (fieldNumber === 1 && wireType === 2) {
      message.asks.push(decodePublicAggreDepthLevel(reader.readBytes()))
    } else if (fieldNumber === 2 && wireType === 2) {
      message.bids.push(decodePublicAggreDepthLevel(reader.readBytes()))
    } else if (fieldNumber === 3 && wireType === 2) {
      message.eventType = reader.readString()
    } else if (fieldNumber === 4 && wireType === 2) {
      message.fromVersion = reader.readString()
    } else if (fieldNumber === 5 && wireType === 2) {
      message.toVersion = reader.readString()
    } else {
      reader.skip(wireType)
    }
  }

  return message
}

function decodePublicAggreDepthLevel(buffer: Uint8Array) {
  const reader = new ProtobufReader(buffer)
  const message: Record<string, string> = {}

  while (!reader.done) {
    const { fieldNumber, wireType } = reader.readTag()
    if (fieldNumber === 1 && wireType === 2) {
      message.price = reader.readString()
    } else if (fieldNumber === 2 && wireType === 2) {
      message.quantity = reader.readString()
    } else {
      reader.skip(wireType)
    }
  }

  return message
}

function decodePublicAggreBookTicker(buffer: Uint8Array) {
  const reader = new ProtobufReader(buffer)
  const message: Record<string, string> = {}

  while (!reader.done) {
    const { fieldNumber, wireType } = reader.readTag()
    if (fieldNumber === 1 && wireType === 2) {
      message.bidPrice = reader.readString()
    } else if (fieldNumber === 2 && wireType === 2) {
      message.bidQuantity = reader.readString()
    } else if (fieldNumber === 3 && wireType === 2) {
      message.askPrice = reader.readString()
    } else if (fieldNumber === 4 && wireType === 2) {
      message.askQuantity = reader.readString()
    } else {
      reader.skip(wireType)
    }
  }

  return message
}

class ProtobufReader {
  private offset = 0

  constructor(private readonly buffer: Uint8Array) {}

  get done() {
    return this.offset >= this.buffer.length
  }

  readTag() {
    const tag = this.readVarintNumber()
    return {
      fieldNumber: tag >>> 3,
      wireType: (tag & 7) as ProtobufWireType
    }
  }

  readVarintNumber() {
    return Number(this.readVarintBigInt())
  }

  readInt64String() {
    return this.readVarintBigInt().toString()
  }

  readString() {
    return Buffer.from(this.readBytes()).toString('utf8')
  }

  readBytes() {
    const length = this.readVarintNumber()
    const end = this.offset + length
    if (end > this.buffer.length) {
      throw new Error('MEXC protobuf message ended unexpectedly')
    }

    const bytes = this.buffer.subarray(this.offset, end)
    this.offset = end
    return bytes
  }

  skip(wireType: ProtobufWireType) {
    if (wireType === 0) {
      this.readVarintBigInt()
      return
    }

    if (wireType === 1) {
      this.skipFixed(8)
      return
    }

    if (wireType === 2) {
      this.readBytes()
      return
    }

    if (wireType === 5) {
      this.skipFixed(4)
      return
    }

    throw new Error(`Unsupported MEXC protobuf wire type ${wireType}`)
  }

  private readVarintBigInt() {
    let shift = 0n
    let value = 0n

    while (this.offset < this.buffer.length) {
      const byte = this.buffer[this.offset++]
      value |= BigInt(byte & 0x7f) << shift
      if ((byte & 0x80) === 0) {
        return value
      }
      shift += 7n
    }

    throw new Error('MEXC protobuf varint ended unexpectedly')
  }

  private skipFixed(bytes: number) {
    this.offset += bytes
    if (this.offset > this.buffer.length) {
      throw new Error('MEXC protobuf message ended unexpectedly')
    }
  }
}
