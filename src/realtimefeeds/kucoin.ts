import { getRandomString, getJSON, postJSON, wait } from '../handy.ts'
import { Filter } from '../types.ts'
import { RealTimeFeedBase } from './realtimefeed.ts'

export class KucoinRealTimeFeed extends RealTimeFeedBase {
  protected wssURL = ''
  private _httpURL = 'https://api.kucoin.com/api'

  protected async getWebSocketUrl() {
    const { data: body } = await postJSON<any>(`${this._httpURL}/v1/bullet-public`, { retry: 3, timeout: 10000 })

    return `${body.data.instanceServers[0].endpoint}?token=${body.data.token}&connectId=${getRandomString()}`
  }

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    return filters
      .filter((f) => f.channel !== 'market/level2Snapshot')
      .map((filter) => {
        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error('KucoinRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
        }

        return {
          id: getRandomString(),
          type: 'subscribe',
          topic: `/${filter.channel}:${filter.symbols.join(',')}`,
          privateChannel: false,
          response: true
        }
      })
  }

  protected async provideManualSnapshots(filters: Filter<string>[], shouldCancel: () => boolean) {
    const depthSnapshotFilter = filters.find((f) => f.channel === 'market/level2Snapshot')
    if (!depthSnapshotFilter) {
      return
    }

    this.debug('requesting manual snapshots for: %s', depthSnapshotFilter.symbols)
    for (let symbol of depthSnapshotFilter.symbols!) {
      if (shouldCancel()) {
        return
      }

      const { data } = await getJSON<any>(`${this._httpURL}/v1/market/orderbook/level2_100?symbol=${symbol}`, {
        timeout: 10000
      })

      const snapshot = {
        type: 'message',
        generated: true,
        topic: `/market/level2Snapshot:${symbol}`,
        subject: 'trade.l2Snapshot',
        ...data
      }

      this.manualSnapshotsBuffer.push(snapshot)
    }

    this.debug('requested manual snapshots successfully for: %s ', depthSnapshotFilter.symbols)
  }

  protected messageIsError(message: any): boolean {
    return message.type === 'error'
  }

  protected sendCustomPing = () => {
    this.send({
      id: new Date().valueOf().toString(),
      type: 'ping'
    })
  }

  protected messageIsHeartbeat(msg: any) {
    return msg.type === 'pong'
  }
}
