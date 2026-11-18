"""SWT commission engine (official policy).

The web app and future dashboard import src/lib/commission.ts, which is the
runtime port of this file. Keep these 5% examples in both places:

- list $1,000, sold $1,100 → $55
- list $1,000, sold $950 → $25
- list $1,000, sold $900 → $0 (below the 10% floor)

Prices exclude 4% fees (Job Total / charged and list are pre-fee).
Commission is never negative.

If charged >= list:
    commission = rate × charged
If undersold by less than 10% of list:
    commission = rate × list − 0.5 × (list − charged)
If charged <= 90% of list:
    commission = 0 unless manager_approved, which uses the undersold formula
If list cannot be computed:
    commission = rate × charged, listVerified=False ("list not verified")

Paid by credit card, and the commissionable amount is over $10,000:
    The tier above is chosen first. Then fee = 2.9% of the commissionable amount.
    At/over list (and list not verified): commission = rate × (commissionable − fee).
    Undersold formula U: commission = round(U − rate × fee), floored at $0.
    $10,000 or under: the mark changes nothing.
    Example: $20,000 commissionable, Blake 15% → fee $580, base $19,420, pay $2,913.
"""
from __future__ import annotations
from typing import Any, Optional


def _round_money(value: float) -> float:
    sign = -1 if value < 0 else 1
    return sign * round(abs(value) + 1e-10, 2)


def _cents(value: float) -> int:
    return int(round(_round_money(value) * 100))


def is_below_list_floor(list_price: float, charged: float) -> bool:
    """Charged is at or under 90% of list, compared in cents."""
    return _cents(charged) * 10 <= _cents(list_price) * 9


def undersold_commission(rate: float, list_price: float, charged: float) -> float:
    shortfall = _round_money(_round_money(list_price) - _round_money(charged))
    raw = rate * _round_money(list_price) - 0.5 * shortfall
    return max(0.0, _round_money(raw))


CREDIT_CARD_FEE_RATE = 0.029
CREDIT_CARD_FEE_THRESHOLD = 10000.0


def credit_card_processing_fee(commissionable: float) -> float:
    """Half-up cents of commissionable × 29 / 1000. $20,000 → $580."""
    cents = _cents(commissionable)
    sign = -1 if cents < 0 else 1
    fee_cents = (abs(cents) * 29 + 500) // 1000
    return sign * fee_cents / 100.0


def credit_card_fee_applies(paid_by_credit_card: bool, commissionable: Optional[float]) -> bool:
    if not paid_by_credit_card or commissionable is None:
        return False
    try:
        amount = float(commissionable)
    except (TypeError, ValueError):
        return False
    if amount != amount:  # NaN
        return False
    return _cents(amount) > _cents(CREDIT_CARD_FEE_THRESHOLD)


def _apply_credit_card(result: dict[str, Any], paid_by_credit_card: bool) -> dict[str, Any]:
    """Deduct the card fee after the tier is chosen. See src/lib/commission.ts.

    At/over list and list-not-verified:
        commission base = commissionable − fee
        commission = rate × commission base
    Undersold formula (U is the already-rounded undersold commission):
        commission = round(U − rate × fee), floored at $0
        which is rate × (U / rate − fee). The shortfall is not recomputed.
    """
    flagged = bool(paid_by_credit_card)
    before = result.get("commission")
    charged = result.get("charged")
    applies = credit_card_fee_applies(flagged, charged if isinstance(charged, (int, float)) else None)
    fee = credit_card_processing_fee(float(charged)) if applies and isinstance(charged, (int, float)) else 0.0
    out = dict(result)
    out["paidByCreditCard"] = flagged
    out["creditCardFee"] = fee
    out["commissionBeforeCreditCard"] = before
    if not applies or before is None or not isinstance(charged, (int, float)) or fee == 0:
        return out
    rate = float(result.get("rate") or 0)
    base = result.get("commissionBase")
    if isinstance(base, (int, float)):
        adjusted_base = _round_money(float(base) - fee)
        out["commissionBase"] = adjusted_base
        out["commission"] = max(0.0, _round_money(rate * adjusted_base))
        return out
    out["commission"] = max(0.0, _round_money(float(before) - rate * fee))
    return out


def commission_from_list_and_charged(
    rate: float,
    charged: Optional[float],
    list_price: Optional[float],
    manager_approved: bool = False,
    paid_by_credit_card: bool = False,
) -> dict[str, Any]:
    """Return commission breakdown for one job.

    All money inputs are pre-fee (exclude 4%). The card fee is applied after
    the tier, and only when paid_by_credit_card is set and charged is over $10,000.
    """
    return _apply_credit_card(
        _commission_tier(rate, charged, list_price, manager_approved),
        paid_by_credit_card,
    )


def _commission_tier(
    rate: float,
    charged: Optional[float],
    list_price: Optional[float],
    manager_approved: bool = False,
) -> dict[str, Any]:
    """Return commission breakdown for one job.

    All money inputs are pre-fee (exclude 4%).
    """
    approved = bool(manager_approved)
    if charged is None or (isinstance(charged, float) and (charged != charged)):  # NaN
        return {
            "listPrice": list_price,
            "charged": charged,
            "difference": None,
            "commissionBase": None,
            "commission": None,
            "rate": rate,
            "status": "needs_review",
            "listVerified": False,
            "belowFloor": False,
            "managerApproved": approved,
            "reason": "invalid charged",
        }

    charged = float(charged)
    list_verified = list_price is not None and not (
        isinstance(list_price, float) and list_price != list_price
    )

    if not list_verified:
        return {
            "listPrice": None,
            "charged": _round_money(charged),
            "difference": None,
            "commissionBase": _round_money(charged),
            "commission": max(0.0, _round_money(rate * charged)),
            "rate": rate,
            "status": "list_not_verified",
            "listVerified": False,
            "belowFloor": False,
            "managerApproved": approved,
            "reason": "list not verified — used charged as base",
        }

    list_price = _round_money(float(list_price))
    charged_rounded = _round_money(charged)
    difference = _round_money(charged_rounded - list_price)

    if charged_rounded >= list_price - 1e-9:
        status = "ok" if abs(difference) < 0.01 else "oversold"
        return {
            "listPrice": list_price,
            "charged": charged_rounded,
            "difference": difference,
            "commissionBase": charged_rounded,
            "commission": max(0.0, _round_money(rate * charged_rounded)),
            "rate": rate,
            "status": status,
            "listVerified": True,
            "belowFloor": False,
            "managerApproved": approved,
            "reason": None,
        }

    below = is_below_list_floor(list_price, charged_rounded)
    formula = undersold_commission(rate, list_price, charged_rounded)
    waived = below and not approved
    return {
        "listPrice": list_price,
        "charged": charged_rounded,
        "difference": difference,
        "commissionBase": None,
        "commission": 0.0 if waived else formula,
        "rate": rate,
        "status": "below_floor" if below else "undersold",
        "listVerified": True,
        "belowFloor": below,
        "managerApproved": approved,
        "reason": "below 10% floor" if waived else None,
    }


def compute_commission(
    rate: float,
    charged: Optional[float],
    list_price: Optional[float],
    manager_approved: bool = False,
    paid_by_credit_card: bool = False,
):
    return commission_from_list_and_charged(
        rate, charged, list_price, manager_approved, paid_by_credit_card
    )
