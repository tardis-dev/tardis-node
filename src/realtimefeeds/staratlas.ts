import { SerumRealTimeFeed } from './serum.ts'

export class StarAtlasRealTimeFeed extends SerumRealTimeFeed {
  protected wssURL = 'wss://serum-vial.staratlas.cloud/v1/ws'
}
