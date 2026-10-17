#!/usr/bin/env python3
"""Estrae il confine della provincia di Foggia in un piccolo GeoJSON locale.

Sorgente: openpolis/geojson-italy (limiti delle province italiane).
Viene eseguito una tantum; il risultato (data/geo/foggia.geojson) e' committato
nel repository e servito staticamente dalla mappa.

Uso:
    python3 scripts/fetch_province_geo.py [percorso_geojson_sorgente]
"""

import json
import os
import sys
import urllib.request

SOURCE_URL = (
    "https://raw.githubusercontent.com/openpolis/geojson-italy/"
    "master/geojson/limits_IT_provinces.geojson"
)
OUT_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data",
    "geo",
    "foggia.geojson",
)
TOLERANCE = 0.0015  # gradi (~150 m)


def load_source(argv):
    if len(argv) > 1:
        with open(argv[1], "r", encoding="utf-8") as fh:
            return json.load(fh)
    req = urllib.request.Request(
        SOURCE_URL, headers={"User-Agent": "invasidicapitanata/0.1"}
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode("utf-8"))


def perp_distance(p, a, b):
    (px, py), (ax, ay), (bx, by) = p, a, b
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    cx, cy = ax + t * dx, ay + t * dy
    return ((px - cx) ** 2 + (py - cy) ** 2) ** 0.5


def simplify(points, tol):
    if len(points) < 3:
        return points
    dmax, index = 0.0, 0
    for i in range(1, len(points) - 1):
        d = perp_distance(points[i], points[0], points[-1])
        if d > dmax:
            dmax, index = d, i
    if dmax > tol:
        left = simplify(points[: index + 1], tol)
        right = simplify(points[index:], tol)
        return left[:-1] + right
    return [points[0], points[-1]]


def round_ring(ring):
    out = []
    for lon, lat in ring:
        pt = [round(lon, 5), round(lat, 5)]
        if not out or out[-1] != pt:
            out.append(pt)
    if len(out) >= 3 and out[0] != out[-1]:
        out.append(out[0])
    return out


def simplify_polygon(rings):
    return [round_ring(simplify(ring, TOLERANCE)) for ring in rings]


def main():
    data = load_source(sys.argv)
    feature = None
    for feat in data["features"]:
        if str(feat["properties"].get("prov_name", "")).lower() == "foggia":
            feature = feat
            break
    if feature is None:
        raise SystemExit("Provincia di Foggia non trovata nella sorgente.")

    geom = feature["geometry"]
    if geom["type"] == "Polygon":
        coordinates = simplify_polygon(geom["coordinates"])
    elif geom["type"] == "MultiPolygon":
        coordinates = [simplify_polygon(poly) for poly in geom["coordinates"]]
    else:
        raise SystemExit("Geometria non supportata: %s" % geom["type"])

    out = {
        "type": "Feature",
        "properties": {"name": "Provincia di Foggia", "reg_name": "Puglia"},
        "geometry": {"type": geom["type"], "coordinates": coordinates},
    }

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))

    size = os.path.getsize(OUT_PATH)
    print("Scritto %s (%.1f KB)" % (OUT_PATH, size / 1024.0))


if __name__ == "__main__":
    main()
