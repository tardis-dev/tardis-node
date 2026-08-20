type PendingRead<T> = {
  resolve: (result: IteratorResult<T>) => void
  reject: (error: Error) => void
}

type PendingWrite<T> = {
  value: T
  resolve: (written: boolean) => void
}

export class BoundedQueue<T> {
  private readonly values: (T | undefined)[]
  private readIndex = 0
  private size = 0
  private pendingWrites: PendingWrite<T>[] = []
  private pendingRead?: PendingRead<T>
  private failure?: Error
  private open = true

  constructor(private readonly capacity: number) {
    this.values = new Array(capacity)
  }

  get isOpen() {
    return this.open
  }

  write(value: T): boolean | Promise<boolean> {
    if (!this.open) {
      return false
    }

    if (this.pendingRead !== undefined) {
      const { resolve } = this.pendingRead
      this.pendingRead = undefined
      resolve({ done: false, value })
      return true
    }

    if (this.size < this.capacity) {
      this.values[(this.readIndex + this.size) % this.capacity] = value
      this.size++
      return true
    }

    return new Promise((resolve) => this.pendingWrites.push({ value, resolve }))
  }

  async next(): Promise<IteratorResult<T>> {
    if (this.size > 0) {
      const value = this.values[this.readIndex] as T
      this.values[this.readIndex] = undefined
      this.readIndex = (this.readIndex + 1) % this.capacity
      this.size--
      const pendingWrite = this.pendingWrites.shift()
      if (pendingWrite !== undefined) {
        this.values[(this.readIndex + this.size) % this.capacity] = pendingWrite.value
        this.size++
        pendingWrite.resolve(true)
      }
      return { done: false, value }
    }

    if (this.failure !== undefined) {
      throw this.failure
    }

    if (!this.open) {
      return { done: true, value: undefined }
    }

    return new Promise((resolve, reject) => {
      this.pendingRead = { resolve, reject }
    })
  }

  finish() {
    if (!this.open) {
      return
    }

    this.open = false
    this.pendingRead?.resolve({ done: true, value: undefined })
    this.pendingRead = undefined
  }

  fail(error: Error) {
    if (!this.open) {
      return
    }

    this.failure = error
    this.stop(error)
  }

  close() {
    this.stop()
  }

  private stop(error?: Error) {
    this.open = false
    this.values.fill(undefined)
    this.readIndex = 0
    this.size = 0
    for (const { resolve } of this.pendingWrites) {
      resolve(false)
    }
    this.pendingWrites = []
    if (this.pendingRead !== undefined) {
      if (error === undefined) {
        this.pendingRead.resolve({ done: true, value: undefined })
      } else {
        this.pendingRead.reject(error)
      }
      this.pendingRead = undefined
    }
  }
}
