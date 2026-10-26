# Mobile interface review

Reviewed with the Emil design-engineering and Pocock/Pstack architecture skills. The existing visual language is retained. City changes and map navigation are frequent actions, so they do not gain decorative transitions.

| Before                                                          | After                                                                                                        | Why                                                                                                       |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Every viewport request briefly removed the map results          | Results remain visible during viewport and pagination requests within the same inventory, release and filter | A moving map does not blink while the worker answers; a different city or filter still clears old results |
| Every result response rebuilt all Leaflet layers                | Identical marker and cluster layers are retained; changed or absent layers are replaced or removed           | Avoids unnecessary DOM and canvas work while keeping cluster actions tied to their actual content         |
| Selecting a tree rebuilt the result markers to change its style | The existing independent selected-tree overlay handles the highlight                                         | Selection does not need to recreate unrelated markers                                                     |
| Loading feedback appeared only below the mobile map             | The map names the inventory being opened and remains interactive                                             | People can distinguish a loading inventory from an empty map and can change their choice immediately      |
| Three-city wording and a single row of location controls        | General inventory wording and a three-column location grid                                                   | Six locations fit without horizontal scrolling or tiny touch targets                                      |
| Unlocated source records had no display path                    | Searchable list entries explain that their location is not recorded; the map does not invent coordinates     | Preserves source completeness without misleading map markers                                              |
| Search text used a 13 px input                                  | Search text uses 16 px                                                                                       | Avoids automatic input-focus zoom on iOS and improves readability                                         |

## Architecture comparison

| Criterion                       | Complete index with bounded verified-byte cache                                    | Prepared spatial tiles and partitioned text postings                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Complete search and saved links | Preserves the tested inventory interface and old release reader                    | Requires a new global postings/count contract and compatibility reader                                           |
| Memory                          | One parsed inventory worker; retained cache contains compressed bytes              | Can reduce active spatial data, but complete text queries need carefully bounded partition reads                 |
| Cold and repeat loads           | Cold index parse and clustering remain; returning locations avoid network transfer | Smaller first-map payload, with additional requests and publication work                                         |
| Interface depth                 | The existing query/suggest/detail/dispose surface hides caching and reconciliation | Can remain small for callers, but new partition state and completeness rules increase implementation obligations |
| Verification                    | Existing conformance and user journeys extend directly                             | Requires new cross-partition membership, totals, failure and version-consistency tests                           |

The complete-index candidate is the base for this iteration. It addresses return visits and map churn without changing search semantics. The partitioned candidate remains appropriate if representative-device measurements show unacceptable cold-load or memory costs. Provider vector tiles alone were rejected because they do not guarantee complete searchable records or consistent saved releases.

## Verification

Browser regressions cover unchanged cluster elements during pagination, mobile rapid city changes without stale records, complete counts after returning to a city with the ordinary HTTP cache disabled, existing wheel zoom and detail journeys, and horizontal overflow. CPU/network emulation is documented separately in [mobile performance](mobile-performance.md); it is not a physical-phone result.
