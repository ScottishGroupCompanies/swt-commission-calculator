#!/usr/bin/env python3
"""
SWT Commission Calculator — data build / refresh (READ-ONLY Zoho).

Usage (from the repo root):
  python3 scripts/build_commission_data.py            # fetch Books details + write data/source/jobs.json
  python3 scripts/build_commission_data.py --assemble # skip fetch; assemble from data/raw/details
  python3 scripts/build_commission_data.py --fetch-only
  node scripts/build-snapshot.mjs                     # package src/data/snapshot.json for the app

Requires .env with ZOHO_REFRESH_TOKEN, ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET.
Never commit .env. Master sheet dump: data/raw/sheet_2026.json.
Estimate index: data/raw/estimate_index.json (or data/raw/estimates_p*.json).

Commission dollars in jobs.json come from scripts/engine/commission.py.
The app ignores them and recalculates with src/lib/commission.ts.
"""
from __future__ import annotations

import argparse, csv, json, os, re, sys, time, unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "source"
DETAILS = RAW / "details"
ENV_PATH = ROOT / ".env"
CATALOG_CSV = ROOT / "data" / "source" / "swt-film-catalog.csv"

RATES = {
    "Dana Hojnacki": 0.07,
    "Amy Haley": 0.05,
    "Blake Parish": 0.15,
    "Scott Gafney": 0.15,
    "John": 0.15,
}
ALIASES_DESIGNER = {k.lower(): k for k in RATES}
for k in list(RATES):
    ALIASES_DESIGNER[k.split()[0].lower()] = k

FILM_ALIASES = {
    "nv 15": "Night Vision 15 (NV-15) - Sun Control Film",
    "nv-15": "Night Vision 15 (NV-15) - Sun Control Film",
    "nv15": "Night Vision 15 (NV-15) - Sun Control Film",
    "prestige 50": "Prestige 50",
    "3m prestige 50": "Prestige 50",
    "elegant frost": "Frost (NRM PS2) - Elegant Frost",
    "llumar elegant frost": "Frost (NRM PS2) - Elegant Frost",
    "frost": "Frost (NRM PS2) - Elegant Frost",
    "privacy frost": "Frost (NRM PS2) - Elegant Frost",
    "gcl ps6": "GCL SR PS6 - Graffiti",
    "gcl ps4": "GCL SR PS4 - Graffiti",
    "gcl": "GCL SR PS6 - Graffiti",
    "graffiti": "GCL SR PS6 - Graffiti",
    "drds15": "SunTek DRDS 15",
    "drds 15": "SunTek DRDS 15",
    "drds25": "SunTek DRDS 25",
    "drds 25": "SunTek DRDS 25",
    "v28": "V 28 SR CDF - Dual Reflective",
    "v 28": "V 28 SR CDF - Dual Reflective",
    "s70": "Safety S70 (SH7CLARL) - Safety/Security",
    "3m s70": "Safety S70 (SH7CLARL) - Safety/Security",
    "8mil": "SECURITY 8 MIL",
    "8 mil": "SECURITY 8 MIL",
    "clear 8mil": "SECURITY 8 MIL",
    "clear 8 mil": "SECURITY 8 MIL",
}

ORG = "848144102"


def load_env():
    env = {}
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text().splitlines():
            if not line.strip() or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    env.update({k: os.environ[k] for k in os.environ if k.startswith("ZOHO_")})
    return env


def access_token(env):
    data = urlencode({
        "refresh_token": env["ZOHO_REFRESH_TOKEN"],
        "client_id": env["ZOHO_CLIENT_ID"],
        "client_secret": env["ZOHO_CLIENT_SECRET"],
        "grant_type": "refresh_token",
    }).encode()
    req = Request("https://accounts.zoho.com/oauth/v2/token", data=data, method="POST")
    with urlopen(req, timeout=60) as r:
        tok = json.load(r)["access_token"]
    (ROOT / ".access_token").write_text(tok)
    (ROOT / ".access_token").chmod(0o600)
    return tok


def books_get(path, token, params=None):
    q = {"organization_id": ORG}
    if params:
        q.update(params)
    url = f"https://www.zohoapis.com/books/v3{path}?{urlencode(q)}"
    req = Request(url, headers={"Authorization": f"Zoho-oauthtoken {token}"})
    with urlopen(req, timeout=90) as r:
        return json.load(r)


def parse_money(s):
    if s is None or s == "":
        return None
    t = str(s).replace("$", "").replace(",", "").strip()
    try:
        return float(t)
    except ValueError:
        return None


def norm(s):
    s = unicodedata.normalize("NFKC", s or "").lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def load_catalog():
    catalog = []
    for r in csv.DictReader(open(CATALOG_CSV)):
        try:
            sell = float(r["sell_per_sf"])
            grp = int(float(r["pricing_group"]))
        except Exception:
            continue
        try:
            cost = float(r["cost_per_sf"] or 0)
        except Exception:
            cost = 0.0
        catalog.append({
            "manufacturer": r["manufacturer"],
            "product": r["product"].strip(),
            "cost": cost,
            "group": grp,
            "sell": sell,
        })
    by = {}
    for c in catalog:
        by[norm(c["product"])] = c
        by[norm(c["product"].split("-")[0])] = c
    for alias, product in FILM_ALIASES.items():
        target = next((c for c in catalog if c["product"] == product or product in c["product"]), None)
        if target:
            by[norm(alias)] = target
    return catalog, by


def match_film(description, item_name, catalog_by):
    text = f"{description or ''} {item_name or ''}"
    n = norm(text)
    keys = sorted(catalog_by.keys(), key=len, reverse=True)
    for k in keys:
        if len(k) >= 3 and k in n:
            return catalog_by[k], k
    m = re.search(r"(?:film:|install)\s+([A-Za-z0-9][A-Za-z0-9 ./\-]{2,60})", description or "", re.I)
    if m:
        cand = norm(m.group(1))
        for k in keys:
            if len(k) >= 3 and (k in cand or cand in k):
                return catalog_by[k], k
    # category fallbacks when description is vague
    iname = norm(item_name or "")
    if "graffiti" in iname or "grafitti" in iname:
        return catalog_by.get(norm("GCL SR PS6 - Graffiti")), "category:graffiti"
    if "frost" in iname or "privacy" in iname:
        return catalog_by.get(norm("Frost (NRM PS2) - Elegant Frost")), "category:frost"
    return None, None


def extract_dims(description):
    """Return list of (W,H,qty) inches if present."""
    dims = []
    for m in re.finditer(r"(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)(?:\s*\(x?\s*(\d+)\))?", description or "", re.I):
        w, h = float(m.group(1)), float(m.group(2))
        q = int(m.group(3) or 1)
        dims.append((w, h, q))
    return dims


def detect_addons(description):
    d = (description or "").lower()
    return {
        "removal": "removal" in d or "remove existing" in d,
        "cbond": "cbond" in d or "c-bond" in d or "c bond" in d,
        "french": "french" in d,
    }


def is_fee_line(li):
    name = (li.get("name") or "").lower()
    if "fee" in name:
        return True
    for cf in li.get("item_custom_fields") or []:
        if cf.get("api_name") == "cf_category" and str(cf.get("value") or "").lower() == "fee":
            return True
    return False


def base_zoho_key(num):
    n = (num or "").upper().replace(" ", "")
    m = re.match(r"(WT-\d+)", n)
    return m.group(1) if m else n


def load_master_jobs():
    sheet = json.load(open(RAW / "sheet_2026.json"))
    rows = sheet["data"]["range_details"]
    jobs = []
    for i, r in enumerate(rows[1:], start=2):
        while len(r) < 10:
            r.append("")
        client, zoho, jobn, designer, jtype, ftype, loc, dsold, total, month = r[:10]
        dkey = ALIASES_DESIGNER.get((designer or "").strip().lower())
        if (designer or "").strip().lower() in ("john",) or (designer or "").strip().lower().startswith("john "):
            dkey = "John"
        if not dkey:
            continue
        jt = parse_money(total)
        if jt is None or jt <= 0:
            continue
        if (jtype or "").lower() == "cancelled":
            continue
        jobs.append({
            "sheet_row": i,
            "client": client,
            "zoho": (zoho or "").strip(),
            "jobNumber": (jobn or "").strip(),
            "designer": dkey,
            "jobType": jtype,
            "filmType": ftype,
            "location": loc,
            "dateSold": dsold,
            "charged": jt,
            "monthSold": month,
            "rate": RATES[dkey],
        })
    return jobs


def load_estimate_index():
    """Prefer estimate_index.json; else rebuild from list pages."""
    idx_path = RAW / "estimate_index.json"
    if idx_path.exists():
        return json.load(open(idx_path))
    return {"matched_jobs": [], "missed_jobs": []}


def fetch_all_details(token, estimate_ids):
    DETAILS.mkdir(parents=True, exist_ok=True)
    pending = [eid for eid in estimate_ids if not (DETAILS / f"{eid}.json").exists()]
    print(f"fetch details: {len(estimate_ids)} total, {len(pending)} pending", flush=True)

    def one(eid):
        try:
            data = books_get(f"/estimates/{eid}", token)
            est = data.get("estimate") or data
            (DETAILS / f"{eid}.json").write_text(json.dumps(est))
            return eid, None
        except Exception as e:
            return eid, str(e)

    errors = []
    with ThreadPoolExecutor(max_workers=12) as ex:
        futs = [ex.submit(one, eid) for eid in pending]
        done = 0
        for fut in as_completed(futs):
            eid, err = fut.result()
            done += 1
            if err:
                errors.append((eid, err))
            if done % 50 == 0 or done == len(futs):
                print(f"  fetched {done}/{len(futs)}", flush=True)
            time.sleep(0.02)
    print(f"fetch done; errors={len(errors)}", flush=True)
    if errors[:5]:
        print("sample errors", errors[:5], flush=True)


def compact_lines(est, catalog_by):
    films = []
    fee = 0.0
    flags = []
    for li in est.get("line_items") or []:
        if is_fee_line(li):
            fee += float(li.get("item_total") or 0)
            continue
        desc = li.get("description") or ""
        name = li.get("name") or ""
        qty = float(li.get("quantity") or 0)
        rate = float(li.get("rate") or 0)
        amount = float(li.get("item_total") or 0)
        unit = (li.get("unit") or "").lower()
        match, matched_key = match_film(desc, name, catalog_by)
        addons = detect_addons(desc)
        dims = extract_dims(desc)
        sf = None
        lump = False
        if unit == "sf" and qty > 1.5:
            sf = qty
        elif unit == "sf" and qty == 1 and rate > 50:
            lump = True
            flags.append("no_sf_lump_sum")
        elif qty > 0 and unit == "sf":
            sf = qty
        film_label = None
        sell = None
        group = None
        if match:
            film_label = match["product"]
            sell = match["sell"]
            group = match["group"]
        else:
            # try pull a readable hint from description
            m = re.search(r"(?:install|Film:)\s+([^\n.]+)", desc, re.I)
            film_label = (m.group(1).strip() if m else name)[:80]
            flags.append("film_not_in_catalog")
        if sf is None and not lump:
            if dims:
                # geometric glass SF as fallback
                sf = sum((w * h / 144.0) * q for w, h, q in dims)
                flags.append("sf_from_dims_glass")
            else:
                flags.append("no_sf")
        films.append({
            "itemName": name,
            "description": desc[:240],
            "film": film_label,
            "catalogProduct": match["product"] if match else None,
            "sellPerSf": sell,
            "pricingGroup": group,
            "sf": sf,
            "chargedRate": rate if not lump else None,
            "lineAmount": amount,
            "lump": lump,
            "addons": addons,
            "dims": [{"w": w, "h": h, "qty": q} for w, h, q in dims],
            "matchedKey": matched_key,
        })
    return films, fee, sorted(set(flags))


def compute_list(films, override_list=None):
    if override_list is not None:
        return float(override_list), []
    total = 0.0
    notes = []
    ok = True
    for f in films:
        if f.get("listOverride") is not None:
            total += float(f["listOverride"])
            continue
        sell = f.get("sellPerSf")
        sf = f.get("sf")
        if sell is None or sf is None:
            ok = False
            continue
        line = sell * sf
        # add-ons if flagged (approximate job-level applied per film line that mentions them)
        add = f.get("addons") or {}
        if add.get("cbond"):
            line += 1.25 * sf
            notes.append("cbond+$1.25/sf")
        if add.get("removal"):
            line += 1.25 * sf
            notes.append("removal+$1.25/sf")
        total += line
    return (round(total, 2) if ok or total > 0 else None), notes


def commission(rate, list_prefee, charged_prefee):
    """Official policy. Prices exclude 4% fees. Pay is never negative.

    charged >= list → commission = rate × charged
    undersold by < 10% → rate × list − 0.5 × shortfall
    charged <= 90% of list → $0 unless a manager approved in writing
    no list → rate × charged (list not verified)
    """
    import sys
    sys.path.insert(0, str(ROOT / "scripts"))
    from engine.commission import compute_commission
    r = compute_commission(rate, charged_prefee, list_prefee)
    list_total = round(r["listPrice"] * 1.04, 2) if r["listPrice"] is not None else None
    # Map to legacy field names used by jobs.json / calculator
    sale = None
    ou = None
    if r["listVerified"] and r["listPrice"] is not None and charged_prefee is not None:
        # decompose for UI: at/over → sale on charged conceptually shown as total;
        # keep sale/ou for backwards display where useful
        if charged_prefee >= r["listPrice"] - 1e-9:
            sale = round(rate * charged_prefee, 2)
            ou = 0.0
        else:
            # Mild undersell and the approved floor both use rate × list − half the shortfall.
            sale = round(rate * r["listPrice"], 2)
            ou = round(r["commission"] - sale, 2)
    elif not r["listVerified"] and charged_prefee is not None:
        sale = round(rate * charged_prefee, 2)
        ou = 0.0
    return {
        "listPrefee": r["listPrice"],
        "listTotal": list_total,
        "difference": r["difference"],
        "commissionSale": sale,
        "commissionOU": ou,
        "commission": r["commission"],
        "commissionBase": r["commissionBase"],
        "listVerified": r["listVerified"],
        "status": r["status"] if r["status"] != "list_not_verified" else "needs_review",
    }


def assemble():
    catalog, catalog_by = load_catalog()
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "catalog.json").write_text(json.dumps(catalog))
    master = load_master_jobs()
    idx = load_estimate_index()
    by_zoho = {base_zoho_key(j["zoho"]): j for j in idx.get("matched_jobs", [])}
    # also map estimate_id
    jobs_out = []
    flagged = 0
    with_lines = 0
    for m in master:
        key = base_zoho_key(m["zoho"])
        match = by_zoho.get(key)
        estimate_id = match.get("estimate_id") if match else None
        films, fee, flags = [], 0.0, []
        est_number = None
        books_total = None
        quote_status = None
        accepted_date = None
        salesperson = None
        if estimate_id and (DETAILS / f"{estimate_id}.json").exists():
            est = json.load(open(DETAILS / f"{estimate_id}.json"))
            films, fee, flags = compact_lines(est, catalog_by)
            est_number = est.get("estimate_number")
            books_total = est.get("total")
            quote_status = (est.get("status") or "").strip().lower() or None
            accepted_date = est.get("accepted_date") or None
            salesperson = est.get("salesperson_name") or None
            with_lines += 1
        elif not estimate_id:
            flags.append("estimate_not_found")
        else:
            flags.append("estimate_detail_missing")

        list_prefee, addon_notes = compute_list(films)
        if list_prefee is None and films:
            flags.append("cannot_compute_list")
        if not films:
            flags.append("no_film_lines")

        calc = commission(m["rate"], list_prefee, m["charged"])
        status = calc["status"]
        reasons = []
        if "no_sf" in flags or "no_sf_lump_sum" in flags:
            status = "needs_review"
            reasons.append("no SF on quote")
        if "film_not_in_catalog" in flags:
            status = "needs_review"
            reasons.append("film not in catalog")
        if "cannot_compute_list" in flags or "no_film_lines" in flags or "estimate_not_found" in flags or "estimate_detail_missing" in flags:
            status = "needs_review"
            if "no_film_lines" in flags:
                reasons.append("no film lines")
            if "estimate_not_found" in flags:
                reasons.append("Books estimate not found")
            if "estimate_detail_missing" in flags:
                reasons.append("Books detail not loaded")
            if "cannot_compute_list" in flags and "cannot compute list" not in reasons:
                reasons.append("cannot compute list")
        if status == "undersold":
            reasons.append("undersold vs list")
        if status == "below_floor":
            reasons.append("below 10% floor")
        if status == "needs_review":
            flagged += 1

        jobs_out.append({
            "id": f"{m['zoho']}|{m['sheet_row']}",
            "client": m["client"],
            "zoho": m["zoho"],
            "jobNumber": m["jobNumber"],
            "designer": m["designer"],
            "rate": m["rate"],
            "location": m["location"],
            "dateSold": m["dateSold"],
            "monthSold": m["monthSold"],
            "jobType": m["jobType"],
            "filmType": m["filmType"],
            "charged": m["charged"],
            "estimateId": estimate_id,
            "estimateNumber": est_number or (match.get("estimate_number") if match else None),
            "quoteStatus": quote_status,
            "acceptedDate": accepted_date,
            "salesperson": salesperson,
            "booksTotal": books_total if books_total is not None else (match.get("books_total") if match else None),
            "fee": fee,
            "films": films,
            "listPrefee": calc["listPrefee"],
            "listTotal": calc["listTotal"],
            "difference": calc["difference"],
            "commissionSale": calc["commissionSale"],
            "commissionOU": calc["commissionOU"],
            "commission": calc["commission"],
            "status": status if status != "oversold" else "ok",  # oversold still OK badge with note
            "statusRaw": calc["status"],
            "reasons": reasons,
            "flags": flags,
            "addonNotes": addon_notes,
        })

    # Denver timestamp
    as_of = datetime.now().astimezone().strftime("%Y-%m-%d %I:%M %p %Z")
    payload = {
        "asOf": as_of,
        "asOfIso": datetime.now().astimezone().isoformat(),
        "rates": RATES,
        "policyNote": "Commission is $0 when charged is 10% or more below list, unless a manager approved the price in writing. Pay is never negative.",
        "jobCount": len(jobs_out),
        "flaggedCount": flagged,
        "withLinesCount": with_lines,
        "jobs": jobs_out,
        "catalogProducts": [c["product"] for c in catalog],
    }
    (OUT / "jobs.json").write_text(json.dumps(payload))
    # slim picker index
    picker = [{
        "id": j["id"],
        "zoho": j["zoho"],
        "jobNumber": j["jobNumber"],
        "client": j["client"],
        "designer": j["designer"],
        "dateSold": j["dateSold"],
        "charged": j["charged"],
        "status": j["status"],
    } for j in jobs_out]
    (OUT / "picker.json").write_text(json.dumps({"asOf": as_of, "jobs": picker}))
    print(json.dumps({
        "asOf": as_of,
        "jobs": len(jobs_out),
        "flagged": flagged,
        "withLines": with_lines,
        "out": str(OUT / "jobs.json"),
    }, indent=2))
    return payload


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--assemble", action="store_true")
    ap.add_argument("--fetch-only", action="store_true")
    args = ap.parse_args()
    RAW.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)

    if not args.assemble:
        env = load_env()
        token = access_token(env)
        idx = load_estimate_index()
        ids = sorted({j["estimate_id"] for j in idx.get("matched_jobs", []) if j.get("estimate_id")})
        if not ids and (RAW / "estimate_ids.txt").exists():
            ids = [l.strip() for l in open(RAW / "estimate_ids.txt") if l.strip()]
        fetch_all_details(token, ids)
        if args.fetch_only:
            return
    assemble()


if __name__ == "__main__":
    main()
