import { Mapper } from './mapper'
import { DeribitMapper } from './deribit'
import { BitmexMapper } from './bitmex'
// import { OkexMapper } from './okex'
// import { BitfinexMapper, BitfinexDerivativesMapper } from './bitfinex'
// import { BinanceMapper, BinanceFuturesMapper } from './binance'
// import { BinanceDexMapper } from './binancedex'
import { Exchange } from '../types'

export { Mapper } from './mapper'

const exchangeMapperMap: {
  [key in Exchange]?: new () => Mapper
} = {
  deribit: DeribitMapper,
  bitmex: BitmexMapper
  // okex: OkexMapper,
  // bitfinex: BitfinexMapper,
  // 'bitfinex-derivatives': BitfinexDerivativesMapper,
  // binance: BinanceMapper,
  // 'binance-us': BinanceMapper,
  // 'binance-jersey': BinanceMapper,
  // 'binance-dex': BinanceDexMapper,
  // 'binance-futures': BinanceFuturesMapper
}

export function getMapperFactory(exchange: Exchange): new () => Mapper {
  if (exchangeMapperMap[exchange]) {
    return exchangeMapperMap[exchange]!
  }

  throw new Error(`not supported exchange ${exchange}`)
}

export function createMapper(exchange: Exchange) {
  const MapperClass = getMapperFactory(exchange)

  return new MapperClass()
}

export function setMapperFactory(exchange: Exchange, mapper: new () => Mapper) {
  exchangeMapperMap[exchange] = mapper
}

// mama zadzwonic
//3 coinbase nie ma quotes - moge dodac
//4 bitflyer - nie ma quotes - moge dodac
//5 ftx - nie ma quotes i ticker'a
//6 gemini - nie ma quotes i ticker
//7 cryptofacilities - nie ma quotes - moge dodac
//8 kraken - ma wszystko
//2 bitstamp: nie ma ticker i quotes moge dodac

// testy
//--
// uzyc deoptigate
//2 - przekazuje referencje do order book, jesli zasubskrybowalem?
// dodac alias dla quotes? book_1
// testy dla order book
// primitive data types: 'trade', 'book', 'derivative_info'
// derived data types:
// book_1 - alias quote
// book_10
// bar_time_10s
// bar_volume_1mil
//---
// tardis client rozdziela typy na native i derived
// native types przekazuje do mapper'a ktory mapuje sobie jak zwykle
// mapper dla jednego typu moze subskrybowac do wielu channels
// dla tych roznych channels zwraca native data type
// a w funkcji map sprawdza jaki byl konkretnie message i jesli trzeba to publikuje zmiane,
// mam cos takiego jak pending Deriv_Info i isDirty i wtedy odpalam? moze i tak
//
//--

// tardis client umie tworzyc top_levels i je zwracac przy uzyciu order booka
// kazdy _bar ma odpowiadajacy PendingBar ktory sie aktualizuje przy kazdym trejdzie i ewentualnie yielduje

// 1.- implementacja order book
// 2.- implementacja Bar
// --
// implementacja w tardis client pozostalych typow
//
// quotes
// trades
// l2change
// OHLC
// ticker
// vwap
//--
// CSV
// -
// cryptoti
//4 - bitmex testy
//3 -deribit testy

//5- bitfinex testy
// binance dex testy

// ----------
// - cwiczenia
// - dentysta
// - ksiegowosc wyslac
// samochod oleje
// nowe data_types: bar_time_1m, bar_vol_1mil

// prostszy cennik ? 1 symbol 18$, full feed 180$, prosty layout, plus wypisane co jest za darmo!

//--- vwap? jak obliczaC?
// - bitstamp
// - coinbase
// - bitflyer
// - ftx
// - gemini
// - cryptofacilities
// - kraken

// dodac referal program page + paddle remove query strings, Paddle.Spinner.show() zamiast krecioly przy buttonie
// live client i snapshots? jak?

//--------------
// dodac darmowy dostep do trades data, ostatnie 30 dni?
// - dodac live client?
// dodac do tardis client  bars, volume etc, i pokazac na live i historical data
// replayOHLC(aggegateBy='time',period:'' ) aggregateBy'volume' ? czy po prostu dodac obiekt Bar ktory moze emitowac nowe bars, albo tez nie skonczone?
// mam w srodku implementacje OHLC ktora produkuje takie dane na podstawie trejdow?
//----------

// https://stackoverflow.com/questions/57991432/what-is-the-fastest-way-to-do-array-table-lookup-with-an-integer-index/57992274#57992274
// telegram group vs user?
// testy dla kazdej z nowych metod
// musze tak przerobic filters http service zebym mogl z nich korzystac uzywacac tardis-client
// --

// ----
//website: uzyc selecr, w exchanges api dodac typ dla kazdego symbolu: future, option, swap, spot
// do tardis-machine dodac ws-live handling
// python - improve error handling and retries? review
// python dla binance dodac book ticker, dla okex index/ticker - dodac tez do tardis-api, tak samo binance-us
// python broken pipe error
// python usunac przyklad dot bitmex normalization? czy zostawic?
// python ndjson handling? example with tardis-machine and normalized data? tak normalized data, paging per day? bez ndjson? albo zakladam ze ktos sobie sciagnie csv

// docs:
// napisac blog posta na substack o nowym kliencie? i ten post promowac?
// w api section na stronie dodac sekcje live data!
// kazdy client ma osobna strone, usunac api z readme
// removed raw, jest flaga decode
// nowe metody plus przyklady
// doac info o getExchangedetails
// docs dodac przyklad jak sprawdzac przerwy w danych, tzn disconnects i czas pomiedzy
// dodac sekcje ktora opisuje ktory tryb pobierania danych wybrac
// przyklad z order book reconstruction
// przyklad z tickerami
// przyklad z zapisem do csv
// zrobic ficzer z tego ze nie trzeba uzywac czegos 3rd party dla live data, i ze jest to darmowe i dziala przez docker'a, automatyczny reconnect handling, nie wymaga zadnych subskrybcji
// open source, no vendor lock-in
// status page na podstawie stackdriver
// dodac przyklad dodawanie nowego data type
// dodac przyklad rozszerzanie trejda deribit o dodatkowe info
// dodac local fix proxy ? https://gitlab.com/logotype/fixparser, mogloby tlumaczyc z WS na FIX?

// private _streamRealtime<T extends DataType | DataType[], Z extends boolean = false>(
//   { exchange, symbols, returnDisconnectsAsUndefined = undefined }: LiveStreamOptions<Z>,
//   dataTypes: T
// ) {
//   // setInterval ktory sprawdza kiedy ostatni message byl odebrany-> opcjonalnie?

//   const mapper = getMapper(exchange)
//   const dateTypes = (Array.isArray(dataTypes) ? dataTypes : [dataTypes]) as DataType[]

//   // const subscribeMessage = mapper.getSubscribeMessage(dateTypes, symbols)
//   // mam cos takiego jak feeds i kazdy feed wie jak zmapowac z filters do subsribe message
//   // niektory exchnages musza dodatkowo pobierac snapshots, dodatkowo binance przez url
//   // kazdy exchange musi miec url
//   // musze miec dodatkowo cos jak feed?
//   // inicjalizuje odpowieni mapper
//   // robieSubscribe
//   // TODO: obsluga bledow, jak?
//   // TODO: obsluga restartow
//   // TODO: dodac setimeout - no data?
// }

// export type LiveStreamOptions<Z extends boolean = false> = {
//   exchange: Exchange
//   symbols?: string[]
//   returnDisconnectsAsUndefined?: Z
// }
