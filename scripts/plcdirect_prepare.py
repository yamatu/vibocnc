"""Convert the PLC Direct product export into the TSV consumed by backend/cmd/import-plcdirect.

Usage: python scripts/plcdirect_prepare.py <input.xlsx> <output.tsv.gz>

Price rule: Sealed Surplus price when > 0, otherwise Never Used Surplus price, otherwise 0 (inquiry).
"""
import collections
import gzip
import re
import sys

import openpyxl

COL_MPN, COL_BRAND, COL_PTYPE, COL_SERIES = 1, 4, 5, 6
COL_SEALED_PRICE, COL_NEVER_PRICE, COL_SPECS = 9, 12, 18

# Source brand -> brand name used by the site catalogue.
BRAND_MAP = {
    "siemens": "Siemens", "sirius": "Siemens", "scalance": "Siemens",
    "sick": "SICK",
    "schneider": "Schneider Electric", "schneider electric": "Schneider Electric",
    "honeywell": "Honeywell",
    "abb": "ABB",
    "yaskawa": "Yaskawa",
    "rexroth": "Bosch Rexroth", "indramat": "Bosch Rexroth",
    "general electric": "General Electric",
    "mitsubishi": "Mitsubishi", "mitsubishi electric": "Mitsubishi",
    "ge fanuc": "FANUC", "fanuc": "FANUC",
    "balluff": "Balluff",
    "festo": "Festo",
    "phoenix contact": "Phoenix Contact",
    "omron": "OMRON",
    "danfoss": "Danfoss",
    "keyence": "KEYENCE",
    "turck": "Turck",
    "parker hannifin": "Parker Hannifin",
    "eaton": "Eaton",
    "b&r": "B&R Industrial Automation",
    "leuze": "Leuze",
    "bently nevada": "Bently Nevada", "bentley nevada": "Bently Nevada",
    "vickers": "Vickers",
    "ifm": "ifm",
    "pepperl+fuchs": "Pepperl+Fuchs",
    "cutler hammer": "Cutler-Hammer",
    "lenze": "Lenze",
    "foxboro": "Foxboro",
    "yokogawa": "Yokogawa",
    "fuji electric": "Fuji Electric",
    "beckhoff": "Beckhoff",
    "kollmorgen": "Kollmorgen",
    "emerson": "Emerson",
    "moog": "Moog",
    "toshiba": "Toshiba",
    "delta": "Delta", "delta electronics": "Delta",
    "pilz": "Pilz",
    "control techniques": "Control Techniques",
    "woodward": "Woodward",
    "red lion": "Red Lion", "red lion controls": "Red Lion",
    "hitachi": "Hitachi",
    "proface": "Pro-face", "pro-face": "Pro-face",
    "triconex": "Triconex",
    "prosoft": "ProSoft Technology", "prosoft technology": "ProSoft Technology",
    "vacon": "Vacon",
}

MPN_OK = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ./_+#():=\-]*$")


def norm_key(value):
    return re.sub(r"[^A-Z0-9]", "", value.upper())


def clean(value):
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def to_price(value):
    try:
        price = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    return price if 0 < price < 100_000_000 else 0.0


def main(src, dst):
    ws = openpyxl.load_workbook(src, read_only=True).worksheets[0]
    rows = ws.iter_rows(values_only=True)
    next(rows)

    best = {}
    order = []
    stats = collections.Counter()
    unknown_brands = collections.Counter()
    for r in rows:
        stats["rows"] += 1
        mpn = clean(r[COL_MPN])
        raw_brand = clean(r[COL_BRAND])
        brand = BRAND_MAP.get(raw_brand.lower())
        if not brand:
            unknown_brands[raw_brand] += 1
            stats["skip_unknown_brand"] += 1
            continue
        if not mpn or len(mpn) > 90 or not MPN_OK.match(mpn) or len(norm_key(mpn)) < 3:
            stats["skip_bad_mpn"] += 1
            continue
        sealed, never = to_price(r[COL_SEALED_PRICE]), to_price(r[COL_NEVER_PRICE])
        if sealed > 0:
            price, cond = sealed, "sealed"
        elif never > 0:
            price, cond = never, "never"
        else:
            price, cond = 0.0, "none"
        rec = (brand, mpn, price, cond, clean(r[COL_SERIES])[:150], clean(r[COL_PTYPE])[:80], clean(r[COL_SPECS])[:4000])
        key = norm_key(mpn)
        prev = best.get(key)
        if prev is None:
            best[key] = rec
            order.append(key)
            continue
        stats["dup_in_file"] += 1
        # Prefer a priced row, then the hyphenated spelling (the manufacturer's format).
        if (price > 0, mpn.count("-")) > (prev[2] > 0, prev[1].count("-")):
            best[key] = rec

    with gzip.open(dst, "wt", encoding="utf-8", newline="") as out:
        out.write("brand\tmpn\tprice\tcondition\tseries\tproduct_type\tspecs\n")
        for key in order:
            brand, mpn, price, cond, series, ptype, specs = best[key]
            stats["written"] += 1
            stats["priced" if price > 0 else "inquiry"] += 1
            out.write("\t".join([brand, mpn, f"{price:.2f}", cond, series, ptype, specs.replace("\t", " ")]) + "\n")

    for k, v in stats.items():
        print(f"{k}: {v}")
    if unknown_brands:
        print("unmapped brands:", unknown_brands.most_common())


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
