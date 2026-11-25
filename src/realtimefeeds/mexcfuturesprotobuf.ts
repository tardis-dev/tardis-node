import { ProtobufReader } from './protobufreader.ts'

// Decodes the public MEXC Futures pushes used by MexcFuturesRealTimeFeed.
// Field numbers mirror the official schemas at commit 033825833318b4bc3add4481997e9f76005c6483:
// https://github.com/mexcdevelop/websocket-future-proto/tree/033825833318b4bc3add4481997e9f76005c6483
// Keep ProtoJSON field names, decimal strings, int64 strings and omitted defaults,
// matching Google.Protobuf.JsonFormatter.Default in the recorder.

export function decodeMexcFuturesProtobufMessage(data: Uint8Array) {
  const reader = new ProtobufReader(data)
  const message: {
    symbol?: string
    channel?: string
    ts?: string
    indexPrice?: ReturnType<typeof decodeIndexPrice>
    contractExtra?: ReturnType<typeof decodeContractExtra>
    contract?: ReturnType<typeof decodeContract>
    deal?: ReturnType<typeof decodeDeal>
    deals?: ReturnType<typeof decodeDeals>
    fundingRate?: ReturnType<typeof decodeFundingRate>
    marketOrderSetting?: ReturnType<typeof decodeMarketOrderSetting>
    fairPrice?: ReturnType<typeof decodeFairPrice>
    depthMerge?: ReturnType<typeof decodeDepthMerge>
    tickerDetail?: ReturnType<typeof decodeTickerDetail>
  } = {}
  let body:
    | 'indexPrice'
    | 'contractExtra'
    | 'contract'
    | 'deal'
    | 'deals'
    | 'fundingRate'
    | 'marketOrderSetting'
    | 'fairPrice'
    | 'depthMerge'
    | 'tickerDetail'
    | undefined

  while (reader.done === false) {
    const { fieldNumber, wireType } = reader.readTag()

    switch (fieldNumber) {
      case 1:
        message.symbol = reader.readString(wireType)
        if (message.symbol === '') delete message.symbol
        break
      case 2:
        message.channel = reader.readString(wireType)
        if (message.channel === '') delete message.channel
        break
      case 3:
        message.ts = reader.readInt64String(wireType)
        if (message.ts === '0') delete message.ts
        break
      case 2001:
        if (body !== undefined) delete message[body]
        body = 'indexPrice'
        message.indexPrice = decodeIndexPrice(reader.readBytes(wireType))
        break
      case 2003:
        if (body !== undefined) delete message[body]
        body = 'contractExtra'
        message.contractExtra = decodeContractExtra(reader.readBytes(wireType))
        break
      case 2004:
        if (body !== undefined) delete message[body]
        body = 'contract'
        message.contract = decodeContract(reader.readBytes(wireType))
        break
      case 2005:
        if (body !== undefined) delete message[body]
        body = 'deal'
        message.deal = decodeDeal(reader.readBytes(wireType))
        break
      case 2006:
        if (body !== undefined) delete message[body]
        body = 'deals'
        message.deals = decodeDeals(reader.readBytes(wireType))
        break
      case 2102:
        if (body !== undefined) delete message[body]
        body = 'fundingRate'
        message.fundingRate = decodeFundingRate(reader.readBytes(wireType))
        break
      case 2100:
        if (body !== undefined) delete message[body]
        body = 'marketOrderSetting'
        message.marketOrderSetting = decodeMarketOrderSetting(reader.readBytes(wireType))
        break
      case 2013:
        if (body !== undefined) delete message[body]
        body = 'fairPrice'
        message.fairPrice = decodeFairPrice(reader.readBytes(wireType))
        break
      case 2016:
        if (body !== undefined) delete message[body]
        body = 'depthMerge'
        message.depthMerge = decodeDepthMerge(reader.readBytes(wireType))
        break
      case 2017:
        if (body !== undefined) delete message[body]
        body = 'tickerDetail'
        message.tickerDetail = decodeTickerDetail(reader.readBytes(wireType))
        break
      default:
        reader.skipField(wireType)
    }
  }

  return message
}

function decodeDepthItem(data: Uint8Array) {
  const reader = new ProtobufReader(data)
  const message: {
    price?: string
    vol?: string
    count?: number
  } = {}

  while (reader.done === false) {
    const { fieldNumber, wireType } = reader.readTag()

    switch (fieldNumber) {
      case 1:
        message.price = reader.readString(wireType)
        if (message.price === '') delete message.price
        break
      case 2:
        message.vol = reader.readString(wireType)
        if (message.vol === '') delete message.vol
        break
      case 3:
        message.count = reader.readInt32(wireType)
        if (message.count === 0) delete message.count
        break
      default:
        reader.skipField(wireType)
    }
  }

  return message
}

function decodeDepthMerge(data: Uint8Array) {
  const reader = new ProtobufReader(data)
  const message: {
    asks?: ReturnType<typeof decodeDepthItem>[]
    bids?: ReturnType<typeof decodeDepthItem>[]
    beginVersion?: string
    endVersion?: string
    timestamp?: string
    cts?: string
  } = {}

  while (reader.done === false) {
    const { fieldNumber, wireType } = reader.readTag()

    switch (fieldNumber) {
      case 1:
        ;(message.asks ??= []).push(decodeDepthItem(reader.readBytes(wireType)))
        break
      case 2:
        ;(message.bids ??= []).push(decodeDepthItem(reader.readBytes(wireType)))
        break
      case 3:
        message.beginVersion = reader.readInt64String(wireType)
        if (message.beginVersion === '0') delete message.beginVersion
        break
      case 4:
        message.endVersion = reader.readInt64String(wireType)
        if (message.endVersion === '0') delete message.endVersion
        break
      case 5:
        message.timestamp = reader.readInt64String(wireType)
        if (message.timestamp === '0') delete message.timestamp
        break
      case 6:
        message.cts = reader.readInt64String(wireType)
        if (message.cts === '0') delete message.cts
        break
      default:
        reader.skipField(wireType)
    }
  }

  return message
}

function decodeDeal(data: Uint8Array) {
  const reader = new ProtobufReader(data)
  const message: {
    p?: string
    v?: string
    t?: number
    o?: number
    m?: number
    ts?: string
    i?: string
    cts?: string
  } = {}

  while (reader.done === false) {
    const { fieldNumber, wireType } = reader.readTag()

    switch (fieldNumber) {
      case 1:
        message.p = reader.readString(wireType)
        break
      case 2:
        message.v = reader.readString(wireType)
        break
      case 3:
        message.t = reader.readInt32(wireType)
        break
      case 4:
        message.o = reader.readInt32(wireType)
        break
      case 5:
        message.m = reader.readInt32(wireType)
        break
      case 6:
        message.ts = reader.readInt64String(wireType)
        break
      case 7:
        message.i = reader.readInt64String(wireType)
        break
      case 8:
        message.cts = reader.readInt64String(wireType)
        if (message.cts === '0') delete message.cts
        break
      default:
        reader.skipField(wireType)
    }
  }

  return message
}

function decodeDeals(data: Uint8Array) {
  const reader = new ProtobufReader(data)
  const message: {
    deals?: ReturnType<typeof decodeDeal>[]
  } = {}

  while (reader.done === false) {
    const { fieldNumber, wireType } = reader.readTag()

    switch (fieldNumber) {
      case 1:
        ;(message.deals ??= []).push(decodeDeal(reader.readBytes(wireType)))
        break
      default:
        reader.skipField(wireType)
    }
  }

  return message
}

function decodeTickerDetail(data: Uint8Array) {
  const reader = new ProtobufReader(data)
  const message: {
    symbol?: string
    lastPrice?: string
    riseFallRate?: string
    fairPrice?: string
    indexPrice?: string
    volume24?: string
    amount24?: string
    maxBidPrice?: string
    minAskPrice?: string
    lower24Price?: string
    high24Price?: string
    timestamp?: string
    bid1?: string
    ask1?: string
    holdVol?: string
    riseFallValue?: string
    fundingRate?: string
    zone?: string
    riseFallRates?: string[]
    riseFallRatesOfTimezone?: string[]
  } = {}

  while (reader.done === false) {
    const { fieldNumber, wireType } = reader.readTag()

    switch (fieldNumber) {
      case 1:
        message.symbol = reader.readString(wireType)
        if (message.symbol === '') delete message.symbol
        break
      case 2:
        message.lastPrice = reader.readString(wireType)
        if (message.lastPrice === '') delete message.lastPrice
        break
      case 3:
        message.riseFallRate = reader.readString(wireType)
        if (message.riseFallRate === '') delete message.riseFallRate
        break
      case 4:
        message.fairPrice = reader.readString(wireType)
        if (message.fairPrice === '') delete message.fairPrice
        break
      case 5:
        message.indexPrice = reader.readString(wireType)
        if (message.indexPrice === '') delete message.indexPrice
        break
      case 6:
        message.volume24 = reader.readString(wireType)
        if (message.volume24 === '') delete message.volume24
        break
      case 7:
        message.amount24 = reader.readString(wireType)
        if (message.amount24 === '') delete message.amount24
        break
      case 8:
        message.maxBidPrice = reader.readString(wireType)
        if (message.maxBidPrice === '') delete message.maxBidPrice
        break
      case 9:
        message.minAskPrice = reader.readString(wireType)
        if (message.minAskPrice === '') delete message.minAskPrice
        break
      case 10:
        message.lower24Price = reader.readString(wireType)
        if (message.lower24Price === '') delete message.lower24Price
        break
      case 11:
        message.high24Price = reader.readString(wireType)
        if (message.high24Price === '') delete message.high24Price
        break
      case 12:
        message.timestamp = reader.readInt64String(wireType)
        if (message.timestamp === '0') delete message.timestamp
        break
      case 13:
        message.bid1 = reader.readString(wireType)
        if (message.bid1 === '') delete message.bid1
        break
      case 14:
        message.ask1 = reader.readString(wireType)
        if (message.ask1 === '') delete message.ask1
        break
      case 15:
        message.holdVol = reader.readString(wireType)
        if (message.holdVol === '') delete message.holdVol
        break
      case 16:
        message.riseFallValue = reader.readString(wireType)
        if (message.riseFallValue === '') delete message.riseFallValue
        break
      case 17:
        message.fundingRate = reader.readString(wireType)
        if (message.fundingRate === '') delete message.fundingRate
        break
      case 18:
        message.zone = reader.readString(wireType)
        if (message.zone === '') delete message.zone
        break
      case 19:
        ;(message.riseFallRates ??= []).push(reader.readString(wireType))
        break
      case 20:
        ;(message.riseFallRatesOfTimezone ??= []).push(reader.readString(wireType))
        break
      default:
        reader.skipField(wireType)
    }
  }

  return message
}

function decodeFundingRate(data: Uint8Array) {
  const reader = new ProtobufReader(data)
  const message: {
    symbol?: string
    rate?: string
    nextSettleTime?: string
    fundingType?: string
  } = {}

  while (reader.done === false) {
    const { fieldNumber, wireType } = reader.readTag()

    switch (fieldNumber) {
      case 1:
        message.symbol = reader.readString(wireType)
        if (message.symbol === '') delete message.symbol
        break
      case 2:
        message.rate = reader.readString(wireType)
        if (message.rate === '') delete message.rate
        break
      case 3:
        message.nextSettleTime = reader.readInt64String(wireType)
        if (message.nextSettleTime === '0') delete message.nextSettleTime
        break
      case 4:
        message.fundingType = reader.readInt64String(wireType)
        if (message.fundingType === '0') delete message.fundingType
        break
      default:
        reader.skipField(wireType)
    }
  }

  return message
}

function decodeIndexPrice(data: Uint8Array) {
  const reader = new ProtobufReader(data)
  const message: {
    symbol?: string
    price?: string
  } = {}

  while (reader.done === false) {
    const { fieldNumber, wireType } = reader.readTag()

    switch (fieldNumber) {
      case 1:
        message.symbol = reader.readString(wireType)
        if (message.symbol === '') delete message.symbol
        break
      case 2:
        message.price = reader.readString(wireType)
        if (message.price === '') delete message.price
        break
      default:
        reader.skipField(wireType)
    }
  }

  return message
}

function decodeFairPrice(data: Uint8Array) {
  const reader = new ProtobufReader(data)
  const message: {
    symbol?: string
    price?: string
  } = {}

  while (reader.done === false) {
    const { fieldNumber, wireType } = reader.readTag()

    switch (fieldNumber) {
      case 1:
        message.symbol = reader.readString(wireType)
        if (message.symbol === '') delete message.symbol
        break
      case 2:
        message.price = reader.readString(wireType)
        if (message.price === '') delete message.price
        break
      default:
        reader.skipField(wireType)
    }
  }

  return message
}

function decodeRiskLimit(data: Uint8Array) {
  const reader = new ProtobufReader(data)
  const message: {
    level?: number
    maxVol?: string
    mmr?: string
    imr?: string
    maxLeverage?: number
  } = {}

  while (reader.done === false) {
    const { fieldNumber, wireType } = reader.readTag()

    switch (fieldNumber) {
      case 1:
        message.level = reader.readInt32(wireType)
        break
      case 2:
        message.maxVol = reader.readString(wireType)
        break
      case 3:
        message.mmr = reader.readString(wireType)
        break
      case 4:
        message.imr = reader.readString(wireType)
        break
      case 5:
        message.maxLeverage = reader.readInt32(wireType)
        break
      default:
        reader.skipField(wireType)
    }
  }

  return message
}

function decodeContractFeeRate(data: Uint8Array) {
  const reader = new ProtobufReader(data)
  const message: {
    minLeverage?: number
    maxLeverage?: number
    takerFeeRate?: string
    makerFeeRate?: string
    minTieredDealAmount?: string
    maxTieredDealAmount?: string
  } = {}

  while (reader.done === false) {
    const { fieldNumber, wireType } = reader.readTag()

    switch (fieldNumber) {
      case 1:
        message.minLeverage = reader.readInt32(wireType)
        break
      case 2:
        message.maxLeverage = reader.readInt32(wireType)
        break
      case 3:
        message.takerFeeRate = reader.readString(wireType)
        if (message.takerFeeRate === '') delete message.takerFeeRate
        break
      case 4:
        message.makerFeeRate = reader.readString(wireType)
        if (message.makerFeeRate === '') delete message.makerFeeRate
        break
      case 5:
        message.minTieredDealAmount = reader.readString(wireType)
        break
      case 6:
        message.maxTieredDealAmount = reader.readString(wireType)
        break
      default:
        reader.skipField(wireType)
    }
  }

  return message
}

function decodeContract(data: Uint8Array) {
  const reader = new ProtobufReader(data)
  const message: {
    symbol?: string
    displayName?: string
    displayNameEn?: string
    positionOpenType?: number
    baseCoin?: string
    quoteCoin?: string
    baseCoinName?: string
    quoteCoinName?: string
    futureType?: number
    settleCoin?: string
    contractSize?: string
    minLeverage?: number
    maxLeverage?: number
    priceScale?: number
    volScale?: number
    amountScale?: number
    priceUnit?: string
    volUnit?: string
    minVol?: string
    maxVol?: string
    limitMaxVol?: string
    bidLimitPriceRate?: string
    askLimitPriceRate?: string
    takerFeeRate?: string
    makerFeeRate?: string
    maintenanceMarginRate?: string
    initialMarginRate?: string
    riskBaseVol?: string
    riskIncrVol?: string
    riskIncrMmr?: string
    riskIncrImr?: string
    riskLevelLimit?: number
    priceCoefficientVariation?: string
    indexOrigin?: string[]
    state?: number
    isNew?: boolean
    isHot?: boolean
    isHidden?: boolean
    conceptPlate?: string[]
    riskLimitType?: ReturnType<typeof decodeRiskLimitType>
    triggerProtect?: string
    maxNumOrders?: number[]
    depthStepList?: string[]
    riskLongShortSwitch?: number
    riskBaseVolLong?: string
    riskIncrVolLong?: string
    riskBaseVolShort?: string
    riskIncrVolShort?: string
    openingTime?: string
    openingCountdownOption?: number
    conceptPlateId?: number[]
    riskLimitMode?: ReturnType<typeof decodeRiskLimitMode>
    riskLimitCustom?: ReturnType<typeof decodeRiskLimit>[]
    liquidationFeeRate?: string
    feeRateMode?: number
    leverageFeeRates?: ReturnType<typeof decodeContractFeeRate>[]
    tieredFeeRates?: ReturnType<typeof decodeContractFeeRate>[]
    tieredDealAmount?: string
    tieredEffectiveDay?: number
    tieredExcludeZeroFee?: boolean
    tieredAppointContract?: boolean
    tieredExcludeContractId?: boolean
    tieredContractIds?: number[]
    tagIdList?: string[]
  } = {}

  while (reader.done === false) {
    const { fieldNumber, wireType } = reader.readTag()

    switch (fieldNumber) {
      case 1:
        message.symbol = reader.readString(wireType)
        break
      case 2:
        message.displayName = reader.readString(wireType)
        break
      case 3:
        message.displayNameEn = reader.readString(wireType)
        break
      case 4:
        message.positionOpenType = reader.readInt32(wireType)
        if (message.positionOpenType === 0) delete message.positionOpenType
        break
      case 5:
        message.baseCoin = reader.readString(wireType)
        break
      case 6:
        message.quoteCoin = reader.readString(wireType)
        break
      case 7:
        message.baseCoinName = reader.readString(wireType)
        break
      case 8:
        message.quoteCoinName = reader.readString(wireType)
        break
      case 9:
        message.futureType = reader.readInt32(wireType)
        break
      case 10:
        message.settleCoin = reader.readString(wireType)
        break
      case 11:
        message.contractSize = reader.readString(wireType)
        break
      case 12:
        message.minLeverage = reader.readInt32(wireType)
        break
      case 13:
        message.maxLeverage = reader.readInt32(wireType)
        break
      case 14:
        message.priceScale = reader.readInt32(wireType)
        break
      case 15:
        message.volScale = reader.readInt32(wireType)
        break
      case 16:
        message.amountScale = reader.readInt32(wireType)
        break
      case 17:
        message.priceUnit = reader.readString(wireType)
        break
      case 18:
        message.volUnit = reader.readString(wireType)
        break
      case 19:
        message.minVol = reader.readString(wireType)
        break
      case 20:
        message.maxVol = reader.readString(wireType)
        break
      case 21:
        message.limitMaxVol = reader.readString(wireType)
        break
      case 22:
        message.bidLimitPriceRate = reader.readString(wireType)
        break
      case 23:
        message.askLimitPriceRate = reader.readString(wireType)
        break
      case 24:
        message.takerFeeRate = reader.readString(wireType)
        break
      case 25:
        message.makerFeeRate = reader.readString(wireType)
        break
      case 26:
        message.maintenanceMarginRate = reader.readString(wireType)
        break
      case 27:
        message.initialMarginRate = reader.readString(wireType)
        break
      case 28:
        message.riskBaseVol = reader.readString(wireType)
        break
      case 29:
        message.riskIncrVol = reader.readString(wireType)
        break
      case 30:
        message.riskIncrMmr = reader.readString(wireType)
        break
      case 31:
        message.riskIncrImr = reader.readString(wireType)
        break
      case 32:
        message.riskLevelLimit = reader.readInt32(wireType)
        break
      case 33:
        message.priceCoefficientVariation = reader.readString(wireType)
        break
      case 34:
        ;(message.indexOrigin ??= []).push(reader.readString(wireType))
        break
      case 35:
        message.state = reader.readInt32(wireType)
        if (message.state === 0) delete message.state
        break
      case 36:
        message.isNew = reader.readInt32(wireType) !== 0
        break
      case 37:
        message.isHot = reader.readInt32(wireType) !== 0
        break
      case 38:
        message.isHidden = reader.readInt32(wireType) !== 0
        break
      case 39:
        ;(message.conceptPlate ??= []).push(reader.readString(wireType))
        break
      case 40:
        message.riskLimitType = decodeRiskLimitType(reader, wireType)
        break
      case 41:
        message.triggerProtect = reader.readString(wireType)
        break
      case 42:
        if (wireType === 2) {
          const packed = new ProtobufReader(reader.readBytes(wireType))
          while (packed.done === false) {
            ;(message.maxNumOrders ??= []).push(packed.readInt32(0))
          }
        } else {
          ;(message.maxNumOrders ??= []).push(reader.readInt32(wireType))
        }
        break
      case 43:
        ;(message.depthStepList ??= []).push(reader.readString(wireType))
        break
      case 44:
        message.riskLongShortSwitch = reader.readInt32(wireType)
        break
      case 45:
        message.riskBaseVolLong = reader.readString(wireType)
        break
      case 46:
        message.riskIncrVolLong = reader.readString(wireType)
        break
      case 47:
        message.riskBaseVolShort = reader.readString(wireType)
        break
      case 48:
        message.riskIncrVolShort = reader.readString(wireType)
        break
      case 49:
        message.openingTime = reader.readInt64String(wireType)
        break
      case 50:
        message.openingCountdownOption = reader.readInt32(wireType)
        break
      case 51:
        if (wireType === 2) {
          const packed = new ProtobufReader(reader.readBytes(wireType))
          while (packed.done === false) {
            ;(message.conceptPlateId ??= []).push(packed.readInt32(0))
          }
        } else {
          ;(message.conceptPlateId ??= []).push(reader.readInt32(wireType))
        }
        break
      case 52:
        message.riskLimitMode = decodeRiskLimitMode(reader, wireType)
        if (message.riskLimitMode === 'RISK_LIMIT_MODE_UNKNOWN') delete message.riskLimitMode
        break
      case 53:
        ;(message.riskLimitCustom ??= []).push(decodeRiskLimit(reader.readBytes(wireType)))
        break
      case 54:
        message.liquidationFeeRate = reader.readString(wireType)
        if (message.liquidationFeeRate === '') delete message.liquidationFeeRate
        break
      case 55:
        message.feeRateMode = reader.readInt32(wireType)
        if (message.feeRateMode === 0) delete message.feeRateMode
        break
      case 56:
        ;(message.leverageFeeRates ??= []).push(decodeContractFeeRate(reader.readBytes(wireType)))
        break
      case 57:
        ;(message.tieredFeeRates ??= []).push(decodeContractFeeRate(reader.readBytes(wireType)))
        break
      case 58:
        message.tieredDealAmount = reader.readString(wireType)
        break
      case 59:
        message.tieredEffectiveDay = reader.readInt32(wireType)
        break
      case 60:
        message.tieredExcludeZeroFee = reader.readInt32(wireType) !== 0
        break
      case 61:
        message.tieredAppointContract = reader.readInt32(wireType) !== 0
        break
      case 62:
        message.tieredExcludeContractId = reader.readInt32(wireType) !== 0
        break
      case 63:
        if (wireType === 2) {
          const packed = new ProtobufReader(reader.readBytes(wireType))
          while (packed.done === false) {
            ;(message.tieredContractIds ??= []).push(packed.readInt32(0))
          }
        } else {
          ;(message.tieredContractIds ??= []).push(reader.readInt32(wireType))
        }
        break
      case 64:
        if (wireType === 2) {
          const packed = new ProtobufReader(reader.readBytes(wireType))
          while (packed.done === false) {
            ;(message.tagIdList ??= []).push(packed.readInt64String(0))
          }
        } else {
          ;(message.tagIdList ??= []).push(reader.readInt64String(wireType))
        }
        break
      default:
        reader.skipField(wireType)
    }
  }

  return message
}

function decodeContractExtra(data: Uint8Array) {
  const reader = new ProtobufReader(data)
  const message: {
    symbol?: string
    triggerProtect?: string
    appraisal?: number
    showAppraisalCountdown?: number
    appraisalEndTime?: string
    automaticDelivery?: number
    deliveryTime?: string
    deliveryPriceTrend?: number
    type?: number
    stopOnlyFair?: boolean
    preMarket?: boolean
    typeLabel?: number
    riskLimitRate?: string
  } = {}

  while (reader.done === false) {
    const { fieldNumber, wireType } = reader.readTag()

    switch (fieldNumber) {
      case 1:
        message.symbol = reader.readString(wireType)
        break
      case 2:
        message.triggerProtect = reader.readString(wireType)
        if (message.triggerProtect === '') delete message.triggerProtect
        break
      case 3:
        message.appraisal = reader.readInt32(wireType)
        if (message.appraisal === 0) delete message.appraisal
        break
      case 4:
        message.showAppraisalCountdown = reader.readInt32(wireType)
        if (message.showAppraisalCountdown === 0) delete message.showAppraisalCountdown
        break
      case 5:
        message.appraisalEndTime = reader.readInt64String(wireType)
        break
      case 6:
        message.automaticDelivery = reader.readInt32(wireType)
        if (message.automaticDelivery === 0) delete message.automaticDelivery
        break
      case 7:
        message.deliveryTime = reader.readInt64String(wireType)
        break
      case 8:
        message.deliveryPriceTrend = reader.readInt32(wireType)
        break
      case 9:
        message.type = reader.readInt32(wireType)
        break
      case 10:
        message.stopOnlyFair = reader.readInt32(wireType) !== 0
        if (message.stopOnlyFair === false) delete message.stopOnlyFair
        break
      case 11:
        message.preMarket = reader.readInt32(wireType) !== 0
        break
      case 12:
        message.typeLabel = reader.readInt32(wireType)
        break
      case 13:
        message.riskLimitRate = reader.readString(wireType)
        break
      default:
        reader.skipField(wireType)
    }
  }

  return message
}

function decodeMarketOrderSetting(data: Uint8Array) {
  const reader = new ProtobufReader(data)
  const message: {
    symbol?: string
    level?: number
    maxLevel?: number
    priceLimitRate1?: string
    priceLimitRate2?: string
    threshold?: string
  } = {}

  while (reader.done === false) {
    const { fieldNumber, wireType } = reader.readTag()

    switch (fieldNumber) {
      case 1:
        message.symbol = reader.readString(wireType)
        if (message.symbol === '') delete message.symbol
        break
      case 2:
        message.level = reader.readInt32(wireType)
        break
      case 3:
        message.maxLevel = reader.readInt32(wireType)
        break
      case 4:
        message.priceLimitRate1 = reader.readString(wireType)
        if (message.priceLimitRate1 === '') delete message.priceLimitRate1
        break
      case 5:
        message.priceLimitRate2 = reader.readString(wireType)
        if (message.priceLimitRate2 === '') delete message.priceLimitRate2
        break
      case 6:
        message.threshold = reader.readInt64String(wireType)
        break
      default:
        reader.skipField(wireType)
    }
  }

  return message
}

function decodeRiskLimitType(reader: ProtobufReader, wireType: number) {
  const value = reader.readInt32(wireType)
  switch (value) {
    case 0:
      return 'RISKLIMIT_TYPE_UNKNOWN' as const
    case 1:
      return 'BY_VOLUME' as const
    case 2:
      return 'BY_VALUE' as const
    default:
      return value
  }
}

function decodeRiskLimitMode(reader: ProtobufReader, wireType: number) {
  const value = reader.readInt32(wireType)
  switch (value) {
    case 0:
      return 'RISK_LIMIT_MODE_UNKNOWN' as const
    case 1:
      return 'INCREASE' as const
    case 2:
      return 'CUSTOM' as const
    default:
      return value
  }
}
