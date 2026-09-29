# Exchange Numeric Field Mapping

Use the exchange contract for each field before choosing a parser. The key question is whether `0` is a real market value or an exchange placeholder for no value.

## Preserve Precision Before Mapping

Integers above `Number.MAX_SAFE_INTEGER` can lose digits during `JSON.parse`, before a mapper runs. The shared [message parser](src/parsemessage.ts) preserves affected IDs and timestamps as strings in both replay and real-time feeds. It is selected once per feed; exchanges without precision fixes use `JSON.parse` directly.

Bitvavo Market Data Pro uses different units for the same field name:

| Message                                                                                | Field                | Unit         | Decoded value |
| -------------------------------------------------------------------------------------- | -------------------- | ------------ | ------------- |
| [Trade](https://docs.bitvavo.com/docs/ws-market-data-pro-api/trades-subscription/)     | `timestamp`          | milliseconds | number        |
| Trade                                                                                  | `timestampNs`        | nanoseconds  | string        |
| [Book update](https://docs.bitvavo.com/docs/ws-market-data-pro-api/book-subscription/) | `timestamp`          | nanoseconds  | string        |
| [Get order book](https://docs.bitvavo.com/docs/ws-market-data-pro-api/get-order-book/) | `response.timestamp` | nanoseconds  | string        |

The Bitvavo parser quotes only 19-digit values in these timestamp fields. The mapper removes the last three digits, then converts the remaining microseconds to a number. Millisecond trade timestamps remain numeric. `replay({ skipDecoding: true })` preserves the original message bytes.

## Parser Choices

| Case                                | Parser                              | Use when                                                                                              |
| ----------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Required numeric field              | `Number(value)`                     | The exchange contract requires the field and invalid data should be visible during testing/debugging. |
| Optional numeric field, `0` valid   | `asNumberOrUndefined(value)`        | Missing/null/empty/non-finite values map to `undefined`, but `0` must be emitted or cached.           |
| Optional numeric field, `0` invalid | `asNonZeroNumberOrUndefined(value)` | Missing/null/empty/non-finite values and `0` map to `undefined`.                                      |

`asNonZeroNumberOrUndefined` is mainly for exchanges that encode an absent quote/top-of-book value as zero.

## Stateful Mapper Note

`PendingTickerInfoHelper` update methods ignore `undefined`. When a cached field can legitimately change to zero, use `asNumberOrUndefined` so the zero clears the previous non-zero value:

```ts
pendingTickerInfo.updateFundingRate(asNumberOrUndefined(message.data.fundingRate))
pendingTickerInfo.updateOpenInterest(asNumberOrUndefined(message.data.openInterest))
```
