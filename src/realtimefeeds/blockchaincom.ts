import { wait } from '../handy'
import { Filter } from '../types'
import { RealTimeFeedBase } from './realtimefeed'

export class BlockchainComRealTimeFeed extends RealTimeFeedBase {
  protected readonly wssURL = 'wss://ws.blockchain.info/mercury-gateway/v1/ws'
  protected readonly originHeader = 'https://exchange.blockchain.com'

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const subs = filters
      .map((filter) => {
        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error('BlockchainComRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
        }

        return filter.symbols.map((symbol) => {
          return {
            action: 'subscribe',
            channel: filter.channel,
            symbol
          }
        })
      })
      .flatMap((f) => f)

    return subs
  }

  protected messageIsError(message: any): boolean {
    return message.event === 'rejected'
  }

  protected messageIsHeartbeat(msg: any) {
    return msg.channel === 'heartbeat'
  }
  protected async onConnected() {
    this.send({
      action: 'subscribe',
      channel: 'heartbeat'
    })

    await wait(0)
  }
}
