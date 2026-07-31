import { batchObjects } from '../handy.ts'
import { Filter } from '../types.ts'
import { RealTimeFeedBase } from './realtimefeed.ts'

abstract class BitgetRealTimeFeedBase extends RealTimeFeedBase {
  protected throttleSubscribeMS = 100
  protected readonly wssURL = 'wss://ws.bitget.com/v3/ws/public'

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const argsInputs = filters.flatMap((filter) => {
      if (filter.channel === 'liquidation') {
        return this.getLiquidationInstTypes().map((instType) => {
          return {
            instType,
            topic: filter.channel
          }
        })
      }

      if (!filter.symbols || filter.symbols.length === 0) {
        throw new Error('BitgetRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
      }

      return filter.symbols.map((symbol) => {
        return {
          instType: this.getInstType(symbol),
          topic: filter.channel,
          symbol
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

  protected getLiquidationInstTypes(): string[] {
    return []
  }
}

export class BitgetRealTimeFeed extends BitgetRealTimeFeedBase {
  getInstType(_: string) {
    return 'spot'
  }
}

export class BitgetFuturesRealTimeFeed extends BitgetRealTimeFeedBase {
  getInstType(symbol: string) {
    if (symbol.endsWith('USDT')) {
      return 'usdt-futures'
    }

    if (symbol.endsWith('PERP')) {
      return 'usdc-futures'
    }

    return 'coin-futures'
  }

  protected getLiquidationInstTypes() {
    return ['usdt-futures', 'usdc-futures', 'coin-futures']
  }
}
