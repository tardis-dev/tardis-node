import crypto from 'crypto'
import type { CoinbaseMessage } from '../mappers/coinbase.ts'
import { Filter } from '../types.ts'
import { RealTimeFeedBase, type SequenceInfo } from './realtimefeed.ts'

export class CoinbaseRealTimeFeed extends RealTimeFeedBase {
  private _fullChannelSymbols = new Set<string>()

  private _hasCredentials =
    process.env.COINBASE_API_KEY !== undefined &&
    process.env.COINBASE_API_SECRET !== undefined &&
    process.env.COINBASE_API_PASSPHRASE !== undefined

  protected get wssURL() {
    return this._hasCredentials ? 'wss://ws-direct.exchange.coinbase.com' : 'wss://ws-feed.exchange.coinbase.com'
  }

  // map from coinbase subscribe 'channels' to more granular channels that tardis uses
  protected channelMappings = {
    full: ['received', 'open', 'done', 'match', 'change', 'full_snapshot'],
    level2: ['snapshot', 'l2update'],
    matches: ['match', 'last_match'],
    ticker: ['ticker']
  }

  protected getSequence(message: CoinbaseMessage): SequenceInfo | undefined {
    if (
      this._fullChannelSymbols.has(message.product_id) === false ||
      !('sequence' in message) ||
      message.sequence === undefined ||
      !this.shouldValidateSequenceFor(message.type)
    ) {
      return undefined
    }

    return {
      key: message.product_id,
      sequenceId: message.sequence,
      previousSequenceId: message.sequence - 1
    }
  }

  private shouldValidateSequenceFor(type: CoinbaseMessage['type']): boolean {
    return (
      type !== 'ticker' &&
      type !== 'l2update' &&
      type !== 'snapshot' &&
      type !== 'auction' &&
      type !== 'last_auction' &&
      type !== 'rfq_match'
    )
  }

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const channelsToSubscribe = filters
      .map((filter) => {
        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error('CoinbaseRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
        }

        const subscribeToFullChannel =
          filters.filter((f) => this.channelMappings.full.includes(f.channel) && f.channel !== 'match').length > 0
        const subscribeToLevel2Channel = this.channelMappings.level2.includes(filter.channel)
        const subscribeToMatchesChannel = this.channelMappings.matches.includes(filter.channel)
        let channel

        if (subscribeToFullChannel) {
          channel = 'full'
        } else if (subscribeToLevel2Channel) {
          if (this._hasCredentials) {
            channel = 'level2'
          } else {
            // for not authenticated connections use batch channel, non batched l2 updates require auth
            channel = 'level2_batch'
          }
        } else if (subscribeToMatchesChannel) {
          channel = 'matches'
        } else {
          channel = 'ticker'
        }

        return {
          name: channel,
          product_ids: filter.symbols
        }
      })
      .reduce(
        (prev, current) => {
          const matchingExisting = prev.find((c) => c.name === current.name)
          if (matchingExisting !== undefined) {
            for (const symbol of current.product_ids) {
              if (matchingExisting.product_ids.includes(symbol) === false) {
                matchingExisting.product_ids.push(symbol)
              }
            }
          } else {
            prev.push(current)
          }

          return prev
        },
        [] as { name: string; product_ids: string[] }[]
      )

    this._fullChannelSymbols = new Set(
      channelsToSubscribe.filter((channel) => channel.name === 'full').flatMap((channel) => channel.product_ids)
    )

    if (this._hasCredentials) {
      const authParams = this.getAuthParams()

      return [
        {
          type: 'subscribe',
          channels: channelsToSubscribe,
          ...authParams
        }
      ]
    }

    return [
      {
        type: 'subscribe',
        channels: channelsToSubscribe
      }
    ]
  }

  private getAuthParams() {
    const timestamp = Math.floor(Date.now().valueOf() / 1000)
    const apiSecret = process.env.COINBASE_API_SECRET!
    const message = `${timestamp}GET/users/self/verify`
    const hmac = crypto.createHmac('sha256', Buffer.from(apiSecret, 'base64'))
    const signature = hmac.update(message).digest('base64')

    return {
      signature,
      key: process.env.COINBASE_API_KEY!,
      passphrase: process.env.COINBASE_API_PASSPHRASE!,
      timestamp
    }
  }

  protected messageIsError(message: any): boolean {
    return message.type === 'error'
  }
}
