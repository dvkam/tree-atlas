# Expansion product review

## Spec and interface review

The country and inventory picker must expose all 44 published inventories. It must not present blocked candidates as usable. Selection changes the complete search scope and cancels the previous worker session. A place label describes source coverage; it does not promise complete municipal coverage.

Complete text search, first usable map and exact spatial filtering are separate milestones. Pending geometry must not turn a located record into an unlocated record or show partial area counts. Selecting a text result can load its detail shard before the global geometry asset finishes.

## Design review: before, after, why

| Before                                                                                                                                                                                                                     | After                                                                    | Why                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Ten inventory buttons                                                                                                                                                                                                      | A native location selector grouped by country, with 44 entries           | Keeps the control compact and supports the browser's keyboard and mobile selection controls.                      |
| Every search waited for the combined index                                                                                                                                                                                 | Complete text results and suggestions load before exact geometry         | People can find records while the map continues loading. The interface states that early map dots are unfiltered. |
| Loading could resemble an empty result                                                                                                                                                                                     | Separate messages for pending text, pending geometry and failed geometry | An incomplete transfer is not evidence that no tree matches.                                                      |
| Review principles follow the requested Emil design approach: preserve context, show progress where it affects the task, and make the next action clear. These are product judgments, not measured usability-study results. |

## Publication limits

Turin has a disclosed count mismatch. Frankfurt has three retained records with invalid native coordinates. Remarkable-tree collections remain selective. Five candidates need further access or licence evidence; Nottingham remains restricted. Historical performance reports retain their original scope. Current performance claims belong in [search performance](search-performance.md).
