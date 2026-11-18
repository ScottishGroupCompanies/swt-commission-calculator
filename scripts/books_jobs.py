#!/usr/bin/env python3
"""Turn 2026 Zoho Books estimates that are not already jobs into snapshot jobs.

`npm run data:build` runs this. It reads data/source/jobs.json and
data/source/books-estimates.json and prints supplemental jobs as JSON.
Film lines and list inputs come from scripts/build_commission_data.py
(the same catalog match and square-foot rules as the sheet export).
Charged amount is the commissionable portion only. The rules live in
scripts/commissionable_lines.py. Commission dollars are not stored;
the app recalculates.

This script never calls Zoho and never writes a sheet.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from build_commission_data import (  # noqa: E402
    compact_lines,
    load_catalog,
)
from commissionable_lines import summarize_lines  # noqa: E402

FEE_DIVISOR = 1.04


def wt_number(value: str | None) -> int | None:
    match = re.search(r"WT-(\d+)", value or "", re.I)
    return int(match.group(1)) if match else None


def base_key(value: str | None) -> str:
    text = (value or "").upper().replace(" ", "")
    match = re.search(r"(WT-\d+)", text)
    return match.group(1) if match else text


def year_of(estimate: dict) -> int | None:
    """First explicit calendar year on the estimate, if the sync wrote one."""
    for key in ("date", "acceptedDate", "createdDate", "accepted_date", "created_date"):
        value = estimate.get(key)
        if isinstance(value, str) and len(value) >= 4 and value[:4].isdigit():
            return int(value[:4])
    return None


def is_2026_estimate(estimate: dict, max_job_wt: int) -> bool:
    """A 2026 quote is one dated 2026, or a newer WT number with no date yet.

    Drafts and sent quotes often have no accepted date. When the sync has
    not written `date` either, a WT number past the last sheet job is still
    current-year work and must not be dropped.
    """
    year = year_of(estimate)
    if year is not None:
        return year == 2026
    number = wt_number(estimate.get("estimateNumber") or estimate.get("estimate_number"))
    return number is not None and number > max_job_wt


def already_in_jobs(estimate: dict, ids: set[str], numbers: set[str], bases: set[str]) -> bool:
    estimate_id = str(estimate.get("estimateId") or estimate.get("estimate_id") or "")
    number = str(estimate.get("estimateNumber") or estimate.get("estimate_number") or "")
    if estimate_id and estimate_id in ids:
        return True
    if number and number in numbers:
        return True
    key = base_key(number)
    return bool(key) and key in bases


def line_items_of(estimate: dict) -> list[dict]:
    raw = estimate.get("lineItems")
    if raw is None:
        raw = estimate.get("line_items")
    if not isinstance(raw, list):
        return []
    lines = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        if "item_total" in item or "item_custom_fields" in item:
            lines.append(item)
            continue
        category = item.get("category")
        custom = []
        if category:
            custom.append({"api_name": "cf_category", "value": category})
        total = item.get("itemTotal")
        if total is None:
            total = item.get("item_total")
        lines.append({
            "name": item.get("name") or "",
            "description": item.get("description") or "",
            "quantity": item.get("quantity") or 0,
            "rate": item.get("rate") or 0,
            "item_total": 0 if total is None else total,
            "unit": item.get("unit") or "",
            "item_custom_fields": custom,
        })
    return lines


def money(value: float) -> float:
    sign = -1 if value < 0 else 1
    return sign * round(abs(value) + 1e-10, 2)


def estimate_total(estimate: dict) -> float | None:
    total = estimate.get("total")
    if total is None or total == "":
        return None
    try:
        return money(float(total))
    except (TypeError, ValueError):
        return None


def commissionable_amount(estimate: dict, lines: list[dict]) -> dict:
    """What commission is calculated on, plus the lines left out.

    With line items, charged is the sum of commissionable lines
    (window film, film removal, C-Bond, labor-only install) minus negative
    discount lines. Fees, travel, lifts, and other non-film extras are
    excluded. An unclassified line is excluded and the job is flagged
    commissionable amount not verified. A discount does not raise that flag.

    Without line items, keep the previous behavior: strip a flat 4% from
    `total`, and flag the job line items not available.
    """
    if lines:
        summary = summarize_lines(lines)
        quote = estimate_total(estimate)
        return {
            "charged": summary["commissionable"],
            "quoteAmount": summary["lineTotal"] if quote is None else quote,
            "commissionableAmount": summary["commissionable"],
            "excludedLines": summary["excluded"],
            "discountLines": summary["discounts"],
            "commissionableAmountVerified": not summary["ambiguous"],
            "lineItemsAvailable": True,
            "commissionableLines": summary["commissionableLines"],
        }
    total = estimate_total(estimate)
    charged = money(total / FEE_DIVISOR) if total is not None else 0.0
    return {
        "charged": charged,
        "quoteAmount": total,
        "commissionableAmount": charged,
        "excludedLines": [],
        "discountLines": [],
        "commissionableAmountVerified": True,
        "lineItemsAvailable": False,
        "commissionableLines": [],
    }


def prefee_charged(estimate: dict, lines: list[dict]) -> float:
    """Commissionable amount charged. See commissionable_amount."""
    return commissionable_amount(estimate, lines)["charged"]


def estimate_to_job(estimate: dict, catalog_by: dict) -> dict:
    lines = line_items_of(estimate)
    priced = commissionable_amount(estimate, lines)
    kept = priced["commissionableLines"]
    films, _fee, _flags = compact_lines({"line_items": kept}, catalog_by) if kept else ([], 0.0, [])
    number = str(estimate.get("estimateNumber") or estimate.get("estimate_number") or "")
    estimate_id = str(estimate.get("estimateId") or estimate.get("estimate_id") or "")
    status = str(estimate.get("status") or "").strip().lower() or None
    accepted = estimate.get("acceptedDate")
    if accepted is None:
        accepted = estimate.get("accepted_date") or None
    if accepted == "":
        accepted = None
    salesperson = estimate.get("salesperson")
    if salesperson is None:
        salesperson = estimate.get("salesperson_name")
    salesperson = salesperson or None
    customer = estimate.get("customerName") or estimate.get("customer_name") or ""
    job_id = number or estimate_id or base_key(number)
    return {
        "id": job_id,
        "client": customer,
        "zoho": base_key(number) or number,
        "jobNumber": number,
        "designer": salesperson or "",
        "salesperson": salesperson,
        "location": estimate.get("location") or "",
        "acceptedDate": accepted,
        "jobType": "",
        "filmType": "",
        "charged": priced["charged"],
        "quoteAmount": priced["quoteAmount"],
        "commissionableAmount": priced["commissionableAmount"],
        "excludedLines": priced["excludedLines"],
        "discountLines": priced["discountLines"],
        "commissionableAmountVerified": priced["commissionableAmountVerified"],
        "lineItemsAvailable": priced["lineItemsAvailable"],
        "estimateId": estimate_id or None,
        "estimateNumber": number or None,
        "quoteStatus": status,
        "films": films,
        "fromBooksEstimate": True,
    }


def supplemental_jobs(jobs_doc: dict, books_doc: dict, catalog_by: dict) -> dict:
    ids: set[str] = set()
    numbers: set[str] = set()
    bases: set[str] = set()
    max_wt = 0
    for job in jobs_doc.get("jobs") or []:
        if job.get("estimateId"):
            ids.add(str(job["estimateId"]))
        for value in (job.get("estimateNumber"), job.get("zoho"), job.get("jobNumber")):
            if not value:
                continue
            numbers.add(str(value))
            bases.add(base_key(str(value)))
            number = wt_number(str(value))
            if number is not None and number > max_wt:
                max_wt = number

    jobs = []
    missing: list[str] = []
    seen_ids: set[str] = set()
    estimates = books_doc.get("estimates") or []
    for estimate in estimates:
        if not isinstance(estimate, dict):
            continue
        if not is_2026_estimate(estimate, max_wt):
            continue
        if already_in_jobs(estimate, ids, numbers, bases):
            continue
        job = estimate_to_job(estimate, catalog_by)
        if job["id"] in seen_ids:
            job["id"] = f"{job['id']}|{job.get('estimateId') or len(jobs)}"
        seen_ids.add(job["id"])
        if not line_items_of(estimate):
            missing.append(job.get("estimateNumber") or job["id"])
        jobs.append(job)

    jobs.sort(key=lambda job: (job.get("estimateNumber") or job["id"]))
    return {"jobs": jobs, "missingLineItems": missing, "maxJobWt": max_wt}


def main() -> None:
    parser = argparse.ArgumentParser(description="Supplemental jobs from books-estimates.json")
    parser.add_argument("--jobs", type=Path, default=ROOT / "data" / "source" / "jobs.json")
    parser.add_argument("--books", type=Path, default=ROOT / "data" / "source" / "books-estimates.json")
    args = parser.parse_args()
    jobs_doc = json.loads(args.jobs.read_text())
    books_doc = json.loads(args.books.read_text())
    _catalog, catalog_by = load_catalog()
    payload = supplemental_jobs(jobs_doc, books_doc, catalog_by)
    json.dump(payload, sys.stdout)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
