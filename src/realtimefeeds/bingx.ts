import { unzipSync } from 'zlib'
import { EXCHANGE_CHANNELS_INFO } from '../consts.ts'
import { Filter } from '../types.ts'
import { RealTimeFeedBase, Sequence } from './realtimefeed.ts'

export class BingxRealTimeFeed extends RealTimeFeedBase {
  protected readonly wssURL: string = 'wss://open-api-ws.bingx.com/market'
  protected decompress = unzipSync

  protected mapToSubscribeMessages(filters: Filter<string>[]) {
    let id = 0
    const subscriptions = filters.flatMap(({ channel, symbols }) => {
      if (!symbols?.length) {
        throw new Error('BingX requires explicitly specified symbols for live subscriptions')
      }

      if (!(EXCHANGE_CHANNELS_INFO.bingx as readonly string[]).includes(channel)) {
        throw new Error(`Unsupported BingX channel: ${channel}`)
      }

      return symbols.map((symbol) => ({
        id: String(++id),
        reqType: 'sub',
        dataType: `${symbol}@${channel}`
      }))
    })

    if (subscriptions.length > 200) {
      throw new Error('BingX allows at most 200 topics per WebSocket connection')
    }

    return subscriptions
  }

  protected parseMessage(message: Buffer) {
    return message.toString() === 'Ping' ? 'Ping' : super.parseMessage(message)
  }

  protected messageIsError(message: any) {
    return message.code !== undefined && message.code !== 0
  }

  protected messageIsHeartbeat(message: any) {
    return message === 'Ping'
  }

  protected onMessage(message: any) {
    if (message === 'Ping') this.sendRaw('Pong')
  }

  protected getSequence(message: any): Sequence | undefined {
    if (message.dataType?.endsWith('@incrDepth') && message.data !== undefined) {
      return {
        key: message.dataType,
        sequence: message.data.lastUpdateId,
        previousSequence: message.data.action === 'all' ? undefined : message.data.lastUpdateId - 1
      }
    }
    return undefined
  }
}
