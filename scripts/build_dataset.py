#!/usr/bin/env python3
import csv
import datetime as dt
import json
from pathlib import Path

from xlsx_writer import write_xlsx

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
META_PATH = ROOT / "data" / "reservoirs.json"
CSV_PATH = ROOT / "data" / "levels.csv"
XLSX_PATH = ROOT / "data" / "levels.xlsx"
JS_PATH = ROOT / "data" / "levels.js"
STATS_PATH = ROOT / "data" / "stats.json"
GEO_PATH = ROOT / "data" / "geo" / "foggia.geojson"

ORDER = ["Occhito", "Capacciotti", "Capaccio", "Osento"]


def parse_it_number(value):
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    text = text.replace(".", "").replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return None


def to_iso(dmy):
    return dt.datetime.strptime(dmy.strip(), "%d/%m/%Y").date().isoformat()


def load_records():
    observations = {}
    for path in sorted(RAW_DIR.glob("*.json")):
        text = path.read_text(encoding="utf-8").strip()
        if not text or text == "null":
            continue
        data = json.loads(text)
        if not isinstance(data, dict):
            continue
        for name, obj in data.items():
            if not isinstance(obj, dict):
                continue
            try:
                iso = to_iso(obj["date"])
            except (KeyError, ValueError):
                continue
            key = (name, iso)
            if key in observations:
                continue
            level = parse_it_number(obj.get("level"))
            volume = parse_it_number(obj.get("capacity"))
            if volume is not None and volume < 0:
                volume = None
            if level is not None and level <= 0:
                level = None
            observations[key] = {
                "date": iso,
                "reservoir": name,
                "level_m": level,
                "available_m3": volume,
            }
    return observations


def build_series(observations):
    series = {name: [] for name in ORDER}
    for (name, iso), rec in observations.items():
        if name not in series:
            series[name] = []
            ORDER.append(name)
        series[name].append([iso, rec["level_m"], rec["available_m3"]])
    for name in series:
        series[name].sort(key=lambda row: row[0])
    return series


def compute_stats(series):
    stats = {}
    for name, rows in series.items():
        if not rows:
            continue
        levels = [(r[1], r[0]) for r in rows if r[1] is not None]
        volumes = [(r[2], r[0]) for r in rows if r[2] is not None]
        latest = rows[-1]
        entry = {
            "points": len(rows),
            "first_date": rows[0][0],
            "last_date": latest[0],
            "latest_level_m": latest[1],
            "latest_available_m3": latest[2],
        }
        if levels:
            entry["level_min"] = {"value": min(levels)[0], "date": min(levels)[1]}
            entry["level_max"] = {"value": max(levels)[0], "date": max(levels)[1]}
            entry["level_avg"] = round(sum(v for v, _ in levels) / len(levels), 2)
        if volumes:
            entry["volume_min"] = {"value": min(volumes)[0], "date": min(volumes)[1]}
            entry["volume_max"] = {"value": max(volumes)[0], "date": max(volumes)[1]}
            entry["volume_avg"] = round(sum(v for v, _ in volumes) / len(volumes), 2)
        stats[name] = entry
    return stats


def main():
    meta = json.loads(META_PATH.read_text(encoding="utf-8"))
    reservoirs_meta = meta["reservoirs"]

    observations = load_records()
    series = build_series(observations)
    stats = compute_stats(series)

    for name, entry in stats.items():
        usable = reservoirs_meta.get(name, {}).get("usable_capacity_m3")
        if usable and entry.get("latest_available_m3") is not None:
            entry["latest_pct_usable"] = round(100.0 * entry["latest_available_m3"] / usable, 1)

    CSV_PATH.parent.mkdir(parents=True, exist_ok=True)
    with CSV_PATH.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["date", "reservoir", "level_m", "available_m3"])
        for name in ORDER:
            for iso, level, volume in series.get(name, []):
                writer.writerow([iso, name, level, volume])

    write_workbook(reservoirs_meta, series, stats)

    last_dates = [entry["last_date"] for entry in stats.values() if entry.get("last_date")]
    payload = {
        "generated_at": dt.datetime.now().isoformat(timespec="seconds"),
        "source_last_date": max(last_dates) if last_dates else None,
        "source": meta.get("source", {}),
        "units": meta.get("units", {}),
        "order": ORDER,
        "reservoirs": {
            name: {
                "meta": reservoirs_meta.get(name, {}),
                "series": series.get(name, []),
            }
            for name in ORDER
        },
    }
    if GEO_PATH.exists():
        payload["geo"] = json.loads(GEO_PATH.read_text(encoding="utf-8"))
    full = dict(payload)
    full["stats"] = stats
    JS_PATH.write_text(
        "window.GESI_DATA = " + json.dumps(full, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    STATS_PATH.write_text(json.dumps({"generated_at": payload["generated_at"], "stats": stats}, ensure_ascii=False, indent=2), encoding="utf-8")

    total_points = sum(len(v) for v in series.values())
    print(json.dumps({
        "reservoirs": len(series),
        "observations": total_points,
        "latest": payload["source_last_date"],
        "csv_kb": round(CSV_PATH.stat().st_size / 1024, 1),
        "xlsx_kb": round(XLSX_PATH.stat().st_size / 1024, 1),
    }))


def write_workbook(reservoirs_meta, series, stats):
    summary = [[
        "Invaso", "Capienza utilizzabile (m3)", "Disponibilita attuale (m3)",
        "% capacita", "Data ultimo dato", "Min disponibilita (m3)", "Data minimo",
        "Max disponibilita (m3)", "Data massimo",
    ]]
    for name in ORDER:
        entry = stats.get(name, {})
        meta = reservoirs_meta.get(name, {})
        usable = meta.get("usable_capacity_m3")
        vmin = entry.get("volume_min", {})
        vmax = entry.get("volume_max", {})
        latest = entry.get("latest_available_m3")
        summary.append([
            meta.get("name", name),
            usable,
            latest,
            entry.get("latest_pct_usable"),
            entry.get("last_date"),
            vmin.get("value"),
            vmin.get("date"),
            vmax.get("value"),
            vmax.get("date"),
        ])

    sheets = [("Riepilogo", summary)]
    for name in ORDER:
        usable = reservoirs_meta.get(name, {}).get("usable_capacity_m3")
        rows = [["Data", "Livello (m s.l.m.)", "Disponibilita (m3)", "% capacita"]]
        for iso, level, volume in series.get(name, []):
            pct = None
            if usable and volume is not None:
                pct = round(100.0 * volume / usable, 1)
            rows.append([iso, level, volume, pct])
        sheets.append((name, rows))
    write_xlsx(XLSX_PATH, sheets)


if __name__ == "__main__":
    main()
