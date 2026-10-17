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
            last_err = f"HTTP {resp.status_code}"
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
    return p.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    start = dt.date.fromisoformat(args.start)
    end = dt.date.fromisoformat(args.end)
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    days = list(daterange(start, end))

    counts = {"ok": 0, "null": 0, "skip": 0, "error": 0}
    errors = []
    session = requests.Session()

    total = len(days)
    done = 0
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {}
        for day in days:
            fut = pool.submit(fetch_one, session, day, args.retries, args.backoff, args.force)
            futures[fut] = day
        for fut in as_completed(futures):
            kind, day, err = fut.result()
            counts[kind] += 1
            if err:
                errors.append({"date": day.isoformat(), "error": err})
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
        "counts": counts,
        "errors": errors,
    }
    SUMMARY_PATH.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(counts))
    if errors:
        print(f"{len(errors)} errors recorded in {SUMMARY_PATH}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
