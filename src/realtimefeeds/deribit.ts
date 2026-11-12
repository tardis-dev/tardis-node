import { wait } from '../handy.ts'
import { Filter, FilterForExchange } from '../types.ts'
import type { DeribitBookMessage } from '../mappers/deribit.ts'
import { RealTimeFeedBase, SequenceInfo } from './realtimefeed.ts'

export class DeribitRealTimeDataFeed extends RealTimeFeedBase {
  protected get wssURL() {
    if (this._hasCredentials) {
      return 'wss://www.deribit.com/ws/api/v2'
    } else {
      return 'wss://streams.deribit.com/ws/api/v2'
    }
  }

  private _hasCredentials = process.env.DERIBIT_API_CLIENT_ID !== undefined && process.env.DERIBIT_API_CLIENT_SECRET !== undefined
  private readonly _bookSequenceStates = new Map<string, { changeId: number; allowOverlap: boolean }>()

  protected channelsWithIntervals: FilterForExchange['deribit']['channel'][] = ['book', 'perpetual', 'trades', 'ticker']

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    this._bookSequenceStates.clear()
    const hasCredentials = this._hasCredentials

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

  protected getSequence({ params: { channel, data } = {} as DeribitBookMessage['params'] }: DeribitBookMessage): SequenceInfo | undefined {
    if (channel?.startsWith('book.')) {
      const previousSequenceId = this.resolvePreviousSequenceId(data)
      if (previousSequenceId !== undefined) {
        return {
          key: data.instrument_name,
          sequenceId: data.change_id,
          previousSequenceId
        }
      }
    }
    return undefined
  }

  private resolvePreviousSequenceId(data: DeribitBookMessage['params']['data']): number | null | undefined {
    if (data.type === 'snapshot') {
      this._bookSequenceStates.set(data.instrument_name, { changeId: data.change_id, allowOverlap: true })
      return null
    }
    const state = this._bookSequenceStates.get(data.instrument_name)
    if (!!state && (!state.allowOverlap || data.change_id >= state.changeId)) {
      if (data.change_id !== state.changeId && (data.prev_change_id === undefined || data.prev_change_id === null)) {
        throw new Error('Deribit book change is missing prev_change_id')
      }
      const previousChangeId = data.prev_change_id ?? state.changeId
      const previousSequenceId = state.allowOverlap && previousChangeId <= state.changeId ? state.changeId : previousChangeId
      state.allowOverlap = false
      state.changeId = data.change_id
      return previousSequenceId
    }
    return undefined
  }

  protected async onConnected() {
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

    if (this._hasCredentials) {
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

      await wait(10)
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
