import {
  Exchange,
  Mapper,
  normalizeBookChanges,
  normalizeDerivativeTickers,
  normalizeTrades,
  normalizeOptionsSummary,
  normalizeLiquidations
} from '../src'

const exchangesWithDerivativeInfo: Exchange[] = [
  'bitmex',
  'binance-futures',
  'bitfinex-derivatives',
  'cryptofacilities',
  'deribit',
  'okex-futures',
  'okex-swap',
  'bybit',
  'phemex',
  'ftx',
  'delta',
  'binance-delivery',
  'huobi-dm',
  'huobi-dm-swap',
  'gate-io-futures',
  'coinflex'
]

const exchangesWithOptionsSummary: Exchange[] = ['deribit', 'okex-options']

const exchangesWithLiquidationsSupport: Exchange[] = [
  'ftx',
  'bitmex',
  'deribit',
  'binance-futures',
  'binance-delivery',
  'bitfinex-derivatives',
  'cryptofacilities',
  'huobi-dm',
  'huobi-dm-swap'
]

const createMapper = (exchange: Exchange, localTimestamp?: Date) => {
  let normalizers: any = [normalizeTrades, normalizeBookChanges]
  if (exchangesWithDerivativeInfo.includes(exchange)) {
    normalizers.push(normalizeDerivativeTickers)
  }

  if (exchangesWithOptionsSummary.includes(exchange)) {
    normalizers.push(normalizeOptionsSummary)
  }

  if (exchangesWithLiquidationsSupport.includes(exchange)) {
    normalizers.push(normalizeLiquidations)
  }

  const mappersForExchange = normalizers.map((m: any) => m(exchange, localTimestamp)) as Mapper<any, any>[]

  return {
    map(message: any, localTimestamp: Date) {
      const responses = []
      for (const mapper of mappersForExchange) {
        if (mapper.canHandle(message)) {
          const mappedMessages = mapper.map(message, localTimestamp)
          if (!mappedMessages) {
            continue
          }

          for (const message of mappedMessages) {
            responses.push(message)
          }
        }
      }

      return responses
    }
  }
}

describe('mappers', () => {
  test('map deribit messages', () => {
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
            bids: [
              ['new', 217.8, 1895.0],
              ['new', 217.75, 712.0]
            ],
            asks: [
              ['new', 218.6, 179803.0],
              ['new', 218.65, 7887.0]
            ]
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
            asks: [
              ['change', 219.2, 64903.0],
              ['change', 219.1, 19343.0]
            ]
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
      },
      {
        jsonrpc: '2.0',
        method: 'subscription',
        params: {
          channel: 'ticker.BTC-PERPETUAL.raw',
          data: {
            timestamp: 1569888003897,
            stats: { volume: 43610.27177267, low: 7684.0, high: 8353.0 },
            state: 'open',
            settlement_price: 7792.17,
            open_interest: 84844461,
            min_price: 8179.57,
            max_price: 8428.7,
            mark_price: 8304.39,
            last_price: 8304.5,
            instrument_name: 'BTC-PERPETUAL',
            index_price: 8305.94,
            funding_8h: -0.00008477,
            current_funding: 0.0,
            best_bid_price: 8304.0,
            best_bid_amount: 267900.0,
            best_ask_price: 8304.5,
            best_ask_amount: 5260.0
          }
        }
      },
      {
        jsonrpc: '2.0',
        method: 'subscription',
        params: {
          channel: 'ticker.BTC-8JUN20-8750-P.raw',
          data: {
            underlying_price: 9724.48,
            underlying_index: 'SYN.BTC-8JUN20',
            timestamp: 1591603200048,
            stats: { volume: 2.5, price_change: 0.0, low: 0.0005, high: 0.0005 },
            state: 'closed',
            open_interest: 0.0,
            min_price: 0.0001,
            max_price: 0.015,
            mark_price: 0.0,
            mark_iv: 70.0,
            last_price: 0.0005,
            interest_rate: 0.0,
            instrument_name: 'BTC-8JUN20-8750-P',
            index_price: 9729.25,
            greeks: { vega: 0.0, theta: 0.0, rho: 0.0, gamma: 0.0, delta: 0.0 },
            estimated_delivery_price: 'expired',
            delivery_price: 9728.65,
            bid_iv: 0.0,
            best_bid_price: 0.0,
            best_bid_amount: 0.0,
            best_ask_price: 0.0,
            best_ask_amount: 0.0,
            ask_iv: 500.0
          }
        }
      },
      {
        jsonrpc: '2.0',
        method: 'subscription',
        params: {
          channel: 'ticker.BTC-5JUN20-9250-C.raw',
          data: {
            underlying_price: 9440.73,
            underlying_index: 'SYN.BTC-5JUN20',
            timestamp: 1590969652595,
            stats: { volume: 13.4, price_change: -19.1489, low: 0.037, high: 0.047 },
            state: 'open',
            settlement_price: 0.05,
            open_interest: 533.2,
            min_price: 0.0115,
            max_price: 0.069,
            mark_price: 0.03847784,
            mark_iv: 63.21,
            last_price: 0.038,
            interest_rate: 0.0,
            instrument_name: 'BTC-5JUN20-9250-C',
            index_price: 9434.36,
            greeks: { vega: 3.88497, theta: -28.34113, rho: 0.66242, gamma: 0.00058, delta: 0.62959 },
            estimated_delivery_price: 9434.36,
            bid_iv: 58.39,
            best_bid_price: 0.0365,
            best_bid_amount: 15.4,
            best_ask_price: 0.04,
            best_ask_amount: 4.8,
            ask_iv: 66.9
          }
        }
      },
      {
        jsonrpc: '2.0',
        method: 'subscription',
        params: {
          channel: 'ticker.ETH-5JUN20-310-P.raw',
          data: {
            underlying_price: 231.7,
            underlying_index: 'SYN.ETH-5JUN20',
            timestamp: 1590969597073,
            stats: { volume: null, price_change: null, low: null, high: null },
            state: 'open',
            settlement_price: 0.29,
            open_interest: 0.0,
            min_price: 0.299,
            max_price: 0.383,
            mark_price: 0.33859,
            mark_iv: 118.63,
            last_price: null,
            interest_rate: 0.0,
            instrument_name: 'ETH-5JUN20-310-P',
            index_price: 231.54,
            greeks: { vega: 0.0092, theta: -0.12594, rho: -0.03643, gamma: 0.00122, delta: -0.98566 },
            estimated_delivery_price: 231.54,
            bid_iv: 0.0,
            best_bid_price: 0.0,
            best_bid_amount: 0.0,
            best_ask_price: 0.0,
            best_ask_amount: 0.0,
            ask_iv: 0.0
          }
        }
      },
      {
        jsonrpc: '2.0',
        method: 'subscription',
        params: {
          channel: 'ticker.ETH-10JUN20-270-C.raw',
          data: {
            underlying_price: 244.14,
            underlying_index: 'SYN.ETH-10JUN20',
            timestamp: 1591608298178,
            stats: { volume: null, price_change: null, low: null, high: null },
            state: 'open',
            open_interest: 0.0,
            min_price: 0.0001,
            max_price: 0.0155,
            mark_price: 0.000632,
            mark_iv: 72.96,
            last_price: null,
            interest_rate: 0.0,
            instrument_name: 'ETH-10JUN20-270-C',
            index_price: 243.98,
            greeks: { vega: 0.01246, theta: -0.15436, rho: 0.00039, gamma: 0.00539, delta: 0.03105 },
            estimated_delivery_price: 243.98,
            bid_iv: 0.0,
            best_bid_price: 0.0,
            best_bid_amount: 0.0,
            best_ask_price: 0.0,
            best_ask_amount: 0.0,
            ask_iv: 0.0
          }
        }
      },
      {
        jsonrpc: '2.0',
        method: 'subscription',
        params: {
          channel: 'trades.BTC-PERPETUAL.raw',
          data: [
            {
              trade_seq: 40781986,
              trade_id: '66460463',
              timestamp: 1584058044032,
              tick_direction: 3,
              price: 4469.5,
              liquidation: 'T',
              instrument_name: 'BTC-PERPETUAL',
              index_price: 4805.41,
              direction: 'sell',
              amount: 1120
            }
          ]
        }
      },
      {
        jsonrpc: '2.0',
        method: 'subscription',
        params: {
          channel: 'trades.BTC-PERPETUAL.raw',
          data: [
            {
              trade_seq: 40782080,
              trade_id: '66460626',
              timestamp: 1584058067675,
              tick_direction: 3,
              price: 4458.5,
              liquidation: 'M',
              instrument_name: 'BTC-PERPETUAL',
              index_price: 4793.6,
              direction: 'buy',
              amount: 2500
            }
          ]
        }
      }
    ]
    const deribitMapper = createMapper('deribit')
    for (const message of messages) {
      const mappedMessages = deribitMapper.map(message, new Date('2019-06-01T00:00:28.6199940Z'))
      expect(mappedMessages).toMatchSnapshot()
    }
  })

  test('map bitmex messages', () => {
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
            lastPrice: 267.75,
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
      },
      {
        table: 'instrument',
        action: 'update',
        data: [
          {
            symbol: 'ETHUSD',
            openInterest: 58922153
          }
        ]
      },
      {
        table: 'liquidation',
        action: 'insert',
        data: [{ orderID: 'dd9cea25-207c-0dab-15b5-b88da776f500', symbol: 'XBTUSD', side: 'Buy', price: 10106, leavesQty: 9214 }]
      },
      { table: 'liquidation', action: 'delete', data: [{ orderID: 'dd9cea25-207c-0dab-15b5-b88da776f500', symbol: 'XBTUSD' }] }
    ]

    const bitmexMapper = createMapper('bitmex')
    for (const message of messages) {
      const mappedMessages = bitmexMapper.map(message, new Date('2019-06-01T00:00:28.6199940Z'))
      expect(mappedMessages).toMatchSnapshot()
    }
  })

  test('map okex messages', () => {
    const messages = [
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
        table: 'spot/depth',
        action: 'partial',
        data: [
          {
            instrument_id: 'BTC-USDT',
            asks: [
              [4084.57, 38, 0, 3],
              [4085.0, 20, 0, 1]
            ],
            bids: [
              [4084.56, 4, 0, 1],
              [4084.5, 29, 0, 1]
            ],
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
        table: 'spot/depth_l2_tbt',
        action: 'update',
        data: [
          {
            instrument_id: 'BTC-USDT',
            asks: [],
            bids: [['2.25', '1459', '0', '1']],
            timestamp: '2019-12-03T15:14:59.904Z',
            checksum: 1099728614
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
            timestamp: '2019-08-01T00:00:08.807Z',
            trade_id: '423886240'
          }
        ]
      }
    ]
    let okexMapper = createMapper('okex', new Date('2019-12-05'))

    for (const message of messages) {
      const mappedMessages = okexMapper.map(message, new Date('2019-08-01T00:00:02.9970505Z'))
      expect(mappedMessages).toMatchSnapshot()
    }
  })

  test('map okex-futures messages', () => {
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
        table: 'futures/trade',
        data: [
          {
            side: 'sell',
            trade_id: '2578238628528132',
            price: 4061.95,
            qty: 4,
            instrument_id: 'BTC-USD-190628',
            timestamp: '2019-03-31T23:59:59.389Z'
          }
        ]
      },
      {
        table: 'futures/trade',
        data: [
          {
            side: 'buy',
            trade_id: '3269040623943686',
            price: '10209.43',
            qty: '5',
            instrument_id: 'BTC-USD-190927',
            timestamp: '2019-08-01T00:00:01.321Z'
          }
        ]
      },
      {
        table: 'futures/depth',
        action: 'partial',
        data: [
          {
            instrument_id: 'BTC-USD-190405',
            asks: [
              [4084.57, 38, 0, 3],
              [4085.0, 20, 0, 1]
            ],
            bids: [
              [4084.56, 4, 0, 1],
              [4084.5, 29, 0, 1]
            ],
            timestamp: '2019-08-01T00:00:08.930Z'
          }
        ]
      },
      {
        table: 'swap/funding_rate',
        data: [
          {
            estimated_rate: '0.00037',
            funding_rate: '0.00023534',
            funding_time: '2019-08-01T04:00:00.000Z',
            instrument_id: 'BCH-USD-SWAP',
            interest_rate: '0'
          }
        ]
      },

      {
        table: 'futures/mark_price',
        data: [{ instrument_id: 'BTC-USD-190927', mark_price: '10218.61', timestamp: '2019-08-01T00:00:20.869Z' }]
      },
      {
        table: 'futures/ticker',
        data: [
          {
            last: '0.02249',
            best_bid: '0.0225',
            high_24h: '0.02275',
            low_24h: '0.02208',
            volume_24h: '41666',
            open_interest: '24419',
            best_ask: '0.02255',
            instrument_id: 'TRX-USD-190802',
            open_24h: '0.02206',
            timestamp: '2019-08-01T00:02:00.429Z',
            volume_token_24h: '18526456.20275678'
          }
        ]
      },
      {
        table: 'futures/depth_l2_tbt',
        action: 'update',
        data: [
          {
            instrument_id: 'EOS-USD-191206',
            asks: [],
            bids: [['2.25', '1459', '0', '1']],
            timestamp: '2019-12-03T15:14:59.904Z',
            checksum: 1099728614
          }
        ]
      }
    ]
    let okexFuturesMapper = createMapper('okex-futures', new Date('2019-12-04'))

    for (const message of messages) {
      const mappedMessages = okexFuturesMapper.map(message, new Date('2019-08-01T00:00:02.9970505Z'))
      expect(mappedMessages).toMatchSnapshot()
    }

    const messagesTickByTick = [
      {
        table: 'futures/depth_l2_tbt',
        action: 'partial',
        data: [
          {
            instrument_id: 'BTC-USD-191018',
            asks: [['8581.44', '74', '0', '74']],
            bids: [['8581.38', '37', '0', '37']],
            timestamp: '2019-10-10T08:50:14.528Z',
            checksum: -182860440
          }
        ]
      },
      {
        table: 'futures/depth_l2_tbt',
        action: 'update',
        data: [
          {
            instrument_id: 'EOS-USD-191206',
            asks: [],
            bids: [['2.25', '1459', '0', '1']],
            timestamp: '2019-12-03T15:14:59.904Z',
            checksum: 1099728614
          }
        ]
      },
      {
        table: 'futures/depth',
        action: 'partial',
        data: [
          {
            instrument_id: 'BTC-USD-190405',
            asks: [
              [4084.57, 38, 0, 3],
              [4085.0, 20, 0, 1]
            ],
            bids: [
              [4084.56, 4, 0, 1],
              [4084.5, 29, 0, 1]
            ],
            timestamp: '2019-08-01T00:00:08.930Z'
          }
        ]
      }
    ]

    okexFuturesMapper = createMapper('okex-futures', new Date('2019-12-05'))

    for (const message of messagesTickByTick) {
      const mappedMessages = okexFuturesMapper.map(message, new Date('2019-08-01T00:00:02.9970505Z'))
      expect(mappedMessages).toMatchSnapshot()
    }
  })

  test('map okex-swap messages', () => {
    const messages = [
      {
        table: 'swap/trade',
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
            asks: [
              ['0.3198', '264', '0', '5'],
              ['0.3199', '222', '0', '4'],
              ['0.3219', '2014', '0', '2']
            ],
            bids: [
              ['0.3196', '1646', '0', '14'],
              ['0.3195', '1672', '0', '6']
            ],
            timestamp: '2019-08-01T00:00:08.930Z',
            checksum: 1684272782
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
      },
      {
        table: 'swap/funding_rate',
        data: [
          {
            estimated_rate: '0.00037',
            funding_rate: '0.00023534',
            funding_time: '2019-08-01T04:00:00.000Z',
            instrument_id: 'BCH-USD-SWAP',
            interest_rate: '0'
          }
        ]
      },
      { table: 'swap/mark_price', data: [{ instrument_id: 'BCH-USD-SWAP', mark_price: '329.3', timestamp: '2019-08-01T00:00:20.773Z' }] },
      {
        table: 'swap/depth_l2_tbt',
        action: 'update',
        data: [
          {
            instrument_id: 'EOS-USD-191206',
            asks: [],
            bids: [['2.25', '1459', '0', '1']],
            timestamp: '2019-12-03T15:14:59.904Z',
            checksum: 1099728614
          }
        ]
      },
      {
        table: 'swap/trade',
        data: [
          {
            instrument_id: 'BCH-USDT',
            price: '328.74',
            side: 'sell',
            size: '0.12',
            timestamp: '2019-08-01T00:00:08.816Z',
            trade_id: '423886240'
          }
        ]
      }
    ]

    let okexSwap = createMapper('okex-swap', new Date('2020-02-07'))

    for (const message of messages) {
      const mappedMessages = okexSwap.map(message, new Date('2019-08-01T00:00:02.9970505Z'))
      expect(mappedMessages).toMatchSnapshot()
    }

    let messagesWithTickByTickBook = [
      {
        table: 'swap/depth_l2_tbt',
        action: 'update',
        data: [
          {
            instrument_id: 'ETC-USDT-SWAP',
            asks: [['11.749', '0', '0', '0']],
            bids: [],
            timestamp: '2020-02-08T00:01:00.022Z',
            checksum: -229520224
          }
        ]
      },
      {
        table: 'swap/depth',
        action: 'update',
        data: [
          {
            instrument_id: 'ETC-USDT-SWAP',
            asks: [['11.761', '0', '0', '0']],
            bids: [['11.66', '160', '0', '2']],
            timestamp: '2020-02-08T00:01:00.035Z',
            checksum: -229520224
          }
        ]
      }
    ]

    okexSwap = createMapper('okex-swap', new Date('2020-02-08'))

    for (const message of messagesWithTickByTickBook) {
      const mappedMessages = okexSwap.map(message, new Date('2020-02-08T00:00:02.9970505Z'))
      expect(mappedMessages).toMatchSnapshot()
    }
  })

  test('map okex-options messages', () => {
    const messages = [
      {
        table: 'option/depth',
        action: 'partial',
        data: [
          {
            instrument_id: 'BTC-USD-200207-8500-P',
            asks: [['0.0005', '305', '0', '1']],
            bids: [],
            timestamp: '2020-02-06T23:42:51.121Z',
            checksum: 1274182169
          }
        ]
      },
      {
        table: 'option/depth_l2_tbt',
        action: 'update',
        data: [
          {
            instrument_id: 'BTC-USD-200327-12000-P',
            asks: [
              ['0.234', '0', '0', '0'],
              ['0.2345', '100', '0', '1']
            ],
            bids: [],
            timestamp: '2020-02-08T00:00:28.101Z',
            checksum: 1704544030
          }
        ]
      },
      {
        table: 'option/summary',
        data: [
          {
            instrument_id: 'ETH-USD-200925-240-P',
            underlying: 'ETH-USD',
            best_ask: '0.153',
            best_bid: '0.1465',
            best_ask_size: '505',
            best_bid_size: '505',
            change_rate: '0',
            delta: '-0.5402682903',
            gamma: '1.4602562596',
            high_24h: '0.153',
            highest_buy: '0.3565',
            realized_vol: '0',
            bid_vol: '0.7495',
            ask_vol: '0.7813',
            mark_vol: '0.7637',
            last: '0.153',
            leverage: '6.6989',
            low_24h: '0.153',
            lowest_sell: '0.0005',
            mark_price: '0.14927916',
            theta: '-0.0007332882',
            vega: '0.002094302',
            volume_24h: '0',
            open_interest: '1',
            estimated_price: '0',
            timestamp: '2020-06-08T12:52:00.000Z'
          }
        ]
      },

      {
        table: 'index/ticker',
        data: [
          {
            last: '243.11',
            open_24h: '237.943',
            high_24h: '245.43',
            low_24h: '234.661',
            instrument_id: 'ETH-USD',
            timestamp: '2020-06-08T12:52:00.802Z'
          }
        ]
      },
      {
        table: 'option/summary',
        data: [
          {
            instrument_id: 'ETH-USD-200925-240-P',
            underlying: 'ETH-USD',
            best_ask: '0.153',
            best_bid: '0.1465',
            best_ask_size: '505',
            best_bid_size: '505',
            change_rate: '0',
            delta: '-0.5401157512',
            gamma: '1.460028096',
            high_24h: '0.153',
            highest_buy: '0.3565',
            realized_vol: '0',
            bid_vol: '0.7507',
            ask_vol: '0.7813',
            mark_vol: '0.7637',
            last: '0.153',
            leverage: '6.7017',
            low_24h: '0.153',
            lowest_sell: '0.0005',
            mark_price: '0.14921543',
            theta: '-0.0007332464',
            vega: '0.0020941549',
            volume_24h: '0',
            open_interest: '1',
            estimated_price: '0',
            timestamp: '2020-06-08T12:52:03.000Z'
          }
        ]
      },
      {
        table: 'option/summary',
        data: [
          {
            instrument_id: 'ETH-USD-200925-180-C',
            underlying: 'ETH-USD',
            best_ask: '0.3325',
            best_bid: '0.3065',
            best_ask_size: '55',
            best_bid_size: '25',
            change_rate: '0',
            delta: '0.5085224419',
            gamma: '0.0821676388',
            high_24h: '0',
            highest_buy: '0.514',
            realized_vol: '0',
            bid_vol: '0.6934',
            ask_vol: '0.8814',
            mark_vol: '0.7875',
            last: '0',
            leverage: '3.1339',
            low_24h: '0',
            lowest_sell: '0.124',
            mark_price: '0.31908882',
            theta: '-0.0004980699',
            vega: '0.0013866212',
            volume_24h: '0',
            open_interest: '0',
            estimated_price: '0',
            timestamp: '2020-06-08T12:52:00.000Z'
          }
        ]
      },
      {
        table: 'option/summary',
        data: [
          {
            instrument_id: 'BTC-USD-200605-9250-P',
            underlying: 'BTC-USD',
            best_ask: '0.018',
            best_bid: '0.0165',
            best_ask_size: '4',
            best_bid_size: '50',
            change_rate: '0.1212',
            delta: '-0.3860939252',
            gamma: '5.6271994199',
            high_24h: '0.019',
            highest_buy: '0.068',
            realized_vol: '0',
            bid_vol: '0.6055',
            ask_vol: '0.6348',
            mark_vol: '0.6595',
            last: '0.0185',
            leverage: '53.0011',
            low_24h: '0.0135',
            lowest_sell: '0.0005',
            mark_price: '0.01886752',
            theta: '-0.0031224769',
            vega: '0.0004103337',
            volume_24h: '82',
            open_interest: '486',
            estimated_price: '0',
            timestamp: '2020-06-01T00:00:39.117Z'
          }
        ]
      },
      {
        table: 'option/depth_l2_tbt',
        action: 'update',
        data: [
          {
            instrument_id: 'BTC-USD-200710-8750-C',
            asks: [],
            bids: [],
            timestamp: '2020-07-01T00:00:51.209Z',
            checksum: 1490116368
          }
        ]
      },
      {
        table: 'option/summary',
        data: [
          {
            instrument_id: 'ETH-USD-200724-190-C',
            underlying: 'ETH-USD',
            best_ask: '',
            best_bid: '',
            best_ask_size: '0',
            best_bid_size: '0',
            change_rate: '0',
            delta: '',
            gamma: '',
            high_24h: '0',
            highest_buy: '',
            realized_vol: '0',
            bid_vol: '',
            ask_vol: '',
            mark_vol: '1.6437',
            last: '0',
            leverage: '',
            low_24h: '0',
            lowest_sell: '',
            mark_price: '',
            theta: '',
            vega: '0',
            volume_24h: '0',
            open_interest: '0',
            estimated_price: '0',
            timestamp: '2020-07-24T07:00:00.001Z'
          }
        ]
      },
      {
        table: 'option/summary',
        data: [
          {
            instrument_id: 'ETH-USD-200724-310-P',
            underlying: 'ETH-USD',
            best_ask: '',
            best_bid: '',
            best_ask_size: '0',
            best_bid_size: '0',
            change_rate: '0',
            delta: '-∞',
            gamma: '∞',
            high_24h: '0',
            highest_buy: '4611686018427388',
            realized_vol: '0',
            bid_vol: '',
            ask_vol: '',
            mark_vol: '2.5227',
            last: '0',
            leverage: '0',
            low_24h: '0',
            lowest_sell: '4611686018427388',
            mark_price: '∞',
            theta: '∞',
            vega: '0',
            volume_24h: '0',
            open_interest: '0',
            estimated_price: '0',
            timestamp: '2020-07-24T07:00:00.001Z'
          }
        ]
      }
    ]

    let okexOptions = createMapper('okex-options', new Date('2020-02-07'))

    for (const message of messages) {
      const mappedMessages = okexOptions.map(message, new Date('2019-08-01T00:00:02.9970505Z'))
      expect(mappedMessages).toMatchSnapshot()
    }

    okexOptions = createMapper('okex-options', new Date('2020-02-08'))

    for (const message of messages) {
      const mappedMessages = okexOptions.map(message, new Date('2020-02-08T00:00:02.9970505Z'))
      expect(mappedMessages).toMatchSnapshot()
    }
  })

  test('map bitfinex messages', () => {
    const messages = [
      [6957, 'tu', [382490248, 1564617600489, 0.43426, 218.74], 11, 1564617600570],
      { event: 'subscribed', channel: 'trades', chanId: 89, symbol: 'tBTCUSD', pair: 'BTCUSD' },
      [89, [[382489562, 1564617598688, 0.01302607, 10088]], 1, 1564617600401],
      [89, 'te', [382489563, 1564617600709, 0.00705845, 10087.98969503], 18, 1564617600784],
      [89, 'tu', [382489563, 1564617600709, 0.00705845, 10087.98969503], 19, 1564617600834],

      { event: 'subscribed', channel: 'book', chanId: 6959, symbol: 'tETHUSD', prec: 'P0', freq: 'F0', len: '100', pair: 'ETHUSD' },

      [
        6959,
        [
          [216, 2, 31.52],
          [218.75, 1, -13.33333333],
          [218.76, 1, -2]
        ],
        10,
        1564617600541
      ],
      [6959, [219.11, 3, -18.10913638], 45, 1564617601214],
      [6959, [218.99, 0, -1], 61, 1564617601769],
      [6959, [218.03, 0, 1], 430, 1564617602483],
      [6959, 'hb', 3603, 1569715249702]
    ]
    const bitfinex = createMapper('bitfinex')
    for (const message of messages) {
      const mappedMessages = bitfinex.map(message, new Date('2019-08-01T00:00:02.4965581Z'))
      expect(mappedMessages).toMatchSnapshot()
    }
  })

  test('map bitfinex derivatives messages', () => {
    const messages = [
      { event: 'subscribed', channel: 'status', chanId: 127758, key: 'deriv:tBTCF0:USTF0' },
      [127758, [1569715201000, null, 173.535, 173.57, null, 101052.04082882, null, 1569744000000, 0, 0, null, null], 7, 1569715201369],
      [127758, 'hb', 3603, 1569715249702],
      [
        127758,
        [1569801649000, null, 8090.5, 8051.45, null, 101052.31005666, null, 1569830400000, 0.00000843, 16, null, 0.00196337],
        3256,
        1569801652225
      ],
      [
        127758,
        [
          1570492830000,
          null,
          8192.7,
          8197.3,
          null,
          101120.80328179,
          null,
          1570521600000,
          -1.4e-7,
          9,
          null,
          0,
          null,
          null,
          8196.973333333333
        ],
        1116,
        1570492832311
      ],
      [
        127758,
        [
          1570493698000,
          null,
          8210.5,
          8208.45,
          null,
          101120.80328179,
          null,
          1570521600000,
          0.00000725,
          296,
          null,
          0,
          null,
          null,
          8208.893333333333
        ],
        243027,
        1570493699520
      ],
      [
        12778,
        [
          1570493698000,
          null,
          8210.5,
          8208.45,
          null,
          101120.80328179,
          null,
          1570521600000,
          0.00000725,
          296,
          null,
          0,
          null,
          null,
          8208.893333333333
        ],
        243027,
        1570493699520
      ],
      [23918, [9163.7, 0, 1], 961871, 1590596820151, 'book', 'BTCF0:USTF0'],
      [23917, [45761787004, 9170, -0.06039856], 961865, 1590596820150, 'raw_book', 'BTCF0:USTF0'],
      [
        23928,
        [
          1590596819000,
          null,
          9166.30324769,
          9169.35,
          null,
          1372762.95402242,
          null,
          1590624000000,
          -0.00001415,
          533,
          null,
          0,
          null,
          null,
          9170.3525,
          null,
          null,
          3005.25851857
        ],
        962044,
        1590596820986,
        'status',
        'BTCF0:USTF0'
      ],
      [23925, 'hb', 924771, 1590596648661, 'trades', 'BTCDOMF0:USTF0'],
      [23916, 'te', [452025730, 1590593199934, 0.005, 9135.5], 11125, 1590593199956, 'trades', 'BTCF0:USTF0'],
      [23916, 'tu', [452025730, 1590593199934, 0.005, 9135.5], 11141, 1590593199986, 'trades', 'BTCF0:USTF0'],
      [
        386841,
        [['pos', 143683674, 1593522802742, null, 'tBTCF0:USTF0', 0.00268657, 9135.972557016, null, 0, 1, null, 9080]],
        7,
        1593566593351,
        'liquidations',
        'global'
      ],
      [386841, 'hb', 2043, 1593566613422, 'liquidations', 'global'],
      [
        386841,
        [['pos', 143683674, 1593522802742, null, 'tBTCF0:USTF0', 0.00268657, 9135.972557016, null, 0, 1, null, 9080]],
        7,
        1593566593351
      ],
      {
        event: 'subscribed',
        channel: 'status',
        chanId: 386841,
        key: 'liq:global'
      },
      [
        386841,
        [['pos', 143683674, 1593522802742, null, 'tBTCF0:USTF0', 0.00268657, 9135.972557016, null, 0, 1, null, 9080]],
        7,
        1593566593351
      ],
      [
        907,
        [['pos', 143679087, 1594036710543, null, 'tETHF0:USTF0', -4.56671421, 222.248906484356, null, 1, 1, null, 235.52]],
        1206215,
        1594036710595,
        'liquidations',
        'global'
      ],
      [
        907,
        [['pos', 143679087, 1594036710534, null, 'tETHF0:USTF0', -8.6007, 222.248906484356, null, 0, 1, null, null]],
        1206216,
        1594036710596,
        'liquidations',
        'global'
      ]
    ]

    const bitfinexDerivativesMapper = createMapper('bitfinex-derivatives')
    for (const message of messages) {
      const mappedMessages = bitfinexDerivativesMapper.map(message, new Date('2019-08-01T00:00:02.4965581Z'))

      expect(mappedMessages).toMatchSnapshot()
    }
  })

  test('map binance messages', () => {
    const messages = [
      {
        stream: 'bnbbtc@trade',
        data: {
          e: 'trade',
          E: 1554076800945,
          s: 'BNBBTC',
          t: 40756030,
          p: '0.00426990',
          q: '33.82000000',
          b: 133829535,
          a: 133829504,
          T: 1554076800940,
          m: false,
          M: true
        }
      },
      {
        stream: 'bnbbtc@trade',
        data: {
          e: 'trade',
          E: 1567296001038,
          s: 'BNBBTC',
          t: 60276726,
          p: '0.00219650',
          q: '6.48000000',
          b: 255533165,
          a: 255532831,
          T: 1567296001034,
          m: true,
          M: true
        }
      },
      {
        stream: 'btcusdt@bookTicker',
        data: { u: 1127645101, s: 'BTCUSDT', b: '8010.00000000', B: '0.14245900', a: '8012.15000000', A: '0.03120100' }
      },
      {
        stream: 'dogebnb@ticker',
        data: {
          e: '24hrTicker',
          E: 1569805259092,
          s: 'DOGEBNB',
          p: '0.00000291',
          P: '2.068',
          w: '0.00014188',
          x: '0.00014069',
          c: '0.00014360',
          Q: '51135.00000000',
          b: '0.00014365',
          B: '7080.00000000',
          a: '0.00014498',
          A: '275033.00000000',
          o: '0.00014069',
          h: '0.00014550',
          l: '0.00013851',
          v: '20014582.00000000',
          q: '2839.62578157',
          O: 1569718859088,
          C: 1569805259088,
          F: 64171,
          L: 64684,
          n: 514
        }
      },

      {
        stream: 'btcusdc@depthSnapshot',
        generated: true,
        data: {
          lastUpdateId: 16084251,
          bids: [
            ['4091.92000000', '0.00976500'],
            ['4089.09000000', '0.76393100']
          ],
          asks: [
            ['4095.99000000', '2.31652000'],
            ['4096.00000000', '1.42541900']
          ]
        }
      },
      {
        stream: 'btcusdc@depth',
        data: {
          e: 'depthUpdate',
          E: 1554076801699,
          s: 'BTCUSDC',
          U: 16084252,
          u: 16084253,
          b: [['4084.88000000', '0.00000000']],
          a: [['4111.84000000', '0.00000000']]
        }
      },

      {
        stream: 'gntbtc@depth',
        data: {
          e: 'depthUpdate',
          E: 1554076807698,
          s: 'GNTBTC',
          U: 41603407,
          u: 41603413,
          b: [
            ['0.00002246', '1215.00000000'],
            ['0.00002245', '2673.00000000'],
            ['0.00002244', '390.00000000'],
            ['0.00002239', '2126.00000000']
          ],
          a: [
            ['0.00002267', '0.00000000'],
            ['0.00002269', '7840.00000000']
          ]
        }
      },
      {
        stream: 'gntbtc@depth',
        data: {
          e: 'depthUpdate',
          E: 1554076808698,
          s: 'GNTBTC',
          U: 41603414,
          u: 41603418,
          b: [
            ['0.00002248', '114.00000000'],
            ['0.00002246', '375.00000000']
          ],
          a: [['0.00002253', '3945.00000000']]
        }
      },
      {
        stream: 'gntbtc@depthSnapshot',
        generated: true,
        data: {
          lastUpdateId: 41603417,
          bids: [
            ['0.00002248', '114.00000000'],
            ['0.00002246', '370.00000000'],
            ['0.00002245', '2673.00000000'],
            ['0.00002244', '390.00000000'],
            ['0.00002243', '3425.00000000']
          ],
          asks: [
            ['0.00002253', '3945.00000000'],
            ['0.00002256', '50641.00000000'],
            ['0.00002258', '1777.00000000']
          ]
        }
      },
      {
        stream: 'gntbtc@depth',
        data: {
          e: 'depthUpdate',
          E: 1554076809699,
          s: 'GNTBTC',
          U: 41603417,
          u: 41603419,
          b: [],
          a: [
            ['0.00002257', '0.00000000'],
            ['0.00002262', '6080.00000000']
          ]
        }
      }
    ]

    const binanceMapper = createMapper('binance', new Date())
    for (const message of messages) {
      const mappedMessages = binanceMapper.map(message, new Date('2019-09-01T00:00:01.2750543Z'))
      expect(mappedMessages).toMatchSnapshot()
    }
  })

  test('map binance dex messages', () => {
    const messages = [
      {
        stream: 'depthSnapshot',
        generated: true,
        data: {
          symbol: 'BLINK-9C6_BNB',
          bids: [['0.00003212', '7000.00000000']],
          asks: [['0.00005325', '29900.00000000']],
          height: 16926984
        }
      },
      {
        stream: 'marketDiff',
        data: {
          e: 'depthUpdate',
          E: 1561939201,
          s: 'BLINK-9C6_BNB',
          b: [
            ['0.00000400', '0.00000000'],
            ['0.00000005', '350000.00000000']
          ],
          a: [['0.00005253', '0.00000000']]
        }
      },
      {
        stream: 'trades',
        data: [
          {
            e: 'trade',
            E: 16927042,
            s: 'PHB-2DF_BNB',
            t: '16927042-0',
            p: '0.00042701',
            q: '2070.00000000',
            b: '31363F61C6A1E3D956435BEC81363B8903BD9B8D-41617',
            a: '3B086ADDF228A40CDB976807ACA62679608B22A1-336',
            T: 1561939222635379202,
            sa: 'bnb18vyx4h0j9zjqekuhdqr6ef3x09sgkg4py604hr',
            ba: 'bnb1xymr7cwx583aj4jrt0kgzd3m3ypmmxud5ldpfg'
          },
          {
            e: 'trade',
            E: 16927042,
            s: 'PHB-2DF_BNB',
            t: '16927042-1',
            p: '0.00042701',
            q: '2930.00000000',
            b: 'A9D1434FE2C1082A52FF68E6D04E292E8CB54B2A-150',
            a: '3B086ADDF228A40CDB976807ACA62679608B22A1-336',
            T: 1561939222635379202,
            sa: 'bnb18vyx4h0j9zjqekuhdqr6ef3x09sgkg4py604hr',
            ba: 'bnb148g5xnlzcyyz55hldrndqn3f96xt2je24ctzc8'
          }
        ]
      },
      {
        stream: 'ticker',
        data: {
          e: '24hrTicker',
          E: 1561939223,
          s: 'RAVEN-F66_BNB',
          p: '-0.00000073',
          P: '-0.00860000',
          w: '0.00008289',
          x: '0.00008362',
          c: '0.00008398',
          Q: '9200.00000000',
          b: '0.00008379',
          B: '394500.00000000',
          a: '0.00008414',
          A: '646900.00000000',
          o: '0.00008471',
          h: '0.00008590',
          l: '0.00008114',
          v: '27305600.00000000',
          q: '2263.48604700',
          O: 1561852822969,
          C: 1561939222969,
          F: '16691022-0',
          L: '16916084-0',
          n: 276
        }
      }
    ]

    const binanceDexMapper = createMapper('binance-dex')
    for (const message of messages) {
      const mappedMessages = binanceDexMapper.map(message, new Date('2019-09-01T00:00:01.2750543Z'))
      expect(mappedMessages).toMatchSnapshot()
    }
  })

  test('map binance futures messages', () => {
    const messages = [
      {
        stream: 'btcusdt@aggTrade',
        data: { e: 'aggTrade', E: 1568693103463, s: 'BTCUSDT', p: '10223.74', q: '0.236', f: 181349, l: 181349, T: 1568693103463, m: false }
      },

      {
        stream: 'btcusdt@ticker',
        data: {
          e: '24hrTicker',
          E: 1568693103467,
          s: 'BTCUSDT',
          p: '-88.17',
          P: '-0.855',
          w: '10223.98',
          c: '10223.74',
          Q: '2.097',
          o: '10311.91',
          h: '10329.38',
          l: '10080.70',
          v: '20248.900',
          q: '207024349.13',
          O: 1568606704662,
          C: 1568693103463,
          F: 148927,
          L: 181349,
          n: 32423
        }
      },
      {
        stream: 'btcusdt@markPrice',
        data: { e: 'markPriceUpdate', E: 1569888003001, s: 'BTCUSDT', p: '8291.34697815', r: '0.00010000', T: 1569916800000 }
      },
      {
        stream: 'btcusdt@ticker',
        data: {
          e: '24hrTicker',
          E: 1568693103467,
          s: 'BTCUSDT',
          p: '-88.17',
          P: '-0.855',
          w: '10223.98',
          c: '10223.74',
          Q: '2.097',
          o: '10311.91',
          h: '10329.38',
          l: '10080.70',
          v: '20248.900',
          q: '207024349.13',
          O: 1568606704662,
          C: 1568693103463,
          F: 148927,
          L: 181349,
          n: 32423
        }
      },
      {
        stream: 'btcusdt@trade',
        data: { e: 'trade', E: 1574381164089, T: 1574381164086, s: 'BTCUSDT', t: 10934580, p: '7627.60', q: '0.044', m: false }
      },

      {
        stream: 'btcusdt@depth@100ms',
        data: {
          e: 'depthUpdate',
          E: 1573948821952,
          T: 1573948821948,
          s: 'BTCUSDT',
          U: 687687944,
          u: 687687946,
          pu: 687687946,
          b: [['8493.78', '0.162']],
          a: [['4096.00000000', '2.42541900']]
        }
      },
      {
        stream: 'btcusdt@depthSnapshot',
        generated: true,
        data: {
          lastUpdateId: 687687945,
          bids: [['8488.36', '1.501']],
          asks: [
            ['4095.99000000', '2.31652000'],
            ['4096.00000000', '1.42541900']
          ]
        }
      },
      {
        stream: 'btcusdt@depth@100ms',
        data: {
          e: 'depthUpdate',
          E: 1573948821952,
          T: 1573948821948,
          s: 'BTCUSDT',
          U: 687687944,
          u: 687687946,
          pu: 687690832,
          b: [['8493.78', '0.162']],
          a: []
        }
      },
      { stream: 'btcusdt@openInterest', generated: true, data: { symbol: 'BTCUSDT', openInterest: '26286.181' } },
      {
        stream: 'btcusdt@markPrice@1s',
        data: {
          e: 'markPriceUpdate',
          E: 1597536008000,
          s: 'BTCUSDT',
          p: '11857.56000000',
          i: '11851.86949091',
          r: '0.00015640',
          T: 1597564800000
        }
      },
      {
        stream: 'ethusdt@trade',
        data: {
          e: 'trade',
          E: 1596034530241,
          T: 1596034530235,
          s: 'ETHUSDT',
          t: 73701056,
          p: '2366.55',
          q: '0.070',
          X: 'INSURANCE_FUND',
          m: true
        }
      },
      {
        stream: 'btcusdt@trade',
        data: {
          e: 'trade',
          E: 1596240000596,
          T: 1596240000519,
          s: 'BTCUSDT',
          t: 173525189,
          p: '11343.67',
          q: '0.467',
          X: 'MARKET',
          m: true
        }
      },
      {
        stream: 'btcusdt@forceOrder',
        data: {
          e: 'forceOrder',
          E: 1584059031426,
          o: {
            s: 'BTCUSDT',
            S: 'BUY',
            o: 'LIMIT',
            f: 'IOC',
            q: '0.014',
            p: '4793.91',
            ap: '4706.04',
            X: 'FILLED',
            l: '0.014',
            z: '0.014',
            T: 1584059031421
          }
        }
      }
    ]

    const binanceFuturesMapper = createMapper('binance-futures', new Date())
    for (const message of messages) {
      const mappedMessages = binanceFuturesMapper.map(message, new Date('2019-09-01T00:00:01.2750543Z'))
      expect(mappedMessages).toMatchSnapshot()
    }
  })

  test('map binance delivery messages', () => {
    const messages = [
      { id: 1000, result: null },
      {
        stream: 'btcusd_200925@depthSnapshot',
        generated: true,
        data: {
          lastUpdateId: 37471290,
          E: 1592265600231,
          T: 1592265600229,
          symbol: 'BTCUSD_200925',
          pair: 'BTCUSD',
          bids: [['9504.8', '181']],
          asks: [['99999.0', '4090']]
        }
      },
      {
        stream: 'btcusd_200925@depth@0ms',
        data: {
          e: 'depthUpdate',
          E: 1592265600422,
          T: 1592265600420,
          s: 'BTCUSD_200925',
          ps: 'BTCUSD',
          U: 37471290,
          u: 37471292,
          pu: 37471291,
          b: [['9498.9', '13']],
          a: []
        }
      },
      {
        stream: 'btcusd_200925@markPrice@1s',
        data: { e: 'markPriceUpdate', E: 1592265602000, s: 'BTCUSD_200925', p: '9501.15723333', P: '9429.39675000' }
      },
      { stream: 'btcusd@indexPrice@1s', data: { e: 'indexPriceUpdate', E: 1592265601001, i: 'BTCUSD', p: '9429.39675000' } },
      {
        stream: 'btcusd_200925@depth@0ms',
        data: {
          e: 'depthUpdate',
          E: 1592265602212,
          T: 1592265602210,
          s: 'BTCUSD_200925',
          ps: 'BTCUSD',
          U: 37471322,
          u: 37471322,
          pu: 37471321,
          b: [['9504.8', '181']],
          a: []
        }
      },
      {
        stream: 'btcusd_200925@ticker',
        data: {
          e: '24hrTicker',
          E: 1592265616654,
          s: 'BTCUSD_200925',
          ps: 'BTCUSD',
          p: '72.9',
          P: '0.773',
          w: '9271.96027324',
          c: '9504.9',
          Q: '1',
          o: '9432.0',
          h: '9769.5',
          l: '8621.4',
          v: '1967607',
          q: '21221.04648872',
          O: 1592179200000,
          C: 1592265616653,
          F: 100191,
          L: 173906,
          n: 73715
        }
      },
      {
        stream: 'btcusd_200925@openInterest',
        generated: true,
        data: { symbol: 'BTCUSD_200925', pair: 'BTCUSD', openInterest: '15279', contractType: 'CURRENT_QUARTER', time: 1592265372706 }
      },
      {
        stream: 'btcusd_200925@trade',
        data: { e: 'trade', E: 1592265616654, T: 1592265616653, s: 'BTCUSD_200925', t: 173906, p: '9504.9', q: '1', X: 'MARKET', m: false }
      },
      {
        stream: 'btcusd_200925@forceOrder',
        data: {
          e: 'forceOrder',
          E: 1594622954023,
          o: {
            s: 'BTCUSD_200925',
            ps: 'BTCUSD',
            S: 'SELL',
            o: 'LIMIT',
            f: 'IOC',
            q: '3',
            p: '9314.5',
            ap: '9352.7',
            X: 'FILLED',
            l: '3',
            z: '3',
            T: 1594622954021
          }
        }
      }
    ]

    const binanceDelivery = createMapper('binance-delivery', new Date())
    for (const message of messages) {
      const mappedMessages = binanceDelivery.map(message, new Date('2019-09-01T00:00:01.2750543Z'))
      expect(mappedMessages).toMatchSnapshot()
    }
  })

  test('map ftx us messages', () => {
    const messages = [
      { type: 'subscribed', channel: 'trades', market: 'USDT/USD' },
      {
        channel: 'orderbook',
        market: 'ETH/USD',
        type: 'partial',
        data: {
          time: 1592265601.2727785,
          checksum: 1225528673,
          bids: [[231.08, 2.456]],
          asks: [[231.09, 2.393]],
          action: 'partial'
        }
      },
      {
        channel: 'orderbook',
        market: 'ETH/USD',
        type: 'update',
        data: { time: 1592265602.3259132, checksum: 1225528673, bids: [], asks: [], action: 'update' }
      },
      {
        channel: 'orderbook',
        market: 'BTC/USD',
        type: 'update',
        data: { time: 1592271542.2219546, checksum: 1296823591, bids: [[9398.5, 3.4959]], asks: [[9400.0, 3.1373]], action: 'update' }
      },
      {
        channel: 'trades',
        market: 'BTC/USD',
        type: 'update',
        data: [{ id: 1711, price: 9469.0, size: 0.031, side: 'sell', liquidation: false, time: '2020-06-17T06:31:19.399582+00:00' }]
      }
    ]

    const ftxUSMapper = createMapper('ftx-us', new Date())
    for (const message of messages) {
      const mappedMessages = ftxUSMapper.map(message, new Date('2019-09-01T00:00:01.2750543Z'))
      expect(mappedMessages).toMatchSnapshot()
    }
  })

  test('map delta messages', () => {
    const messages = [
      {
        type: 'subscriptions',
        channels: [
          {
            name: 'ticker',
            symbols: ['BTCUSD']
          }
        ]
      },
      {
        low: 9388,
        high: 9585.5,
        open: 9433.5,
        close: 9522,
        volume: 7101726,
        symbol: 'BTCUSD',
        timestamp: 1592351998339000,
        product_id: 27,
        type: 'ticker'
      },
      {
        buy: [{ limit_price: '9522.0', size: 449313 }],
        last_sequence_no: 1592351999728324,
        product_id: 27,
        sell: [{ limit_price: '9522.5', size: 11100 }],
        symbol: 'BTCUSD',
        timestamp: 1592351999719000,
        type: 'l2_orderbook'
      },
      {
        annualized_basis: '-0.109500000000000000',
        price: '9524.170821',
        price_band: { lower_limit: '9286.281029025000000000000000', upper_limit: '9762.500568975000000000000000' },
        product_id: 139,
        symbol: 'MARK:BTCUSDT',
        timestamp: 1592351997873000,
        type: 'mark_price'
      },
      {
        funding_rate: '-0.01000000000000000000000000000',
        product_id: 139,
        symbol: 'BTCUSDT',
        timestamp: 1592351997873000,
        type: 'funding_rate'
      },
      {
        buyer_role: 'maker',
        price: '9522.0',
        product_id: 27,
        seller_role: 'taker',
        size: 4662,
        symbol: 'BTCUSDT',
        timestamp: 1592352002423123,
        type: 'recent_trade'
      },
      {
        buy: [{ limit_price: '85.0', size: 1 }],
        sell: [{ limit_price: '12536.5', size: 8 }],
        last_sequence_no: 96542791,
        product_id: 27,
        type: 'l2_orderbook',
        symbol: 'BTCUSD'
      },
      {
        funding_rate: '0.08354928018352788781686920000',
        product_id: 37,
        symbol: 'XTZBTC',
        timestamp: 1593561648381531,
        type: 'funding_rate'
      },
      {
        funding_rate: 0.010000000000000002,
        funding_rate_8h: 0.010000000000000002,
        next_funding_realization: 1595404800000000,
        predicted_funding_rate: 0.01,
        predicted_funding_rate_8h: 0.01,
        product_id: 65,
        symbol: 'LINKUSDT',
        timestamp: 1595376026629157,
        type: 'funding_rate'
      },
      {
        funding_rate_8h: 10.95,
        next_funding_realization: 1594396800000000,
        predicted_funding_rate_8h: 0.01,
        product_id: 277,
        symbol: 'ETHBTC',
        timestamp: 1594396559970784,
        type: 'funding_rate'
      }
    ]

    const v2Messages = [
      {
        buyer_role: 'maker',
        price: '9522.0',
        product_id: 27,
        seller_role: 'taker',
        size: 4662,
        symbol: 'BTCUSDT',
        timestamp: 1592352002423123,
        type: 'recent_trade'
      },
      {
        buyer_role: 'maker',
        price: '50.34',
        product_id: 188,
        seller_role: 'taker',
        size: 46,
        symbol: 'LTCUSDT',
        timestamp: 1602585251855645,
        type: 'all_trades'
      },
      {
        close: 11540.5,
        high: 11717.5,
        low: 11225,
        mark_price: '11537.538898',
        open: 11332.5,
        product_id: 27,
        size: 5748794,
        spot_price: '11537.623333333331',
        symbol: 'BTCUSD',
        timestamp: 1602585247446827,
        turnover: 499.8070683500003,
        turnover_symbol: 'BTC',
        turnover_usd: 5748598.978422551,
        type: 'v2/ticker',
        volume: 5748794
      },
      {
        funding_rate: 0.01,
        funding_rate_8h: 0.01,
        next_funding_realization: 1602604800000000,
        predicted_funding_rate: 0.010000000000000002,
        predicted_funding_rate_8h: 0.010000000000000002,
        product_id: 27,
        symbol: 'BTCUSD',
        timestamp: 1602585247941647,
        type: 'funding_rate'
      },
      {
        annualized_basis: '-0.0964916589141385196387753250',
        price: '11536.746127',
        price_band: { lower_limit: '11248.25543107500000000000000', upper_limit: '11825.08904292500000000000000' },
        product_id: 27,
        symbol: 'MARK:BTCUSD',
        timestamp: 1602585252946976,
        type: 'mark_price'
      }
    ]

    let deltaMapper = createMapper('delta', new Date('2020-10-13T00:00:01.2750543Z'))
    for (const message of messages) {
      const mappedMessages = deltaMapper.map(message, new Date('2019-09-01T00:00:01.2750543Z'))
      expect(mappedMessages).toMatchSnapshot()
    }

    deltaMapper = createMapper('delta', new Date('2020-10-14T00:00:01.2750543Z'))

    for (const message of v2Messages) {
      const mappedMessages = deltaMapper.map(message, new Date('2020-10-14T00:00:01.2750543Z'))
      expect(mappedMessages).toMatchSnapshot()
    }
  })

  test('map cryptofacilities messages', () => {
    const messages = [
      { feed: 'book', product_id: 'FI_LTCUSD_190426', side: 'sell', seq: 2139287, price: 60.58, qty: 0.0 },
      {
        feed: 'ticker',
        product_id: 'FI_LTCUSD_190628',
        bid: 60.57,
        ask: 60.62,
        bid_size: 10000.0,
        ask_size: 150.0,
        volume: 66428.0,
        dtm: 88,
        leverage: '50x',
        index: 60.31,
        premium: 0.5,
        last: 60.69,
        time: 1554076800684,
        change: 0.4,
        suspended: false,
        tag: 'quarter',
        pair: 'LTC:USD',
        openInterest: 1692330.0,
        markPrice: 60.61,
        maturityTime: 1561734000000
      },
      {
        feed: 'ticker',
        product_id: 'PI_LTCUSD',
        bid: 60.35,
        ask: 60.38,
        bid_size: 10000.0,
        ask_size: 20000.0,
        volume: 182179.0,
        dtm: -17987,
        leverage: '50x',
        index: 60.31,
        premium: 0.1,
        last: 60.35,
        time: 1554076800695,
        change: 0.1,
        funding_rate: 1.739491032443e-6,
        funding_rate_prediction: 1.739491032443e-6,
        suspended: false,
        tag: 'perpetual',
        pair: 'LTC:USD',
        openInterest: 631360.0,
        markPrice: 60.38,
        maturityTime: 0,
        relative_funding_rate: 1.04908704166667e-4,
        relative_funding_rate_prediction: 1.04908704166667e-4,
        next_funding_rate_time: 1554091200000
      },
      { feed: 'trade', product_id: 'FI_XBTUSD_190426', side: 'buy', type: 'fill', seq: 5271, time: 1554076802518, qty: 3.0, price: 4088.5 },
      {
        feed: 'trade',
        product_id: 'FI_XBTUSD_190927',
        uid: '06842286-3a57-412c-8cb5-b61db36903d3',
        side: 'sell',
        type: 'fill',
        seq: 374,
        time: 1567296042739,
        qty: 166.0,
        price: 9680.0
      },
      {
        feed: 'ticker',
        product_id: 'PI_LTCUSD',
        bid: 64.27,
        ask: 64.28,
        bid_size: 2996.0,
        ask_size: 7.0,
        volume: 1062907.0,
        dtm: -18140,
        leverage: '50x',
        index: 64.33,
        premium: -0.1,
        last: 64.34,
        time: 1567296052217,
        change: 0.6570713391739647,
        funding_rate: -8.92730506785e-7,
        funding_rate_prediction: -1.509794776119e-6,
        suspended: false,
        tag: 'perpetual',
        pair: 'LTC:USD',
        openInterest: 2074134.0,
        markPrice: 64.295,
        maturityTime: 0,
        relative_funding_rate: -5.7456135416667e-5,
        relative_funding_rate_prediction: -9.711e-5,
        next_funding_rate_time: 1567310400000
      },
      {
        feed: 'book_snapshot',
        product_id: 'PI_LTCUSD',
        timestamp: 1567296000518,
        seq: 360370,
        bids: [
          { price: 64.27, qty: 2978.0 },
          { price: 64.26, qty: 5000.0 }
        ],
        asks: [
          { price: 64.28, qty: 1.0 },
          { price: 64.31, qty: 9216.0 }
        ],
        tickSize: null
      },
      { feed: 'book', product_id: 'PI_LTCUSD', side: 'sell', seq: 361428, price: 64.41, qty: 14912.0, timestamp: 1567296042122 },
      { feed: 'book', product_id: 'PI_LTCUSD', side: 'buy', seq: 361432, price: 64.24, qty: 0.0, timestamp: 1567296042131 },
      {
        feed: 'trade',
        product_id: 'PI_XRPUSD',
        uid: '3ee209b8-bc9f-4ed5-965b-8c6208b26411',
        side: 'sell',
        type: 'liquidation',
        seq: 41799,
        time: 1593561965283,
        qty: 12000,
        price: 0.1736
      },
      {
        feed: 'trade',
        product_id: 'PI_ETHUSD',
        uid: 'e7f3a144-5c04-4ed6-999e-5922cd0b6160',
        side: 'buy',
        type: 'liquidation',
        seq: 253796,
        time: 1593620853613,
        qty: 250,
        price: 231.6
      }
    ]

    const cryptofacilitiesMapper = createMapper('cryptofacilities')

    for (const message of messages) {
      const mappedMessages = cryptofacilitiesMapper.map(message, new Date('2019-09-01T00:00:01.2750543Z'))
      expect(mappedMessages).toMatchSnapshot()
    }
  })

  test('map bitflyer messages', () => {
    const messages = [
      {
        jsonrpc: '2.0',
        method: 'channelMessage',
        params: {
          channel: 'lightning_board_snapshot_BCH_BTC',
          message: {
            mid_price: 0.02891,
            bids: [{ price: 0.0146, size: 0.022 }],
            asks: [{ price: 0.02919, size: 0.14 }]
          }
        }
      },
      {
        jsonrpc: '2.0',
        method: 'channelMessage',
        params: {
          channel: 'lightning_board_BCH_BTC',
          message: {
            mid_price: 1046397.0,
            bids: [{ price: 1043400.0, size: 0.05 }],
            asks: [{ price: 1046603.0, size: 0.0 }]
          }
        }
      },
      {
        jsonrpc: '2.0',
        method: 'channelMessage',
        params: {
          channel: 'lightning_executions_FX_BTC_JPY',
          message: [
            {
              id: 1246449270,
              side: 'BUY',
              price: 1046399.0,
              size: 0.01,
              exec_date: '2019-09-01T00:00:11.2256814Z',
              buy_child_order_acceptance_id: 'JRF20190901-000011-748374',
              sell_child_order_acceptance_id: 'JRF20190901-000011-013715'
            },
            {
              id: 1246449271,
              side: 'BUY',
              price: 1046400.0,
              size: 0.002,
              exec_date: '2019-09-01T00:00:11.2256814Z',
              buy_child_order_acceptance_id: 'JRF20190901-000011-748374',
              sell_child_order_acceptance_id: 'JRF20190901-000006-323731'
            }
          ]
        }
      }
    ]

    const bitflyerMapper = createMapper('bitflyer')

    for (const message of messages) {
      const mappedMessages = bitflyerMapper.map(message, new Date('2019-09-01T00:00:01.2750543Z'))
      expect(mappedMessages).toMatchSnapshot()
    }
  })

  test('map ftx messages', () => {
    const messages = [
      { type: 'subscribed', channel: 'trades', market: 'ALT-PERP' },
      {
        channel: 'orderbook',
        market: 'BTC-1227',
        type: 'partial',
        data: {
          time: 1567296001.3289416,
          checksum: 2240307563,
          bids: [[9805.0, 15.5629]],
          asks: [[9807.75, 20.1695]],
          action: 'partial'
        }
      },
      {
        channel: 'orderbook',
        market: 'BNB-PERP',
        type: 'update',
        data: { time: 1567296005.667879, checksum: 1100190433, bids: [], asks: [[21.0125, 0.0]], action: 'update' }
      },
      {
        channel: 'trades',
        market: 'LTC-PERP',
        type: 'update',
        data: [{ id: null, price: 64.33, size: 0.03, side: 'sell', liquidation: false, time: '2019-09-01T00:00:12.659525+00:00' }]
      },
      {
        channel: 'trades',
        market: 'ETH-PERP',
        type: 'update',
        data: [{ id: 1139499, price: 181.86, size: 0.13, side: 'sell', liquidation: false, time: '2019-10-01T00:00:21.260951+00:00' }]
      },
      {
        channel: 'instrument',
        generated: true,
        market: 'BTC-PERP',
        type: 'update',
        data: {
          stats: { nextFundingRate: 0.0, nextFundingTime: '2020-05-12T13:00:00+00:00', openInterest: 11471.4921, volume: 87818.5334 },
          info: {
            ask: 8791.5,
            bid: 8791.0,
            change1h: 0.0007399396664579658,
            change24h: -0.015014005602240896,
            changeBod: 0.025667950064169876,
            description: 'Bitcoin Perpetual Futures',
            enabled: true,
            expired: false,
            expiryDescription: 'Perpetual',
            group: 'perpetual',
            imfFactor: 0.002,
            index: 8790.512800652727,
            last: 8791.0,
            lowerBound: 8351.0,
            marginPrice: 8791.0,
            mark: 8791.0,
            name: 'BTC-PERP',
            perpetual: true,
            positionLimitWeight: 1.0,
            postOnly: false,
            priceIncrement: 0.5,
            sizeIncrement: 0.0001,
            type: 'perpetual',
            underlying: 'BTC',
            underlyingDescription: 'Bitcoin',
            upperBound: 9232.0,
            volume: 87818.5334,
            volumeUsd24h: 762549880.0517
          }
        }
      },
      {
        channel: 'instrument',
        generated: true,
        market: 'BTC-MOVE-0512',
        type: 'update',
        data: {
          stats: { openInterest: 337.1438, predictedExpirationPrice: 174.41695155220606, strikePrice: 8615.432394555066, volume: 746.7197 },
          info: {
            ask: 266.5,
            bid: 257.5,
            change1h: -0.005597014925373134,
            change24h: -0.18376722817764166,
            changeBod: -0.14170692431561996,
            description: 'Bitcoin MOVE 2020-05-12 Contracts',
            enabled: true,
            expired: false,
            expiry: '2020-05-13T00:00:00+00:00',
            expiryDescription: 'Today',
            group: 'daily',
            imfFactor: 0.002,
            index: 8790.512800652727,
            last: 266.5,
            lowerBound: 0.5,
            marginPrice: 8790.512800652727,
            mark: 266.5,
            moveStart: '2020-05-12T00:00:00+00:00',
            name: 'BTC-MOVE-0512',
            perpetual: false,
            positionLimitWeight: 2.0,
            postOnly: false,
            priceIncrement: 0.5,
            sizeIncrement: 0.0001,
            type: 'move',
            underlying: 'BTC',
            underlyingDescription: 'Bitcoin',
            upperBound: 1149.5,
            volume: 746.7197,
            volumeUsd24h: 227715.1469
          }
        }
      },
      {
        channel: 'instrument',
        generated: true,
        market: 'BRZ-0626',
        type: 'update',
        data: {
          stats: { openInterest: 608187.0, predictedExpirationPrice: 0.17007, volume: 61892.0 },
          info: {
            ask: 0.17137,
            bid: 0.17058,
            change1h: 0.0004105331065626649,
            change24h: -0.005422424348434493,
            changeBod: 0.0004105331065626649,
            description: 'Brazilian Digital Token June 2020 Futures',
            enabled: true,
            expired: false,
            expiry: '2020-06-26T03:00:00+00:00',
            expiryDescription: 'June 2020',
            group: 'quarterly',
            imfFactor: 2e-6,
            index: 0.17007,
            last: 0.17051,
            lowerBound: 0.16157,
            marginPrice: 0.17058,
            mark: 0.17058,
            name: 'BRZ-0626',
            perpetual: false,
            positionLimitWeight: 10.0,
            postOnly: false,
            priceIncrement: 1e-5,
            sizeIncrement: 1.0,
            type: 'future',
            underlying: 'BRZ',
            underlyingDescription: 'Brazilian Digital Token',
            upperBound: 0.17957,
            volume: 61892.0,
            volumeUsd24h: 10557.55092
          }
        }
      },
      {
        channel: 'trades',
        market: 'BTC-PERP',
        type: 'update',
        data: [{ id: 114724653, price: 10683.5, size: 0.0149, side: 'buy', liquidation: true, time: '2020-09-15T00:02:05.787437+00:00' }]
      }
    ]

    const ftxMapper = createMapper('ftx')

    for (const message of messages) {
      const mappedMessages = ftxMapper.map(message, new Date('2019-09-01T00:00:01.2750543Z'))
      expect(mappedMessages).toMatchSnapshot()
    }
  })

  test('map coinbase messages', () => {
    const messages = [
      {
        type: 'match',
        trade_id: 216544,
        maker_order_id: '4c2aa376-4bda-4947-84ee-4dc5a6337cba',
        taker_order_id: '247a6eb2-b5c1-42db-b0ac-cb74b85bcac8',
        side: 'buy',
        size: '0.97133855',
        price: '4.97800000',
        product_id: 'ETC-GBP',
        sequence: 253395153,
        time: '2019-08-01T00:00:03.816000Z'
      },
      { type: 'l2update', product_id: 'BTC-EUR', time: '2019-08-01T00:00:03.818Z', changes: [['sell', '9202.54000000', '0.432']] },
      { type: 'l2update', product_id: 'ETH-USD', time: '2019-08-01T00:00:03.869Z', changes: [['buy', '218.21000000', '20.79816319']] },
      {
        product_id: 'BAT-USDC',
        type: 'snapshot',
        bids: [['0.247175', '5299']],
        asks: [['0.257175', '12']]
      },
      {
        type: 'l2update',
        product_id: 'BTC-EUR',
        changes: [
          ['buy', '9202.70', '0.58667860'],
          ['sell', '9222.39', '0.00459825']
        ],
        time: '0001-01-01T00:00:00.000000Z'
      }
    ]

    const coinbaseMapper = createMapper('coinbase')

    for (const message of messages) {
      const mappedMessages = coinbaseMapper.map(message, new Date('2019-09-01T00:00:01.2750543Z'))
      expect(mappedMessages).toMatchSnapshot()
    }
  })

  test('map gemini messages', () => {
    const messages = [
      {
        type: 'l2_updates',
        symbol: 'ZECLTC',
        changes: [
          ['buy', '0.688', '51.55728'],
          ['buy', '0.686', '1.168083'],
          ['sell', '15', '0.078285']
        ],
        auction_events: []
      },
      { type: 'trade', symbol: 'BTCUSD', event_id: 8280715334, timestamp: 1569888020080, price: '8325.00', quantity: '0.1', side: 'buy' },
      {
        type: 'l2_updates',
        symbol: 'ETHBTC',
        changes: [
          ['sell', '0.02189', '88.236'],
          ['sell', '0.02184', '4'],
          ['sell', '0.02185', '0'],
          ['sell', '0.02188', '149.57']
        ]
      }
    ]

    const geminiMapper = createMapper('gemini')

    for (const message of messages) {
      const mappedMessages = geminiMapper.map(message, new Date('2019-09-01T00:00:01.2750543Z'))
      expect(mappedMessages).toMatchSnapshot()
    }
  })

  test('map bitstamp messages', () => {
    const messages = [
      { event: 'bts:subscription_succeeded', channel: 'live_trades_xrpeur', data: {} },
      {
        data: {
          microtimestamp: '1554076803243152',
          amount: 0.0016429999999999999,
          buy_order_id: 3056112169,
          sell_order_id: 3056099349,
          amount_str: '0.00164300',
          price_str: '3651.30',
          timestamp: '1554076803',
          price: 3651.3000000000002,
          type: 0,
          id: 84550458
        },
        event: 'trade',
        channel: 'live_trades_btceur'
      },
      {
        data: { timestamp: '1554076800', microtimestamp: '1554076800436165', bids: [], asks: [['168.75', '2.00000000']] },
        event: 'data',
        channel: 'diff_order_book_bchusd'
      },
      {
        data: {
          timestamp: '1554076800',
          bids: [
            ['51046.31', '0.04249473'],
            ['60000.00', '0.00040718']
          ],
          asks: [
            ['168.75', '2.00000000'],
            ['168.76', '0.49428809']
          ]
        },
        event: 'snapshot',
        channel: 'diff_order_book_bchusd',
        generated: true
      },
      {
        data: {
          timestamp: '1554076800',
          microtimestamp: '1554076801338397',
          bids: [
            ['51046.31', '0.04249473'],
            ['60000.00', '0.00040718']
          ],
          asks: [
            ['168.75', '2.00000000'],
            ['168.76', '0.49428809']
          ]
        },
        event: 'snapshot',
        channel: 'diff_order_book_btcusd',
        generated: true
      },
      {
        data: {
          timestamp: '1554076801',
          microtimestamp: '1554076801338397',
          bids: [],
          asks: [
            ['169.28', '180.00000000'],
            ['170.16', '360.00000000']
          ]
        },
        event: 'data',
        channel: 'diff_order_book_bchusd'
      },
      {
        data: {
          microtimestamp: '1569888000557673',
          amount: 0.02834,
          buy_order_id: 4173504870,
          sell_order_id: 4173504860,
          amount_str: '0.02834000',
          price_str: '8304.47',
          timestamp: '1569888000',
          price: 8304.47,
          type: 0,
          id: 98000129
        },
        event: 'trade',
        channel: 'live_trades_btcusd'
      }
    ]

    const bitstampMapper = createMapper('bitstamp')

    for (const message of messages) {
      const mappedMessages = bitstampMapper.map(message, new Date('2019-09-01T00:00:01.2750543Z'))
      expect(mappedMessages).toMatchSnapshot()
    }
  })

  test('map kraken messages', () => {
    const messages = [
      [170, [['0.01136500', '2.51146536', '1561939201.587070', 's', 'l', '']], 'trade', 'LTC/XBT'],
      [
        14,
        [
          ['9482.40000', '0.01596347', '1561939258.512503', 's', 'l', ''],
          ['9488.20000', '0.28522465', '1561939258.557040', 'b', 'l', '']
        ],
        'trade',
        'XBT/EUR'
      ],
      [468, { b: [['87.60000000', '35.02658459', '1561939258.527900']] }, 'book-1000', 'XMR/USD'],
      [
        741,
        {
          a: [
            ['413.900000', '27.71904764', '1561939258.527125'],
            ['403.500000', '0.00000000', '1561939258.530503'],
            ['400.300000', '0.00000000', '1561939258.534680']
          ]
        },
        { b: [['400.000000', '3.38983321', '1561939258.526326']] },
        'book-1000',
        'BCH/USD'
      ],
      [
        754,
        {
          b: [
            ['352.000000', '33.95500000', '1561939258.538807'],
            ['351.500000', '5.89527900', '1561939258.548498']
          ]
        },
        'book-1000',
        'BCH/EUR'
      ],
      [
        923,
        {
          as: [['0.102987', '3.00000000', '1561939199.992830']],
          bs: [['0.102810', '2.00000000', '1561635364.836639']]
        },
        ,
        'book-1000',
        'ADA/CAD'
      ]
    ]

    const krakenMapper = createMapper('kraken')

    for (const message of messages) {
      const mappedMessages = krakenMapper.map(message, new Date('2019-09-01T00:00:01.2750543Z'))
      expect(mappedMessages).toMatchSnapshot()
    }
  })

  test('map huobi messages', () => {
    const messages = [
      { id: null, subbed: 'market.BTC_CW.trade.detail', ts: 1572912001262, status: 'ok' },
      {
        ch: 'market.BTC_CW.detail',
        ts: 1572912000995,
        tick: {
          id: 1572912000,
          mrid: 25102925110,
          open: 9323.85,
          close: 9435.15,
          high: 9650,
          low: 9273.49,
          amount: 45646.1037938786755718562979596368747611432,
          vol: 4260726,
          count: 85611
        }
      },

      {
        ch: 'market.BTC_NW.depth.step0',
        ts: 1572912001193,
        tick: {
          mrid: 25102925648,
          id: 1572912001,
          bids: [
            [9467.21, 35],
            [9467.2, 132]
          ],
          asks: [
            [9469.88, 20],
            [9470.38, 8]
          ],
          ts: 1572912001180,
          version: 1572912001,
          ch: 'market.BTC_NW.depth.step0'
        }
      },
      {
        ch: 'market.ETH_CQ.trade.detail',
        ts: 1572912028352,
        tick: {
          id: 25102975022,
          ts: 1572912028237,
          data: [{ amount: 62, ts: 1572912028237, id: 251029750220000, price: 190.031, direction: 'sell' }]
        }
      },
      {
        ch: 'market.BCH_CQ.depth.step0',
        ts: 1572912028401,
        update: true,
        tick: {
          mrid: 25102974989,
          id: 1572912028,
          bids: [
            [290.864, 1],
            [290.966, 0]
          ],
          asks: [[299.375, 734]],
          ts: 1572912028381,
          version: 1572912028,
          ch: 'market.BCH_CQ.depth.step0'
        }
      },

      {
        ch: 'market.mexbtc.depth.step0',
        ts: 1572911920067,
        tick: {
          bids: [
            [6.22e-8, 45542.05],
            [6.21e-8, 663504.55]
          ],
          asks: [
            [6.35e-8, 1033141.41],
            [6.4e-8, 269808.94]
          ],
          version: 100033171703,
          ts: 1572911920032
        }
      },

      {
        ch: 'market.mexbtc.trade.detail',
        ts: 1572911088789,
        tick: {
          id: 100033171587,
          ts: 1572911088761,
          data: [
            { id: 10003317158754670853281, ts: 1572911088761, tradeId: 100027416191, amount: 1569.86, price: 6.37e-8, direction: 'buy' }
          ]
        }
      },
      {
        ch: 'market.mexbtc.trade.detail',
        ts: 1572911088790,
        tick: {
          id: 100033171588,
          ts: 1572911088761,
          data: [
            { id: 10003317158754670853281, ts: 1572911088761, tradeId: 100027416192, amount: 1569.86, price: 6.37e-8, direction: 'buy' }
          ]
        }
      },
      {
        ch: 'market.waxpbtc.depth.step0',
        ts: 1572912002010,
        update: true,
        tick: { bids: [], asks: [], ts: 1572912002001, version: 100052331172 }
      },
      {
        ch: 'market.ontusdt.depth.step0',
        ts: 1572912001077,
        tick: {
          bids: [[0.9073, 1877.1994]],
          asks: [
            [0.9087, 1.07],
            [0.9088, 1760.6161]
          ],
          ts: 1572912001027,
          version: 100305412446
        }
      },
      {
        ch: 'market.xmrbtc.trade.detail',
        ts: 1572879775938,
        tick: {
          id: 100201717928,
          ts: 1571238239378,
          data: [{ id: '10020171792852100010452', amount: 6.5286, price: 0.006663, direction: 'buy', ts: 1571238239378 }]
        }
      },
      {
        ch: 'market.xmrbtc.trade.detail',
        ts: 1572879775938,
        tick: {
          id: 100201717928,
          ts: 1571238239378,
          data: [{ id: '100201717928521000104525', amount: 6.5286, price: 0.006663, direction: 'buy', ts: 1571238239379 }]
        }
      },
      {
        ch: 'market.dtabtc.depth.step0',
        ts: 1572912002012,
        update: true,
        tick: {
          bids: [[4.37e-8, 731389.72]],
          asks: [
            [1.55e-7, 437407.32],
            [4.75e-8, 0]
          ],
          ts: 1572912002002,
          version: 100058542239
        }
      },
      {
        ch: 'market.BTC_CQ.depth.size_150.high_freq',
        tick: {
          asks: [
            [10866.01, 137],

            [10900.06, 35]
          ],
          bids: [
            [10866, 3166],

            [10847.44, 30]
          ],
          ch: 'market.BTC_CQ.depth.size_150.high_freq',
          event: 'snapshot',
          id: 45961927810,
          mrid: 45961927810,
          ts: 1581552001187,
          version: 25630954
        },
        ts: 1581552001189
      },
      {
        ch: 'market.BTC_NW.depth.size_150.high_freq',
        tick: {
          asks: [],
          bids: [
            [10489.55, 0],
            [10361.14, 385]
          ],
          ch: 'market.BTC_NW.depth.size_150.high_freq',
          event: 'update',
          id: 45961928082,
          mrid: 45961928082,
          ts: 1581552001275,
          version: 23596415
        },
        ts: 1581552001277
      },
      {
        ch: 'market.btcusdt.mbp.150',
        ts: 1593561601106,
        tick: {
          seqNum: 109409288253,
          prevSeqNum: 109409288226,
          asks: [[9138.67, 0.036178]],
          bids: []
        }
      }
    ]

    let huobi = createMapper('huobi', new Date('2019-12-01T00:00:01.2750543Z'))

    for (const message of messages) {
      const mappedMessages = huobi.map(message, new Date('2019-12-01T00:00:01.2750543Z'))
      expect(mappedMessages).toMatchSnapshot()
    }

    const messagesWithMBPData = [
      {
        ch: 'market.btcusdt.mbp.150',
        ts: 1593561600691,
        tick: {
          seqNum: 109409288130,
          prevSeqNum: 109409288078,
          asks: [
            [9138.61, 0.033785],
            [9138.67, 0.0],
            [9138.93, 0.0622],
            [9144.0, 0.201447],
            [9144.01, 0.0]
          ],
          bids: [
            [9137.67, 4.129547],
            [9135.96, 0.0],
            [9135.95, 0.3],
            [9134.67, 0.2],
            [9134.1, 0.0],
            [9133.12, 0.0],
            [9131.68, 0.02059],
            [9131.67, 0.0],
            [9131.64, 0.0],
            [9129.34, 0.0],
            [9126.86, 0.05],
            [9126.81, 1.141568],
            [9126.78, 0.021],
            [9126.68, 0.8385]
          ]
        }
      },
      {
        ch: 'market.btcusdt.mbp.150',
        ts: 1593561600793,
        tick: {
          seqNum: 109409288160,
          prevSeqNum: 109409288130,
          asks: [
            [9138.6, 0.010259],
            [9138.61, 0.01767],
            [9138.67, 0.014126],
            [9145.18, 0.0],
            [9145.4, 0.014157],
            [9146.84, 0.0]
          ],
          bids: [
            [9137.67, 4.683547],
            [9135.95, 0.4998],
            [9134.1, 0.019023],
            [9133.17, 0.22827],
            [9131.87, 0.513608],
            [9131.68, 0.001352],
            [9129.19, 0.856013],
            [9126.86, 0.0],
            [9126.81, 0.0],
            [9126.78, 0.0],
            [9126.68, 0.0]
          ]
        }
      },
      {
        ch: 'market.btcusdt.mbp.150',
        ts: 1593561600901,
        tick: {
          seqNum: 109409288204,
          prevSeqNum: 109409288160,
          asks: [
            [9138.6, 0.0],
            [9138.61, 0.0],
            [9138.67, 0.033924],
            [9144.0, 0.05],
            [9146.84, 1.0],
            [9146.9, 0.001598]
          ],
          bids: [
            [9134.5, 0.002232],
            [9134.4, 0.164064],
            [9126.94, 0.0]
          ]
        }
      },
      {
        ch: 'market.btcusdt.mbp.150',
        ts: 1593561601005,
        tick: {
          seqNum: 109409288226,
          prevSeqNum: 109409288204,
          asks: [
            [9138.67, 0.042194],
            [9144.0, 0.069238],
            [9145.4, 0.030582],
            [9146.18, 0.132209],
            [9146.9, 0.0]
          ],
          bids: [
            [9135.96, 0.0622],
            [9135.78, 0.0],
            [9131.7, 0.007665],
            [9127.0, 0.0]
          ]
        }
      },
      {
        id: '1',
        status: 'ok',
        ts: 1593561601666,
        rep: 'market.btcusdt.mbp.150',
        data: {
          bids: [
            [9137.67, 4.683547],
            [9137.35, 0.0089],
            [9137.17, 0.00606],
            [9137.06, 0.11]
          ],
          asks: [
            [9137.68, 0.190075],
            [9137.75, 0.01],
            [9138.23, 0.010945],
            [9138.27, 0.131941],
            [9138.47, 0.003],
            [9138.6, 0.010259],
            [9138.61, 0.01767],
            [9138.62, 0.0074],
            [9138.67, 0.014126]
          ],
          seqNum: 109409288160
        }
      },
      {
        ch: 'market.btcusdt.mbp.150',
        ts: 1593561601727,
        tick: {
          seqNum: 109409288576,
          prevSeqNum: 109409288500,
          asks: [[9137.68, 3.691799]],
          bids: [[9137.67, 2.389677]]
        }
      }
    ]

    huobi = createMapper('huobi', new Date('2020-07-03T00:00:01.2750543Z'))

    for (const message of messagesWithMBPData) {
      const mappedMessages = huobi.map(message, new Date('2020-07-03T00:00:01.2750543Z'))
      expect(mappedMessages).toMatchSnapshot()
    }
  })

  test('map huobi-dm, messages', () => {
    const messages = [
      {
        ch: 'market.BCH_NQ.depth.size_150.high_freq',
        tick: {
          ch: 'market.BCH_NQ.depth.size_150.high_freq',
          event: 'snapshot',
          id: 73813475013,
          mrid: 73813475013,
          ts: 1592130042862,
          version: 5
        },
        ts: 1592130042866
      },
      {
        ch: 'market.BCH_NQ.depth.size_150.high_freq',
        tick: {
          asks: [],
          bids: [[228.191, 7999]],
          ch: 'market.BCH_NQ.depth.size_150.high_freq',
          event: 'update',
          id: 74013930075,
          mrid: 74013930075,
          ts: 1592200802699,
          version: 8
        },
        ts: 1592200802700
      },
      {
        ch: 'market.ETH_NW.basis.1min.open',
        ts: 1592915100011,
        tick: {
          id: 1592915040,
          index_price: '243.466431823',
          contract_price: '244.126',
          basis: '0.659568177',
          basis_rate: '0.0027090723434083340276793275670103096'
        }
      },
      {
        ch: 'market.ETH_NW.open_interest',
        generated: true,
        data: [
          { volume: 648420.0, amount: 26550.216194968553459119, symbol: 'ETH', contract_type: 'next_week', contract_code: 'ETH200703' }
        ],
        ts: 1592915103195
      },
      {
        op: 'notify',
        topic: 'public.BSV.contract_info',
        ts: 1592915141957,
        event: 'snapshot',
        data: [
          {
            symbol: 'BSV',
            contract_code: 'BSV200626',
            contract_type: 'this_week',
            contract_size: 10.0,
            price_tick: 0.001,
            delivery_date: '20200626',
            create_date: '20200306',
            contract_status: 1
          }
        ]
      },
      {
        op: 'notify',
        topic: 'public.BTC.liquidation_orders',
        ts: 1593561769911,
        data: [
          {
            symbol: 'BTC',
            contract_code: 'BTC200703',
            direction: 'sell',
            offset: 'close',
            volume: 1450,
            price: 9062.71,
            created_at: 1593561769833
          }
        ]
      },
      {
        op: 'notify',
        topic: 'public.BTC.contract_info',
        ts: 1593561601464,
        event: 'init',
        data: [
          {
            symbol: 'BTC',
            contract_code: 'BTC200703',
            contract_type: 'this_week',
            contract_size: 100,
            price_tick: 0.01,
            delivery_date: '20200703',
            create_date: '20200612',
            contract_status: 1
          },
          {
            symbol: 'BTC',
            contract_code: 'BTC200710',
            contract_type: 'next_week',
            contract_size: 100,
            price_tick: 0.01,
            delivery_date: '20200710',
            create_date: '20200619',
            contract_status: 1
          },
          {
            symbol: 'BTC',
            contract_code: 'BTC200925',
            contract_type: 'quarter',
            contract_size: 100,
            price_tick: 0.01,
            delivery_date: '20200925',
            create_date: '20200605',
            contract_status: 1
          },
          {
            symbol: 'BTC',
            contract_code: 'BTC201225',
            contract_type: 'next_quarter',
            contract_size: 100,
            price_tick: 0.01,
            delivery_date: '20201225',
            create_date: '20200612',
            contract_status: 1
          }
        ]
      },
      {
        op: 'notify',
        topic: 'public.BTC.liquidation_orders',
        ts: 1593561773080,
        data: [
          {
            symbol: 'BTC',
            contract_code: 'BTC200925',
            direction: 'sell',
            offset: 'close',
            volume: 319,
            price: 9115.43,
            created_at: 1593561773025
          }
        ]
      },
      {
        op: 'notify',
        topic: 'public.BTC.liquidation_orders',
        ts: 1593593169204,
        data: [
          {
            symbol: 'BTC',
            contract_code: 'BTC200703',
            direction: 'buy',
            offset: 'close',
            volume: 218,
            price: 9244.08,
            created_at: 1593593169156
          }
        ]
      }
    ]

    const huobiDM = createMapper('huobi-dm')

    for (const message of messages) {
      const mappedMessages = huobiDM.map(message, new Date('2019-12-01T00:00:01.2750543Z'))
      expect(mappedMessages).toMatchSnapshot()
    }
  })

  test('map huobi-dm-swap, messages', () => {
    const messages = [
      { op: 'sub', cid: '14', topic: 'public.BTC-USD.liquidation_orders', ts: 1592904821340, 'err-code': 0 },
      { id: '1', subbed: 'market.ZEC-USD.trade.detail', ts: 1592904820310, status: 'ok' },
      {
        ch: 'market.BSV-USD.trade.detail',
        ts: 1592904815036,
        tick: {
          id: 9530684332,
          ts: 1592904814962,
          data: [{ amount: 8, ts: 1592904814962, id: 95306843320000, price: 177.3, direction: 'sell' }]
        }
      },
      {
        ch: 'market.BSV-USD.trade.detail',
        ts: 1592904821252,
        tick: {
          id: 9530712324,
          ts: 1592904821209,
          data: [{ amount: 80, ts: 1592904821209, id: 95307123240000, price: 177.3, direction: 'sell' }]
        }
      },
      {
        ch: 'market.BCH-USD.depth.size_150.high_freq',
        tick: {
          asks: [],
          bids: [[239.34, 1021]],
          ch: 'market.BCH-USD.depth.size_150.high_freq',
          event: 'update',
          id: 9530712377,
          mrid: 9530712377,
          ts: 1592904821308,
          version: 164176090
        },
        ts: 1592904821309
      },
      {
        ch: 'market.BTC-USD.basis.1min.open',
        ts: 1592904821703,
        tick: {
          id: 1592904780,
          index_price: '9582.975',
          contract_price: '9590.1',
          basis: '7.125',
          basis_rate: '0.0007435060615309963763862474857755551'
        }
      },
      {
        ch: 'market.BTC-USD.open_interest',
        generated: true,
        data: [{ volume: 1711705.0, amount: 17841.411298728371899103, symbol: 'BTC', contract_code: 'BTC-USD' }],
        ts: 1592904823141
      },
      {
        op: 'notify',
        topic: 'public.BTC-USD.funding_rate',
        ts: 1592904820339,
        data: [
          {
            symbol: 'BTC',
            contract_code: 'BTC-USD',
            fee_asset: 'BTC',
            funding_time: '1592904780000',
            funding_rate: '0.000100000000000000',
            estimated_rate: '0.000113655663368468',
            settlement_time: '1592913600000'
          }
        ]
      },
      {
        op: 'notify',
        topic: 'public.ETH-USD.liquidation_orders',
        ts: 1593610492198,
        data: [
          {
            symbol: 'ETH',
            contract_code: 'ETH-USD',
            direction: 'buy',
            offset: 'close',
            volume: 231,
            price: 229.95,
            created_at: 1593610492167
          }
        ]
      },
      {
        op: 'notify',
        topic: 'public.BSV-USD.liquidation_orders',
        ts: 1593585531616,
        data: [
          {
            symbol: 'BSV',
            contract_code: 'BSV-USD',
            direction: 'sell',
            offset: 'close',
            volume: 3,
            price: 153.28,
            created_at: 1593585531562
          }
        ]
      }
    ]

    const huobiDMSwap = createMapper('huobi-dm-swap')

    for (const message of messages) {
      const mappedMessages = huobiDMSwap.map(message, new Date('2019-12-01T00:00:01.2750543Z'))
      expect(mappedMessages).toMatchSnapshot()
    }
  })
  test('map bybit messages', () => {
    const messages = [
      {
        success: true,
        ret_msg: '',
        conn_id: 'f428f979-3fd2-4b1e-aa12-f42ef3bc4a66',
        request: {
          op: 'subscribe',
          args: ['trade.BTCUSD']
        }
      },
      {
        topic: 'instrument_info.100ms.ETHUSD',
        type: 'snapshot',
        data: {
          id: 2,
          symbol: 'ETHUSD',
          last_price_e4: 1906500,
          last_tick_direction: 'MinusTick',
          prev_price_24h_e4: 1875000,
          price_24h_pcnt_e6: 16800,
          high_price_24h_e4: 1950000,
          low_price_24h_e4: 1864500,
          prev_price_1h_e4: 1915000,
          price_1h_pcnt_e6: -4438,
          mark_price_e4: 1905000,
          index_price_e4: 1904900,
          open_interest: 13793020,
          open_value_e8: 7302549080059,
          total_turnover_e8: 8510047221366513,
          turnover_24h_e8: 33613080478038,
          total_volume: 17203142911,
          volume_24h: 64058841,
          funding_rate_e6: 100,
          predicted_funding_rate_e6: 100,
          cross_seq: 311869653,
          created_at: '2019-01-25T09:12:06Z',
          updated_at: '2019-11-06T12:49:56Z',
          next_funding_time: '2019-11-06T16:00:00Z',
          countdown_hour: 4
        },
        cross_seq: 311872222,
        timestamp_e6: 1573044649041458
      },
      {
        topic: 'orderBookL2_25.BTCUSD',
        type: 'snapshot',
        data: [
          { price: '9353.50', symbol: 'BTCUSD', id: 93535000, side: 'Buy', size: 58486 },
          { price: '9366.00', symbol: 'BTCUSD', id: 93660000, side: 'Sell', size: 704729 }
        ],
        cross_seq: 794201904,
        timestamp_e6: 1573044648627110
      },
      {
        topic: 'orderBookL2_25.BTCUSD',
        type: 'delta',
        data: {
          delete: [],
          update: [{ price: '9367.00', symbol: 'BTCUSD', id: 93670000, side: 'Sell', size: 674462 }],
          insert: [],
          transactTimeE6: 0
        },
        cross_seq: 794201917,
        timestamp_e6: 1573044650028026
      },
      {
        topic: 'trade.BTCUSD',
        data: [
          {
            timestamp: '2019-11-06T12:50:52.000Z',
            symbol: 'BTCUSD',
            side: 'Buy',
            size: 6000,
            price: 9366,
            tick_direction: 'ZeroPlusTick',
            trade_id: '8c53dd53-2df5-563d-8e3b-e0dbba7c55a0',
            cross_seq: 794201989
          }
        ]
      },
      {
        topic: 'orderBookL2_25.XRPUSD',
        type: 'delta',
        data: {
          delete: [{ price: '0.3013', symbol: 'XRPUSD', id: 3013, side: 'Sell' }],
          update: [{ price: '0.3010', symbol: 'XRPUSD', id: 3010, side: 'Buy', size: 224986 }],
          insert: [{ price: '0.3038', symbol: 'XRPUSD', id: 3038, side: 'Sell', size: 41761 }],
          transactTimeE6: 0
        },
        cross_seq: 322932462,
        timestamp_e6: 1573045141027590
      },
      {
        topic: 'instrument_info.100ms.EOSUSD',
        type: 'delta',
        data: {
          delete: [],
          update: [
            {
              id: 4,
              symbol: 'EOSUSD',
              last_tick_direction: 'ZeroMinusTick',
              total_turnover_e8: 220614611978549345,
              turnover_24h_e8: 1804511683074981,
              total_volume: 8223153999,
              volume_24h: 65324494,
              cross_seq: 344634644,
              created_at: '2018-10-17T11:53:15Z',
              updated_at: '2019-11-06T12:59:58Z'
            }
          ],
          insert: []
        },
        cross_seq: 344634644,
        timestamp_e6: 1573045198449619
      },
      {
        topic: 'instrument_info.100ms.BTCUSD',
        type: 'delta',
        data: {
          delete: [],
          update: [
            {
              id: 1,
              symbol: 'BTCUSD',
              last_price_e4: 92915000,
              last_tick_direction: 'PlusTick',
              price_24h_pcnt_e6: -13222,
              price_1h_pcnt_e6: -2201,
              total_turnover_e8: 1264996883399380,
              turnover_24h_e8: 4918593756702,
              total_volume: 118238483891,
              volume_24h: 459925565,
              cross_seq: 795142862,
              created_at: '2018-11-14T16:33:26Z',
              updated_at: '2019-11-06T20:03:01Z'
            }
          ],
          insert: []
        },
        cross_seq: 795142862,
        timestamp_e6: 1573070581891131
      },
      {
        topic: 'orderBook_200.100ms.EOSUSD',
        type: 'delta',
        data: {
          delete: [],
          update: [
            { price: '4.159', symbol: 'EOSUSD', id: 41590, side: 'Sell', size: 94085 },
            { price: '4.136', symbol: 'EOSUSD', id: 41360, side: 'Buy', size: 112459 }
          ],
          insert: [],
          transactTimeE6: 0
        },
        cross_seq: 534365684,
        timestamp_e6: 1580515259599816
      },
      {
        topic: 'orderBookL2_25.BTCUSDT',
        type: 'delta',
        data: { delete: [], update: [{ price: '9452.50', symbol: 'BTCUSDT', id: '94525000', side: 'Sell', size: 9.95 }], insert: [] },
        cross_seq: '177025198',
        timestamp_e6: '1590683460293107'
      },
      {
        topic: 'trade.BTCUSDT',
        data: [
          {
            symbol: 'BTCUSDT',
            tick_direction: 'MinusTick',
            price: '9452.00',
            size: 0.001,
            timestamp: '2020-05-28T16:31:02.000Z',
            trade_time_ms: '1590683462124',
            side: 'Sell',
            trade_id: 'bfbbb893-0971-5733-8eb2-aab164d0a552'
          }
        ]
      },
      {
        topic: 'instrument_info.100ms.BTCUSDT',
        type: 'delta',
        data: {
          update: [
            {
              id: 1,
              symbol: 'BTCUSDT',
              index_price_e4: '94496200',
              cross_seq: '177025335',
              created_at: '1970-01-01T00:00:00.000Z',
              updated_at: '2020-05-28T16:31:02.000Z'
            }
          ]
        },
        cross_seq: '177025391',
        timestamp_e6: '1590683462401579'
      },
      {
        topic: 'trade.ETHUSD',
        data: [
          {
            trade_time_ms: 1590683463041,
            timestamp: '2020-05-28T16:31:03.000Z',
            symbol: 'ETHUSD',
            side: 'Buy',
            size: 1,
            price: 215.15,
            tick_direction: 'PlusTick',
            trade_id: '52079383-86f0-52bf-ab1f-f943a34a8aeb',
            cross_seq: 736789193
          }
        ]
      },
      {
        topic: 'orderBookL2_25.XRPUSD',
        type: 'delta',
        data: {
          delete: [],
          update: [{ price: '0.1984', symbol: 'XRPUSD', id: 1984, side: 'Sell', size: 183205 }],
          insert: [],
          transactTimeE6: 0
        },
        cross_seq: 584609909,
        timestamp_e6: 1590683463122042
      },
      {
        topic: 'trade.BTCUSDT',
        data: [
          {
            symbol: 'BTCUSDT',
            tick_direction: 'PlusTick',
            price: '9452.00',
            size: 0.001,
            timestamp: '2020-05-28T16:31:21.000Z',
            trade_time_ms: '1590683481987',
            side: 'Buy',
            trade_id: 'b79bae67-1526-5ee6-adee-cf88e8a691a6'
          }
        ]
      },
      {
        topic: 'orderBookL2_25.BTCUSDT',
        type: 'snapshot',
        data: {
          order_book: [{ price: '9483.00', symbol: 'BTCUSDT', id: '94830000', side: 'Sell', size: 9.16 }]
        },
        cross_seq: '176990958',
        timestamp_e6: '1590682503852140'
      },
      {
        topic: 'orderBookL2_25.BTCUSD',
        type: 'snapshot',
        data: [{ price: '9462.50', symbol: 'BTCUSD', id: 94625000, side: 'Buy', size: 35140 }],
        cross_seq: 1628388493,
        timestamp_e6: 1590682503318949
      },

      {
        topic: 'orderBookL2_25.BTCUSD',
        type: 'delta',
        data: {
          delete: [],
          update: [
            { price: '9465.50', symbol: 'BTCUSD', id: 94655000, side: 'Buy', size: 101535 },
            { price: '9480.50', symbol: 'BTCUSD', id: 94805000, side: 'Sell', size: 121205 },
            { price: '9467.50', symbol: 'BTCUSD', id: 94675000, side: 'Buy', size: 46177 }
          ],
          insert: [],
          transactTimeE6: 0
        },
        cross_seq: 1628388501,
        timestamp_e6: 1590682504061720
      },
      {
        topic: 'orderBookL2_25.BTCUSD',
        type: 'delta',
        data: {
          delete: [],
          update: [{ price: '9474.50', symbol: 'BTCUSD', id: 94745000, side: 'Buy', size: 214147 }],
          insert: [],
          transactTimeE6: 0
        },
        cross_seq: 1628388509,
        timestamp_e6: 1590682504459494
      },
      {
        topic: 'orderBookL2_25.BTCUSDT',
        type: 'delta',
        data: {
          delete: [],
          update: [
            { price: '9472.50', symbol: 'BTCUSDT', id: '94725000', side: 'Buy', size: 22.390999 },
            { price: '9466.00', symbol: 'BTCUSDT', id: '94660000', side: 'Buy', size: 2.17 },
            { price: '9469.50', symbol: 'BTCUSDT', id: '94695000', side: 'Buy', size: 3.331 }
          ],
          insert: []
        },
        cross_seq: '176991944',
        timestamp_e6: '1590682528033099'
      },
      {
        topic: 'orderBook_200.100ms.BTCUSDT',
        type: 'delta',
        data: {
          delete: [],
          update: [
            { price: '9472.50', symbol: 'BTCUSDT', id: '94725000', side: 'Buy', size: 22.390999 },
            { price: '9466.00', symbol: 'BTCUSDT', id: '94660000', side: 'Buy', size: 2.17 },
            { price: '9469.50', symbol: 'BTCUSDT', id: '94695000', side: 'Buy', size: 3.331 }
          ],
          insert: []
        },
        cross_seq: '176991944',
        timestamp_e6: '1590682528035169'
      },
      {
        topic: 'instrument_info.100ms.BTCUSDT',
        type: 'snapshot',
        data: {
          id: 1,
          symbol: 'BTCUSDT',
          last_price_e4: '94695000',
          last_tick_direction: 'PlusTick',
          prev_price_24h_e4: '91615000',
          price_24h_pcnt_e6: '33618',
          high_price_24h_e4: '95330000',
          low_price_24h_e4: '90515000',
          prev_price_1h_e4: '94395000',
          price_1h_pcnt_e6: '3178',
          mark_price_e4: '94751300',
          index_price_e4: '94739400',
          open_interest_e8: '447123000000',
          total_turnover_e8: '942044488647300000',
          turnover_24h_e8: '10388254798149995',
          total_volume_e8: '115158480000000',
          volume_24h_e8: '1118447100000',
          funding_rate_e6: '93',
          predicted_funding_rate_e6: '100',
          cross_seq: '176990247',
          created_at: '1970-01-01T00:00:00.000Z',
          updated_at: '2020-05-28T16:14:34.000Z'
        },
        cross_seq: '176990933',
        timestamp_e6: '1590682502904608'
      }
    ]

    let bybit = createMapper('bybit', new Date('2019-12-23'))

    for (const message of messages) {
      const mappedMessages = bybit.map(message, new Date('2019-12-01T00:00:01.2750543Z'))
      expect(mappedMessages).toMatchSnapshot()
    }

    bybit = createMapper('bybit', new Date('2019-12-24'))

    const messagesIncludingOrderBook200 = [
      {
        topic: 'orderBookL2_25.BTCUSD',
        type: 'delta',
        data: {
          delete: [],
          update: [{ price: '9360.00', symbol: 'BTCUSD', id: 93600000, side: 'Sell', size: 43624 }],
          insert: [],
          transactTimeE6: 0
        },
        cross_seq: 1116030773,
        timestamp_e6: 1580515259707361
      },
      {
        topic: 'orderBook_200.100ms.BTCUSD',
        type: 'delta',
        data: {
          delete: [],
          update: [{ price: '9352.50', symbol: 'BTCUSD', id: 93525000, side: 'Sell', size: 238589 }],
          insert: [],
          transactTimeE6: 0
        },
        cross_seq: 1116030776,
        timestamp_e6: 1580515259758557
      }
    ]

    for (const message of messagesIncludingOrderBook200) {
      const mappedMessages = bybit.map(message, new Date('2019-12-14T00:00:01.2750543Z'))
      expect(mappedMessages).toMatchSnapshot()
    }
  })

  test('map okcoin messages', () => {
    const messages = [
      {
        table: 'spot/depth',
        action: 'partial',
        data: [
          {
            instrument_id: 'BTC-USD',
            asks: [['7624.75', '0.0425', '1']],
            bids: [['766.0', '1.359', '1']],
            timestamp: '2019-11-22T00:00:01.547Z'
          }
        ]
      },
      { event: 'subscribe', channel: 'spot/ticker:LTC-USD' },
      {
        table: 'spot/ticker',
        data: [
          {
            last: '4.166',
            open_24h: '4.2',
            best_bid: '4.166',
            high_24h: '4.2',
            low_24h: '4.166',
            base_volume_24h: '14626.6263',
            quote_volume_24h: '60934.5251',
            best_ask: '5.51',
            instrument_id: 'ETC-USD',
            timestamp: '2019-11-21T23:59:04.392Z'
          }
        ]
      },
      {
        table: 'spot/depth',
        action: 'update',
        data: [
          {
            instrument_id: 'BTC-EUR',
            asks: [['6914.33', '0.5985', '1']],
            bids: [],
            timestamp: '2019-11-22T00:00:30.968Z',
            checksum: -1061607485
          }
        ]
      },
      {
        table: 'spot/trade',
        data: [
          { side: 'buy', trade_id: '459', price: '20.38', size: '0.1', instrument_id: 'DCR-USD', timestamp: '2019-11-09T07:53:40.478Z' }
        ]
      },
      {
        table: 'spot/trade',
        data: [
          { side: 'buy', trade_id: '460', price: '20.38', size: '0.1', instrument_id: 'DCR-USD', timestamp: '2019-11-09T07:53:40.479Z' }
        ]
      }
    ]
    const okcoin = createMapper('okcoin', new Date('2020-01-01'))

    for (const message of messages) {
      const mappedMessages = okcoin.map(message, new Date('2019-11-09T00:00:01.2750543Z'))
      expect(mappedMessages).toMatchSnapshot()
    }
  })

  test('map hitbtc messages', () => {
    const messages = [
      { jsonrpc: '2.0', result: true, id: 1 },
      {
        jsonrpc: '2.0',
        method: 'snapshotOrderbook',
        params: {
          ask: [{ price: '0.00000004255', size: '31400' }],
          bid: [{ price: '0.00000004245', size: '2200' }],
          symbol: 'BCNBTC',
          sequence: 1591130,
          timestamp: '2019-11-22T00:00:00.040Z'
        }
      },
      {
        jsonrpc: '2.0',
        method: 'updateOrderbook',
        params: {
          ask: [],
          bid: [
            { price: '0.000104487', size: '0' },
            { price: '0.000073314', size: '8865' }
          ],
          symbol: 'POAETH',
          sequence: 1702925,
          timestamp: '2019-11-22T00:00:40.148Z'
        }
      },
      {
        jsonrpc: '2.0',
        method: 'snapshotTrades',
        params: {
          data: [{ id: 712213931, price: '0.335590', quantity: '0.030', side: 'sell', timestamp: '2019-11-22T00:00:40.462Z' }],
          symbol: 'XMRETH'
        }
      },
      {
        jsonrpc: '2.0',
        method: 'updateTrades',
        params: {
          data: [{ id: 712213931, price: '0.335590', quantity: '0.030', side: 'sell', timestamp: '2019-11-22T00:00:40.462Z' }],
          symbol: 'XMRETH'
        }
      }
    ]
    const hitbtc = createMapper('hitbtc')

    for (const message of messages) {
      const mappedMessages = hitbtc.map(message, new Date('2019-12-01T00:00:01.2750543Z'))
      expect(mappedMessages).toMatchSnapshot()
    }
  })

  test('map phemex messages', () => {
    const messages = [
      {
        market24h: {
          close: 58820000,
          fundingRate: -39075,
          high: 62710000,
          indexPrice: 58981349,
          low: 58605000,
          markPrice: 58958348,
          open: 62640000,
          openInterest: 10113855,
          predFundingRate: -260708,
          symbol: 'BTCUSD',
          turnover: 3061842677702,
          volume: 186213143
        },
        timestamp: 1585526459199354689
      },
      {
        book: { asks: [], bids: [[58795000, 46385]] },
        depth: 30,
        sequence: 675453625,
        symbol: 'BTCUSD',
        timestamp: 1585526459126872850,
        type: 'incremental'
      },
      {
        book: {
          asks: [
            [14730, 62442],
            [14840, 7957]
          ],
          bids: [[14680, 64579]]
        },
        depth: 30,
        sequence: 208228196,
        symbol: 'XTZUSD',
        timestamp: 1585526458842641407,
        type: 'incremental'
      },
      { sequence: 251739378, symbol: 'LINKUSD', trades: [[1585526459381695957, 'Buy', 20210, 56]], type: 'incremental' },
      { sequence: 251739378, symbol: 'LINKUSD', trades: [[1585526459381695957, 'Buy', 20210, 56]], type: 'snapshot' },
      {
        book: {
          asks: [[58690000, 237505]],
          bids: [[58685000, 328758]]
        },
        depth: 30,
        sequence: 675440727,
        symbol: 'BTCUSD',
        timestamp: 1585526400543970299,
        type: 'snapshot'
      },
      {
        book: {
          asks: [],
          bids: [
            [954532000000, 8863300],
            [954528000000, 0]
          ]
        },
        depth: 30,
        sequence: 1067554850,
        symbol: 'sBTCUSDT',
        timestamp: 1591268221628126444,
        type: 'incremental'
      },
      { sequence: 1067555713, symbol: 'sETHUSDT', trades: [[1591268224163281134, 'Buy', 24025000000, 10576000]], type: 'incremental' },
      { sequence: 1067556417, symbol: 'sBTCUSDT', trades: [[1591268226414925245, 'Sell', 954488000000, 279100]], type: 'incremental' },
      { sequence: 615011372, symbol: 'LINKUSD', trades: [[1591268230652613373, 'Sell', 43780, 6]], type: 'incremental' }
    ]
    const phemex = createMapper('phemex')

    for (const message of messages) {
      const mappedMessages = phemex.map(message, new Date('2019-12-01T00:00:01.2750543Z'))
      expect(mappedMessages).toMatchSnapshot()
    }
  })

  test('map gate-io messages', () => {
    const messages = [
      {
        method: 'trades.update',
        params: ['BTC_USDT', [{ id: 259066862, time: 1593561592.4327581, price: '9137.38', amount: '0.0047', type: 'buy' }]],
        id: null
      },
      {
        method: 'trades.update',
        params: [
          'BTC_USDT',
          [
            { id: 259066877, time: 1593561600.7751219, price: '9137.38', amount: '0.002736014', type: 'buy' },
            { id: 259066876, time: 1593561600.655988, price: '9137.38', amount: '0.0019152098', type: 'buy' }
          ]
        ],
        id: null
      },
      {
        method: 'ticker.update',
        params: [
          'CVC_USDT',
          {
            period: 86400,
            open: '0.0276',
            close: '0.0269',
            high: '0.0276',
            low: '0.0262',
            last: '0.0269',
            change: '-2.53',
            quoteVolume: '14765.07143428',
            baseVolume: '394.022772826982'
          }
        ],
        id: null
      },
      {
        method: 'depth.update',
        params: [
          true,
          {
            asks: [['10.95', '14.4232']],
            bids: [['10.53', '26.681457246']]
          },
          'BTG_USDT'
        ],
        id: null
      },
      {
        method: 'depth.update',
        params: [
          false,
          {
            bids: [
              ['0.01631', '1134158.88940972'],
              ['0.01625', '41254.93309']
            ]
          },
          'TRX_USDT'
        ],
        id: null
      }
    ]
    const gateIOMapper = createMapper('gate-io')

    for (const message of messages) {
      const mappedMessages = gateIOMapper.map(message, new Date('2020-07-01T00:00:01.2750543Z'))
      expect(mappedMessages).toMatchSnapshot()
    }
  })

  test('map gate-io-futures messages', () => {
    const messages = [
      {
        time: 1593561600,
        channel: 'futures.order_book',
        event: 'all',
        error: null,
        result: {
          contract: 'ZRX_USD',
          asks: [{ p: '0.3351', s: 108 }],
          bids: [{ p: '0.2728', s: 10 }]
        }
      },
      {
        time: 1593561604,
        channel: 'futures.order_book',
        event: 'update',
        error: null,
        result: [
          { p: '222.25', s: -390, c: 'BCH_USDT', id: 242207247 },
          { p: '222.25', s: 0, c: 'BCH_USDT', id: 242207248 }
        ]
      },
      {
        time: 1593561604,
        channel: 'futures.order_book',
        event: 'update',
        error: null,
        result: [{ p: '0.01643', s: 0, c: 'TRX_USDT', id: 62446928 }]
      },
      {
        time: 1593561606,
        channel: 'futures.order_book',
        event: 'update',
        error: null,
        result: [
          { p: '221.3', s: 12405, c: 'BCH_USD', id: 453347637 },
          { p: '223.35', s: -2500, c: 'BCH_USD', id: 453347638 }
        ]
      },
      {
        time: 1593561606,
        channel: 'futures.tickers',
        event: 'update',
        error: null,
        result: [
          {
            contract: 'ETC_USD',
            last: '5.67',
            change_percentage: '-1.31',
            funding_rate: '0.0001',
            mark_price: '5.735',
            index_price: '5.734',
            total_size: '46366',
            volume_24h: '2713',
            quanto_base_rate: '0.0006277',
            volume_24h_usd: '14051',
            volume_24h_btc: '1',
            funding_rate_indicative: '0.0001',
            volume_24h_quote: '14051',
            volume_24h_settle: '1',
            volume_24h_base: '2478'
          },
          {
            contract: 'ETC_USD',
            last: '5.67',
            change_percentage: '-1.31',
            funding_rate: '0.0001',
            mark_price: '5.735',
            index_price: '5.734',
            total_size: '46366',
            volume_24h: '2713',
            quanto_base_rate: '0.00062772',
            volume_24h_usd: '14051',
            volume_24h_btc: '1',
            funding_rate_indicative: '0.0001',
            volume_24h_quote: '14051',
            volume_24h_settle: '1',
            volume_24h_base: '2478'
          }
        ]
      },
      {
        time: 1593561616,
        channel: 'futures.trades',
        event: 'update',
        error: null,
        result: [{ size: 1, id: 31615, create_time: 1593561616, price: '217.2', contract: 'COMP_USDT' }]
      },
      {
        time: 1593561623,
        channel: 'futures.trades',
        event: 'update',
        error: null,
        result: [{ size: -22, id: 1696009, create_time: 1593561623, price: '225.5', contract: 'ETH_USDT' }]
      },
      { time: 1593561600, channel: 'futures.trades', event: 'subscribe', error: null, result: { status: 'success' } },
      { time: 1593561600, channel: 'futures.order_book', event: 'subscribe', error: null, result: { status: 'success' } },
      { time: 1593561600, channel: 'futures.tickers', event: 'subscribe', error: null, result: { status: 'success' } },
      {
        time: 1595376003,
        channel: 'futures.order_book',
        event: 'update',
        error: null,
        result: [
          { p: '4.2201', s: 117, c: 'HT_USDT', id: 139300729 },
          { p: '4.2907', s: -117, c: 'HT_USDT', id: 139300730 }
        ]
      },
      {
        time: 1595376005,
        channel: 'futures.order_book',
        event: 'all',
        error: null,
        result: {
          contract: 'XRP_USDT',
          asks: [{ p: '0.1996', s: 93 }],
          bids: [{ p: '0.1954', s: 17 }]
        }
      },

      {
        time: 1593600293,
        channel: 'futures.order_book',
        event: 'update',
        error: null,
        result: [
          { p: '227.2', s: 4884, c: 'ETH_USDT', id: 363072474 },
          { p: '227.2', s: 4881, c: 'ETH_USDT', id: 363072475 },
          { p: '227.2', s: 2440, c: 'ETH_USDT', id: 363072476 },
          { p: '227.2', s: 1155, c: 'ETH_USDT', id: 363072477 },
          { p: '227.2', s: 0, c: 'ETH_USDT', id: 363072478 },
          { p: '227.55', s: -4925, c: 'ETH_USDT', id: 363072479 }
        ]
      },
      {
        time: 1593600249,
        channel: 'futures.order_book',
        event: 'update',
        error: null,
        result: [
          { p: '223.75', s: 14, c: 'BCH_USDT', id: 242529117 },
          { p: '223.75', s: 0, c: 'BCH_USDT', id: 242529118 },
          { p: '223.7', s: 0, c: 'BCH_USDT', id: 242529119 },
          { p: '223.6', s: 0, c: 'BCH_USDT', id: 242529120 },
          { p: '223.6', s: -20, c: 'BCH_USDT', id: 242529121 },
          { p: '223.55', s: 15039, c: 'BCH_USDT', id: 242529122 },
          { p: '223.55', s: 15089, c: 'BCH_USDT', id: 242529123 }
        ]
      }
    ]
    const gateIOFuturesMapper = createMapper('gate-io-futures')

    for (const message of messages) {
      const mappedMessages = gateIOFuturesMapper.map(message, new Date('2020-07-01T00:00:01.2750543Z'))
      expect(mappedMessages).toMatchSnapshot()
    }
  })

  test('map poloniex messages', () => {
    const messages = [
      [
        14,
        98112891,
        [
          [
            'i',
            {
              currencyPair: 'BTC_BTS',
              orderBook: [
                {
                  '0.00000253': '11210.09190734',
                  '0.00000254': '264.83225116'
                },
                {
                  '0.00000252': '184.56548785'
                }
              ]
            }
          ]
        ],
        'BTC_BTS'
      ],
      [14, 98112892, [['o', 1, '0.00000249', '84147.13099837']], 'BTC_BTS'],
      [
        239,
        158180518,
        [
          ['o', 0, '158.19075628', '3.74516873'],
          ['t', '572068', 1, '158.19075628', '0.16519127', 1593561602]
        ],
        'USDC_BCHSV'
      ],
      [
        231,
        80867762,
        [
          ['o', 1, '0.03647020', '2075.23326384'],
          ['o', 1, '0.03647022', '2174.03060057']
        ],
        'USDT_MANA'
      ],
      [
        14,
        98112906,
        [
          ['o', 0, '0.00000253', '8597.42720734'],
          ['o', 0, '0.00000254', '2877.49695116']
        ]
      ],
      [
        212,
        117638587,
        [
          ['o', 0, '0.25355332', '0.00000000'],
          ['o', 0, '0.25245395', '4565.00000000']
        ]
      ],
      [
        114,
        574692726,
        [
          ['o', 1, '0.00695218', '0.00000000'],
          ['o', 1, '0.00695217', '0.00000000'],
          ['t', '20441515', 0, '0.00695218', '98.55153490', 1593561636],
          ['t', '20441516', 0, '0.00695217', '1.72607982', 1593561636]
        ],
        'BTC_XMR'
      ],
      [14, 98527492, [['t', 10384654, 1, '0.00000226', '299.99145733', 1597167360]], 'BTC_BTS']
    ]
    const poloniexMapper = createMapper('poloniex')

    for (const message of messages) {
      const mappedMessages = poloniexMapper.map(message, new Date('2020-07-01T00:00:01.2750543Z'))
      expect(mappedMessages).toMatchSnapshot()
    }
  })

  test('map coinflex messages', () => {
    const messages = [
      { channel: 'futures/depth:BTC-USD-SWAP-LIN', event: 'subscribe', success: true, timestamp: 1594684800279 },
      { channel: 'trade:BTC-USD-SWAP-LIN', event: 'subscribe', success: true, timestamp: 1594684800280 },
      { channel: 'ticker:BTC-USD-SWAP-LIN', event: 'subscribe', success: true, timestamp: 1594684800280 },
      {
        data: [
          {
            instrumentId: 'BTC-USD',
            seqNum: 1594613594001171264,
            asks: [
              [9241, 1, 0, 0],
              [9243.5, 0.967, 0, 0]
            ],
            checksum: 0,
            bids: [
              [9239.9, 0.46, 0, 0],
              [9238.1, 0.5, 0, 0]
            ],
            timestamp: '1594684800290'
          }
        ],
        action: 'partial',
        table: 'futures/depth'
      },
      {
        data: [
          {
            side: 'SELL',
            quantity: '0.499900000',
            price: '9237.500000000',
            marketCode: 'BTC-USD-SWAP-LIN',
            tradeId: '160061323905884640',
            timestamp: '1594684856487'
          }
        ],
        table: 'trade'
      },
      {
        data: [
          {
            currencyVolume24h: '0.999800000',
            high24h: '9237.500000000',
            last: '9237.500000000',
            lastQty: '0.499900000',
            low24h: '9237.500000000',
            markPrice: '9225.5',
            marketCode: 'BTC-USD-SWAP-LIN',
            open24h: '9237.500000000',
            openInterest: '95.868400010',
            timestamp: '1594684800000',
            volume24h: '9235.652500000000000000'
          }
        ],
        table: 'ticker'
      },
      {
        data: [
          {
            side: 'BUY',
            quantity: '0.258000000',
            price: '9215.000000000',
            marketCode: 'BTC-USD-SWAP-LIN',
            tradeId: '160061323905902676',
            timestamp: '1594738801694'
          }
        ],
        table: 'trade'
      },
      {
        data: [
          {
            side: 'SELL',
            quantity: '0.817000000',
            price: '9218.000000000',
            marketCode: 'BTC-USD-SWAP-LIN',
            tradeId: '160061323905902717',
            timestamp: '1594738849445'
          }
        ],
        table: 'trade'
      },
      {
        data: [
          {
            currencyVolume24h: '21206.000000000',
            high24h: '0.304000000',
            last: '0.284000000',
            lastQty: '100.000000000',
            low24h: '0.284000000',
            markPrice: '0.28725862068965517241',
            marketCode: 'FLEX-USD',
            open24h: '0.304000000',
            openInterest: '0',
            timestamp: '1594737689712',
            volume24h: '6262.576000000000000000'
          }
        ],
        table: 'ticker'
      },
      {
        data: [
          {
            currencyVolume24h: '4234.002000000',
            high24h: '86.000000000',
            last: '83.000000000',
            lastQty: '17.979000000',
            low24h: '81.000000000',
            marketCode: 'BTC-USD-SPR-QP-LIN',
            open24h: '82.000000000',
            openInterest: '0',
            timestamp: '1594733816647',
            volume24h: '39119727.0229900000000000000'
          }
        ],
        table: 'ticker'
      }
    ]

    const coinflexMapper = createMapper('coinflex')

    for (const message of messages) {
      const mappedMessages = coinflexMapper.map(message, new Date('2020-07-01T00:00:01.2750543Z'))
      expect(mappedMessages).toMatchSnapshot()
    }
  })
})
