import { existsSync } from 'fs-extra'
import pMap from 'p-map'
import { debug } from './debug'
import { DatasetType } from './exchangedetails'
import { addDays, doubleDigit, download, parseAsUTCDate, sequence } from './handy'
import { getOptions } from './options'
import { Exchange } from './types'

const CONCURRENCY_LIMIT = 20
const MILLISECONDS_IN_SINGLE_DAY = 24 * 60 * 60 * 1000
const DEFAULT_DOWNLOAD_DIR = './datasets'

const options = getOptions()

export async function downloadDatasets(downloadDatasetsOptions: DownloadDatasetsOptions) {
  const { exchange, dataTypes, from, to, symbols } = downloadDatasetsOptions
  const apiKey = downloadDatasetsOptions.apiKey !== undefined ? downloadDatasetsOptions.apiKey : options.apiKey
  const downloadDir = downloadDatasetsOptions.downloadDir !== undefined ? downloadDatasetsOptions.downloadDir : DEFAULT_DOWNLOAD_DIR
  const format = downloadDatasetsOptions.format !== undefined ? downloadDatasetsOptions.format : 'csv'
  const getFilename = downloadDatasetsOptions.getFilename !== undefined ? downloadDatasetsOptions.getFilename : getFilenameDefault
  const skipIfExists = downloadDatasetsOptions.skipIfExists === undefined ? true : downloadDatasetsOptions.skipIfExists

  // in case someone provided 'api/exchange' symbol, transform it to symbol that is accepted by datasets API
  const datasetsSymbols = symbols.map((s) => s.replace(/\/|:/g, '-').toUpperCase())

  for (const symbol of datasetsSymbols) {
    for (const dataType of dataTypes) {
      const { daysCountToFetch, startDate } = getDownloadDateRange(downloadDatasetsOptions)
      const startTimestamp = new Date().valueOf()
      debug('dataset download started for %s %s %s from %s to %s', exchange, dataType, symbol, from, to)

      if (daysCountToFetch > 1) {
        // start with downloading last day of the range, validates is API key has access to the end range of requested data
        await downloadDataSet(
          getDownloadOptions({
            exchange,
            symbol,
            apiKey,
            downloadDir,
            dataType,
            format,
            getFilename,
            date: addDays(startDate, daysCountToFetch - 1)
          }),
          skipIfExists
        )
      }

      // then download the first day of the range, validates is API key has access to the start range of requested data
      await downloadDataSet(
        getDownloadOptions({
          exchange,
          symbol,
          apiKey,
          downloadDir,
          dataType,
          format,
          getFilename,
          date: startDate
        }),
        skipIfExists
      )

      // download the rest concurrently up to the CONCURRENCY_LIMIT
      await pMap(
        sequence(daysCountToFetch - 1, 1), // this will produce Iterable sequence from 1 to daysCountToFetch - 1 (as we already downloaded data for the first and last day)
        (offset) =>
          downloadDataSet(
            getDownloadOptions({
              exchange,
              symbol,
              apiKey,
              downloadDir,
              dataType,
              format,
              getFilename,
              date: addDays(startDate, offset)
            }),
            skipIfExists
          ),
        { concurrency: CONCURRENCY_LIMIT }
      )
      const elapsedSeconds = (new Date().valueOf() - startTimestamp) / 1000

      debug('dataset download finished for %s %s %s from %s to %s, time: %s seconds', exchange, dataType, symbol, from, to, elapsedSeconds)
    }
  }
}

async function downloadDataSet(downloadOptions: DownloadOptions, skipIfExists: boolean) {
  if (skipIfExists && existsSync(downloadOptions.downloadPath)) {
    debug('dataset %s already exists, skipping download', downloadOptions.downloadPath)
  } else {
    return await download(downloadOptions)
  }
}

function getDownloadOptions({
  apiKey,
  exchange,
  dataType,
  date,
  symbol,
  format,
  downloadDir,
  getFilename
}: {
  exchange: Exchange
  dataType: DatasetType
  symbol: string
  date: Date
  format: string
  apiKey: string
  downloadDir: string
  getFilename: (options: GetFilenameOptions) => string
}): DownloadOptions {
  const year = date.getUTCFullYear()
  const month = doubleDigit(date.getUTCMonth() + 1)
  const day = doubleDigit(date.getUTCDate())

  const url = `${options.datasetsEndpoint}/${exchange}/${dataType}/${year}/${month}/${day}/${symbol}.${format}.gz`
  const filename = getFilename({
    dataType,
    date,
    exchange,
    format,
    symbol
  })

  const downloadPath = `${downloadDir}/${filename}`

  return {
    url,
    downloadPath,
    userAgent: options._userAgent,
    apiKey
  }
}

type DownloadOptions = Parameters<typeof download>[0]

function getFilenameDefault({ exchange, dataType, format, date, symbol }: GetFilenameOptions) {
  return `${exchange}_${dataType}_${date.toISOString().split('T')[0]}_${symbol}.${format}.gz`
}

function getDownloadDateRange({ from, to }: DownloadDatasetsOptions) {
  if (!from || isNaN(Date.parse(from))) {
    throw new Error(`Invalid "from" argument: ${from}. Please provide valid date string.`)
  }

  if (!to || isNaN(Date.parse(to))) {
    throw new Error(`Invalid "to" argument: ${to}. Please provide valid date string.`)
  }

  const toDate = parseAsUTCDate(to)
  const fromDate = parseAsUTCDate(from)
  const daysCountToFetch = Math.floor((toDate.getTime() - fromDate.getTime()) / MILLISECONDS_IN_SINGLE_DAY)

  if (daysCountToFetch < 1) {
    throw new Error(`Invalid "to" and "from" arguments combination. Please provide "to" day that is later than "from" day.`)
  }

  return {
    startDate: fromDate,
    daysCountToFetch
  }
}

type GetFilenameOptions = {
  exchange: Exchange
  dataType: DatasetType
  symbol: string
  date: Date
  format: string
}

type DownloadDatasetsOptions = {
  exchange: Exchange
  dataTypes: DatasetType[]
  symbols: string[]
  from: string
  to: string
  format?: 'csv'
  apiKey?: string
  downloadDir?: string
  getFilename?: (options: GetFilenameOptions) => string
  skipIfExists?: boolean
}
