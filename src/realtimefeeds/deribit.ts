import { Filter, FilterForExchange } from '../types'
import { RealTimeFeedBase } from './realtimefeed'

export class DeribitRealTimeDataFeed extends RealTimeFeedBase {
  protected wssURL = 'wss://www.deribit.com/ws/api/v2'

  protected channelsWithIntervals: FilterForExchange['deribit']['channel'][] = ['book', 'perpetual', 'trades', 'ticker']

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const hasCredentials = this.hasCredentials()
    const channels = filters
      .map((filter) => {
        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error('DeribitRealTimeDataFeed requires explicitly specified symbols when subscribing to live feed')
        }

        return filter.symbols.map((symbol) => {
          const suffix = this.channelsWithIntervals.includes(filter.channel as any) ? (hasCredentials ? '.raw' : '.100ms') : ''

          return `${filter.channel}.${symbol}${suffix}`
        })
      })
      .flatMap((f) => f)

    return [
      {
        jsonrpc: '2.0',
        id: 3,
        method: hasCredentials ? 'private/subscribe' : 'public/subscribe',
        params: {
          channels
        }
      }
    ]
  }

  protected messageIsError(message: any): boolean {
    return message.error !== undefined
  }

  private hasCredentials() {
    return process.env.DERIBIT_API_CLIENT_ID !== undefined && process.env.DERIBIT_API_CLIENT_SECRET !== undefined
  }

  protected onConnected() {
    // set heartbeat so deribit won't close connection prematurely
    // https://docs.deribit.com/v2/#public-set_heartbeat

    this.send({
      jsonrpc: '2.0',
      method: 'public/set_heartbeat',
      id: 0,
      params: {
        interval: 10
      }
    })

    if (this.hasCredentials()) {
      this.send({
        jsonrpc: '2.0',
        method: 'public/auth',
        id: 1,
        params: {
          grant_type: 'client_credentials',
          client_id: process.env.DERIBIT_API_CLIENT_ID,
          client_secret: process.env.DERIBIT_API_CLIENT_SECRET
        }
      })
    }
  }

  protected messageIsHeartbeat(msg: any) {
    return msg.method === 'heartbeat'
  }

  protected onMessage(msg: any) {
    // respond with public/test message to keep connection alive
    if (msg.params !== undefined && msg.params.type === 'test_request') {
      this.send({
        jsonrpc: '2.0',
        method: 'public/test',
        id: 0,
        params: {}
      })
    }
  }
}
