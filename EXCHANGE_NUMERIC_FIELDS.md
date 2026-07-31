# Exchange Numeric Field Mapping

Use the exchange contract for each field before choosing a parser. The key question is whether `0` is a real market value or an exchange placeholder for no value.

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
