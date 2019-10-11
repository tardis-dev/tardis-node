import { DataType, MessageForDataType } from '../types'

export type Computable<T, U extends DataType> = {
  readonly name: string
  readonly sourceDataType: U

  update(message: MessageForDataType[U]): void

  hasNewSample(timestamp: Date): boolean

  getSample(timestamp: Date): T
}
