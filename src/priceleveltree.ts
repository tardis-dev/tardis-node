import { BookPriceLevel, Writeable } from './types.ts'

const PAGE_CAPACITY = 64
const PAGE_MERGE_THRESHOLD = PAGE_CAPACITY >>> 2

class PriceLevelPage {
  public readonly levels: Writeable<BookPriceLevel>[] = []
  public count = 0
}

export class PriceLevelTree {
  private _pages: PriceLevelPage[] = []

  constructor(private readonly _direction: 1 | -1) {}

  public clear() {
    this._pages = []
  }

  public upsert(data: BookPriceLevel) {
    if (this._pages.length === 0) {
      const page = new PriceLevelPage()
      page.levels[0] = { ...data }
      page.count = 1
      this._pages.push(page)
      return
    }

    const pageIndex = this._findPageIndex(data.price)
    const page = this._pages[pageIndex]
    const levelIndex = this._findLevelIndex(page, data.price)
    const existing = page.levels[levelIndex]

    if (existing !== undefined && existing.price === data.price) {
      existing.amount = data.amount
      return
    }

    const storedData = { ...data }
    if (page.count < PAGE_CAPACITY) {
      insertIntoPage(page, levelIndex, storedData)
      return
    }

    const splitIndex = PAGE_CAPACITY >>> 1
    const rightPage = new PriceLevelPage()
    for (let index = splitIndex; index < PAGE_CAPACITY; index++) {
      rightPage.levels[rightPage.count++] = page.levels[index]
    }
    page.levels.length = splitIndex
    page.count = splitIndex
    this._pages.splice(pageIndex + 1, 0, rightPage)

    if (levelIndex <= splitIndex) {
      insertIntoPage(page, levelIndex, storedData)
    } else {
      insertIntoPage(rightPage, levelIndex - splitIndex, storedData)
    }
  }

  public remove(data: BookPriceLevel) {
    if (this._pages.length === 0) {
      return false
    }

    const pageIndex = this._findPageIndex(data.price)
    const page = this._pages[pageIndex]
    const levelIndex = this._findLevelIndex(page, data.price)
    const existing = page.levels[levelIndex]

    if (existing === undefined || existing.price !== data.price) {
      return false
    }

    removeFromPage(page, levelIndex)
    if (page.count === 0) {
      this._pages.splice(pageIndex, 1)
    } else if (page.count <= PAGE_MERGE_THRESHOLD) {
      this._mergePage(pageIndex)
    }

    return true
  }

  public iterator() {
    return new PriceLevelTreeIterator(this._pages)
  }

  private _findPageIndex(price: number) {
    let low = 0
    let high = this._pages.length

    while (low < high) {
      const middle = (low + high) >>> 1
      const page = this._pages[middle]
      const lastLevel = page.levels[page.count - 1]!
      if (this._comparePrices(lastLevel.price, price) < 0) {
        low = middle + 1
      } else {
        high = middle
      }
    }

    return low === this._pages.length ? low - 1 : low
  }

  private _findLevelIndex(page: PriceLevelPage, price: number) {
    let low = 0
    let high = page.count

    while (low < high) {
      const middle = (low + high) >>> 1
      if (this._comparePrices(page.levels[middle]!.price, price) < 0) {
        low = middle + 1
      } else {
        high = middle
      }
    }

    return low
  }

  private _comparePrices(priceA: number, priceB: number) {
    return this._direction * (priceA - priceB)
  }

  private _mergePage(pageIndex: number) {
    const page = this._pages[pageIndex]
    const previousPage = pageIndex > 0 ? this._pages[pageIndex - 1] : undefined
    const nextPage = pageIndex + 1 < this._pages.length ? this._pages[pageIndex + 1] : undefined
    const canMergePrevious = previousPage !== undefined && previousPage.count + page.count <= PAGE_CAPACITY
    const canMergeNext = nextPage !== undefined && page.count + nextPage.count <= PAGE_CAPACITY

    if (canMergePrevious && (!canMergeNext || previousPage!.count <= nextPage!.count)) {
      appendPage(previousPage!, page)
      this._pages.splice(pageIndex, 1)
    } else if (canMergeNext) {
      appendPage(page, nextPage!)
      this._pages.splice(pageIndex + 1, 1)
    }
  }
}

class PriceLevelTreeIterator {
  private _pageIndex = 0
  private _levelIndex = 0

  constructor(private readonly _pages: readonly PriceLevelPage[]) {}

  public next() {
    while (this._pageIndex < this._pages.length) {
      const page = this._pages[this._pageIndex]
      if (this._levelIndex < page.count) {
        return page.levels[this._levelIndex++]!
      }

      this._pageIndex++
      this._levelIndex = 0
    }

    return null
  }
}

function insertIntoPage(page: PriceLevelPage, index: number, data: Writeable<BookPriceLevel>) {
  for (let current = page.count; current > index; current--) {
    page.levels[current] = page.levels[current - 1]
  }
  page.levels[index] = data
  page.count++
}

function removeFromPage(page: PriceLevelPage, index: number) {
  page.count--
  for (let current = index; current < page.count; current++) {
    page.levels[current] = page.levels[current + 1]
  }
  page.levels.pop()
}

function appendPage(target: PriceLevelPage, source: PriceLevelPage) {
  for (let index = 0; index < source.count; index++) {
    target.levels[target.count + index] = source.levels[index]
  }
  target.count += source.count
  source.levels.length = 0
  source.count = 0
}
