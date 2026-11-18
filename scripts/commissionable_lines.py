#!/usr/bin/env python3
"""Which Zoho Books estimate lines earn SWT commission.

Owner-confirmed 2026-11-18. One line is classified from its name, description,
category, and unit. The rules were checked against the line items in
data/source/books-estimates.json (film, removal, labor, attachment, glass,
trip, site visit, discounts, and the 4% fee).

Counts toward the commissionable amount:
  - window film (Material - Film, or a film item such as Solar, Security,
    Frost/Privacy, Graffiti, Custom/Graphics, Bird, Other Film)
  - film removal
  - C-Bond
  - labor-only install
  - a negative discount (Over/Short, Discount, Less X%, military, and
    similar). The line total is negative, so it reduces the commissionable
    amount. A discount does not flag the job.

Does not count (left out, job stays verified):
  - fees, including the 4% fee and credit-card fees
  - travel, mileage, and trip charges
  - lifts and equipment rental
  - permits and parking
  - other non-film extras: attachment, replacement glass, site visits,
    window treatments, warranties, and misc charges

A line that is none of those, or that mixes commissionable work with an
excluded charge in one amount, is left out and marked not classified. The
job is then flagged "commissionable amount not verified". A positive
Over/Short or other unknown positive line is still not classified. A fee
stays a fee even when the description mentions a discount.

A film line stays film even when the description mentions removal, attachment,
or equipment as part of that film scope. A trip, lift, or fee stays excluded
even when the description says the trip was to install film.
"""
from __future__ import annotations

import argparse
import json
import re
import sys

FILM_ITEM_NAMES = {
    "solar film",
    "frost/privacy film",
    "frost",
    "privacy film",
    "security film",
    "safety film",
    "graffiti",
    "anti-graffiti",
    "grafitti",
    "custom/graphics",
    "custom graphics",
    "bird film",
    "other film",
    "decorative film",
    "window film",
}

REASONS = {
    "film": "Window film",
    "removal": "Film removal",
    "cbond": "C-Bond",
    "labor": "Labor-only install",
    "fee": "Fee",
    "travel": "Travel / mileage",
    "lift": "Lift / equipment",
    "permit": "Permit / parking",
    "extra": "Non-film extra",
    "discount": "Discount",
    "ambiguous": "Not classified",
}

COUNTS = {"film", "removal", "cbond", "labor", "discount"}

_FEE_TEXT = re.compile(
    r"\b(credit\s*card\s*fee|card\s*fee|cc\s*fee|processing\s*fee|convenience\s*fee|4\s*%\s*fee)\b",
    re.I,
)
_TRAVEL_TEXT = re.compile(
    r"\b(trip\s*charges?|trip\s*fees?|mileage|travel\s*charges?|travel\s*fees?|travel)\b",
    re.I,
)
_LIFT_TEXT = re.compile(
    r"\b(boom\s*lifts?|scissor\s*lifts?|man\s*lifts?|manlifts?|aerial\s*lifts?|"
    r"equipment\s*rentals?|lift\s*rentals?|scaffolds?|scaffolding|lifts?)\b",
    re.I,
)
_PERMIT_TEXT = re.compile(r"\b(permits?|parking)\b", re.I)
_CBOND_TEXT = re.compile(r"\bc[\s-]?bonds?\b", re.I)
_REMOVAL_TEXT = re.compile(
    r"\b(film\s*removal|removal\s+of\s+(?:the\s+)?(?:existing\s+)?film|remove\s+existing\s+film)\b",
    re.I,
)
_FILM_WORD = re.compile(r"\bfilms?\b", re.I)
_PURPOSE_ONLY = re.compile(r"\b(?:to|for)\s+install", re.I)
# "discounted" is not a discount word. "%" is not a word character, so the
# Less X% alternative cannot end on a word boundary.
_DISCOUNT_PHRASE = re.compile(
    r"\b(?:military(?:\s+discount)?|discounts?)\b|less\s*\d+(?:\.\d+)?\s*%",
    re.I,
)


def money(value: float) -> float:
    sign = -1 if value < 0 else 1
    return sign * round(abs(value) + 1e-10, 2)


def _space(value: str | None) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())


def category_of(line: dict) -> str:
    category = line.get("category")
    if category:
        return str(category)
    for field in line.get("item_custom_fields") or []:
        if isinstance(field, dict) and field.get("api_name") == "cf_category" and field.get("value"):
            return str(field.get("value"))
    return ""


def line_amount(line: dict) -> float:
    for key in ("item_total", "itemTotal"):
        raw = line.get(key)
        if raw is None or raw == "":
            continue
        try:
            return float(raw)
        except (TypeError, ValueError):
            return 0.0
    return 0.0


def _clip(value: str | None, limit: int = 400) -> str:
    text = re.sub(r"[ \t]+", " ", (value or "").strip())
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def _decision(kind: str) -> dict:
    return {"counts": kind in COUNTS, "kind": kind, "reason": REASONS[kind]}


def _is_fee_name(name: str, category: str) -> bool:
    if _space(category) == "fee":
        return True
    return "fee" in _space(name)


def _is_film_item(name: str, category: str) -> bool:
    category_name = _space(category)
    item = _space(name)
    if category_name == "material - film":
        return True
    if item in FILM_ITEM_NAMES:
        return True
    if re.search(r"\bfilm\b", item) and "removal" not in item:
        return True
    return False


def _is_removal_name(name: str) -> bool:
    item = _space(name)
    if item in {"film removal", "removal", "remove film"}:
        return True
    return bool(re.search(r"\bfilm\s*removal\b", item))


def _is_labor_name(name: str) -> bool:
    item = _space(name)
    return "labor only" in item or "labour only" in item or item.startswith("install (labor")


def _is_travel_name(name: str) -> bool:
    item = _space(name)
    return item in {"trip charge", "trip", "mileage", "travel", "travel charge"} or bool(
        _TRAVEL_TEXT.search(item)
    )


def _is_lift_name(name: str) -> bool:
    item = _space(name)
    if item in {"equipment", "lift", "boom lift", "scissor lift", "scaffold", "scaffolding"}:
        return True
    return bool(_LIFT_TEXT.search(item))


def _is_permit_name(name: str) -> bool:
    return bool(_PERMIT_TEXT.search(_space(name)))


def _is_glass_name(name: str) -> bool:
    item = _space(name)
    return "replacement glass" in item or "glass replacement" in item


def _is_attachment_name(name: str) -> bool:
    item = _space(name)
    if "film" in item:
        return False
    return "attachment" in item or bool(re.search(r"\bdow(?:sil)?\s*995\b", item))


def _is_window_treatment_name(name: str) -> bool:
    item = _space(name)
    return (
        "window treatment" in item
        or item in {"blinds", "shades", "shade", "blind"}
        or "blind" in item
        or "shade" in item
    )


def _is_site_visit_name(name: str) -> bool:
    return "site visit" in _space(name)


def _is_warranty_name(name: str) -> bool:
    item = _space(name)
    return item == "warranty" or item.startswith("warranty")


def _is_bullet_name(name: str) -> bool:
    return "bullet" in _space(name)


def _is_discount_name(name: str) -> bool:
    item = re.sub(r"\s*/\s*", "/", _space(name))
    if item in {"over/short", "over short", "discount", "military discount"}:
        return True
    return "over/short" in item or item.endswith(" discount") or item.startswith("discount")


def _is_clear_discount(name: str, description: str) -> bool:
    """Over/Short, Discount, Less X%, military, or the word discount."""
    if _is_discount_name(name):
        return True
    return bool(_DISCOUNT_PHRASE.search(f"{name}\n{description}"))


def _mentions_commissionable_work(text: str) -> bool:
    if _FILM_WORD.search(text) or _REMOVAL_TEXT.search(text) or _CBOND_TEXT.search(text):
        return True
    return bool(re.search(r"\blabor[\s-]*only\b", text, re.I))


def _itemizes_mixed_money(text: str) -> bool:
    """One line that prices film or labor and also glass, mileage, or a lift."""
    has_commissionable = bool(
        re.search(r"(film|labor).{0,40}\$\s*\d", text, re.I)
        or re.search(r"\$\s*\d[\d,]*(?:\.\d+)?\s*.{0,40}(film|labor)", text, re.I)
    )
    has_excluded = bool(
        re.search(r"(glass|mileage|trip|lift).{0,40}\$\s*\d", text, re.I)
        or re.search(r"\$\s*\d[\d,]*(?:\.\d+)?\s*.{0,48}(glass|mileage|trip|lift)", text, re.I)
    )
    return has_commissionable and has_excluded


def _describe_generic(description: str) -> dict:
    """Other Charge, blank, and similar names follow the description.

    A trip or lift that only mentions film as the reason for the trip
    ("boom lift to install film") stays a trip or lift. A line that prices
    film together with mileage, glass, or a lift is not classified.
    """
    text = description or ""
    if _itemizes_mixed_money(text):
        return _decision("ambiguous")
    travel = bool(_TRAVEL_TEXT.search(text))
    lift = bool(_LIFT_TEXT.search(text))
    permit = bool(_PERMIT_TEXT.search(text))
    fee = bool(_FEE_TEXT.search(text))
    removal = bool(_REMOVAL_TEXT.search(text))
    cbond = bool(_CBOND_TEXT.search(text))
    film_work = _mentions_commissionable_work(text)
    excluded = travel or lift or permit or fee
    # "to install film" is why the crew went. It does not make the trip commissionable.
    if excluded and film_work and not _PURPOSE_ONLY.search(text):
        return _decision("ambiguous")
    if fee:
        return _decision("fee")
    if travel:
        return _decision("travel")
    if lift:
        return _decision("lift")
    if permit:
        return _decision("permit")
    if removal and not re.search(r"\binstall", text, re.I):
        return _decision("removal")
    if cbond:
        return _decision("cbond")
    if film_work:
        return _decision("film")
    # A positive "Less 5%" or "military discount" on a generic line is still
    # not a known charge. Negative discounts are classified before this runs.
    return _decision("ambiguous")


def classify_line(line: dict) -> dict:
    """Classify one Books line.

    `counts` is true for film, removal, C-Bond, labor, and a negative discount.
    A discount total is negative, so counting it subtracts from commissionable.
    """
    name = str(line.get("name") or "")
    description = str(line.get("description") or "")
    category = category_of(line)
    item = _space(name)

    if _is_fee_name(name, category):
        return _decision("fee")

    if line_amount(line) < 0 and _is_clear_discount(name, description):
        return _decision("discount")

    if _is_film_item(name, category):
        return _decision("film")

    if _is_removal_name(name):
        return _decision("removal")

    if _CBOND_TEXT.search(name) and "film" not in item:
        return _decision("cbond")

    if _is_labor_name(name):
        return _decision("labor")

    if _is_travel_name(name):
        return _decision("travel")

    if _is_lift_name(name):
        return _decision("lift")

    if _is_permit_name(name):
        return _decision("permit")

    if _is_glass_name(name):
        if _itemizes_mixed_money(description) or _mentions_commissionable_work(description):
            return _decision("ambiguous")
        return _decision("extra")

    if _is_attachment_name(name):
        return _decision("extra")

    if _is_site_visit_name(name):
        return _decision("extra")

    if _is_window_treatment_name(name):
        if _mentions_commissionable_work(description):
            return _decision("ambiguous")
        return _decision("extra")

    if _is_warranty_name(name):
        return _decision("extra")

    if _is_bullet_name(name):
        return _decision("extra")

    if _is_discount_name(name):
        return _decision("ambiguous")

    if item in {"misc", "miscellaneous"}:
        described = _describe_generic(description)
        if described["kind"] == "ambiguous" and not _space(description):
            return _decision("extra")
        return described

    if item in {"", "other charge", "other", "charge", "service", "material", "materials"}:
        return _describe_generic(description)

    # A specific product we have not seen. Leave it out and ask a person.
    described = _describe_generic(f"{name}\n{description}")
    if described["kind"] != "ambiguous":
        return described
    return _decision("ambiguous")


def _line_record(line: dict, amount: float, reason: str) -> dict:
    category = category_of(line).strip()
    return {
        "name": str(line.get("name") or ""),
        "description": _clip(line.get("description")),
        "amount": amount,
        "category": category or None,
        "reason": reason,
    }


def summarize_lines(lines: list[dict]) -> dict:
    """Sum commissionable lines, list discounts, and list everything left out.

    `commissionableLines` is film, removal, C-Bond, and labor only. Discount
    lines reduce `commissionable` and are returned in `discounts` so list
    price is not built from a discount.
    """
    commissionable = 0.0
    prefee = 0.0
    line_total = 0.0
    excluded: list[dict] = []
    discounts: list[dict] = []
    kept: list[dict] = []
    decisions: list[dict] = []
    ambiguous = False

    for line in lines:
        if not isinstance(line, dict):
            continue
        amount = money(line_amount(line))
        decision = classify_line(line)
        line_total += amount
        if decision["kind"] != "fee":
            prefee += amount
        if decision["counts"]:
            commissionable += amount
            if decision["kind"] == "discount":
                discounts.append(_line_record(line, amount, decision["reason"]))
            else:
                kept.append(line)
        else:
            if decision["kind"] == "ambiguous":
                ambiguous = True
            excluded.append(_line_record(line, amount, decision["reason"]))
        decisions.append({
            "name": str(line.get("name") or ""),
            "amount": amount,
            "counts": decision["counts"],
            "kind": decision["kind"],
            "reason": decision["reason"],
        })

    return {
        "commissionable": money(commissionable),
        "preFee": money(prefee),
        "lineTotal": money(line_total),
        "excluded": excluded,
        "discounts": discounts,
        "ambiguous": ambiguous,
        "commissionableLines": kept,
        "decisions": decisions,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Classify Books estimate lines for commission")
    parser.add_argument(
        "--summarize",
        action="store_true",
        help="Read {\"lines\": [...]} from stdin and write the summary as JSON",
    )
    args = parser.parse_args()
    if not args.summarize:
        parser.error("pass --summarize")
    payload = json.load(sys.stdin)
    lines = payload.get("lines") if isinstance(payload, dict) else payload
    if not isinstance(lines, list):
        raise SystemExit("expected a list of lines")
    summary = summarize_lines(lines)
    summary.pop("commissionableLines", None)
    json.dump(summary, sys.stdout)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
