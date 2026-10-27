import { existsSync } from 'node:fs'
import { debug } from './debug.ts'
import { DatasetType } from './exchangedetails.ts'
import { forEachConcurrent } from './foreachconcurrent.ts'
import { addDays, doubleDigit, downloadDatasetFile, parseAsUTCDate, RequestSlots, sequence } from './handy.ts'
import { getOptions } from './options.ts'
import { Exchange } from './types.ts'

const DEFAULT_CONCURRENCY = 20
const MILLISECONDS_IN_SINGLE_DAY = 24 * 60 * 60 * 1000
const DEFAULT_DOWNLOAD_DIR = './datasets'
const DATASET_DOWNLOAD_ATTEMPT_TIMEOUT_MS = 120_000

export async function downloadDatasets(downloadDatasetsOptions: DownloadDatasetsOptions) {
  const options = getOptions()
  const { exchange, dataTypes, from, to, symbols } = downloadDatasetsOptions
  const apiKey = downloadDatasetsOptions.apiKey !== undefined ? downloadDatasetsOptions.apiKey : options.apiKey
  const downloadDir = downloadDatasetsOptions.downloadDir !== undefined ? downloadDatasetsOptions.downloadDir : DEFAULT_DOWNLOAD_DIR
  const format = downloadDatasetsOptions.format !== undefined ? downloadDatasetsOptions.format : 'csv'
  const getFilename = downloadDatasetsOptions.getFilename !== undefined ? downloadDatasetsOptions.getFilename : getFilenameDefault
  const skipIfExists = downloadDatasetsOptions.skipIfExists === undefined ? true : downloadDatasetsOptions.skipIfExists
  const verifyMd5 = downloadDatasetsOptions.verifyMd5 === true
  const concurrency = downloadDatasetsOptions.concurrency !== undefined ? downloadDatasetsOptions.concurrency : DEFAULT_CONCURRENCY

  if (concurrency < 1) {
    throw new Error('Invalid "concurrency" argument. Please provide value greater than 0.')
  }

  const requestSlots = new RequestSlots(concurrency)

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
            datasetsEndpoint: options.datasetsEndpoint,
            userAgent: options._userAgent,
            downloadDir,
            dataType,
            format,
            getFilename,
            verifyMd5,
            date: addDays(startDate, daysCountToFetch - 1)
          }),
          skipIfExists,
          requestSlots
        )
      }

      // then download the first day of the range, validates is API key has access to the start range of requested data
      await downloadDataSet(
        getDownloadOptions({
          exchange,
          symbol,
          apiKey,
          datasetsEndpoint: options.datasetsEndpoint,
          userAgent: options._userAgent,
          downloadDir,
          dataType,
          format,
          getFilename,
          verifyMd5,
          date: startDate
        }),
        skipIfExists,
        requestSlots
      )

      // download the rest concurrently up to the concurrency limit
      await forEachConcurrent(
        sequence(daysCountToFetch - 1, 1), // this will produce Iterable sequence from 1 to daysCountToFetch - 1 (as we already downloaded data for the first and last day)
        concurrency,
        (offset) =>
          downloadDataSet(
            getDownloadOptions({
              exchange,
              symbol,
              apiKey,
              datasetsEndpoint: options.datasetsEndpoint,
              userAgent: options._userAgent,
              downloadDir,
              dataType,
              format,
              getFilename,
              verifyMd5,
              date: addDays(startDate, offset)
            }),
            skipIfExists,
            requestSlots
          )
      )
      const elapsedSeconds = (new Date().valueOf() - startTimestamp) / 1000

      debug('dataset download finished for %s %s %s from %s to %s, time: %s seconds', exchange, dataType, symbol, from, to, elapsedSeconds)
    }
  }
}

async function downloadDataSet(downloadOptions: DownloadOptions, skipIfExists: boolean, requestSlots: RequestSlots) {
  if (skipIfExists && existsSync(downloadOptions.downloadPath)) {
    debug('dataset %s already exists, skipping download', downloadOptions.downloadPath)
    return
  } else {
    return await downloadDatasetFile({ ...downloadOptions, requestSlots })
  }
}

function getDownloadOptions({
  apiKey,
  datasetsEndpoint,
  userAgent,
  exchange,
  dataType,
  date,
  symbol,
  format,
  downloadDir,
  getFilename,
  verifyMd5
}: {
  exchange: Exchange
  dataType: DatasetType
  symbol: string
  date: Date
  format: string
  apiKey: string
  datasetsEndpoint: string
  userAgent: string
  downloadDir: string
  getFilename: (options: GetFilenameOptions) => string
  verifyMd5: boolean
}): DownloadOptions {
  const year = date.getUTCFullYear()
  const month = doubleDigit(date.getUTCMonth() + 1)
  const day = doubleDigit(date.getUTCDate())

  const url = `${datasetsEndpoint}/${exchange}/${dataType}/${year}/${month}/${day}/${encodeURIComponent(symbol)}.${format}.gz`
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
    userAgent,
    apiKey,
    attemptTimeoutMS: DATASET_DOWNLOAD_ATTEMPT_TIMEOUT_MS,
    verifyMd5
  }
}

type DownloadOptions = Omit<Parameters<typeof downloadDatasetFile>[0], 'requestSlots'>

export function sanitizeForFilename(s: string) {
  return s.replace(/[:\\/?*<>|"]/g, '-')
}

function getFilenameDefault({ exchange, dataType, format, date, symbol }: GetFilenameOptions) {
  return `${exchange}_${dataType}_${date.toISOString().split('T')[0]}_${sanitizeForFilename(symbol)}.${format}.gz`
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
  verifyMd5?: boolean
  concurrency?: number
}
