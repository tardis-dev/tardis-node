import { httpClient } from './handy'
import { getOptions } from './options'
import { Exchange, FilterForExchange } from './types'

export async function getExchangeDetails<T extends Exchange>(exchange: T) {
  const options = getOptions()

  const exchangeDetails = await httpClient.get(`${options.endpoint}/exchanges/${exchange}`).json()

  return exchangeDetails as ExchangeDetails<T>
}

export type SymbolType = 'spot' | 'future' | 'perpetual' | 'option'

export type Stats = {
  trades: number
  bookChanges: number
}

export type DatasetType = 'trades' | 'incremental_book_L2' | 'quotes' | 'derivative_ticker' | 'options_chain'

type Datasets = {
  dataTypes: DatasetType[]
  formats: ['csv']
  exportedFrom: Date
  exportedUntil: Date
  stats: Stats
  symbols: {
    id: string
    type: SymbolType
    availableSince: string
    availableTo: string
    stats: Stats
  }[]
}

export type ExchangeDetailsBase<T extends Exchange> = {
  id: T
  name: string
  filterable: boolean
  enabled: boolean
  availableSince: string

  availableChannels: FilterForExchange[T]['channel'][]

  availableSymbols: {
    id: string
    type: SymbolType
    availableSince: string
    availableTo?: string
    name?: string
  }[]

  incidentReports: {
    from: string
    to: string
    status: 'resolved' | 'wontfix'
    details: string
  }
}

type ExchangeDetails<T extends Exchange> =
  | (ExchangeDetailsBase<T> & { supportsDatasets: false })
  | (ExchangeDetailsBase<T> & { supportsDatasets: true; datasets: Datasets })
