# SWT Commission Calculator

Day-to-day commission calculator for Scottish Window Tinting accounting. Pick a sales rep, find one of their jobs, and edit film, square footage, the charged amount, and add-ons. List price, over/under, and commission update immediately.

This is a calculator, not a payroll report. It does not list every job or total a rep.

## Commission rules

Owner-confirmed 2026-11-05, with commissionable lines confirmed 2026-11-18. Commission is calculated on window film, film removal, C-Bond, and labor-only install, minus discounts (Over/Short, Discount, Less X%, military, and similar negative lines). The 4% fee, travel, mileage, lifts, equipment rental, permits, parking, and other non-film extras are not included. A line that cannot be classified is left out and the job is marked **commissionable amount not verified**. A discount does not raise that flag. A Books quote with no line items keeps the quote total with 4% removed and is marked **line items not available**.

Only these reps earn commission:

| Rep | Rate |
| --- | ---: |
| Dana Hojnacki | 7% |
| Amy Haley | 5% |
| Blake Parish | 15% |
| Scott Gafney | 15% |
| John | 15% |

- If the commissionable amount is at or above list, commission = rate × that amount. List $1,000 at 5%, sold for $1,100, pays **$55**.
- If undersold by less than 10% of list, commission = rate × list − 0.5 × (list − charged). List $1,000 at 5%, sold for $950, pays $50 − $25 = **$25**.
- If charged is at or under 90% of list, commission is **$0** unless a manager approved the price in writing. With that approval, the undersold formula applies and commission does not go below $0. List $1,000 at 5%, sold for $900, pays **$0**.
- If list cannot be computed, commission = rate × the commissionable amount and the job is marked **list not verified**.
- A job missing film or square footage is marked **needs review**.
- Paid by credit card, and the commissionable amount is over $10,000: deduct 2.9% of that amount from the commission base after the list tier is chosen, then apply the rate. The fee cannot move a job into the undersold tiers. At $10,000 or under, the checkbox changes nothing. Example: $20,000 commissionable, fee $580, base $19,420, Blake at 15% pays **$2,913**. For undersold by less than 10% (and a manager-approved sale below the floor), let U be the undersold commission. Its base is U / rate. The fee is subtracted from that base and the rate is applied again: commission = U − rate × fee, and it does not go below $0. The shortfall in U still uses the original list and commissionable amount.

List price is V-10.9 catalog sell $/SF × billed square feet, plus removal ($1.25/SF), C-Bond ($1.25/SF), and French panes ($3 each). An optional list override replaces that total when accounting already knows the pre-fee list.

The math lives in [`src/lib/commission.ts`](src/lib/commission.ts). A future per-rep dashboard should import `priceJob` from that module instead of reimplementing it. [`scripts/engine/commission.py`](scripts/engine/commission.py) is the same policy for the data builder.

Only an admin login can mark a job **Paid by credit card**. Kelly and Sarah see the checkbox, the fee, and the adjusted commission, and cannot change it. The mark is stored in the same private Vercel Blob store as the usage log, under the prefix `swt-commission-flags/`, keyed by job number (or the estimate number when the job has no separate job number). Each object records who changed it and when. It is not in this repository. Toggling recalculates in the browser immediately and is still there after the 30-minute snapshot rebuild, because the rebuild does not write that prefix.

## Sign in

The calculator is behind a login. The name dropdown lists **Kelly** (code `1234`), **Sarah** (code `7807`), and **Admin** (code `1234`). Admin uses the same calculator as the other names. Codes are stored as scrypt hashes in [`src/lib/auth/users.ts`](src/lib/auth/users.ts), not as plaintext.

Change one password:

```bash
node scripts/hash-password.mjs "a-new-password"
```

Paste the printed hash over that user's `passwordHash`. To replace the whole list without editing code, set `AUTH_USERS` to a JSON array of `{ "username", "passwordHash" }`.

Sessions are a signed httpOnly cookie (`sgc_session`, 12 hours). Set `AUTH_SECRET` to a long random string in `.env.local` and in the Vercel project for Production, Preview, and Development. Next.js 16 runs the gate in [`src/proxy.ts`](src/proxy.ts). That file is the request middleware: it checks the cookie before every page and API route. `/login` and `/api/login` stay public. `/api/v1/*` skips the cookie and checks a bot API key instead. See [`docs/BOT_API.md`](docs/BOT_API.md).

## Run locally

```bash
npm install
# create .env.local with AUTH_SECRET=...
npm test
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy on Vercel

Set `AUTH_SECRET` on the Vercel project (Production, Preview, and Development) before deploying. The snapshot itself needs no other variables. The temporary passwords live in the repo as hashes.

The bot API also needs `BOT_API_KEYS` on Production and Preview. Connect a private Vercel Blob store so usage history and the per-job credit-card flags are kept. Neither the keys, the usage log, nor the flags belong in git. Details are in [`docs/BOT_API.md`](docs/BOT_API.md).

1. Import this repository as a Next.js project.
2. Leave the build command as `npm run build` and the output as the Next.js default.
3. Deploy.

The page reads the checked-in snapshot at build time. It does not call Zoho.

## Refresh the snapshot

Zoho Books is the source of truth for whether a quote was sold, who sold it, and the date. A job pays commission only when its Books status is **accepted** or **invoiced**. Anything else shows “Not sold in Zoho Books — no commission” and $0. Date sold is the Books `accepted_date`. The rep is the Books salesperson. Dana, Amy, Blake, Scott, and John are the only commissionable reps.

`data/source/books-estimates.json` holds those Books fields, including line items. `npm run data:build` copies them onto each sheet job and **adds a snapshot job for every 2026 estimate that is not already in `jobs.json`**. A quote is already represented when its Books estimate id, estimate number, or `WT-#####` base key is on a job. 2026 means `date`, `acceptedDate`, or `createdDate` is in 2026. A quote with none of those dates is included when its WT number is higher than the last job in `jobs.json`, so a new draft is not dropped.

Film, square feet, and the pre-fee charged amount for those new jobs come from the estimate line items and `swt-film-catalog.csv`, using the same matching as `scripts/build_commission_data.py`. Commission is not stored in the snapshot; the app calculates it. A non-sold status (anything other than accepted or invoiced) shows “Not sold in Zoho Books — no commission” and $0. An estimate whose film lines do not match the catalog is still added and flagged **list not verified**.

The 30-minute sync only needs to replace `data/source/books-estimates.json` and run:

```bash
npm run data:build
```

`data:build` needs `python3` on the sync box. It does not call Zoho. Commit `data/source/books-estimates.json` and `src/data/snapshot.json`.

### What the sync must write

`books-estimates.json` is one JSON object:

| Field | Required | Meaning |
| --- | --- | --- |
| `source` | yes | `"zoho-books"` |
| `organizationId` | yes | Books organization id |
| `fetchedAt` | yes | ISO-8601 UTC time the estimates were read, e.g. `2026-11-17T22:16:18Z`. This is the freshness label. |
| `estimates` | yes | Array of estimate objects |

Each estimate:

| Field | Required | Meaning |
| --- | --- | --- |
| `estimateId` | yes | Books estimate id |
| `estimateNumber` | yes | e.g. `WT-03645-QT01` |
| `status` | yes | Lowercase Books status: `draft`, `sent`, `accepted`, `invoiced`, `declined`, … |
| `acceptedDate` | yes | `yyyy-mm-dd`, or `null` when the quote is not accepted |
| `date` | yes | Estimate date `yyyy-mm-dd`. This is how an unaccepted 2026 quote is recognized. |
| `salesperson` | yes | Books salesperson name, or `null` |
| `customerName` | yes | Books customer name |
| `total` | yes | Books total. This includes the 4% fee when a fee line is present. |
| `lineItems` | yes | Array of line items. Use `[]` only when Books has no lines. Do not omit the key. |

Each line item:

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | yes | Books item name |
| `description` | yes | Books line description (film name lives here) |
| `quantity` | yes | Quantity. For film this is square feet when `unit` is `sf`. |
| `rate` | yes | Books rate |
| `itemTotal` | yes | Books line total |
| `unit` | yes | Books unit, e.g. `sf`. Empty string when Books has none. |
| `category` | yes | Item custom field `cf_category`, or `null`. `Fee` marks the 4% fee line. A name containing “fee” is also treated as the fee. `Material - Film` is window film. |

The commissionable amount is the sum of line totals that count: window film, film removal, C-Bond, and labor-only install, minus negative discounts. Fees, travel, lifts, permits, parking, and other non-film extras are excluded. A line that matches none of those rules is excluded and the job is flagged commissionable amount not verified. A negative Over/Short, Discount, Less X%, or military line is a discount: it is subtracted and the job stays verified. The rules are in [`scripts/commissionable_lines.py`](scripts/commissionable_lines.py). With no line items, charged is the Books total divided by 1.04 and the job is flagged line items not available. List price is catalog sell $/SF × billed square feet, plus removal and C-Bond when the description says so. Discount lines are not film and are not part of that list. That list is compared with the commissionable amount. The page label and the bot API `fetchedAt` use the later of `fetchedAt` and the job export time.

```bash
npm run data:build
```

That reads:

- `data/source/jobs.json` — job facts exported from the 2026 master sheet
- `data/source/books-estimates.json` — Books estimates, including line items for quotes that are not in the sheet export
- `data/source/swt-film-catalog.csv` — V-10.9 cost, pricing group, and sell $/SF

and writes `src/data/snapshot.json`. The page shows Zoho Books freshness from `fetchedAt` (`booksAsOf` on the snapshot).

To pull a newer read-only export from Zoho, put credentials in an untracked `.env` (see `.env.example`) and place the master-sheet dump at `data/raw/sheet_2026.json` plus `data/raw/estimate_index.json`. Then:

```bash
python3 scripts/build_commission_data.py
npm run data:build
```

`--assemble` rebuilds `data/source/jobs.json` from `data/raw/details` without calling Zoho. The script never writes to Zoho.

## Data layer

`getCommissionDataSource()` in [`src/lib/data/index.ts`](src/lib/data/index.ts) returns the bundled snapshot. A later live reader can implement the same `CommissionDataSource` interface (see [`src/lib/data/zoho.ts`](src/lib/data/zoho.ts)) and return the same snapshot shape. Keep tokens out of the repository.
