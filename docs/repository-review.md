# Repository review

Reviewed on 26 October 2026 against baseline `63a438d`. This review covers application code, import scripts, tests, source attribution, documentation and the deployment workflow. The user request supplies the acceptance criteria: useful tree interaction before the full index downloads, complete search, measured cold-load improvements, UK source checks and documented interfaces.

This is a baseline review, not a claim that later changes have passed. Read the current verification and profiling reports for test results. Pocock's code-review structure separates correctness from the requested behaviour. Pstack's interrogation structure distinguishes actions from tradeoffs. Independent reviewers used the available agent model; the external model defaults named by the skill were unavailable.

## Findings to act on

### The complete index blocks tree interaction

`createInventorySession` in `src/inventory-client.ts` returns only after the worker reports readiness. The worker loads the complete search index first. The basemap can appear earlier, but users cannot inspect inventory trees until this work finishes. This is the main gap against the new request.

Publish a separate, release-pinned map representation. Small overview data can show initial distribution. Bounded spatial files must also expose individual trees and detail references at useful zooms. Load the complete search index independently. Keep global search visibly pending until it is complete; a partial index must not produce a false zero-result answer.

### The source download instructions are stale

`docs/sources.md` says that direct execution of `scripts/download-sources.mjs` is equivalent to `pnpm data:download`. The direct script now writes `original-provenance.json` for the first three sources. The combined downloader merges acquisition evidence into `provenance.json`. Correct the command description and retain the original document's three-source scope.

### Source documentation lacks a common entry point

The original three sources and the next three use separate chronological reports. Add one page per source, including its official interface, field units, identity limits, licence and acquisition checks. The new [source API reference](source-apis/index.md) provides that structure. Keep snapshot reports as dated evidence rather than treating their counts as permanent documentation.

## Tradeoffs to consider

### Import memory grows with the publication batch

`scripts/prepare.ts` prepares every source before it writes releases. The `prepared` array retains compressed output files for all sources. Sequential source parsing limits some memory use, but does not bound the combined output buffer. Measure peak memory as UK sources join the batch. A staging directory can retain the all-or-nothing manifest switch without retaining every asset buffer in memory.

### Public inventory coordinates do not define a city boundary

Amsterdam has source positions far outside the expected city area. The default camera already uses `viewBounds`, and the records remain searchable. Keep that distinction in future spatial routing. A record extent should not become an administrative coverage claim or proof that all trees inside the extent are included.

### More assets create more consistency obligations

A progressive map adds a second representation of each located record. The publisher must check IDs, coordinates, counts, detail references and release identity against the complete index. Cache keys must include immutable release identity. A failed tile or cell must produce a recoverable map error, not silently look like an empty area.

## Decisions to retain

- Keep React Strict Mode. `src/main.tsx` already enables it. Development checks can repeat setup and cleanup to expose leaked workers or map subscriptions. They do not cause production downloads to run twice. Test both development cleanup and the production build.
- Keep search and clustering in a worker. React receives bounded results rather than a million records.
- Keep unlocated records searchable. Exclude them only from operations that require coordinates.
- Keep source measurements distinct. Diameter, circumference, categories and approximate crown dimensions are not interchangeable.
- Keep source attribution separate from the application licence. The browser needs no upstream inventory credentials.
- Keep release-pinned links and checksum verification. A release mismatch must not mix map geometry with another release's details.

## Independent architecture comparison

| Option                                                                    | Benefit                                                | Cost or limit                                                | Judgement                                                  |
| ------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------ | ---------------------------------------------------------- |
| Optimize only the complete index                                          | Few new interfaces                                     | Tree interaction still waits for the full download           | Insufficient for the request                               |
| Publish an overview only                                                  | Small initial map payload                              | Clusters cannot provide individual tree details              | Useful first stage, insufficient alone                     |
| Publish overview and bounded spatial records; load full search separately | Early map interaction and complete eventual search     | Extra publication checks, asset caching and readiness states | Preferred candidate                                        |
| Add a live spatial backend                                                | Server-side queries can avoid a complete browser index | Hosting, availability, authentication and operating costs    | Consider when static asset costs or query needs justify it |

For the preferred candidate, cap both response size and rendered features. Coalesce repeated viewport requests. Cancel obsolete city work. Do not let tile downloads compete without limit with the index download. Measure bytes and time to the first selectable tree, full search readiness and a city switch. Report network and CPU conditions separately.

## Regression and conformance gates

Use the three agreed public interfaces:

1. **Source import:** validate schema, identity, units, geometry, duplicate handling and source status. UK overlap checks must distinguish a missing record from a duplicate compilation record.
2. **Published catalogue:** verify all located IDs appear in spatial publication, all records remain in search, detail references resolve, release checks agree and corrupt or missing assets fail visibly.
3. **User journeys:** hold the complete index request open. Confirm that users can pan, select an individual tree and read details. Confirm that search remains pending. Then release the index and verify a known record outside the first viewport. Switch cities during loading and check that no old response replaces the new view.

React profiling can identify excessive commits or expensive component work. It cannot explain download or worker decoding time by itself. Browser network timing and worker phase measurements are required for the cold-load bottleneck.

## Documentation completion plan

| Document         | Required update                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| README           | Explain early map readiness, complete search readiness, current source scope and source API links |
| Architecture     | Describe spatial assets, release invariants, cancellation, cache limits and failure states        |
| Profiling report | State device emulation, network limits, sample count, cold-cache method and phase timings         |
| Verification     | Record actual checks and unresolved failures after the final changes                              |
| Source API pages | Add each accepted UK source, licence evidence, field rules and coverage exclusions                |
| Operations       | Explain refresh, immutable asset retention, failed publication recovery and deployment rollback   |

The CI workflow already runs checks, builds the app and runs Chromium journeys before GitHub Pages deployment. Documentation should describe that gate. Do not report a successful local build as proof that the deployed URL serves the same release.

The new source pages use short instructions and explicit units. This wording borrows clarity principles from ASD STE100; it does not claim formal vocabulary or specification compliance.

## Review rounds and dispositions

The baseline review compared a smaller complete index, an overview-only map, bounded spatial leaves and a live backend. **Act:** use spatial leaves with early details and retain complete search in a worker. An overview-only map was dismissed because it cannot open individual records. **Consider:** a spatial backend when full-index transfer or memory becomes unacceptable; London remains a useful stress case.

A second independent review inspected release isolation, cancellation, count conservation, viewport edges and storage. **Act:** clamp early aggregate markers to their visible cell intersection. Counts still describe the whole cell, and the map labels that limit. **Act:** move cache writes off the display path; retain one active write, at most two pending writes and an 8 MiB pending-byte limit. **Act:** display a spatial-error notice while the full-index fallback loads. New regression tests cover these findings.

**Noted:** dense coincident records can remain aggregated until complete search is ready. **Retained:** Strict Mode, immutable releases, unknown measurements and searchable unlocated rows. **Blocked:** Nottingham redistribution, pending a specific applicable licence. No generic open-data statement was treated as permission for that layer.

The review used Pocock code-review guidance, Pstack interrogation and independent agents on the available model. It did not use unavailable external model services. The final checks cover all three agreed interfaces: import, published catalogue and user journeys. This is a reviewed change set, not a claim that all defects have been eliminated.

Documentation gaps were addressed in the README, per-city API pages, architecture, profiling, verification and [operations guide](operations.md). Unslop checks support the short, explicit wording; these documents do not claim formal ASD STE100 compliance.
