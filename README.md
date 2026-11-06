# British Columbia polling place lookup

Unofficial lookup of official voting places for the 2026 provincial general election. Enter a Canadian postal code. The page lists the voting places Elections BC recorded for electoral districts whose published boundaries overlap that code’s 2021 census forward sortation area.

This is not an Elections BC service. It does not report the single voting place printed on a Where to Vote card, and it does not include election results.

## Run it locally

From this folder:

```bash
python3 -m http.server 8000
```

Open <http://127.0.0.1:8000/>. The page loads `data/lookup.json` with a fetch request, so opening the HTML file directly from disk will not search.

No build step is required to use the packaged file. No account, API key, or external script is used when the page runs.

## What a postal code matches

A Canadian postal code is checked for format (`A1A 1A1`). Only the first three characters are used after that. Those three characters are a census forward sortation area in the Statistics Canada 2021 Census Forward Sortation Area Boundary File, not a Canada Post delivery area, and not a voting area.

The page intersects those census boundaries with the current provincial electoral district boundaries. An overlap of at least 1 square metre is kept. An overlap is listed in a separate “smaller overlaps” group only when it is under 1% of the census area and under 2 km², because a thin overlap can come from the two boundary files not lining up. A large land area stays in the main list even when it is a small percentage of a very large forward sortation area. Elections BC says its boundary files should not be used to determine a voter’s electoral district or voting area.

Voting places come from the Elections BC voting-place point table for the event named `2026 Provincial General Election`. Each place is already tagged with an electoral district in that table. Places are not assigned by dropping the building point into a district.

The electoral-district menu on the page reads that table directly and does not use the boundary overlay.

## What this cannot show

- The voting place assigned to a residential address. Elections BC tells voters to use the Where to Vote card or [wheretovote.elections.bc.ca](https://wheretovote.elections.bc.ca).
- A full six-character postal code match. That crosswalk is not an open government file.
- Which voting area is assigned to which 2026 voting place. The assignment table `WHSE_HUMAN_CULTURAL_ECONOMIC.EBC_VOTING_AREA_VOTING_PLACES` includes the 2026 election, but the BC Data Catalogue exposes it through an emailed warehouse order, not a direct download. No 2026 spatial assignment layer was found on the public map services. The published 2024 assignment layer was not substituted.

For the assigned place, use the [Where to Vote page](https://elections.bc.ca/2026-provincial-election/where-to-vote/). That page, retrieved 6 November 2026, says voting is closed, gives Final Voting Day as Saturday, October 24, 8 a.m. to 8 p.m. (Pacific time), and says advance voting was available October 16–21. The same page lists toll-free 1-800-661-8683 and TTY 1-888-456-5448.

## Sources

Retrieved 6 November 2026.

| Source | What was used |
| --- | --- |
| [Provincial Voting Places](https://catalogue.data.gov.bc.ca/dataset/2e12376d-f68c-4c33-ac4f-82d1b5a65dc2) | Public feature service `WHSE_HUMAN_CULTURAL_ECONOMIC.EBC_VOTING_PLACES_SP`, filtered to the 2026 Provincial General Election. A catalogue CSV of the same table was counted as a check. |
| [Current Provincial Electoral Districts of British Columbia](https://catalogue.data.gov.bc.ca/dataset/current-provincial-electoral-districts-of-british-columbia) | Public feature service `WHSE_ADMIN_BOUNDARIES.EBC_PROV_ELECTORAL_DIST_SVW`, boundary set 11. |
| [2021 Census Forward Sortation Area Boundary File](https://www150.statcan.gc.ca/n1/en/catalogue/92-179-X2021001), catalogue 92-179-X | Digital boundary service, layer `FSA - lfsa000a21s_e`, British Columbia (`PRUID` 59). |
| [Where to Vote](https://elections.bc.ca/2026-provincial-election/where-to-vote/) | Hours, the closed-election statement, and the official lookup link. |
| [GIS spatial data](https://elections.bc.ca/resources/maps/gis-spatial-data/) | Warning against using the boundary files to determine a voter’s district or voting area. |

Contains information licenced under the [Elections BC Open Data Licence](https://www.elections.bc.ca/docs/EBC-Open-Data-Licence.pdf). Contains information licensed under the [Open Government Licence – Canada](https://open.canada.ca/en/open-government-licence-canada).

Postal code is an official mark of Canada Post Corporation.

The packaged file does not include electoral-district or census-area polygons. `scripts/build_lookup.py` downloads those boundaries, intersects them, and keeps the overlap table only.

## Rebuild the data file

```bash
python3 -m pip install shapely pyproj
python3 scripts/build_lookup.py
node --test scripts/match.test.mjs
```

The build stops if the Where to Vote page no longer contains the hours and closed-election sentences it copies, or if a published check point (Auguston Traditional Elem School in Abbotsford-Mission) does not fall in a census area that overlaps that district.

## Hosting

The site is static: `index.html`, `styles.css`, `app.js`, `src/match.js`, and `data/lookup.json`. It can be served by any static host, including GitHub Pages from this repository, with no custom domain.
