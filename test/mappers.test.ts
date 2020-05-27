import { Exchange, Mapper, normalizeBookChanges, normalizeDerivativeTickers, normalizeTrades } from '../src'

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
  'ftx'
]

const createMapper = (exchange: Exchange, localTimestamp?: Date) => {
  const normalizers = exchangesWithDerivativeInfo.includes(exchange)
    ? [normalizeTrades, normalizeBookChanges, normalizeDerivativeTickers]
    : [normalizeTrades, normalizeBookChanges]

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
      }
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
      { stream: 'btcusdt@openInterest', generated: true, data: { symbol: 'BTCUSDT', openInterest: '26286.181' } }
    ]

    const binanceFuturesMapper = createMapper('binance-futures', new Date())
    for (const message of messages) {
      const mappedMessages = binanceFuturesMapper.map(message, new Date('2019-09-01T00:00:01.2750543Z'))
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
      { feed: 'book', product_id: 'PI_LTCUSD', side: 'buy', seq: 361432, price: 64.24, qty: 0.0, timestamp: 1567296042131 }
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
      }
    ]

    const huobi = createMapper('huobi')

    for (const message of messages) {
      const mappedMessages = huobi.map(message, new Date('2019-12-01T00:00:01.2750543Z'))
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
      }
    ]
    const phemex = createMapper('phemex')

    for (const message of messages) {
      const mappedMessages = phemex.map(message, new Date('2019-12-01T00:00:01.2750543Z'))
      expect(mappedMessages).toMatchSnapshot()
    }
  })
})
