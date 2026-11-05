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

- If charged is at or above list, commission = rate × charged.
- If undersold, base = list − 0.5 × (list − charged), and commission = rate × base.
- Example: list $500, sold $400, base $450. At 15% the commission is **$67.50**.
- If list cannot be computed, the base is the charged amount and the job is marked **list not verified**.
- A job missing film or square footage is marked **needs review**.

List price is V-10.9 catalog sell $/SF × billed square feet, plus removal ($1.25/SF), C-Bond ($1.25/SF), and French panes ($3 each). An optional list override replaces that total when accounting already knows the pre-fee list.

The math lives in [`src/lib/commission.ts`](src/lib/commission.ts). A future per-rep dashboard should import `priceJob` from that module instead of reimplementing it. The Python file [`scripts/engine/commission.py`](scripts/engine/commission.py) is the original reference for the same rules.

## Run locally

```bash
npm install
npm test
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy on Vercel

No environment variables are required for the bundled snapshot.

1. Import this repository as a Next.js project.
2. Leave the build command as `npm run build` and the output as the Next.js default.
3. Deploy.

The page reads the checked-in snapshot at build time. It does not call Zoho.

## Refresh the snapshot

Job facts and the 307-film catalog are bundled. Commission is not stored in the snapshot; the app calculates it.

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
