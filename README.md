# SWT Commission Calculator

Day-to-day commission calculator for Scottish Window Tinting accounting. Pick a sales rep, find one of their jobs, and edit film, square footage, the charged amount, and add-ons. List price, over/under, and commission update immediately.

This is a calculator, not a payroll report. It does not list every job or total a rep.

## Commission rules

Owner-confirmed 2026-11-05. Prices exclude the 4% fee.

Only these reps earn commission:

| Rep | Rate |
| --- | ---: |
| Dana Hojnacki | 7% |
| Amy Haley | 5% |
| Blake Parish | 15% |
| Scott Gafney | 15% |
| John | 15% |

- If charged is at or above list, commission = rate × charged. List $1,000 at 5%, sold for $1,100, pays **$55**.
- If undersold by less than 10% of list, commission = rate × list − 0.5 × (list − charged). List $1,000 at 5%, sold for $950, pays $50 − $25 = **$25**.
- If charged is at or under 90% of list, commission is **$0** unless a manager approved the price in writing. With that approval, the undersold formula applies and commission does not go below $0. List $1,000 at 5%, sold for $900, pays **$0**.
- If list cannot be computed, commission = rate × charged and the job is marked **list not verified**.
- A job missing film or square footage is marked **needs review**.

List price is V-10.9 catalog sell $/SF × billed square feet, plus removal ($1.25/SF), C-Bond ($1.25/SF), and French panes ($3 each). An optional list override replaces that total when accounting already knows the pre-fee list.

The math lives in [`src/lib/commission.ts`](src/lib/commission.ts). A future per-rep dashboard should import `priceJob` from that module instead of reimplementing it. [`scripts/engine/commission.py`](scripts/engine/commission.py) is the same policy for the data builder.

## Sign in

The calculator is behind a login. The temporary accounts are **Kelly**, **Sarah**, and **admin**, each with password `1234`. Passwords are stored as scrypt hashes in [`src/lib/auth/users.ts`](src/lib/auth/users.ts), not as plaintext.

Change one password:

```bash
node scripts/hash-password.mjs "a-new-password"
```

Paste the printed hash over that user's `passwordHash`. To replace the whole list without editing code, set `AUTH_USERS` to a JSON array of `{ "username", "passwordHash" }`.

Sessions are a signed httpOnly cookie (`sgc_session`, 12 hours). Set `AUTH_SECRET` to a long random string in `.env.local` and in the Vercel project for Production, Preview, and Development. Next.js 16 runs the gate in [`src/proxy.ts`](src/proxy.ts). That file is the request middleware: it checks the cookie before every page and API route. `/login` and `/api/login` stay public.

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

1. Import this repository as a Next.js project.
2. Leave the build command as `npm run build` and the output as the Next.js default.
3. Deploy.

The page reads the checked-in snapshot at build time. It does not call Zoho.

## Refresh the snapshot

Zoho Books is the source of truth for whether a quote was sold, who sold it, and the date. A job pays commission only when its Books status is **accepted** or **invoiced**. Anything else shows “Not sold in Zoho Books — no commission” and $0. Date sold is the Books `accepted_date`. The rep is the Books salesperson. Dana, Amy, Blake, Scott, and John are the only commissionable reps.

`data/source/books-estimates.json` holds those Books fields. `npm run data:build` copies them onto each job in the snapshot. A future server sync can replace that file, or replace `getCommissionDataSource()` with the reader sketched in `src/lib/data/zoho.ts`, and return the same snapshot shape.

Film lines, square feet, and the pre-fee charged amount still come from the bundled job export. Commission is not stored in the snapshot; the app calculates it.

```bash
npm run data:build
```

That reads:

- `data/source/jobs.json` — job facts exported from the 2026 master sheet and Zoho Books estimates
- `data/source/swt-film-catalog.csv` — V-10.9 cost, pricing group, and sell $/SF

and writes `src/data/snapshot.json`, including the source file’s **data as of** timestamp.

To pull a newer read-only export from Zoho, put credentials in an untracked `.env` (see `.env.example`) and place the master-sheet dump at `data/raw/sheet_2026.json` plus `data/raw/estimate_index.json`. Then:

```bash
python3 scripts/build_commission_data.py
npm run data:build
```

`--assemble` rebuilds `data/source/jobs.json` from `data/raw/details` without calling Zoho. The script never writes to Zoho.

## Data layer

`getCommissionDataSource()` in [`src/lib/data/index.ts`](src/lib/data/index.ts) returns the bundled snapshot. A later live reader can implement the same `CommissionDataSource` interface (see [`src/lib/data/zoho.ts`](src/lib/data/zoho.ts)) and return the same snapshot shape. Keep tokens out of the repository.
