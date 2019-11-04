import got from 'got'
import { getOptions } from './options'
import { Exchange, FilterForExchange } from './types'

export async function getExchangeDetails<T extends Exchange>(exchange: T) {
  const options = getOptions()
  const exchangeDetails = await got.get(`${options.endpoint}/exchanges/${exchange}`).json()

  return exchangeDetails as ExchangeDetails<T>
}

export type ExchangeDetails<T extends Exchange> = {
  id: T
  name: string
  enabled: boolean
  filterable: boolean
  availableSince: string
  availableSymbols: {
    id: string
    type: 'spot' | 'future' | 'perpetual' | 'option'
    availableSince: string
    availableTo?: string
  }[]
  availableChannels: FilterForExchange[T]['channel'][]
  incidentReports: {
    from: string
    to: string
    status: string
    details: string
  }
}
