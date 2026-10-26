# Pilot verification — 26 October 2026

The pilot covers three declared study rectangles, not three complete cities. It publishes 4,375 Vienna, 4,685 Geneva and 2,328 Porto records. All published records pass runtime validation, identity checks, exact geographic bounds and SHA-256 verification.

## Checks performed

- Strict TypeScript, including external declarations (`skipLibCheck: false`).
- Type-aware Oxlint with React Compiler validation, and Oxfmt.
- 26 Vitest tests across source conformance, MSW catalogue requests, real-release regression, canopy fixtures and publication failure recovery.
- Chromium journeys for search suggestions, selection and close, history and reload, city isolation, wheel zoom, missing releases and mobile overflow.
- Desktop visual inspection with actual OpenStreetMap tiles in the in-app browser.
- Production build with the Oxc React Compiler enabled.

MSW tests exercise HTTP errors, corrupted bytes, wrong release identity and unavailable saved releases. Publication tests run the real preparation command in isolated directories and check that invalid input, metadata changes and publication failure cannot replace the previous valid pointer or its provenance. Local browser regression tests deliberately block external map tiles, so provider uptime cannot make those tests pass or fail.

## Findings incorporated

Geneva's documented stable ID appears four times for one source identifier. Those rows are retained independently and recorded as identity conflicts in the release report. Negative epoch timestamps are valid historical dates: a regression case preserves a 1962 planting year. Source envelope queries returned nine Vienna and 170 Geneva points outside the exact geographic windows; these are excluded explicitly, not silently counted as accepted records.

Release identity includes normalized rows and source metadata. Provenance and data are immutable; only the current manifest pointer changes. The first unpublished candidate files were replaced during development. Once published, releases must be retained for saved links.

## Interface review

| Before                                                    | After                                                        | Why                                                |
| --------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------- |
| Selected details could remain below the visible sidebar   | Selection focuses and reveals the heading                    | A map click gives visible and keyboard feedback    |
| Failed basemap tiles left an unexplained blank background | A tile failure message preserves usable inventory markers    | Missing map imagery is distinct from missing trees |
| Map code loaded with the initial interface                | The map loads in a separate chunk                            | Reduces the initial JavaScript payload             |
| One empty state for any geographic search                 | Outside-coverage notice for areas beyond the study rectangle | Unimported territory is distinct from zero matches |
| Press effects also applied to keyboard actions            | Pointer-only press feedback and reduced-motion rules         | Keyboard interaction stays immediate               |

## Not yet established

The Copernicus WMS returned a real image during a direct probe. Anonymous vector download returned HTTP 401. The local vector importer passes synthetic conformance fixtures, but an official Vienna vector file has not been imported end to end. No synthetic polygons are shipped as source data.

This pilot does not validate countrywide scale, partitioned spatial queries, physical-device touch behavior, screen-reader interaction, all browser engines or a mobile performance budget. Full address geocoding, translated interfaces, scheduled refreshes and an owned spatial API remain outside this pilot. The current complete-snapshot approach is intentionally bounded and should not be extended to whole countries by simply increasing file sizes.
