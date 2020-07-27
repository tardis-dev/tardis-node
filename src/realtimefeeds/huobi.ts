import { unzipSync } from 'zlib'
import { Filter } from '../types'
import { RealTimeFeedBase } from './realtimefeed'

abstract class HuobiRealTimeFeedBase extends RealTimeFeedBase {
  protected abstract wssURL: string
  protected channelSuffixMap = {} as any

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    return filters
      .map((filter, index) => {
        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error('HuobiRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
        }

        return filter.symbols.map((symbol, symbolIndex) => {
          return {
            id: String(symbolIndex + index),
            sub: `market.${symbol}.${filter.channel}${
              this.channelSuffixMap[filter.channel] !== undefined ? this.channelSuffixMap[filter.channel] : ''
            }`
          }
        })
      })
      .flatMap((s) => s)
  }

  protected decompress = (message: any) => {
    message = unzipSync(message)

    return message as Buffer
  }

  protected messageIsError(message: any): boolean {
    if (message.status === 'error') {
      return true
    }
    return false
  }

  protected onMessage(message: any) {
    if (message.ping !== undefined) {
      this.send({
        pong: message.ping
      })
    }
  }

  protected messageIsHeartbeat(message: any) {
    return message.ping !== undefined
  }
}

export class HuobiRealTimeFeed extends HuobiRealTimeFeedBase {
  protected wssURL = 'wss://api-aws.huobi.pro/ws'

  protected channelSuffixMap = {
    trade: '.detail',
    depth: '.step0',
    mbp: '.150'
  } as any
}

export class HuobiDMRealTimeFeed extends HuobiRealTimeFeedBase {
  protected wssURL = 'wss://api.hbdm.vn/ws'

  protected channelSuffixMap = {
    trade: '.detail',
    depth: '.size_150.high_freq'
  } as any
}

export class HuobiDMSwapRealTimeFeed extends HuobiRealTimeFeedBase {
  protected wssURL = 'wss://api.hbdm.vn/swap-ws'

  protected channelSuffixMap = {
    trade: '.detail',
    depth: '.size_150.high_freq'
  } as any
}
