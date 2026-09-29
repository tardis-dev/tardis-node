export function getMessageParser(exchange: string): (message: string) => any {
  switch (exchange) {
    case 'bitvavo':
      return parseBitvavoMessage
    case 'huobi-dm':
    case 'huobi-dm-swap':
    case 'huobi-dm-linear-swap':
    case 'huobi-dm-options':
      return parseHuobiMessage
    case 'bithumb':
    case 'upbit':
      return parseSequentialIdMessage
    default:
      return JSON.parse
  }
}

function parseBitvavoMessage(message: string) {
  // Trades use timestampNs; book updates and getBook snapshots use timestamp.
  // Quote only nanoseconds (19 digits), leaving millisecond trade timestamps numeric.
  return JSON.parse(message.replace(/"(timestampNs|timestamp)":([0-9]{19})/g, '"$1":"$2"'))
}

function parseHuobiMessage(message: string) {
  if (message.includes('.trade.detail')) {
    message = message.replace(/"id":([0-9]+),/g, '"id":"$1",')
  }
  return JSON.parse(message)
}

function parseSequentialIdMessage(message: string) {
  return JSON.parse(message.replace(/"sequential_id":([0-9]+),/g, '"sequential_id":"$1",'))
}
