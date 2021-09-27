import { getOptions } from './options'
import type { SymbolType } from './exchangedetails'
import type { Exchange } from './types'
import { httpClient } from './handy'

export async function getInstrumentInfo(exchange: Exchange): Promise<InstrumentInfo[]>
export async function getInstrumentInfo(exchange: Exchange | Exchange[], filter: InstrumentInfoFilter): Promise<InstrumentInfo[]>
export async function getInstrumentInfo(exchange: Exchange, symbol: string): Promise<InstrumentInfo>

export async function getInstrumentInfo(exchange: Exchange | Exchange[], filterOrSymbol?: InstrumentInfoFilter | string) {
  if (Array.isArray(exchange)) {
    const exchanges = exchange
    const results = await Promise.all(exchanges.map((e) => getInstrumentInfoForExchange(e, filterOrSymbol)))

    return results.flat()
  } else {
    return getInstrumentInfoForExchange(exchange, filterOrSymbol)
  }
}

async function getInstrumentInfoForExchange(exchange: Exchange, filterOrSymbol?: InstrumentInfoFilter | string) {
  const options = getOptions()

  let url = `${options.endpoint}/instruments/${exchange}`
  if (typeof filterOrSymbol === 'string') {
    url += `/${filterOrSymbol}`
  } else if (typeof filterOrSymbol === 'object') {
    url += `?filter=${encodeURIComponent(JSON.stringify(filterOrSymbol))}`
  }

  try {
    return await httpClient
      .get(url, {
        headers: { Authorization: `Bearer ${options.apiKey}` }
      })
      .json()
  } catch (e: any) {
    // expose 400 error message from server
    if (e.response?.statusCode === 400) {
      let err: { code: Number; message: string }
      try {
        err = JSON.parse(e.response.body)
      } catch {
        throw e
      }

      throw err ? new Error(`${err.message} (${err.code})`) : e
    } else {
      throw e
    }
  }
}

type InstrumentInfoFilter = {
  baseCurrency?: string | string[]
  quoteCurrency?: string | string[]
  type?: SymbolType | SymbolType[]
  contractType?: ContractType | ContractType[]
  active?: boolean
}

export type ContractType =
  | 'move'
  | 'linear_future'
  | 'inverse_future'
  | 'quanto_future'
  | 'linear_perpetual'
  | 'inverse_perpetual'
  | 'quanto_perpetual'
  | 'put_option'
  | 'call_option'
  | 'turbo_put_option'
  | 'turbo_call_option'
  | 'spread'
  | 'interest_rate_swap'
  | 'repo'
  | 'index'

export interface InstrumentInfo {
  /** symbol id */
  id: string
  /** exchange id */
  exchange: string
  /** normalized, so for example bitmex XBTUSD has base currency set to BTC not XBT */
  baseCurrency: string
  /** normalized, so for example bitfinex BTCUST has quote currency set to USDT, not UST */
  quoteCurrency: string
  type: SymbolType
  /** indicates if the instrument can currently be traded. */
  active: boolean
  /** date in ISO format */
  availableSince: string
  /** date in ISO format */
  availableTo?: string
  /** in ISO format, only for futures and options */
  expiry?: string
  /** price tick size, price precision can be calculated from it */
  priceIncrement: number
  /** amount tick size, amount/size precision can be calculated from it */
  amountIncrement: number
  /** min order size */
  minTradeAmount: number
  /** consider it as illustrative only, as it depends in practice on account traded volume levels, different categories, VIP levels, owning exchange currency etc */
  makerFee: number
  /** consider it as illustrative only, as it depends in practice on account traded volume levels, different categories, VIP levels, owning exchange currency etc */
  takerFee: number
  /** only for derivatives */
  inverse?: boolean
  /** only for derivatives */
  contractMultiplier?: number
  /** only for quanto instruments */
  quanto?: boolean
  /**  only for quanto instruments as settlement currency is different base/quote currency */
  settlementCurrency?: string
  /** strike price, only for options */
  strikePrice?: number
  /** option type, only for options */
  optionType?: 'call' | 'put'
  /** date in ISO format */
  changes?: {
    until: string
    priceIncrement?: number
    amountIncrement?: number
    contractMultiplier?: number
  }[]
}
