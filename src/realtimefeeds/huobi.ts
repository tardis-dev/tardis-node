import { unzipSync } from 'zlib'
import { Filter } from '../types'
import { RealTimeFeedBase } from './realtimefeed'

abstract class HuobiRealTimeFeedBase extends RealTimeFeedBase {
  protected abstract wssURL: string
  private channelSuffixMap = {
    trade: '.detail',
    depth: '.step0'
  } as any

  protected mapToSubscribeMessages(filters: Filter<string>[]): string | any[] {
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
      .flatMap(s => s)
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

  protected onMessage(msg: any) {
    if (msg.ping !== undefined) {
      this.send({
        pong: msg.ping
      })
    }
  }
}

export class HuobiRealTimeFeed extends HuobiRealTimeFeedBase {
  protected wssURL = 'wss://api.huobi.pro/ws'
}

export class HuobiUSRealTimeFeed extends HuobiRealTimeFeedBase {
  protected wssURL = 'wss://api.huobi.pro/hbus/ws'
}

export class HuobiDMRealTimeFeed extends HuobiRealTimeFeedBase {
  protected wssURL = 'wss://www.hbdm.com/ws'
}
