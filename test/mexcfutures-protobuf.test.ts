import { test } from 'node:test'
import { assert } from './assertions.ts'
import { decodeMexcFuturesProtobufMessage } from '../dist/realtimefeeds/mexcfuturesprotobuf.js'
import { MexcFuturesRealTimeFeed } from '../dist/realtimefeeds/mexcfutures.js'

const fixtures = [
  {
    base64: 'CghCVENfVVNEVBIQcHVzaC5pbmRleC5wcmljZRjczseYoTSKfRMKCEJUQ19VU0RUEgc1ODMzMy42',
    decoded: {
      symbol: 'BTC_USDT',
      channel: 'push.index.price',
      ts: '1795616270172',
      indexPrice: {
        symbol: 'BTC_USDT',
        price: '58333.6'
      }
    },
    source:
      'Live MEXC Futures Protobuf capture 2026-11-25; decoded independently using official schemas at 033825833318b4bc3add4481997e9f76005c6483'
  },
  {
    base64: 'CghCVENfVVNEVBIPcHVzaC5mYWlyLnByaWNlGMTPx5ihNOp9EwoIQlRDX1VTRFQSBzU4MzA4LjU=',
    decoded: {
      symbol: 'BTC_USDT',
      channel: 'push.fair.price',
      ts: '1795616270276',
      fairPrice: {
        symbol: 'BTC_USDT',
        price: '58308.5'
      }
    },
    source:
      'Live MEXC Futures Protobuf capture 2026-11-25; decoded independently using official schemas at 033825833318b4bc3add4481997e9f76005c6483'
  },
  {
    base64: 'CghCVENfVVNEVBIKcHVzaC5kZXB0aBjRo8iYoTSCfiwKDgoFNTgzMDASAzEzMBgCGPmetr+jASD5nra/owEopaPImKE0MKWjyJihNA==',
    decoded: {
      symbol: 'BTC_USDT',
      channel: 'push.depth',
      ts: '1795616281041',
      depthMerge: {
        asks: [
          {
            price: '58300',
            vol: '130',
            count: 2
          }
        ],
        beginVersion: '43887988601',
        endVersion: '43887988601',
        timestamp: '1795616280997',
        cts: '1795616280997'
      }
    },
    source:
      'Live MEXC Futures Protobuf capture 2026-11-25; decoded independently using official schemas at 033825833318b4bc3add4481997e9f76005c6483'
  },
  {
    base64: 'CghCVENfVVNEVBIJcHVzaC5kZWFsGIvXx5ihNKp9JQoFNTgzMDASAjEzGAIgAygBMIXXx5ihNDjswJn4P0CF18eYoTQ=',
    decoded: {
      symbol: 'BTC_USDT',
      channel: 'push.deal',
      ts: '1795616271243',
      deal: {
        p: '58300',
        v: '13',
        t: 2,
        o: 3,
        m: 1,
        ts: '1795616271237',
        i: '17163509868',
        cts: '1795616271237'
      }
    },
    source:
      'Live MEXC Futures Protobuf capture 2026-11-25; decoded independently using official schemas at 033825833318b4bc3add4481997e9f76005c6483'
  },
  {
    base64:
      'CghCVENfVVNEVBILcHVzaC50aWNrZXIYiKLImKE0in6GAgoIQlRDX1VTRFQSBzU4Mjg0LjkaBy0wLjAyMzYiBTU4Mjg1Kgc1ODMxMC41Mgk1NzUxNDg3OTA6EDM0MTIxNjExMTYuNTQ1NjVCBzY0MTQxLjVKBzUyNDc5LjRSBzU3OTYyLjVaBzYwNjYyLjRgiKLImKE0agc1ODI4NC45cgU1ODI4NXoJNDgxNzY0OTc5ggEHLTE0MDkuMooBCDAuMDAwMDc0kgEFVVRDKziaAQctMC4wMjM2mgEHLTAuMDkwNJoBBy0wLjI3NjiaAQctMC4yNTI1mgEHLTAuMjAwNJoBBy0wLjMyNjeiAQctMC4wMjgzogEHLTAuMDI1M6IBBy0wLjAyMzY=',
    decoded: {
      symbol: 'BTC_USDT',
      channel: 'push.ticker',
      ts: '1795616280840',
      tickerDetail: {
        symbol: 'BTC_USDT',
        lastPrice: '58284.9',
        riseFallRate: '-0.0236',
        fairPrice: '58285',
        indexPrice: '58310.5',
        volume24: '575148790',
        amount24: '3412161116.54565',
        maxBidPrice: '64141.5',
        minAskPrice: '52479.4',
        lower24Price: '57962.5',
        high24Price: '60662.4',
        timestamp: '1795616280840',
        bid1: '58284.9',
        ask1: '58285',
        holdVol: '481764979',
        riseFallValue: '-1409.2',
        fundingRate: '0.000074',
        zone: 'UTC+8',
        riseFallRates: ['-0.0236', '-0.0904', '-0.2768', '-0.2525', '-0.2004', '-0.3267'],
        riseFallRatesOfTimezone: ['-0.0283', '-0.0253', '-0.0236']
      }
    },
    source:
      'Live MEXC Futures Protobuf capture 2026-11-25; decoded independently using official schemas at 033825833318b4bc3add4481997e9f76005c6483'
  },
  {
    base64: 'CghCVENfVVNEVBIRcHVzaC5mdW5kaW5nLnJhdGUY1J7ImKE0soMBGwoIQlRDX1VTRFQSCDAuMDAwMDc0GIDgvZuhNA==',
    decoded: {
      symbol: 'BTC_USDT',
      channel: 'push.funding.rate',
      ts: '1795616280404',
      fundingRate: {
        symbol: 'BTC_USDT',
        rate: '0.000074',
        nextSettleTime: '1795622400000'
      }
    },
    source:
      'Live MEXC Futures Protobuf capture 2026-11-25; decoded independently using official schemas at 033825833318b4bc3add4481997e9f76005c6483'
  },
  {
    source: 'Local Protobuf recorder slice 2026-11-25 13:18 UTC, encoded using official schemas',
    base64:
      'Cg1HRlNTVE9DS19VU0RUEg1wdXNoLmNvbnRyYWN0GIWC7pahNKJ9rAMKDUdGU1NUT0NLX1VTRFQSDkdGU19VU0RU5rC457utGhJHRlNfVVNEVCBQRVJQRVRVQUwgAyoIR0ZTU1RPQ0syBFVTRFQ6A0dGU0IEVVNEVEgBUgRVU0RUWgQwLjAxYAFoFHACeACAAQSKAQQwLjAxkgEBMZoBATGiAQU4NTMwMKoBBjI4NDQwMLIBAzAuMroBAzAuMsIBBjAuMDAwMsoBATDSAQQwLjAy2gEEMC4wNeIBBTg1MzAw6gEBMPIBBDAuMDH6AQQwLjAxgAIBigIDMC40kgINQklUR0VUX0ZVVFVSRZICDElORk9XQVlTVE9DS5ICBFBZVEigAgCoAgCwAgC6AhNtYy10cmFkZS16b25lLVN0b2NrugITbWMtdHJhZGUtem9uZS0wZmVlc7oCFG1jLXRyYWRlLXpvbmUtdHJhZGZpugIWbWMtdHJhZGUtem9uZS11c3N0b2Nrc8ACAcoCAzAuMdICA8gBMtoCBDAuMDHaAgMwLjHaAgEx2gICMTDgAgCIA8DoyuL8M5ADAZoDBDktRGSgAwGyAwYwLjAwMDK4AwGCBAICCA==',
    decoded: {
      symbol: 'GFSSTOCK_USDT',
      channel: 'push.contract',
      ts: '1795612705029',
      contract: {
        symbol: 'GFSSTOCK_USDT',
        displayName: 'GFS_USDT\u6c38\u7eed',
        displayNameEn: 'GFS_USDT PERPETUAL',
        positionOpenType: 3,
        baseCoin: 'GFSSTOCK',
        quoteCoin: 'USDT',
        baseCoinName: 'GFS',
        quoteCoinName: 'USDT',
        futureType: 1,
        settleCoin: 'USDT',
        contractSize: '0.01',
        minLeverage: 1,
        maxLeverage: 20,
        priceScale: 2,
        volScale: 0,
        amountScale: 4,
        priceUnit: '0.01',
        volUnit: '1',
        minVol: '1',
        maxVol: '85300',
        limitMaxVol: '284400',
        bidLimitPriceRate: '0.2',
        askLimitPriceRate: '0.2',
        takerFeeRate: '0.0002',
        makerFeeRate: '0',
        maintenanceMarginRate: '0.02',
        initialMarginRate: '0.05',
        riskBaseVol: '85300',
        riskIncrVol: '0',
        riskIncrMmr: '0.01',
        riskIncrImr: '0.01',
        riskLevelLimit: 1,
        priceCoefficientVariation: '0.4',
        indexOrigin: ['BITGET_FUTURE', 'INFOWAYSTOCK', 'PYTH'],
        isNew: false,
        isHot: false,
        isHidden: false,
        conceptPlate: ['mc-trade-zone-Stock', 'mc-trade-zone-0fees', 'mc-trade-zone-tradfi', 'mc-trade-zone-usstocks'],
        riskLimitType: 'BY_VOLUME',
        triggerProtect: '0.1',
        maxNumOrders: [200, 50],
        depthStepList: ['0.01', '0.1', '1', '10'],
        riskLongShortSwitch: 0,
        openingTime: '1785839400000',
        openingCountdownOption: 1,
        conceptPlateId: [57, 45, 68, 100],
        riskLimitMode: 'INCREASE',
        liquidationFeeRate: '0.0002',
        feeRateMode: 1,
        tagIdList: ['2', '8']
      }
    }
  },
  {
    source: 'Local Protobuf recorder slice 2026-11-25 13:18 UTC, encoded using official schemas',
    base64: 'Cg1HRlNTVE9DS19VU0RUEhpwdXNoLmNvbnRyYWN0LmV4dHJhLnVwZGF0ZRiGgu6WoTSafRIKDUdGU1NUT0NLX1VTRFQSATA=',
    decoded: {
      symbol: 'GFSSTOCK_USDT',
      channel: 'push.contract.extra.update',
      ts: '1795612705030',
      contractExtra: {
        symbol: 'GFSSTOCK_USDT',
        triggerProtect: '0'
      }
    }
  },
  {
    source: 'Official-schema encoded numeric and message-variant fixture',
    base64: 'CghCVENfVVNEVBIJcHVzaC5kZWFssn06Ch0KATESATIYASAAKAAwgIC10qE0OP//////////fwoZCgEyEgExGAIwgYC10qE0OP7/////////fw==',
    decoded: {
      symbol: 'BTC_USDT',
      channel: 'push.deal',
      deals: {
        deals: [
          {
            p: '1',
            v: '2',
            t: 1,
            o: 0,
            m: 0,
            ts: '1795737600000',
            i: '9223372036854775807'
          },
          {
            p: '2',
            v: '1',
            t: 2,
            ts: '1795737600001',
            i: '9223372036854775806'
          }
        ]
      }
    }
  },
  {
    source: 'Official-schema encoded numeric and message-variant fixture',
    base64:
      'CghCVENfVVNEVBINcHVzaC5jb250cmFjdKJ9TwoIQlRDX1VTRFSgAgDAAgLSAgIACogDAJoDAgECoAMCqgMOCAASAzEwMBoFMC4wMDHCAwoIABoGMC4wMDAx+gMCCguCBAn//////////38=',
    decoded: {
      symbol: 'BTC_USDT',
      channel: 'push.contract',
      contract: {
        symbol: 'BTC_USDT',
        isNew: false,
        riskLimitType: 'BY_VALUE',
        maxNumOrders: [0, 10],
        openingTime: '0',
        conceptPlateId: [1, 2],
        riskLimitMode: 'CUSTOM',
        riskLimitCustom: [
          {
            level: 0,
            maxVol: '100',
            mmr: '0.001'
          }
        ],
        leverageFeeRates: [
          {
            minLeverage: 0,
            takerFeeRate: '0.0001'
          }
        ],
        tieredContractIds: [10, 11],
        tagIdList: ['9223372036854775807']
      }
    }
  },
  {
    source: 'Official-schema encoded numeric and message-variant fixture',
    base64: 'CghCVENfVVNEVBIRcHVzaC5tYXJrZXQub3JkZXKigwEbCghCVENfVVNEVBAAGAoiATAw//////////9/',
    decoded: {
      symbol: 'BTC_USDT',
      channel: 'push.market.order',
      marketOrderSetting: {
        symbol: 'BTC_USDT',
        level: 0,
        maxLevel: 10,
        priceLimitRate1: '0',
        threshold: '9223372036854775807'
      }
    }
  },
  {
    source: 'Official-schema encoded numeric and message-variant fixture',
    base64: 'CghCVENfVVNEVBIKcHVzaC5kZXB0aIJ+BBhkIGU=',
    decoded: {
      symbol: 'BTC_USDT',
      channel: 'push.depth',
      depthMerge: {
        beginVersion: '100',
        endVersion: '101'
      }
    }
  }
]

for (const [index, fixture] of fixtures.entries()) {
  test(`MEXC Futures decodes official-schema fixture ${index + 1}: ${fixture.decoded.channel}`, () => {
    assert.deepStrictEqual(decodeMexcFuturesProtobufMessage(Buffer.from(fixture.base64, 'base64')), fixture.decoded)
  })
}

class TestFeed extends MexcFuturesRealTimeFeed {
  parse(bytes: Buffer) {
    return this.parseMessage(bytes)
  }
  url() {
    return this.getWebSocketUrl()
  }
  subscriptions() {
    return this.mapToSubscribeMessages([
      { channel: 'push.deal', symbols: ['BTC_USDT'] },
      { channel: 'push.depth', symbols: ['BTC_USDT'] },
      { channel: 'push.ticker', symbols: ['BTC_USDT'] },
      { channel: 'push.contract' }
    ])
  }
}

test('MEXC Futures uses Protobuf without reducing trades or unbatching depth', async () => {
  const feed = new TestFeed('mexc-futures', [], undefined)
  assert.strictEqual(await feed.url(), 'wss://contract.mexc.com/edge?Trans-Protocol=Protobuf')
  assert.deepStrictEqual(feed.subscriptions(), [
    { method: 'sub.deal', param: { symbol: 'BTC_USDT', reduce: false }, gzip: false },
    { method: 'sub.depth', param: { symbol: 'BTC_USDT', compress: true }, gzip: false },
    { method: 'sub.ticker', param: { symbol: 'BTC_USDT' }, gzip: false },
    { method: 'sub.contract' }
  ])
  assert.deepStrictEqual(feed.parse(Buffer.from('{"channel":"rs.sub.deal","data":"success"}')), { channel: 'rs.sub.deal', data: 'success' })
  for (const fixture of fixtures) assert.deepStrictEqual(feed.parse(Buffer.from(fixture.base64, 'base64')), fixture.decoded)
})
