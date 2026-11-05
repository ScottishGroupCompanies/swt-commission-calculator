"""SWT commission engine (owner-confirmed 2026-11-05).

The web app and future dashboard import src/lib/commission.ts, which is the
runtime port of this file. Keep the $500 list / $400 charged / 15% case at
base $450 and commission $67.50 in both places.

Prices exclude 4% fees (Job Total / charged and list are pre-fee).

If charged >= list:
    commission = rate × charged
If undersold (charged < list):
    base = list − 0.5 × (list − charged)
    commission = rate × base
    e.g. list $500, sold $400 → base $450
If list cannot be computed:
    treat charged as the commission base and mark listVerified=False
    ("list not verified").
"""
from __future__ import annotations
from typing import Any, Optional


def commission_from_list_and_charged(
    rate: float,
    charged: Optional[float],
    list_price: Optional[float],
) -> dict[str, Any]:
    """Return commission breakdown for one job.

    All money inputs are pre-fee (exclude 4%).
    """
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
            "reason": "invalid charged",
        }

    charged = float(charged)
    list_verified = list_price is not None and not (
        isinstance(list_price, float) and list_price != list_price
    )

    if not list_verified:
        base = charged
        difference = None
        status = "list_not_verified"
        commission = round(rate * base, 2)
        return {
            "listPrice": None,
            "charged": round(charged, 2),
            "difference": None,
            "commissionBase": round(base, 2),
            "commission": commission,
            "rate": rate,
            "status": status,
            "listVerified": False,
            "reason": "list not verified — used charged as base",
        }

    list_price = round(float(list_price), 2)
    difference = round(charged - list_price, 2)

    if charged >= list_price - 1e-9:
        # at or over list: commission on charged
        base = charged
        status = "ok" if abs(difference) < 0.01 else "oversold"
    else:
        # undersold: base = list − 0.5 × shortfall
        shortfall = list_price - charged
        base = round(list_price - 0.5 * shortfall, 2)
        status = "undersold"

    commission = round(rate * base, 2)
    return {
        "listPrice": list_price,
        "charged": round(charged, 2),
        "difference": difference,
        "commissionBase": round(base, 2),
        "commission": commission,
        "rate": rate,
        "status": status,
        "listVerified": True,
        "reason": None,
    }


# Back-compat aliases used by calculator UI
def compute_commission(rate: float, charged: float, list_price: Optional[float]):
    return commission_from_list_and_charged(rate, charged, list_price)
