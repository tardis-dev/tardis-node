import { Filter, FilterForExchange } from '../types'
import { RealTimeFeedBase } from './realtimefeed'
import WebSocket from 'ws'

export class DeribitRealTimeDataFeed extends RealTimeFeedBase {
  protected wssURL = 'wss://www.deribit.com/ws/api/v2'

  protected channelsWithIntervals: FilterForExchange['deribit']['channel'][] = ['book', 'perpetual', 'trades', 'ticker']

  protected mapToSubscribeMessages(filters: Filter<string>[]): string | any[] {
    const channels = filters
      .map(filter => {
        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error('DeribitRealTimeDataFeed requires explicitly specified symbols when subscribing to live feed')
        }

        return filter.symbols.map(symbol => {
          const suffix = this.channelsWithIntervals.includes(filter.channel as any) ? '.raw' : ''
          return `${filter.channel}.${symbol}${suffix}`
        })
      })
      .flatMap(f => f)

    return [
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'public/subscribe',
        params: {
          channels
        }
      }
    ]
  }

  protected messageIsError(message: any): boolean {
    return message.error !== undefined
  }

  protected onConnected = (ws: WebSocket) => {
    // set heartbeat so deribit won't close connection prematurely
    // https://docs.deribit.com/v2/#public-set_heartbeat
    ws.send(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'public/set_heartbeat',
        id: 0,
        params: {
          interval: 10
        }
      })
    )
  }

  protected onMessage = (msg: any, ws: WebSocket) => {
    // respond with public/test message to keep connection alive
    if (msg.params !== undefined && msg.params.type === 'test_request') {
      ws.send(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'public/test',
          id: 0,
          params: {}
        })
      )
    }
  }
}
