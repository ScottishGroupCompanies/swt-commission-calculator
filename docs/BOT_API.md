# Bot API

Private commission lookup for server-side callers. Sarah's bot sends `Authorization: Bearer <key>`. The browser login is unchanged.

The numbers are the same ones the calculator shows before anyone edits a job in the browser: manager approval off, no list override, French panes at 0. Commission is calculated by `priceSnapshotJob` in [`src/lib/snapshot-price.ts`](../src/lib/snapshot-price.ts), which calls the same `priceJob` rules as the page.

The data is the snapshot baked into the deploy. A quote that the website cannot find returns 404. Commission is calculated on the commissionable amount: window film, film removal, C-Bond, and labor-only install. The 4% fee, travel, mileage, lifts, equipment rental, permits, parking, and other non-film extras are excluded. `quoteAmount` is the full Books quote, including the fee when that line is present.

Base URL: `https://swt-commission-calculator.vercel.app`

## Auth

```http
Authorization: Bearer YOUR_BOT_API_KEY
```

Missing or wrong keys return `401` and `{ "error": "Unauthorized" }`. The key is never written to logs.

Keys are named in the `BOT_API_KEYS` environment variable so each caller shows up under its own name:

```text
BOT_API_KEYS={"sarah-bot":"<long-random-secret>"}
```

Comma-separated `name:key` pairs also work. Names are letters, numbers, `.`, `_`, or `-`. Each secret is 16–256 characters with no spaces. Set the variable on Vercel for Production and Preview. Do not commit it.

Calls are limited to 60 per minute per key, and failed keys to 30 per minute per IP. Over the limit the API returns `429`.

## Look up one job

`GET` or `POST` `/api/v1/commission`.

Identifiers, any one of them:

| Parameter | Matches |
| --- | --- |
| `estimate`, `quote`, or `number` | Estimate number or Zoho quote. `WT-03533` and `WT-03533-QT01` are the same quote. |
| `job` or `jobNumber` | Job number (`F240464`), snapshot id (`WT-02523\|30`), Zoho quote, estimate number, or Books estimate id. Exact match. |
| `jobId` or `id` | Snapshot id only (`WT-02523\|30`). |

```bash
curl -sS \
  -H "Authorization: Bearer YOUR_BOT_API_KEY" \
  "https://swt-commission-calculator.vercel.app/api/v1/commission?estimate=WT-03533-QT01"
```

```bash
curl -sS \
  -H "Authorization: Bearer YOUR_BOT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"estimate":"WT-03533-QT01"}' \
  https://swt-commission-calculator.vercel.app/api/v1/commission
```

```bash
curl -sS \
  -H "Authorization: Bearer YOUR_BOT_API_KEY" \
  "https://swt-commission-calculator.vercel.app/api/v1/commission?job=F240464"
```

One match returns the record. Example shape (WT-03533 is below the 10% floor, so commission is $0):

```json
{
  "estimateNumber": "WT-03533-QT01",
  "quoteNumber": "WT-03533",
  "jobId": "WT-03533|916",
  "jobNumber": "WT-03533",
  "customer": "Robert Helibrun",
  "rep": "Dana Hojnacki",
  "repName": "Dana Hojnacki",
  "repInitials": "DH",
  "status": "invoiced",
  "acceptedDate": "2026-10-12",
  "commissionable": false,
  "reason": "Below the 10% floor. Commission is $0 unless a manager approved this price in writing.",
  "preFeeCharged": 3282,
  "quoteAmount": null,
  "commissionableAmount": 3282,
  "excludedLines": [],
  "discountLines": [],
  "commissionableAmountVerified": true,
  "lineItemsAvailable": true,
  "listAmount": 4555.24,
  "rate": 0.07,
  "undersoldPercent": 27.95,
  "commission": 0,
  "paidByCreditCard": false,
  "creditCardFee": 0,
  "adjustedCommission": 0,
  "commissionBeforeCreditCard": 0,
  "policy": "undersold >=10% needs manager approval",
  "fetchedAt": "2026-11-17T17:50:00Z",
  "dataAsOf": "2026-11-05 12:34 PM MST"
}
```

`fetchedAt` is the later of when the Books estimates were read and when the job list was built. It is the same instant as the calculator label "Zoho Books data as of". `dataAsOf` is the master-sheet timestamp. `rate` is a fraction (`0.05` is 5%) and is null when the salesperson is not an earner. `undersoldPercent` is `(list − commissionable amount) / list` in percent: positive is undersold, negative is over list, null when list is unknown.

`preFeeCharged` and `commissionableAmount` are the same number: the amount the rate is applied to. It includes window film, film removal, C-Bond, and labor-only install, minus discounts. It does not include the 4% fee, travel, lifts, or other non-film extras. `quoteAmount` is the full Books quote total (null on a sheet job that has no Books total stored). `excludedLines` lists each left-out line with `name`, `description`, `amount`, `category`, and `reason`. `reason` is one of `Fee`, `Travel / mileage`, `Lift / equipment`, `Permit / parking`, `Non-film extra`, or `Not classified`.

`discountLines` lists negative discount lines (Over/Short, Discount, Less X%, military, and similar) that were subtracted from the commissionable amount. Each has `name`, `description`, `amount` (negative), `category`, and `reason` (`Discount`). Those amounts are already included in `preFeeCharged` and `commissionableAmount`. They are not in `excludedLines`.

`commissionableAmountVerified` is false when a line could not be classified. That line is in `excludedLines` with reason `Not classified`, and a person should check the job before paying it. A discount line does not make `commissionableAmountVerified` false. `lineItemsAvailable` is false when Books had no line items. Commission then uses the quote total with 4% removed, which is the previous behavior, and the job is flagged line items not available. Both flags can be read without changing `policy`.

`policy` is one of:

| Policy | Commissionable |
| --- | --- |
| `at/over list` | yes — rate × charged |
| `undersold <10%` | yes — rate × list − half the shortfall |
| `undersold >=10% needs manager approval` | no — $0. The API does not apply in-browser manager approval. |
| `not an earner` | no — salesperson is not Dana, Amy, Blake, Scott, or John |
| `not accepted` | no — Books status is not accepted or invoiced |
| `list not verified` | yes — rate × charged, list could not be computed |
| `needs review` | no — charged amount is missing |

`status` is the Books estimate status: `accepted`, `invoiced`, `draft`, `sent`, `declined`, or null when the quote was not in Books.

`paidByCreditCard` is true when an admin has marked that job paid by credit card. `creditCardFee` is 2.9% of `commissionableAmount` when that flag is on and the amount is over $10,000, otherwise 0. The list tier is chosen from the original commissionable amount before the fee is subtracted, so the fee cannot move a job into the undersold tiers. At $10,000 or under, the flag is still returned and `creditCardFee` is 0.

`commission` and `adjustedCommission` are the payable commission, the same number the calculator shows. When `creditCardFee` is 0 they match the formula from before this flag existed. When the fee applies:

- At or over list, and when list is not verified: commission = rate × (commissionable amount − credit card fee). Example: $20,000 commissionable, Blake at 15% → fee $580, base $19,420, `adjustedCommission` $2,913.
- Undersold by less than 10%, and a manager-approved sale below the 10% floor: let U be the undersold commission (rate × list − half the shortfall, floored at $0). The fee is subtracted from U's commission base, which is U / rate, and the rate is applied again: `adjustedCommission` = U − rate × fee, floored at $0. The shortfall inside U still uses the original list and commissionable amount.
- Below the 10% floor with no manager approval, or not sold: payable commission stays $0. `creditCardFee` is still the 2.9% amount when the threshold is met.

`commissionBeforeCreditCard` is U, or the tier commission before that deduction. It equals `commission` whenever `creditCardFee` is 0. Callers that only read `commission` keep working: unflagged jobs are unchanged, and a flagged job's `commission` is the payable adjusted amount.

The flag is not a request field. GET and POST look up the saved value. Saving it is the admin checkbox on the calculator, stored privately and not in this repository. See [Credit card flags](#credit-card-flags).

More than one snapshot job can share a quote number. The API then returns `200` with `{ "count", "results", "fetchedAt", "dataAsOf" }`. Pass `job` or `jobId` to pick one.

Unknown numbers return `404`:

```json
{ "error": "No job in the commission snapshot matches that estimate or job." }
```

A missing identifier, a bad `since` date, an unknown rep, or a non-JSON POST body returns `400` with `{ "error": "..." }`.

## List

```bash
curl -sS \
  -H "Authorization: Bearer YOUR_BOT_API_KEY" \
  "https://swt-commission-calculator.vercel.app/api/v1/commission?rep=Amy&since=2026-11-01"
```

`rep` is Dana, Amy, Blake, Scott, or John (full name or short name). `since` is `YYYY-MM-DD` and keeps jobs whose Books accepted date is on or after that day. Either filter may be used alone.

```json
{
  "fetchedAt": "2026-11-17T17:50:00Z",
  "dataAsOf": "2026-11-05 12:34 PM MST",
  "matched": 4,
  "count": 4,
  "truncated": false,
  "results": []
}
```

Results use the same record as a single lookup, newest accepted date first. The list stops at 100 jobs and sets `truncated` to true. `matched` is the full count.

## Usage log

Every API call writes one JSON line to the Vercel runtime log (`source` is `swt-commission-usage`) and stores the same object in a private Vercel Blob store under `usage/`. Each object has the time, key name (or `invalid`), path, query, status, user agent, and forwarded IP when the platform sends one.

Every `POST /api/login` writes the same kind of line with the name that was chosen and whether sign-in succeeded. The code is not stored.

Kelly, Sarah, and Admin can open this log.

- Page: `/admin/usage` (newest first)
- JSON: `GET /api/admin/usage`

The log is not in the repository.

## Credit card flags

Kelly, Sarah, and Admin can mark a job paid by credit card on the calculator. `updatedBy` is the name of the person who saved it.

Each mark is one private Blob object under `swt-commission-flags/` in the same Vercel Blob store as `usage/`. The object name is the job number when the job has one that is different from its estimate (`F240464.json`), otherwise the estimate number (`WT-03533-QT01.json`). The JSON records `paidByCreditCard`, `updatedBy`, `updatedAt`, and the estimate, job number, quote, and snapshot id that were current when it was saved. The snapshot rebuild does not write this prefix, so a 30-minute data sync leaves the marks in place.

`GET /api/commission-flags` (any signed-in user) returns `{ "flags": { "<key>": { ... } } }`. `POST /api/commission-flags` with `{ "jobId", "paidByCreditCard" }` is limited to Kelly, Sarah, and Admin. The bot API does not accept the flag as an input. It reads the stored mark and returns `paidByCreditCard`, `creditCardFee`, and `adjustedCommission`.
