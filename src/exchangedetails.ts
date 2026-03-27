import { getJSON } from './handy.ts'
import { getOptions } from './options.ts'
import { Exchange, FilterForExchange } from './types.ts'

export async function getExchangeDetails<T extends Exchange>(exchange: T) {
  const options = getOptions()

  const { data } = await getJSON(`${options.endpoint}/exchanges/${exchange}`)

  return data as ExchangeDetails<T>
}

export type SymbolType = 'spot' | 'future' | 'perpetual' | 'option' | 'combo'

export type DatasetType =
  | 'trades'
  | 'incremental_book_L2'
  | 'quotes'
  | 'derivative_ticker'
  | 'options_chain'
  | 'book_snapshot_25'
  | 'book_snapshot_5'
  | 'liquidations'
  | 'book_ticker'

export type Stats = {
  trades: number
  bookChanges: number
}

type Datasets = {
  formats: ['csv']
  exportedFrom: string
  exportedUntil: string
  stats: Stats
  symbols: {
    id: string
    type: SymbolType
    availableSince: string
    availableTo?: string
    dataTypes: DatasetType[]
  }[]
}

type ChannelDetails = {
  name: string
  description: string
  frequency: string
  frequencySource: string
  exchangeDocsUrl?: string
  sourceFor?: string[]
  availableSince: string
  availableTo?: string
  apiVersion?: string
  additionalInfo?: string
  generated?: true
}

type DataCenter = {
  host: string
  regionId: string
  location: string
}

type DataCollectionDetails = {
  recorderDataCenter: DataCenter
  recorderDataCenterChanges?: {
    until: string
    dataCenter: DataCenter
  }[]
  wssConnection?: {
    url: string
    apiVersion?: string
    proxiedViaCloudflare?: boolean
  }
  wssConnectionChanges?: {
    until: string
    url?: string
    apiVersion?: string
    proxiedViaCloudflare?: boolean
  }[]
  exchangeDataCenter?: DataCenter
  exchangeDataCenterChanges?: {
    until: string
    dataCenter: DataCenter
  }[]
}

export type ExchangeDetailsBase<T extends Exchange> = {
  id: T
  name: string
  enabled: boolean
  delisted?: boolean
  availableSince: string
  availableTo?: string

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
    status: 'resolved' | 'wontfix' | 'unresolved'
    details: string
  }[]

  channelDetails: ChannelDetails[]
  apiDocsUrl?: string
  dataCollectionDetails?: DataCollectionDetails
  datasets: Datasets
}

type ExchangeDetails<T extends Exchange> = ExchangeDetailsBase<T>
