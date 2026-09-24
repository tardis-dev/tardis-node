import crypto from 'crypto'
import { Filter } from '../types.ts'
import { RealTimeFeedBase } from './realtimefeed.ts'

export class BitvavoRealTimeFeed extends RealTimeFeedBase {
  protected readonly wssURL = 'wss://ws-mdpro.bitvavo.com/v2/'
  protected readonly throttleSubscribeMS = 25
  private nextRequestId = 1
  private pendingAuthentication?: {
    resolve: () => void
    reject: (error: Error) => void
  }

  protected mapToSubscribeMessages(filters: Filter<string>[]) {
    this.getCredentials()

    const channels = filters
      .filter((filter) => filter.channel !== 'getBook')
      .map((filter) => {
        if (!filter.symbols || filter.symbols.length === 0) {
          throw new Error('BitvavoRealTimeFeed requires explicitly specified symbols when subscribing to live feed')
        }

        return {
          name: filter.channel === 'trade' ? 'trades' : filter.channel,
          markets: filter.symbols
        }
      })

    const snapshotRequests = (filters.find(({ channel }) => channel === 'getBook')?.symbols ?? []).map((symbol) => ({
      action: 'getBook',
      requestId: this.nextRequestId++,
      market: symbol,
      depth: 1000
    }))

    return [...(channels.length === 0 ? [] : [{ action: 'subscribe', channels }]), ...snapshotRequests]
  }

  protected async onConnected() {
    const { key, secret } = this.getCredentials()
    const timestamp = Date.now()
    const signature = crypto.createHmac('sha256', secret).update(`${timestamp}GET/v2/websocket`).digest('hex')

    let resolveAuthentication!: () => void
    let rejectAuthentication!: (error: Error) => void
    const authenticationResponse = new Promise<void>((resolve, reject) => {
      resolveAuthentication = resolve
      rejectAuthentication = reject
    })
    const pendingAuthentication = {
      resolve: resolveAuthentication,
      reject: rejectAuthentication
    }
    this.pendingAuthentication = pendingAuthentication

    const timeout = setTimeout(() => {
      pendingAuthentication.reject(new Error('Bitvavo Market Data Pro authentication timed out'))
    }, 10000)

    this.send({ action: 'authenticate', key, signature, timestamp })

    try {
      await authenticationResponse
    } finally {
      clearTimeout(timeout)
      if (this.pendingAuthentication === pendingAuthentication) {
        this.pendingAuthentication = undefined
      }
    }
  }

  protected onMessage(message: BitvavoRealtimeMessage) {
    if (message.event !== 'authenticate') {
      return
    }

    if (message.authenticated === true) {
      this.pendingAuthentication?.resolve()
    } else {
      this.pendingAuthentication?.reject(new Error('Bitvavo Market Data Pro authentication failed'))
    }
  }

  protected messageIsError(message: BitvavoRealtimeMessage) {
    const isError = message.event === 'error' || message.error !== undefined
    if (isError) {
      this.pendingAuthentication?.reject(new Error(`Bitvavo Market Data Pro error: ${JSON.stringify(message)}`))
    }
    return isError
  }

  private getCredentials() {
    const key = process.env.BITVAVO_API_KEY
    const secret = process.env.BITVAVO_API_SECRET
    if (key === undefined || secret === undefined) {
      throw new Error('BitvavoRealTimeFeed requires BITVAVO_API_KEY and BITVAVO_API_SECRET environment variables')
    }
    return { key, secret }
  }
}

type BitvavoRealtimeMessage = {
  event?: string
  authenticated?: boolean
  error?: unknown
}
