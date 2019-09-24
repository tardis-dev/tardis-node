import { getMapper } from '../src'

describe.only('Data normalization - mappers', () => {
  describe('Deribit mapper', () => {
    const deribitMapper = getMapper('deribit')
    test('maps trades', () => {
      const deribitTradesMessage = {
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
      }

      expect(deribitMapper.getDataType(deribitTradesMessage)).toEqual('trade')
      const normalizedTrades = Array.from(deribitMapper.mapTrades(deribitTradesMessage, new Date('2019-09-01T00:00:22.5789670Z')))
      expect(normalizedTrades).toMatchSnapshot()
    })

    test('maps quotes', () => {
      const deribitQuoteMessage = {
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
      }

      expect(deribitMapper.getDataType(deribitQuoteMessage)).toEqual('quote')
      const normalizedQuote = Array.from(deribitMapper.mapQuotes(deribitQuoteMessage, new Date('2019-09-01T00:00:22.5789670Z')))
      expect(normalizedQuote).toMatchSnapshot()
    })

    test('maps order book changes', () => {
      const derebitOrderBookSnapMessage = {
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
      }

      expect(deribitMapper.getDataType(derebitOrderBookSnapMessage)).toEqual('l2Change')
      let normalizedBookChanges = Array.from(
        deribitMapper.mapOrderBookL2Changes(derebitOrderBookSnapMessage, new Date('2019-09-01T00:00:22.5789670Z'))
      )
      expect(normalizedBookChanges).toMatchSnapshot()

      const deribitOrderBookUpdateMessage = {
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
      }

      expect(deribitMapper.getDataType(deribitOrderBookUpdateMessage)).toEqual('l2Change')

      normalizedBookChanges = Array.from(
        deribitMapper.mapOrderBookL2Changes(deribitOrderBookUpdateMessage, new Date('2019-09-01T00:00:22.5789670Z'))
      )
      expect(normalizedBookChanges).toMatchSnapshot()
    })

    test('maps ticker', () => {
      const deribitTickerMessage = {
        jsonrpc: '2.0',
        method: 'subscription',
        params: {
          channel: 'quote.ETH-27SEP19-360-P',
          data: {
            timestamp: 1564617654446,
            instrument_name: 'ETH-27SEP19-360-P',
            best_bid_price: 0.649,
            best_bid_amount: 45.0,
            best_ask_price: 0.0,
            best_ask_amount: 1.0
          }
        }
      }

      expect(deribitMapper.getDataType(deribitTickerMessage)).toEqual('quote')
      const normalizedTicker = Array.from(deribitMapper.mapQuotes(deribitTickerMessage, new Date('2019-08-01T00:00:54.4537714Z')))
      expect(normalizedTicker).toMatchSnapshot()
    })
  })
})
