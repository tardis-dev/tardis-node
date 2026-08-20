const textDecoder = new TextDecoder()

// Decodes only the current MEXC real-time channels supported by MexcRealTimeFeed.
// Field numbers mirror the official schemas at commit 7b8ac7a6681f28551612a5a7cefbb7e09b56bb85:
// https://github.com/mexcdevelop/websocket-proto/tree/7b8ac7a6681f28551612a5a7cefbb7e09b56bb85
// int64 values remain decimal strings and repeated fields remain empty arrays when absent,
// preserving the output shape previously produced by protobufjs.
export function decodeMexcProtobufMessage(data: Uint8Array) {
  const reader = new ProtobufReader(data)
  const message: {
    channel?: string
    symbol?: string
    symbolId?: string
    createTime?: string
    sendTime?: string
    publicAggreDepths?: ReturnType<typeof decodeDepths>
    publicAggreDeals?: ReturnType<typeof decodeDeals>
    publicAggreBookTicker?: ReturnType<typeof decodeBookTicker>
  } = {}

  while (reader.done === false) {
    const { fieldNumber, wireType } = reader.readTag()

    switch (fieldNumber) {
      case 1:
        message.channel = reader.readString(wireType)
        break
      case 3:
        message.symbol = reader.readString(wireType)
        break
      case 4:
        message.symbolId = reader.readString(wireType)
        break
      case 5:
        message.createTime = reader.readInt64String(wireType)
        break
      case 6:
        message.sendTime = reader.readInt64String(wireType)
        break
      case 313:
        message.publicAggreDepths = decodeDepths(reader.readBytes(wireType))
        break
      case 314:
        message.publicAggreDeals = decodeDeals(reader.readBytes(wireType))
        break
      case 315:
        message.publicAggreBookTicker = decodeBookTicker(reader.readBytes(wireType))
        break
      default:
        reader.skipField(wireType)
    }
  }

  return message
}

function decodeDeals(data: Uint8Array) {
  const reader = new ProtobufReader(data)
  const message: { deals: ReturnType<typeof decodeTrade>[]; eventType?: string } = { deals: [] }

  while (reader.done === false) {
    const { fieldNumber, wireType } = reader.readTag()

    switch (fieldNumber) {
      case 1:
        message.deals.push(decodeTrade(reader.readBytes(wireType)))
        break
      case 2:
        message.eventType = reader.readString(wireType)
        break
      default:
        reader.skipField(wireType)
    }
  }

  return message
}

function decodeTrade(data: Uint8Array) {
  const reader = new ProtobufReader(data)
  const message: { price?: string; quantity?: string; tradeType?: number; time?: string; tradeId?: string } = {}

  while (reader.done === false) {
    const { fieldNumber, wireType } = reader.readTag()

    switch (fieldNumber) {
      case 1:
        message.price = reader.readString(wireType)
        break
      case 2:
        message.quantity = reader.readString(wireType)
        break
      case 3:
        message.tradeType = reader.readInt32(wireType)
        break
      case 4:
        message.time = reader.readInt64String(wireType)
        break
      case 5:
        message.tradeId = reader.readString(wireType)
        break
      default:
        reader.skipField(wireType)
    }
  }

  return message
}

function decodeDepths(data: Uint8Array) {
  const reader = new ProtobufReader(data)
  const message: {
    asks: ReturnType<typeof decodePriceLevel>[]
    bids: ReturnType<typeof decodePriceLevel>[]
    eventType?: string
    fromVersion?: string
    toVersion?: string
    lastOrderCreateTime?: string
  } = { asks: [], bids: [] }

  while (reader.done === false) {
    const { fieldNumber, wireType } = reader.readTag()

    switch (fieldNumber) {
      case 1:
        message.asks.push(decodePriceLevel(reader.readBytes(wireType)))
        break
      case 2:
        message.bids.push(decodePriceLevel(reader.readBytes(wireType)))
        break
      case 3:
        message.eventType = reader.readString(wireType)
        break
      case 4:
        message.fromVersion = reader.readString(wireType)
        break
      case 5:
        message.toVersion = reader.readString(wireType)
        break
      case 6:
        message.lastOrderCreateTime = reader.readInt64String(wireType)
        break
      default:
        reader.skipField(wireType)
    }
  }

  return message
}

function decodePriceLevel(data: Uint8Array) {
  const reader = new ProtobufReader(data)
  const message: { price?: string; quantity?: string } = {}

  while (reader.done === false) {
    const { fieldNumber, wireType } = reader.readTag()

    switch (fieldNumber) {
      case 1:
        message.price = reader.readString(wireType)
        break
      case 2:
        message.quantity = reader.readString(wireType)
        break
      default:
        reader.skipField(wireType)
    }
  }

  return message
}

function decodeBookTicker(data: Uint8Array) {
  const reader = new ProtobufReader(data)
  const message: {
    bidPrice?: string
    bidQuantity?: string
    askPrice?: string
    askQuantity?: string
    version?: string
    lastOrderCreateTime?: string
  } = {}

  while (reader.done === false) {
    const { fieldNumber, wireType } = reader.readTag()

    switch (fieldNumber) {
      case 1:
        message.bidPrice = reader.readString(wireType)
        break
      case 2:
        message.bidQuantity = reader.readString(wireType)
        break
      case 3:
        message.askPrice = reader.readString(wireType)
        break
      case 4:
        message.askQuantity = reader.readString(wireType)
        break
      case 5:
        message.version = reader.readString(wireType)
        break
      case 6:
        message.lastOrderCreateTime = reader.readInt64String(wireType)
        break
      default:
        reader.skipField(wireType)
    }
  }

  return message
}

class ProtobufReader {
  private offset = 0

  constructor(private readonly data: Uint8Array) {}

  get done() {
    return this.offset === this.data.length
  }

  readTag() {
    const tag = this.readVarint()
    if (typeof tag === 'bigint' || tag > 0xffffffff) {
      throw new Error('Invalid protobuf tag')
    }

    const fieldNumber = tag >>> 3
    const wireType = tag & 7

    if (fieldNumber === 0) {
      throw new Error('Invalid protobuf field number 0')
    }

    return { fieldNumber, wireType }
  }

  readString(wireType: number) {
    this.expectWireType(wireType, 2)
    const length = this.readLength()
    const start = this.offset
    const end = start + length

    if (end > this.data.length) {
      throw new Error('Invalid protobuf message length')
    }

    this.offset = end
    return Buffer.isBuffer(this.data) ? this.data.toString('utf8', start, end) : textDecoder.decode(this.data.subarray(start, end))
  }

  readBytes(wireType: number) {
    this.expectWireType(wireType, 2)
    const length = this.readLength()
    const end = this.offset + length

    if (end > this.data.length) {
      throw new Error('Invalid protobuf message length')
    }

    const value = this.data.subarray(this.offset, end)
    this.offset = end
    return value
  }

  readInt32(wireType: number) {
    this.expectWireType(wireType, 0)
    const value = this.readVarint()
    return typeof value === 'number' ? value | 0 : Number(BigInt.asIntN(32, value))
  }

  readInt64String(wireType: number) {
    this.expectWireType(wireType, 0)
    const value = this.readVarint()
    return typeof value === 'number' ? value.toString() : BigInt.asIntN(64, value).toString()
  }

  skipField(wireType: number): void {
    switch (wireType) {
      case 0:
        this.skipVarint()
        return
      case 1:
        this.skipBytes(8)
        return
      case 2:
        this.skipBytes(this.readLength())
        return
      case 5:
        this.skipBytes(4)
        return
      default:
        throw new Error(`Unsupported protobuf wire type ${wireType}`)
    }
  }

  private readVarint() {
    let value = 0
    let multiplier = 1

    // Seven base-128 digits use at most 49 bits, so they remain exact and fast as a number.
    for (let index = 0; index < 7; index++) {
      const byte = this.readByte()
      value += (byte & 0x7f) * multiplier

      if ((byte & 0x80) === 0) {
        return value
      }
      multiplier *= 0x80
    }

    // Larger int64 values need BigInt to preserve every bit before converting them to strings.
    let bigValue = BigInt(value)
    for (let index = 7; index < 10; index++) {
      const byte = this.readByte()
      bigValue |= BigInt(byte & 0x7f) << BigInt(index * 7)

      if ((byte & 0x80) === 0) {
        return bigValue
      }
    }

    throw new Error('Invalid protobuf varint')
  }

  private readLength() {
    const length = this.readVarint()
    if (typeof length === 'bigint' || Number.isSafeInteger(length) === false) {
      throw new Error('Invalid protobuf message length')
    }
    return length
  }

  private skipVarint() {
    for (let index = 0; index < 10; index++) {
      if ((this.readByte() & 0x80) === 0) {
        return
      }
    }
    throw new Error('Invalid protobuf varint')
  }

  private readByte() {
    if (this.offset >= this.data.length) {
      throw new Error('Unexpected end of protobuf message')
    }
    return this.data[this.offset++]!
  }

  private skipBytes(length: number) {
    const end = this.offset + length
    if (Number.isSafeInteger(length) === false || end > this.data.length) {
      throw new Error('Invalid protobuf message length')
    }
    this.offset = end
  }

  private expectWireType(actual: number, expected: number) {
    if (actual !== expected) {
      throw new Error(`Invalid protobuf wire type ${actual}, expected ${expected}`)
    }
  }
}
