#!/usr/bin/env python3
import argparse
import datetime as dt
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests

BASE_URL = "https://gesi.bonificacapitanata.it/api/v1/open_data/levels"
EARLIEST = dt.date(2018, 1, 1)

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
SUMMARY_PATH = ROOT / "data" / "fetch_summary.json"

HEADERS = {
    "User-Agent": "invasidicapitanata-open-data/0.1 (+https://github.com/)",
    "Accept": "application/json",
}


def daterange(start, end):
    cur = start
    while cur <= end:
        yield cur
        cur += dt.timedelta(days=1)


def observed_date(path):
    """Return the newest observation date contained in a raw response, if any."""
    try:
        text = path.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    if not text or text == "null":
        return None
    try:
        data = json.loads(text)
    except ValueError:
        return None
    if not isinstance(data, dict):
        return None
    dates = []
    for obj in data.values():
        if isinstance(obj, dict) and obj.get("date"):
            try:
                dates.append(dt.datetime.strptime(obj["date"].strip(), "%d/%m/%Y").date())
            except ValueError:
                pass
    return max(dates) if dates else None


def fetch_one(session, day, retries, backoff, force=False):
    path = RAW_DIR / f"{day.isoformat()}.json"
    if path.exists() and not force:
        return ("skip", day, None)
    url = f"{BASE_URL}?date={day.isoformat()}"
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            resp = session.get(url, headers=HEADERS, timeout=30)
            if resp.status_code == 200:
                text = resp.text.strip() or "null"
                path.write_text(text, encoding="utf-8")
                kind = "null" if text == "null" else "ok"
                return (kind, day, None)
            snippet = " ".join(resp.text.split())[:200]
            last_err = f"HTTP {resp.status_code}" + (f": {snippet}" if snippet else "")
        except requests.RequestException as exc:
            last_err = str(exc)
        time.sleep(backoff * attempt)
    return ("error", day, last_err)


def parse_args(argv=None):
    p = argparse.ArgumentParser(description="Download GESI daily reservoir levels.")
    p.add_argument("--start", default=EARLIEST.isoformat(), help="first date YYYY-MM-DD")
    p.add_argument("--end", default=dt.date.today().isoformat(), help="last date YYYY-MM-DD")
    p.add_argument("--workers", type=int, default=5)
    p.add_argument("--retries", type=int, default=4)
    p.add_argument("--backoff", type=float, default=0.75, help="base seconds between retries")
    p.add_argument("--force", action="store_true", help="re-download dates already on disk")
    p.add_argument(
        "--refresh-days",
        type=int,
        default=3,
        help="always re-download the last N days, to catch late-published data (0 disables)",
    )
    p.add_argument(
        "--stale-window-days",
        type=int,
        default=30,
        help="re-download recent files whose content is older than their filename (0 disables)",
    )
    p.add_argument(
        "--allow-errors",
        action="store_true",
        help="exit with status 0 even if some dates could not be downloaded",
    )
    return p.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    start = dt.date.fromisoformat(args.start)
    end = dt.date.fromisoformat(args.end)
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    days = list(daterange(start, end))

    force_days = set()
    if args.refresh_days > 0:
        force_days.update(days[-args.refresh_days :])
    if args.stale_window_days > 0:
        for day in days[-args.stale_window_days :]:
            path = RAW_DIR / f"{day.isoformat()}.json"
            if not path.exists():
                continue
            observed = observed_date(path)
            if observed is None or observed < day:
                force_days.add(day)

    if force_days:
        print(f"refresh: {len(force_days)} date(s) will be re-downloaded", flush=True)

    counts = {"ok": 0, "null": 0, "skip": 0, "error": 0}
    errors = []
    session = requests.Session()

    total = len(days)
    done = 0
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {}
        for day in days:
            force = args.force or day in force_days
            fut = pool.submit(fetch_one, session, day, args.retries, args.backoff, force)
            futures[fut] = day
        for fut in as_completed(futures):
            kind, day, err = fut.result()
            counts[kind] += 1
            if err:
                errors.append({"date": day.isoformat(), "error": err})
                print(f"ERROR {day.isoformat()}: {err}", file=sys.stderr, flush=True)
            done += 1
            if done % 250 == 0 or done == total:
                elapsed = time.time() - t0
                rate = done / elapsed if elapsed else 0
                print(
                    f"[{done}/{total}] ok={counts['ok']} null={counts['null']} "
                    f"skip={counts['skip']} error={counts['error']} ({rate:.1f}/s)",
                    flush=True,
                )

    summary = {
        "generated_at": dt.datetime.now().isoformat(timespec="seconds"),
        "start": start.isoformat(),
        "end": end.isoformat(),
        "refresh_days": args.refresh_days,
        "stale_window_days": args.stale_window_days,
        "counts": counts,
        "errors": errors,
    }
    SUMMARY_PATH.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(counts))
    if errors:
        print(f"{len(errors)} errors recorded in {SUMMARY_PATH}", file=sys.stderr)
        return 0 if args.allow_errors else 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
