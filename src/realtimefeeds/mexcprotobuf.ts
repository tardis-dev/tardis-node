import { ProtobufReader } from './protobufreader.ts'

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
