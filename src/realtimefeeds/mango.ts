import { SerumRealTimeFeed } from './serum'

export class MangoRealTimeFeed extends SerumRealTimeFeed {
  protected wssURL = 'wss://api.mango-bowl.com/v1/ws'
}
