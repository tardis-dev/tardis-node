import protobuf from 'protobufjs'
import { Filter } from '../types.ts'
import { RealTimeFeedBase } from './realtimefeed.ts'

export class MexcRealTimeFeed extends RealTimeFeedBase {
  private static pushDataV3ApiWrapper: protobuf.Type | undefined
  /**
   * MEXC protobuf docs at @see https://www.mexc.com/api-docs/spot-v3/websocket-market-streams/protocol-buffers-integration
   * and schemas from @see https://github.com/mexcdevelop/websocket-proto, mirrored in tardis-recorder/datafeeds/src/mexc/proto.
   */
  private static readonly pushDataV3ApiWrapperSchema = `
    syntax = "proto3";

    message PushDataV3ApiWrapper {
      string channel = 1;
      oneof body {
        PublicAggreDepthsV3Api publicAggreDepths = 313;
        PublicAggreDealsV3Api publicAggreDeals = 314;
        PublicAggreBookTickerV3Api publicAggreBookTicker = 315;
      }

      optional string symbol = 3;
      optional string symbolId = 4;
      optional int64 createTime = 5;
      optional int64 sendTime = 6;
    }

    message PublicAggreDealsV3Api {
      repeated PublicAggreDealsV3ApiItem deals = 1;
      string eventType = 2;
    }

    message PublicAggreDealsV3ApiItem {
      string price = 1;
      string quantity = 2;
      int32 tradeType = 3;
      int64 time = 4;
    }

    message PublicAggreDepthsV3Api {
      repeated PublicAggreDepthV3ApiItem asks = 1;
      repeated PublicAggreDepthV3ApiItem bids = 2;
      string eventType = 3;
      string fromVersion = 4;
      string toVersion = 5;
    }

    message PublicAggreDepthV3ApiItem {
      string price = 1;
      string quantity = 2;
    }

    message PublicAggreBookTickerV3Api {
      string bidPrice = 1;
      string bidQuantity = 2;
      string askPrice = 3;
      string askQuantity = 4;
    }
  `

  protected readonly wssURL = 'wss://wbs-api.mexc.com/ws'
  private readonly channels = new Set([
    'spot@public.aggre.deals.v3.api.pb@10ms',
    'spot@public.aggre.depth.v3.api.pb@10ms',
    'spot@public.aggre.bookTicker.v3.api.pb@100ms'
  ])

  protected mapToSubscribeMessages(filters: Filter<string>[]): any[] {
    const filtersWithSymbols = filters.map<Required<Filter<string>>>((filter) => {
      if (!this.channels.has(filter.channel)) {
        throw new Error(`MexcRealTimeFeed unsupported channel ${filter.channel}`)
      }

      if (!filter.symbols || filter.symbols.length === 0) {
        throw new Error('MexcRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
      }

      return filter as Required<Filter<string>>
    })

    return [
      {
        method: 'SUBSCRIPTION',
        params: filtersWithSymbols.flatMap((filter) => filter.symbols.map((symbol) => `${filter.channel}@${symbol.toUpperCase()}`))
      }
    ]
  }

  protected parseMessage(message: Buffer): any {
    if (message.length > 0 && message[0] === 123) {
      return JSON.parse(message.toString())
    }

    const pushDataV3ApiWrapper = MexcRealTimeFeed.getPushDataV3ApiWrapper()
    return pushDataV3ApiWrapper.toObject(pushDataV3ApiWrapper.decode(message), {
      longs: String,
      arrays: true
    })
  }

  protected messageIsError(message: any): boolean {
    return message.code !== undefined && message.code !== 0
  }

  protected messageIsHeartbeat(message: any) {
    return message.msg === 'PONG'
  }

  protected sendCustomPing = () => {
    this.send({ method: 'PING' })
  }

  private static getPushDataV3ApiWrapper() {
    MexcRealTimeFeed.pushDataV3ApiWrapper ??= protobuf
      .parse(MexcRealTimeFeed.pushDataV3ApiWrapperSchema)
      .root.lookupType('PushDataV3ApiWrapper')

    return MexcRealTimeFeed.pushDataV3ApiWrapper
  }
}
