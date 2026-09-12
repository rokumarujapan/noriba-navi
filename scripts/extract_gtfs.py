#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
extract_gtfs.py — build (or extend) js/data.js from an official Toei Bus GTFS-JP feed.

WHY THIS SCRIPT EXISTS
-----------------------
js/data.js was originally built by hand: filtering stop_times.txt with grep/awk/python,
one destination at a time, for a single origin stop (Shinagawa Sta. Takanawa Exit).
That was fine for validating the idea with 5 destinations, but it does not scale to
covering more origins (Shinjuku, Shibuya, Kinshicho, ...) or the full network by hand.

This script generalizes that manual process into something repeatable: point it at a
freshly downloaded GTFS-JP zip and a list of (origin stop_id prefix, destination
headsign) pairs, and it produces the same JSON shape used by js/data.js.

It intentionally does NOT try to be a generic "GTFS to app" framework — it encodes the
same assumptions we validated by hand while building the prototype:

  1. A physical boarding platform is identified by `stops.txt`'s `platform_code` column
     for a stop row, NOT by trusting a route number alone. The same platform can serve
     more than one destination, and the same destination can be reachable from more than
     one route — see note (2).
  2. A route number (route_short_name) is NOT a reliable way to identify "which service"
     you want. We found real cases in this feed where one route_short_name (e.g. 反96)
     splits into distinct directional services from different platforms, AND cases where
     one platform serves trips with different destination headsigns under the same route
     number (e.g. 品97 platform 7 serves both 新宿駅西口 and 青山一丁目駅前 trips). This
     script always filters stop_times.txt by the exact destination headsign text
     (stop_headsign, or trips.txt's trip_headsign when stop_headsign is blank), never by
     route_short_name alone.
  3. Service calendar patterns are grouped into three buckets using calendar.txt's
     service_id suffix convention observed in this feed: "-170" = weekday (Mon-Fri),
     "-160" = Saturday, "-100" = Sunday/public holiday. This is a simplification (it does
     not special-case irregular calendar_dates.txt exceptions such as year-end/New Year
     service) — good enough for a rider-facing "roughly what time does it run" view, not
     for exact date-by-date schedule accuracy.

USAGE
-----
  1. Download the current GTFS-JP zip for Toei Bus (from ODPT: https://www.odpt.org/)
     and unzip it, e.g. into ./gtfs_raw/.
  2. Edit the ROUTES_TO_EXTRACT list below: for each destination you want in the app,
     give the origin stop_id (the boarding stop, e.g. "0606-07"), the exact destination
     headsign text as it appears in the feed, and a short id/name for the destination.
  3. Run:  python3 extract_gtfs.py --gtfs-dir ./gtfs_raw --out ../js/data.js
     (or --merge to add to an existing data.js's destinations without touching origins
     you already extracted elsewhere).
  4. Re-open index.html — the app reads window.APP_DATA from js/data.js directly, no
     build step required.

This script only reads/writes plain text; it has no third-party dependencies beyond the
Python 3 standard library, so it runs anywhere Python 3 is installed.
"""

import argparse
import csv
import json
import os
import sys
from collections import defaultdict


# ---------------------------------------------------------------------------
# EDIT THIS: one entry per destination you want to (re)generate.
# `origin_stop_id` is the specific boarding-platform stop_id (stops.txt row), not the
# parent station id — that's what carries the real platform_code.
# `headsign` must match stop_times.txt's stop_headsign (or trips.txt's trip_headsign)
# EXACTLY, including any trailing text, or you will silently get zero trips.
# ---------------------------------------------------------------------------
ROUTES_TO_EXTRACT = [
    # dest_id      origin_id   origin_stop_id   headsign            travel_min (estimate; edit after checking shapes.txt)
    dict(dest_id="gotanda",  origin_id="shinagawa", origin_stop_id="0606-01", headsign="五反田駅",     travel_min=8),
    dict(dest_id="roppongi", origin_id="shinagawa", origin_stop_id="0606-05", headsign="六本木ヒルズ",  travel_min=25),
    dict(dest_id="oikeiba",  origin_id="shinagawa", origin_stop_id="0606-02", headsign="大井競馬場前",  travel_min=18),
    dict(dest_id="meguro",   origin_id="shinagawa", origin_stop_id="0606-03", headsign="目黒駅前",     travel_min=12),
    dict(dest_id="shinjuku", origin_id="shinagawa", origin_stop_id="0606-07", headsign="新宿駅西口",   travel_min=41),
]

# Name translations for destinations this script knows about. Add an entry here whenever
# you add a new dest_id above — the script will fall back to the Japanese headsign text
# for any language not listed.
DEST_NAMES = {
    "gotanda":  {"ja": "五反田駅",     "en": "Gotanda Sta.",             "zh": "五反田站",     "ko": "고탄다역"},
    "roppongi": {"ja": "六本木ヒルズ",  "en": "Roppongi Hills",           "zh": "六本木新城",    "ko": "롯폰기힐즈"},
    "oikeiba":  {"ja": "大井競馬場前",  "en": "Oi Racecourse",            "zh": "大井赛马场前",  "ko": "오이 경마장 앞"},
    "meguro":   {"ja": "目黒駅前",     "en": "Meguro Sta.",              "zh": "目黒站前",     "ko": "메구로역 앞"},
    "shinjuku": {"ja": "新宿駅西口",   "en": "Shinjuku Sta. West Exit",  "zh": "新宿站西口",    "ko": "신주쿠역 서쪽 출구"},
}

ORIGIN_NAMES = {
    "shinagawa": {"ja": "品川駅高輪口", "en": "Shinagawa Sta. (Takanawa Exit)", "zh": "品川站(高轮口)", "ko": "시나가와역(다카나와 출구)"},
}

# service_id suffix -> our three calendar buckets (see docstring point 3 above)
CALENDAR_SUFFIX_MAP = {"170": 170, "160": 160, "100": 100}


def read_csv_dicts(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def load_gtfs(gtfs_dir):
    def p(name):
        return os.path.join(gtfs_dir, name)

    stops = {row["stop_id"]: row for row in read_csv_dicts(p("stops.txt"))}
    routes = {row["route_id"]: row for row in read_csv_dicts(p("routes.txt"))}
    trips = {row["trip_id"]: row for row in read_csv_dicts(p("trips.txt"))}
    return stops, routes, trips


def calendar_bucket_for_service(service_id):
    """service_id looks like '06-170' (office_code-pattern) in this feed."""
    suffix = service_id.split("-")[-1]
    return CALENDAR_SUFFIX_MAP.get(suffix)


def extract_destination(gtfs_dir, stops, trips, spec):
    """
    Streams stop_times.txt once per call (it's 1M+ rows — too big to load fully into
    memory comfortably alongside everything else) and collects every departure from
    `origin_stop_id` whose destination text matches `headsign`.
    """
    origin_stop_id = spec["origin_stop_id"]
    headsign = spec["headsign"]

    stop_row = stops.get(origin_stop_id)
    if stop_row is None:
        print(f"  ! WARNING: stop_id {origin_stop_id} not found in stops.txt — skipping {spec['dest_id']}", file=sys.stderr)
        return None

    platform = stop_row.get("platform_code") or ""
    platform_lat = float(stop_row["stop_lat"])
    platform_lon = float(stop_row["stop_lon"])

    # buckets[calendar_bucket][hour] = set of "MM" strings
    buckets = defaultdict(lambda: defaultdict(set))
    route_short_name = None

    stop_times_path = os.path.join(gtfs_dir, "stop_times.txt")
    with open(stop_times_path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row["stop_id"] != origin_stop_id:
                continue
            row_headsign = row.get("stop_headsign") or ""
            trip = trips.get(row["trip_id"])
            if trip is None:
                continue
            if not row_headsign:
                row_headsign = trip.get("trip_headsign") or ""
            if row_headsign != headsign:
                continue  # this is exactly the filter that caught the 品97 mixing bug

            bucket = calendar_bucket_for_service(trip["service_id"])
            if bucket is None:
                continue

            dep = row["departure_time"]  # "HH:MM:SS", HH can be >23 for past-midnight trips
            hh, mm, _ = dep.split(":")
            hh = int(hh) % 24
            buckets[bucket][hh].add(mm)

            if route_short_name is None:
                route = None
                # trips.txt links to routes.txt via route_id
                route_id = trip.get("route_id")
                route_short_name = route_id  # resolved to the real short name by caller

    if not buckets:
        print(f"  ! WARNING: no matching departures for {spec['dest_id']} "
              f"(stop_id={origin_stop_id}, headsign={headsign!r}) — check the headsign text", file=sys.stderr)
        return None

    timetable = {}
    counts = {}
    for bucket, hours in buckets.items():
        timetable[bucket] = {str(h): sorted(mins) for h, mins in sorted(hours.items())}
        counts[bucket] = sum(len(mins) for mins in hours.values())

    return {
        "platform": platform,
        "platformLatLon": [platform_lat, platform_lon],
        "timetable": {**timetable, "counts": counts},
        "_route_id_seen": route_short_name,
    }


def resolve_route_short_name(routes, route_id):
    row = routes.get(route_id)
    return row["route_short_name"] if row else route_id


def build_data(gtfs_dir, feed_version):
    stops, routes, trips = load_gtfs(gtfs_dir)

    origins = {}
    destinations = {}

    for spec in ROUTES_TO_EXTRACT:
        oid = spec["origin_id"]
        if oid not in origins:
            origins[oid] = {
                "id": oid,
                "name": ORIGIN_NAMES.get(oid, {"ja": oid}),
                "lat": None,  # fill in manually if not already known — see README
                "lon": None,
                "destinations": [],
            }

        print(f"Extracting {spec['dest_id']} from stop {spec['origin_stop_id']} ({spec['headsign']}) ...")
        result = extract_destination(gtfs_dir, stops, trips, spec)
        if result is None:
            continue

        route_id = result.pop("_route_id_seen")
        route_short_name = resolve_route_short_name(routes, route_id)

        destinations[spec["dest_id"]] = {
            "id": spec["dest_id"],
            "origin": oid,
            "name": DEST_NAMES.get(spec["dest_id"], {"ja": spec["headsign"]}),
            "route": route_short_name,
            "routeId": route_id,
            "platform": result["platform"],
            "platformLatLon": result["platformLatLon"],
            "destLatLon": None,  # fill in manually — see README ("finding destination coordinates")
            "travelMin": spec["travel_min"],
            "timetable": result["timetable"],
        }
        origins[oid]["destinations"].append(spec["dest_id"])
        print(f"  -> route {route_short_name}, platform {result['platform']!r}, "
              f"{result['timetable']['counts']} trips/day by calendar bucket")

    return {
        "meta": {
            "feedVersion": feed_version,
            "generatedFrom": "extract_gtfs.py",
            "attribution": {
                "operator": "東京都交通局 (Tokyo Metropolitan Bureau of Transportation)",
                "operatorUrl": "https://www.kotsu.metro.tokyo.jp/",
                "dataProducer": "公共交通オープンデータ協議会",
                "dataProducerUrl": "https://www.odpt.org/",
                "license": "CC BY 4.0",
            },
        },
        "origins": origins,
        "destinations": destinations,
    }


def to_js(data):
    """Dump as `window.APP_DATA = <json>;` — valid JS since JSON is a JS subset."""
    return "window.APP_DATA = " + json.dumps(data, ensure_ascii=False, indent=2) + ";\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--gtfs-dir", required=True, help="Directory containing the unzipped GTFS-JP .txt files")
    ap.add_argument("--out", default="../js/data.js", help="Where to write the generated data.js")
    ap.add_argument("--feed-version", default="", help="feed_info.txt's feed_version, for the meta block (optional)")
    args = ap.parse_args()

    data = build_data(args.gtfs_dir, args.feed_version)
    js = to_js(data)

    with open(args.out, "w", encoding="utf-8") as f:
        f.write(js)

    print(f"\nWrote {args.out}")
    print("NOTE: destLatLon and origin lat/lon are left as null placeholders for anything")
    print("this script could not infer on its own — see README.md 'Extending the data' for")
    print("how to fill those in (grep the destination's terminal stop_id in stops.txt), and")
    print("note.md polyline (shapes.txt) extraction is not automated here yet.")


if __name__ == "__main__":
    main()
