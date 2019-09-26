import { getMapper } from '../src'

describe('Mapper.map(message, localTimestmap)', () => {
  test('maps deribit messages', () => {
    const messages = [
      {
        jsonrpc: '2.0',
        method: 'subscription',
        params: {
          channel: 'trades.BTC-PERPETUAL.raw',
          data: [
            {
              trade_seq: 20944815,
              trade_id: '39355898',
              timestamp: 1567296022565,
              tick_direction: 2,
              price: 9598.5,
              instrument_name: 'BTC-PERPETUAL',
              index_price: 9600.8,
              direction: 'sell',
              amount: 2000.0
            },
            {
              trade_seq: 20944816,
              trade_id: '39355899',
              timestamp: 1567296022565,
              tick_direction: 3,
              price: 9598.5,
              instrument_name: 'BTC-PERPETUAL',
              index_price: 9600.8,
              direction: 'sell',
              amount: 50.0
            }
          ]
        }
      },
      {
        jsonrpc: '2.0',
        method: 'subscription',
        params: {
          channel: 'quote.BTC-PERPETUAL',
          data: {
            timestamp: 1567296000183,
            instrument_name: 'BTC-PERPETUAL',
            best_bid_price: 9600.5,
            best_bid_amount: 162800.0,
            best_ask_price: 9601.0,
            best_ask_amount: 49710.0
          }
        }
      },
      {
        jsonrpc: '2.0',
        method: 'subscription',
        params: {
          channel: 'book.ETH-PERPETUAL.raw',
          data: {
            timestamp: 1564617600273,
            instrument_name: 'ETH-PERPETUAL',
            change_id: 1776289261,
            bids: [['new', 217.8, 1895.0], ['new', 217.75, 712.0]],
            asks: [['new', 218.6, 179803.0], ['new', 218.65, 7887.0]]
          }
        }
      },
      {
        jsonrpc: '2.0',
        method: 'subscription',
        params: {
          channel: 'book.ETH-PERPETUAL.raw',
          data: {
            timestamp: 1564617654272,
            prev_change_id: 1776294621,
            instrument_name: 'ETH-PERPETUAL',
            change_id: 1776294623,
            bids: [['delete', 217.8, 0.0]],
            asks: [['change', 219.2, 64903.0], ['change', 219.1, 19343.0]]
          }
        }
      },
      {
        jsonrpc: '2.0',
        method: 'subscription',
        params: {
          channel: 'ticker.BTC-PERPETUAL.raw',
          data: {
            timestamp: 1564617604229,
            stats: { volume: 24618.46215298, low: 9569.5, high: 10131.5 },
            state: 'open',
            settlement_price: 9743.97,
            open_interest: 66128281,
            min_price: 9942.76,
            max_price: 10245.58,
            mark_price: 10094.1,
            last_price: 10095.5,
            instrument_name: 'BTC-PERPETUAL',
            index_price: 10091.15,
            funding_8h: 0.00016281,
            current_funding: 0.0,
            best_bid_price: 10095.0,
            best_bid_amount: 7000.0,
            best_ask_price: 10095.5,
            best_ask_amount: 250.0
          }
        }
      }
    ]
    const deribitMapper = getMapper('deribit')
    for (const message of messages) {
      const mappedMessages = Array.from(deribitMapper.map(message, new Date('2019-09-01T00:00:22.5789670Z'))!)
      expect(mappedMessages).toMatchSnapshot()
    }
  })

  test('maps bitmex messages', () => {
    const messages = [
      {
        table: 'trade',
        action: 'insert',
        data: [
          {
            timestamp: '2019-06-01T00:00:19.163Z',
            symbol: 'XBTUSD',
            side: 'Sell',
            size: 1000,
            price: 8544.5,
            tickDirection: 'ZeroMinusTick',
            trdMatchID: 'f73b6f28-075a-3548-a81c-8c843afd2746',
            grossValue: 11703000,
            homeNotional: 0.11703,
            foreignNotional: 1000
          }
        ]
      },
      {
        table: 'instrument',
        action: 'update',
        data: [{ symbol: 'XBTUSD', lastTickDirection: 'ZeroMinusTick', timestamp: '2019-06-01T00:00:19.163Z' }]
      },
      { table: 'orderBookL2', action: 'update', data: [{ symbol: 'XBTUSD', id: 8799145550, side: 'Buy', size: 220288 }] },
      {
        table: 'instrument',
        action: 'partial',
        filter: {},
        data: [
          {
            symbol: 'ETHM19',
            rootSymbol: 'ETH',
            state: 'Open',
            typ: 'FFCCSX',
            listing: '2019-03-15T08:00:00.000Z',
            front: '2019-05-31T12:00:00.000Z',
            expiry: '2019-06-28T12:00:00.000Z',
            settle: '2019-06-28T12:00:00.000Z',
            relistInterval: null,
            inverseLeg: '',
            sellLeg: '',
            buyLeg: '',
            optionStrikePcnt: null,
            optionStrikeRound: null,
            optionStrikePrice: null,
            optionMultiplier: null,
            positionCurrency: 'ETH',
            underlying: 'ETH',
            quoteCurrency: 'XBT',
            underlyingSymbol: 'ETHXBT=',
            reference: 'BMEX',
            referenceSymbol: '.BETHXBT30M',
            calcInterval: null,
            publishInterval: null,
            publishTime: null,
            maxOrderQty: 100000000,
            maxPrice: 10,
            lotSize: 1,
            tickSize: 0.00001,
            multiplier: 100000000,
            settlCurrency: 'XBt',
            underlyingToPositionMultiplier: 1,
            underlyingToSettleMultiplier: null,
            quoteToSettleMultiplier: 100000000,
            isQuanto: false,
            isInverse: false,
            initMargin: 0.02,
            maintMargin: 0.01,
            riskLimit: 5000000000,
            riskStep: 5000000000,
            limit: null,
            capped: false,
            taxed: true,
            deleverage: true,
            makerFee: -0.0005,
            takerFee: 0.0025,
            settlementFee: 0,
            insuranceFee: 0,
            fundingBaseSymbol: '',
            fundingQuoteSymbol: '',
            fundingPremiumSymbol: '',
            fundingTimestamp: null,
            fundingInterval: null,
            fundingRate: null,
            indicativeFundingRate: null,
            rebalanceTimestamp: null,
            rebalanceInterval: null,
            openingTimestamp: '2019-05-31T23:00:00.000Z',
            closingTimestamp: '2019-06-01T00:00:00.000Z',
            sessionInterval: '2000-01-01T01:00:00.000Z',
            prevClosePrice: 0.0311,
            limitDownPrice: null,
            limitUpPrice: null,
            bankruptLimitDownPrice: null,
            bankruptLimitUpPrice: null,
            prevTotalVolume: 4070606,
            totalVolume: 4075076,
            volume: 4470,
            volume24h: 70698,
            prevTotalTurnover: 12718107396000,
            totalTurnover: 12732141124000,
            turnover: 14033728000,
            turnover24h: 219620772000,
            homeNotional24h: 70698,
            foreignNotional24h: 2196.2077199999994,
            prevPrice24h: 0.03089,
            vwap: 0.03106464,
            highPrice: 0.03163,
            lowPrice: 0.03033,
            lastPrice: 0.03161,
            lastPriceProtected: 0.03161,
            lastTickDirection: 'ZeroPlusTick',
            lastChangePcnt: 0.0233,
            bidPrice: 0.03162,
            midPrice: 0.031625,
            askPrice: 0.03163,
            impactBidPrice: 0.03162,
            impactMidPrice: 0.031625,
            impactAskPrice: 0.03163,
            hasLiquidity: true,
            openInterest: 150499,
            openValue: 475877838000,
            fairMethod: 'ImpactMidPrice',
            fairBasisRate: 0.13,
            fairBasis: 0.00031,
            fairPrice: 0.03162,
            markMethod: 'FairPrice',
            markPrice: 0.03162,
            indicativeTaxRate: 0,
            indicativeSettlePrice: 0.03131,
            optionUnderlyingPrice: null,
            settledPrice: null,
            timestamp: '2019-05-31T23:59:30.000Z'
          },
          {
            symbol: 'LTCM19',
            rootSymbol: 'LTC',
            state: 'Open',
            typ: 'FFCCSX',
            listing: '2019-03-15T08:00:00.000Z',
            front: '2019-05-31T12:00:00.000Z',
            expiry: '2019-06-28T12:00:00.000Z',
            settle: '2019-06-28T12:00:00.000Z',
            relistInterval: null,
            inverseLeg: '',
            sellLeg: '',
            buyLeg: '',
            optionStrikePcnt: null,
            optionStrikeRound: null,
            optionStrikePrice: null,
            optionMultiplier: null,
            positionCurrency: 'LTC',
            underlying: 'LTC',
            quoteCurrency: 'XBT',
            underlyingSymbol: 'LTCXBT=',
            reference: 'BMEX',
            referenceSymbol: '.BLTCXBT30M',
            calcInterval: null,
            publishInterval: null,
            publishTime: null,
            maxOrderQty: 100000000,
            maxPrice: 10,
            lotSize: 1,
            tickSize: 0.000005,
            multiplier: 100000000,
            settlCurrency: 'XBt',
            underlyingToPositionMultiplier: 1,
            underlyingToSettleMultiplier: null,
            quoteToSettleMultiplier: 100000000,
            isQuanto: false,
            isInverse: false,
            initMargin: 0.03,
            maintMargin: 0.015,
            riskLimit: 5000000000,
            riskStep: 5000000000,
            limit: null,
            capped: false,
            taxed: true,
            deleverage: true,
            makerFee: -0.0005,
            takerFee: 0.0025,
            settlementFee: 0,
            insuranceFee: 0,
            fundingBaseSymbol: '',
            fundingQuoteSymbol: '',
            fundingPremiumSymbol: '',
            fundingTimestamp: null,
            fundingInterval: null,
            fundingRate: null,
            indicativeFundingRate: null,
            rebalanceTimestamp: null,
            rebalanceInterval: null,
            openingTimestamp: '2019-05-31T23:00:00.000Z',
            closingTimestamp: '2019-06-01T00:00:00.000Z',
            sessionInterval: '2000-01-01T01:00:00.000Z',
            prevClosePrice: 0.01313,
            limitDownPrice: null,
            limitUpPrice: null,
            bankruptLimitDownPrice: null,
            bankruptLimitUpPrice: null,
            prevTotalVolume: 14683085,
            totalVolume: 14706051,
            volume: 22966,
            volume24h: 193546,
            prevTotalTurnover: 20805359301000,
            totalTurnover: 20836292769500,
            turnover: 30933468500,
            turnover24h: 255133524000,
            homeNotional24h: 193546,
            foreignNotional24h: 2551.3352399999985,
            prevPrice24h: 0.01312,
            vwap: 0.01318207,
            highPrice: 0.01357,
            lowPrice: 0.0129,
            lastPrice: 0.01354,
            lastPriceProtected: 0.01354,
            lastTickDirection: 'ZeroMinusTick',
            lastChangePcnt: 0.032,
            bidPrice: 0.013535,
            midPrice: 0.0135375,
            askPrice: 0.01354,
            impactBidPrice: 0.01353146,
            impactMidPrice: 0.013535,
            impactAskPrice: 0.01354,
            hasLiquidity: true,
            openInterest: 204654,
            openValue: 276958258200,
            fairMethod: 'ImpactMidPrice',
            fairBasisRate: 0.15,
            fairBasis: 0.000151,
            fairPrice: 0.013533,
            markMethod: 'FairPrice',
            markPrice: 0.013533,
            indicativeTaxRate: 0,
            indicativeSettlePrice: 0.013382,
            optionUnderlyingPrice: null,
            settledPrice: null,
            timestamp: '2019-05-31T23:59:55.000Z'
          }
        ]
      },
      {
        table: 'instrument',
        action: 'update',
        data: [
          {
            symbol: 'ETHM19',
            lastPriceProtected: 267.75,
            bidPrice: 267.7,
            midPrice: 267.725,
            askPrice: 267.75,
            impactBidPrice: 267.62,
            impactMidPrice: 267.7,
            impactAskPrice: 267.76,
            timestamp: '2019-05-31T23:59:58.022Z'
          }
        ]
      },
      {
        table: 'quote',
        action: 'insert',
        data: [{ timestamp: '2019-05-31T23:59:59.942Z', symbol: 'ETHUSD', bidSize: 701, bidPrice: 267.7, askPrice: 267.75, askSize: 62427 }]
      },
      {
        table: 'orderBookL2',
        action: 'partial',
        data: [
          { symbol: 'XBTUSD', id: 8791115350, side: 'Sell', size: 501, price: 88846.5 },
          { symbol: 'XBTUSD', id: 8799021950, side: 'Sell', size: 40, price: 9780.5 },
          { symbol: 'XBTUSD', id: 8799141400, side: 'Sell', size: 61227, price: 8586 },
          { symbol: 'EOSM19', id: 33199989899, side: 'Buy', size: 417, price: 0.0010102 }
        ]
      },
      { table: 'orderBookL2', action: 'update', data: [{ symbol: 'XBTUSD', id: 8799141400, side: 'Sell', size: 91227 }] },
      { table: 'orderBookL2', action: 'delete', data: [{ symbol: 'XBTUSD', id: 8799141400, side: 'Sell' }] },
      {
        table: 'orderBookL2',
        action: 'insert',
        data: [{ symbol: 'EOSM19', id: 33199989898, side: 'Buy', size: 416, price: 0.0010102 }]
      }
    ]

    const bitmexMapper = getMapper('bitmex')
    for (const message of messages) {
      const mappedMessages = bitmexMapper.map(message, new Date('2019-06-01T00:00:28.6199940Z'))
      const mappedMessagesArrayOrUndefined = mappedMessages && Array.from(mappedMessages)
      expect(mappedMessagesArrayOrUndefined).toMatchSnapshot()
    }
  })

  test('maps okex messages', () => {
    const messages = [
      {
        table: 'futures/trade',
        data: [
          {
            side: 'sell',
            trade_id: '2578238628528131',
            price: 4061.94,
            qty: 4,
            instrument_id: 'BTC-USD-190628',
            timestamp: '2019-03-31T23:59:59.388Z'
          }
        ]
      },
      {
        table: 'futures/trade',
        data: [
          {
            side: 'buy',
            trade_id: '3269040623943685',
            price: '10209.43',
            qty: '5',
            instrument_id: 'BTC-USD-190927',
            timestamp: '2019-08-01T00:00:01.320Z'
          }
        ]
      },
      {
        table: 'spot/trade',
        data: [
          {
            instrument_id: 'BCH-USDT',
            price: '328.74',
            side: 'sell',
            size: '0.12',
            timestamp: '2019-08-01T00:00:08.806Z',
            trade_id: '423886239'
          }
        ]
      },
      {
        table: 'swap/depth',
        action: 'update',
        data: [
          {
            instrument_id: 'XRP-USD-SWAP',
            asks: [['0.3198', '264', '0', '5'], ['0.3199', '222', '0', '4'], ['0.3219', '2014', '0', '2']],
            bids: [['0.3196', '1646', '0', '14'], ['0.3195', '1672', '0', '6']],
            timestamp: '2019-08-01T00:00:08.930Z',
            checksum: 1684272782
          }
        ]
      },

      {
        table: 'futures/depth',
        action: 'partial',
        data: [
          {
            instrument_id: 'BTC-USD-190405',
            asks: [[4084.57, 38, 0, 3], [4085.0, 20, 0, 1]],
            bids: [[4084.56, 4, 0, 1], [4084.5, 29, 0, 1]],
            timestamp: '2019-08-01T00:00:08.930Z'
          }
        ]
      },
      {
        table: 'spot/ticker',
        data: [
          {
            instrument_id: 'TRX-ETH',
            last: '0.0001659',
            best_bid: '0.0001654',
            best_ask: '0.0001659',
            open_24h: '0.0001629',
            high_24h: '0.0001665',
            low_24h: '0.0001629',
            base_volume_24h: '207761417.05',
            quote_volume_24h: '34230.351676558',
            timestamp: '2019-04-01T00:00:27.106Z'
          }
        ]
      },
      {
        table: 'swap/ticker',
        data: [
          {
            best_ask: '329.3',
            best_bid: '329.29',
            high_24h: '337.89',
            instrument_id: 'BCH-USD-SWAP',
            last: '329.3',
            low_24h: '318.13',
            timestamp: '2019-08-01T00:00:02.483Z',
            volume_24h: '2099540'
          }
        ]
      }
    ]
    const okexMapper = getMapper('okex')

    for (const message of messages) {
      const mappedMessages = Array.from(okexMapper.map(message, new Date('2019-08-01T00:00:02.9970505Z'))!)
      expect(mappedMessages).toMatchSnapshot()
    }
  })
})

describe('Mapper.getFiltersForDataTypeAndSymbols(dataType, symbols?)', () => {
  test('for okex', () => {
    const okexMapper = getMapper('okex')
    expect(okexMapper.getFiltersForDataTypeAndSymbols('trade')).toEqual([
      {
        channel: 'spot/trade'
      },
      {
        channel: 'swap/trade'
      },
      {
        channel: 'futures/trade'
      }
    ])

    expect(okexMapper.getFiltersForDataTypeAndSymbols('l2change')).toEqual([
      {
        channel: 'spot/depth'
      },
      {
        channel: 'swap/depth'
      },
      {
        channel: 'futures/depth'
      }
    ])

    expect(okexMapper.getFiltersForDataTypeAndSymbols('l2change', ['LTC-USD-SWAP', 'TRX-USD-190927', 'XRP-OKB'])).toEqual([
      {
        channel: 'swap/depth',
        symbols: ['LTC-USD-SWAP']
      },
      {
        channel: 'futures/depth',
        symbols: ['TRX-USD-190927']
      },
      {
        channel: 'spot/depth',
        symbols: ['XRP-OKB']
      }
    ])

    expect(okexMapper.getFiltersForDataTypeAndSymbols('l2change', ['LTC-USD-SWAP', 'ETH-USD-SWAP', 'XRP-OKB'])).toEqual([
      {
        channel: 'swap/depth',
        symbols: ['LTC-USD-SWAP']
      },
      {
        channel: 'swap/depth',
        symbols: ['ETH-USD-SWAP']
      },
      {
        channel: 'spot/depth',
        symbols: ['XRP-OKB']
      }
    ])
  })
})
