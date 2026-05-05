# Exchange Numeric Field Mapping

Use the exchange contract for each field before choosing a parser. The key question is whether `0` is a real market value for that field or an exchange placeholder for no value.

## Parser Choices

| Case                                | Parser                       | Use when                                                                                              |
| ----------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| Required numeric field              | `Number(value)`              | The exchange contract requires the field and invalid data should be visible during testing/debugging. |
| Optional numeric field, `0` valid   | `asNumberOrUndefined(value)` | Missing/null/empty/non-finite values map to `undefined`, but `0` must be emitted or cached.           |
| Optional numeric field, `0` invalid | `asNumberIfValid(value)`     | Missing/null/empty/non-finite values and `0` map to `undefined`.                                      |

`asNumberIfValid` is mainly for exchanges that encode an absent quote/top-of-book value as zero.

## Common Zero-Valid Fields

Verify against the exchange docs or captured payloads, but these fields commonly preserve zero:

- `openInterest`
- `fundingRate`
- option `markPrice`
- option greeks: `delta`, `gamma`, `theta`, `vega`
- order book level `amount` when `0` means delete this level

## Common Zero-As-Missing Fields

These fields often use zero as a placeholder, especially in ticker or BBO feeds:

- best bid price or amount
- best ask price or amount
- last price, when the exchange documents zero as no last trade
- derivative mark price, when the exchange sends zero before the mark is available

Do not assume this list is universal. If a field is ambiguous, keep it unmapped or use the conservative existing behavior until docs or captured messages prove the intended meaning.

## Stateful Mappers

Be extra careful with `PendingTickerInfoHelper`. Its update methods ignore `undefined`, so parsing a valid `"0"` as `undefined` can leave a previous non-zero value cached and emit stale normalized data.

Example:

```ts
pendingTickerInfo.updateFundingRate(asNumberOrUndefined(message.data.fundingRate))
pendingTickerInfo.updateOpenInterest(asNumberOrUndefined(message.data.openInterest))
```

If either field changes from non-zero to `"0"`, the zero must reach the helper so the cached state is cleared.

## Bullish Example

Bullish `V1TATickerResponse` uses string/null fields for derivatives and options. Observed option payloads can contain valid zero values for `markPrice`, `openInterest`, and greeks, so those fields use `asNumberOrUndefined`.

For derivative `markPrice`, the reviewed live BTC perpetual tick and the public docs showed a positive mark price and did not establish that `"0.0000"` is a valid derivative mark. Keep derivative `markPrice` on `asNumberIfValid` unless Bullish docs or captured derivative payloads prove zero is meaningful for that field.
