#!/usr/bin/env python3
"""Build data/lookup.json from public Elections BC and Statistics Canada sources.

The voting-area to voting-place assignment table is not on the public feature
service. Full postal codes are not an open dataset. This script therefore
joins census forward sortation areas to current electoral districts by
boundary overlap, then attaches the voting places Elections BC published for
those districts. It does not invent a single assigned voting place.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import Point, shape
from shapely.strtree import STRtree
from shapely.validation import make_valid

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "lookup.json"

RETRIEVED = time.strftime("%Y-%m-%d", time.gmtime())
USER_AGENT = "bc-polling-place-lookup/1.0 (public civic lookup; rebuild script)"

PLACES_WFS = (
    "https://openmaps.gov.bc.ca/geo/pub/"
    "WHSE_HUMAN_CULTURAL_ECONOMIC.EBC_VOTING_PLACES_SP/ows"
)
PLACES_TYPE = "pub:WHSE_HUMAN_CULTURAL_ECONOMIC.EBC_VOTING_PLACES_SP"
EVENT_NAME = "2026 Provincial General Election"

DISTRICTS_WFS = (
    "https://openmaps.gov.bc.ca/geo/pub/"
    "WHSE_ADMIN_BOUNDARIES.EBC_PROV_ELECTORAL_DIST_SVW/ows"
)
DISTRICTS_TYPE = "pub:WHSE_ADMIN_BOUNDARIES.EBC_PROV_ELECTORAL_DIST_SVW"

FSA_QUERY = (
    "https://geo.statcan.gc.ca/geo_wa/rest/services/2021/"
    "Digital_boundary_files/MapServer/14/query"
)

PLACES_CSV = (
    "https://catalogue.data.gov.bc.ca/dataset/"
    "2e12376d-f68c-4c33-ac4f-82d1b5a65dc2/resource/"
    "b130ea8e-bd51-48f8-bdf6-60c55acbfbbf/download/ebc_voting_places_sp.csv"
)

WHERE_TO_VOTE = "https://elections.bc.ca/2026-provincial-election/where-to-vote/"
FINAL_HOURS_PHRASE = "Saturday, October 24 | 8 a.m. to 8 p.m. (Pacific time)"
ADVANCE_PHRASE = "Advance voting was available October 16-21."
CLOSED_PHRASE = "Voting is now closed for the 2026 provincial election."

# Overlaps smaller than this share of the census area are flagged. They are
# still published. A 1 square metre floor drops numeric edge noise only.
SMALL_SHARE = 0.01
SMALL_AREA_SQM = 2000000.0
MIN_OVERLAP_SQM = 1.0

TO_3005 = Transformer.from_crs("EPSG:4326", "EPSG:3005", always_xy=True)


def fetch_bytes(url: str, params: dict | None = None, timeout: int = 180) -> bytes:
    if params:
        url = url + "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    last_error: Exception | None = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")[:500]
            last_error = RuntimeError(f"HTTP {error.code} for {url}: {detail}")
            time.sleep(2**attempt)
        except Exception as error:  # noqa: BLE001 - retry network reads
            last_error = error
            time.sleep(2**attempt)
    raise RuntimeError(f"Failed to fetch {url}") from last_error


def fetch_json(url: str, params: dict | None = None, timeout: int = 180) -> dict:
    payload = fetch_bytes(url, params, timeout=timeout)
    return json.loads(payload.decode("utf-8"))


def wfs_features(
    base: str,
    type_name: str,
    *,
    cql: str | None,
    srs: str,
    page: int,
    sort_by: str | None,
) -> tuple[list, str | None]:
    features: list = []
    stamp = None
    start = 0
    matched = None
    while True:
        params = {
            "service": "WFS",
            "version": "2.0.0",
            "request": "GetFeature",
            "typeNames": type_name,
            "outputFormat": "application/json",
            "srsName": srs,
            "count": str(page),
        }
        # This server can page only when a sort field is set. A single page
        # does not need startIndex.
        if sort_by:
            params["sortBy"] = sort_by
            params["startIndex"] = str(start)
        if cql:
            params["CQL_FILTER"] = cql
        data = fetch_json(base, params)
        if "features" not in data:
            raise RuntimeError(f"Unexpected WFS response: {list(data)[:8]}")
        batch = data["features"]
        stamp = data.get("timeStamp") or stamp
        matched = data.get("numberMatched", matched)
        features.extend(batch)
        print(f"  {type_name} {len(features)}/{matched or '?'}", flush=True)
        if not batch:
            break
        start += len(batch)
        if not sort_by:
            break
        if matched is not None and start >= matched:
            break
        if len(batch) < page:
            break
    if matched is not None and len(features) != matched:
        raise RuntimeError(f"{type_name} returned {len(features)} features, matched {matched}")
    return features, stamp


def load_places() -> tuple[list[dict], str | None]:
    features, stamp = wfs_features(
        PLACES_WFS,
        PLACES_TYPE,
        cql=f"EVENT_NAME='{EVENT_NAME}'",
        srs="EPSG:4326",
        page=500,
        sort_by="VOTING_PLACE_ID",
    )
    places = []
    seen = set()
    for feature in features:
        props = feature["properties"]
        if props.get("EVENT_NAME") != EVENT_NAME:
            raise RuntimeError(f"Unexpected event {props.get('EVENT_NAME')}")
        geometry = feature.get("geometry") or {}
        lon = lat = None
        if geometry.get("type") == "Point":
            lon, lat = geometry["coordinates"]
            lon = round(float(lon), 6)
            lat = round(float(lat), 6)
        place = {
            "id": props.get("VOTING_PLACE_ID"),
            "addressId": props.get("ADDRESS_STANDARD_ID"),
            "building": (props.get("BUILDING_NAME") or "").strip(),
            "address": (props.get("STREET_ADDRESS") or "").strip(),
            "locality": (props.get("LOCALITY") or "").strip(),
            "code": (props.get("ED_ABBREVIATION") or "").strip(),
            "district": (props.get("ED_NAME") or "").strip(),
            "type": (props.get("VOTING_PLACE_TYPE") or "").strip(),
            "wheelchair": (props.get("WHEELCHAIR_ACCESSIBLE_IND") or "").strip(),
            "status": (props.get("STATUS") or "").strip(),
            "statusDate": (props.get("STATUS_DATE_TEXT") or "").strip(),
            "eventDate": (props.get("EVENT_DATE_TEXT") or "").strip(),
        }
        if props.get("VOTER_COUNT") not in (None, ""):
            place["voterCount"] = props["VOTER_COUNT"]
        tech = [props.get("ADV_TECH_TYPE") or "", props.get("FINAL_TECH_TYPE") or ""]
        if any(part.strip() for part in tech):
            place["tech"] = {
                "advance": (props.get("ADV_TECH_TYPE") or "").strip(),
                "final": (props.get("FINAL_TECH_TYPE") or "").strip(),
            }
        flags = [props.get(f"ADV_VOTING_DAY_{index}") for index in range(1, 7)]
        if any(flag not in (None, "") for flag in flags):
            place["advanceFlags"] = ["" if flag is None else str(flag) for flag in flags]
        if lon is not None:
            place["lon"] = lon
            place["lat"] = lat
        key = (
            place["code"],
            place["type"],
            place["addressId"],
            place["building"],
            place["address"],
            place["locality"],
        )
        if key in seen:
            continue
        seen.add(key)
        if not place["code"] or not place["address"] or not place["type"]:
            raise RuntimeError(f"Voting place is missing required fields: {place}")
        places.append(place)
    return places, stamp


def catalogue_csv_keys() -> int:
    import csv
    import io

    raw = fetch_bytes(PLACES_CSV).decode("utf-8-sig")
    rows = csv.DictReader(io.StringIO(raw))
    count = 0
    for row in rows:
        if (row.get("EVENT_NAME") or "").strip() == EVENT_NAME:
            count += 1
    return count


def load_districts() -> list[dict]:
    features, _stamp = wfs_features(
        DISTRICTS_WFS,
        DISTRICTS_TYPE,
        cql=None,
        srs="EPSG:3005",
        page=200,
        sort_by=None,
    )
    districts = []
    for feature in features:
        props = feature["properties"]
        geom = shape(feature["geometry"])
        if not geom.is_valid:
            geom = make_valid(geom)
        districts.append(
            {
                "code": (props.get("ED_ABBREVIATION") or "").strip(),
                "name": (props.get("ED_NAME") or "").strip(),
                "gazetteDate": (props.get("GAZETTE_DATE") or "")[:10],
                "boundarySetId": props.get("BOUNDARY_SET_ID"),
                "geometry": geom,
            }
        )
        if not districts[-1]["code"] or not districts[-1]["name"]:
            raise RuntimeError(f"District is missing a name: {props}")
    if len(districts) != 93:
        raise RuntimeError(f"Expected 93 electoral districts, got {len(districts)}")
    return districts


def load_fsas() -> list[dict]:
    features = []
    offset = 0
    page = 4
    while True:
        data = fetch_json(
            FSA_QUERY,
            {
                "where": "PRUID='59'",
                "outFields": "CFSAUID,LANDAREA",
                "returnGeometry": "true",
                "outSR": "3005",
                "f": "geojson",
                "orderByFields": "CFSAUID",
                "resultOffset": str(offset),
                "resultRecordCount": str(page),
            },
            timeout=240,
        )
        if data.get("error"):
            raise RuntimeError(data["error"])
        batch = data.get("features") or []
        features.extend(batch)
        print(f"  census forward sortation areas {len(features)}", flush=True)
        if not batch:
            break
        offset += len(batch)
        if not data.get("exceededTransferLimit") and len(batch) < page:
            break
    areas = []
    seen = set()
    for feature in features:
        code = (feature["properties"].get("CFSAUID") or "").strip().upper()
        if code in seen:
            continue
        seen.add(code)
        geom = shape(feature["geometry"])
        if not geom.is_valid:
            geom = make_valid(geom)
        if geom.is_empty or geom.area <= 0:
            raise RuntimeError(f"{code} has no area")
        areas.append({"code": code, "geometry": geom})
    if len(areas) != 191:
        raise RuntimeError(f"Expected 191 British Columbia census forward sortation areas, got {len(areas)}")
    return areas


def confirm_where_to_vote_wording() -> None:
    html = fetch_bytes(WHERE_TO_VOTE).decode("utf-8", errors="replace")
    for phrase in (FINAL_HOURS_PHRASE, ADVANCE_PHRASE, CLOSED_PHRASE):
        if phrase not in html:
            raise RuntimeError(f"Where to Vote page no longer contains: {phrase}")


def intersect(fsas: list[dict], districts: list[dict]) -> dict[str, list[dict]]:
    geometries = [district["geometry"] for district in districts]
    tree = STRtree(geometries)
    overlaps: dict[str, list[dict]] = {}
    for area in fsas:
        geom = area["geometry"]
        hits = []
        for index in tree.query(geom):
            district = districts[int(index)]
            if not geom.intersects(district["geometry"]):
                continue
            shared = geom.intersection(district["geometry"]).area
            if shared < MIN_OVERLAP_SQM:
                continue
            share = shared / geom.area
            hits.append(
                {
                    "code": district["code"],
                    "share": round(share, 6),
                    "overlapSqm": round(shared, 1),
                }
            )
        hits.sort(key=lambda item: (-item["share"], item["code"]))
        overlaps[area["code"]] = hits
    return overlaps


def point_in_fsa(fsas: list[dict], lon: float, lat: float) -> str | None:
    easting, northing = TO_3005.transform(lon, lat)
    point = Point(easting, northing)
    for area in fsas:
        if area["geometry"].covers(point):
            return area["code"]
    return None


def build() -> dict:
    print("Checking Where to Vote page", flush=True)
    confirm_where_to_vote_wording()
    print("Downloading voting places", flush=True)
    places, stamp = load_places()
    print("Comparing catalogue CSV", flush=True)
    csv_count = catalogue_csv_keys()
    print("Downloading electoral districts", flush=True)
    districts = load_districts()
    print("Downloading census forward sortation areas", flush=True)
    fsas = load_fsas()
    print("Intersecting boundaries", flush=True)
    overlaps = intersect(fsas, districts)

    by_district: dict[str, list] = {district["code"]: [] for district in districts}
    missing_codes = sorted({place["code"] for place in places} - set(by_district))
    if missing_codes:
        raise RuntimeError(f"Voting places use district codes missing from the boundary file: {missing_codes}")
    for place in places:
        stored = {key: value for key, value in place.items() if key not in {"code", "district"}}
        by_district[place["code"]].append(stored)
    for code, rows in by_district.items():
        rows.sort(key=lambda row: (row["type"], row["building"], row["address"], row["id"] or 0))

    district_rows = [
        {
            "code": district["code"],
            "name": district["name"],
            "gazetteDate": district["gazetteDate"],
            "places": by_district[district["code"]],
        }
        for district in sorted(districts, key=lambda item: item["name"])
    ]

    auguston = next(
        (
            place
            for place in places
            if place["building"] == "Auguston Traditional Elem School"
            and place["address"] == "36367 Stephen Leacock Dr"
            and place["code"] == "ABM"
            and "Final" in place["type"]
        ),
        None,
    )
    if auguston is None or "lon" not in auguston:
        raise RuntimeError("Expected Auguston Traditional Elem School was not in the 2026 voting-place extract")
    auguston_fsa = point_in_fsa(fsas, auguston["lon"], auguston["lat"])
    if not auguston_fsa or not any(hit["code"] == "ABM" for hit in overlaps.get(auguston_fsa, [])):
        raise RuntimeError(
            f"Auguston point fell in {auguston_fsa}, which does not overlap Abbotsford-Mission"
        )

    types = Counter(place["type"] for place in places)
    statuses = Counter(place["status"] for place in places)
    wheelchair = Counter(place["wheelchair"] for place in places)
    event_dates = Counter(place["eventDate"] for place in places)
    if len(event_dates) != 1:
        raise RuntimeError(f"Expected one event date, found {dict(event_dates)}")
    print("Place types", dict(types))
    print("Statuses", dict(statuses))
    print("Wheelchair values", dict(wheelchair))
    print("Event dates", dict(event_dates))
    print("WFS places", len(places), "CSV places", csv_count)
    print("Districts", len(district_rows), "FSAs", len(fsas))
    empty = [code for code, hits in overlaps.items() if not hits]
    print("FSAs with no district overlap", empty)

    dataset = {
        "meta": {
            "retrieved": RETRIEVED,
            "wfsTimeStamp": stamp,
            "eventName": EVENT_NAME,
            "eventDate": next(iter(event_dates)),
            "placeCount": len(places),
            "catalogueCsvPlaceCount": csv_count,
            "catalogueCsvMatchesWfsCount": csv_count == len(places),
            "districtCount": len(district_rows),
            "fsaCount": len(fsas),
            "smallShareThreshold": SMALL_SHARE,
            "smallAreaSqm": SMALL_AREA_SQM,
            "minOverlapSqm": MIN_OVERLAP_SQM,
            "finalVotingText": FINAL_HOURS_PHRASE,
            "advanceVotingText": ADVANCE_PHRASE,
            "votingClosedText": CLOSED_PHRASE,
            "whereToVotePage": WHERE_TO_VOTE,
            "whereToVoteTool": "https://wheretovote.elections.bc.ca",
            "phone": "1-800-661-8683",
            "tty": "1-888-456-5448",
            "check": {
                "building": "Auguston Traditional Elem School",
                "fsaContainingPublishedPoint": auguston_fsa,
            },
        },
        "districts": {row["code"]: row for row in district_rows},
        "fsas": overlaps,
    }
    if not dataset["meta"]["catalogueCsvMatchesWfsCount"]:
        print("WARNING: catalogue CSV count differs from the WFS extract", file=sys.stderr)
    return dataset


def main() -> None:
    dataset = build()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(dataset, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
