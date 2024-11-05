import { batchObjects } from '../handy'
import { Filter } from '../types'
import { RealTimeFeedBase } from './realtimefeed'

abstract class BitgetRealTimeFeedBase extends RealTimeFeedBase {
  protected throttleSubscribeMS = 100
  protected readonly wssURL = 'wss://ws.bitget.com/v2/ws/public'

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const argsInputs = filters.flatMap((filter) => {
      if (!filter.symbols || filter.symbols.length === 0) {
        throw new Error('BitgetRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
      }

      return filter.symbols.map((symbol) => {
        return {
          instType: this.getInstType(symbol),
          channel: filter.channel,
          instId: symbol
        }
      })
    })

    const payload = [...batchObjects(argsInputs, 5)].map((args) => {
      return {
        op: 'subscribe',
        args
      }
    })

    return payload
  }

  protected messageIsError(message: any): boolean {
    return message.event === 'error'
  }

  abstract getInstType(symbol: string): string
}

export class BitgetRealTimeFeed extends BitgetRealTimeFeedBase {
  getInstType(_: string) {
    return 'SPOT'
  }
}

export class BitgetFuturesRealTimeFeed extends BitgetRealTimeFeedBase {
  getInstType(symbol: string) {
    if (symbol.endsWith('USDT')) {
      return 'USDT-FUTURES'
    }

    if (symbol.endsWith('PERP')) {
      return 'USDC-FUTURES'
    }

    return 'COIN-FUTURES'
  }
}
