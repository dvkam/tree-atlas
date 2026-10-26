# Pilot verification — 26 October 2026

Full releases contain 233,102 Vienna, 240,827 Geneva canton and 71,634 Porto records: **545,563 total**. All acquired records have valid point coordinates; none were geographically excluded. Vienna uses before/after WFS counts, Geneva uses source ID-set reconciliation, and Porto uses the complete published GeoJSON. These checks do not prove a transactional upstream snapshot or a census of physical trees.

## Checks performed

- Strict TypeScript, type-aware Oxlint with React Compiler validation, and Oxfmt.
- Vitest source conformance, MSW catalogue failures, publication recovery, full-inventory regression and canopy fixtures.
- Eight Chromium journeys covering full counts, pagination, lazy details, cluster zoom, wheel zoom, city isolation, history, old-release links and mobile overflow.
- Production build with the Oxc React Compiler.
- Actual-inventory engine benchmark, including cluster count conservation and the 1,000-marker limit.

Full-inventory tests exercise records outside the original study windows, first and last result pages, detail loading and exact counts. Compressed assets are verified before decompression. Publication tests ensure failed input cannot replace the previous manifest. Browser tests block external tiles to avoid depending on basemap uptime.

## Findings incorporated

Six Geneva rows share two nominally stable source identifiers; all are retained with object-qualified, release-scoped identities. Historical negative epoch dates remain valid. One source date describes planting year 202: that record remains available with unknown planting year and a quality note preserving the original value.

Browser testing found that `.gz` filenames could trigger server content encoding and browser decompression before stored-byte verification. Opaque `.bin` assets resolve that ambiguity. Published study releases remain available; their links offer an explicit path to the full inventory.

## Interface review

| Before                                                  | After                                                     | Why                                                 |
| ------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------- |
| Small study windows                                     | Complete acquired inventories with visible source extents | Makes the expanded coverage explicit                |
| Many individual map markers                             | Bounded clusters, with counted coincident records         | Keeps map work bounded without dropping results     |
| Entire result list                                      | Thirty-record pages                                       | Bounds rendering and retains keyboard access        |
| All details downloaded up front                         | Verified detail shards loaded on selection                | Reduces initial transfer                            |
| Old links stayed within study areas without explanation | Archived-release notice and Open full inventory action    | Preserves links while making expansion discoverable |

## Limits

One local Chromium desktop run observed no main-thread tasks of at least 50 ms during measured cluster zoom and pan. Initial result readiness was 1.83 s for Vienna, 1.39 s for Geneva and 0.87 s for Porto. This was a development build with blocked basemap requests and no throttling, not a production or mobile performance guarantee. See [benchmark details](performance.md).

Real-device touch behavior, screen readers, other browser engines and mobile memory budgets remain unvalidated. The complete index per city is not a countrywide scaling claim. Address geocoding, translations, scheduled refreshes and cross-inventory search remain outside this pilot. Copernicus WMS was probed successfully, but official vector download requires authentication and has not been validated end to end; no synthetic polygons are shipped as observations.
