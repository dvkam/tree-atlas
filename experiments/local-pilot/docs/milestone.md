# November milestone and work queue

22 November 2026. The two builds have independent review branches. [Draft PR #19](https://github.com/dvkam/tree-atlas/pull/19) carries the public interface changes. [Draft PR #1](https://github.com/dvkam/tree-atlas/pull/1) carries the local service and offline frontend. The pilot source check rejects edits to existing public application files.

## What changed and how to challenge it

| Behavior | Previous failure | Verification |
| --- | --- | --- |
| Public Porto search | In a Turkish browser, uppercase TILIA returned zero records while Tilia returned 2,676. | The new browser regression pinned the Porto release. It failed on the previous build under Turkish settings and passed under English. After the fix, both locales returned 2,676 matches for both forms and preserved the first 30 ordered record IDs. This case checks a real worker and URL submission. |
| London cluster selection | On the previous pilot, five of 302 marker centres on a 390 px phone map hit their intended cluster. | The camera-aware SQL and offline grid keep the badge inside its cell and place map controls outside the usable canvas. On the reviewed phone map all 21 cluster centres and four offset points per centre hit the right badge (105 of 105). Desktop passed 265 of 265. Opening a group exposed two pages of 60 distinct IDs and restored focus on close. After an offline reload the phone produced the same group counts and ordered sampled members. Single points in adjacent cells can still overlap. |
| Failed offline updates | A worker-only update with one failed precache fetch could delete the shell required to reopen a downloaded city. | Three Vite builds check cache identity for unchanged content and a worker-only edit. A real Chromium profile with Porto installed exercises a failed same-name update, a failed distinct-name update, retry, a waiting worker alongside an open tab and retirement after tab closure. Reopen the city offline and check the saved-detail journey. |
| Predictable controls | A search suggestion could survive Escape or outside click. Submitting a search could drop focus on the document. | Each independent build has a typed inventory combobox, semantic role tokens, lint rules and component tests. Keyboard navigation, composition input, dismissal, focus, popup position, trigger-origin motion and reduced motion are covered by the component guide and interaction tests. [Pilot component guide](ui-components.md) · [Public component guide](https://github.com/dvkam/tree-atlas/blob/fix/atlas-search-and-interface/docs/ui-components.md) |

The phone measurements used Chromium touch emulation. Physical Android and Safari behavior, network latency to a real host and whole-server resource usage remain open. A passing marker test measures whether a sampled tap hits the displayed badge. The frozen membership checks answer a different question about the source records represented by the group.

Review also found a valid, very small viewport coordinate that made the PostgreSQL map query return HTTP 503. SQL and offline grid arithmetic now handle this input. The final local HTTP run took 190.384 seconds. It enumerated all 1,657,347 ordered IDs across 16,576 unfiltered pages and matched each frozen city digest. It also checked 192 filtered reference pages, 16 suggestions, eight details, three extreme-coordinate cases, five viewport pages and three complete sampled group partitions. The service exited with zero borrowed database sessions. The filtered and spatial cases are samples.

The [per-inventory November 20 audit](../validation/public-catalogue-2026-11-20.json) records the release pins, row counts, mapped membership and source-quality flags for all 44 inventories. Use the [independent catalogue readers](../scripts/catalogue-audit) to repeat the search-index and map checks. The [handover](handover.md) explains which source-quality questions require municipal evidence.

## Work queue

Each issue contains the observed condition and acceptance criteria. Close an issue when the named behavior has been verified at its intended delivery stage. Capture the browser, release, branch and commit with a measurement.

| Track | Use the issue for |
| --- | --- |
| [#2 Overall performance](https://github.com/dvkam/tree-atlas/issues/2) | End-to-end baselines, physical phones, cold versus warm runs, first usable map and complete search. |
| [#3 UI and UX](https://github.com/dvkam/tree-atlas/issues/3) | Reproducible dead ends, predictable navigation, touch, keyboard, screen reader, offline and recovery. Read the [detailed design review](ux-ui-review.md). |
| [#4 Code quality](https://github.com/dvkam/tree-atlas/issues/4) | Component responsibilities, release boundaries, semantic tokens, documented props, lint and negative misuse tests in CI. |
| [#5 Map failure and independent search](https://github.com/dvkam/tree-atlas/issues/5) | Keep the list responsive if a map chunk or preview is missing or stalled. |
| [#6 Rotterdam decoding](https://github.com/dvkam/tree-atlas/issues/6) | Verify bytes and accents and repair a newly versioned release. |
| [#7 Source status and dimensions](https://github.com/dvkam/tree-atlas/issues/7) | Bordeaux status, suspect Geneva dates and cross-city extreme measurements. |
| [#8 Belfast starting extent](https://github.com/dvkam/tree-atlas/issues/8) | Initial camera and access to distant but retained coordinates. |
| [#9 Links and geolocation](https://github.com/dvkam/tree-atlas/issues/9) | Malformed parameters, wrong-city IDs and cancellation of obsolete location requests. |
| [#10 Startup metadata](https://github.com/dvkam/tree-atlas/issues/10) | Reduce the four-city pilot manifest and preserve release validation. |
| [#11 London SQL](https://github.com/dvkam/tree-atlas/issues/11) | Selective substrings, one-character terms, deep pages and overload. |
| [#12 Offline memory](https://github.com/dvkam/tree-atlas/issues/12) | Duplicate hash reads, cancellation, eviction, quota and device support. |
| [#13 Coverage and monthly refresh](https://github.com/dvkam/tree-atlas/issues/13) | Source units, update dates, complete staging and catalogue activation. |
| [#14 European blockers](https://github.com/dvkam/tree-atlas/issues/14) | Access and redistribution evidence for six withheld cities. |
| [#15 International candidates](https://github.com/dvkam/tree-atlas/issues/15) | Reproduce the [source survey](source-research.md) before adding a distribution. |
| [#16 Self-hosting](https://github.com/dvkam/tree-atlas/issues/16) | ARM qualification, hardware inspection, backups, fresh-host restore, hosting budget and network security. |
| [#17 Search scope and address lookup](https://github.com/dvkam/tree-atlas/issues/17) | Distinguish addresses, city selection and actual inventory matches. |
| [#18 Map edge cases](https://github.com/dvkam/tree-atlas/issues/18) | Public maximum-zoom groups, adjacent singleton tap targets, polar and wrapped cameras. |

Start the next release with Rotterdam decoding and saved-link recovery. Both can give a visitor the wrong answer even when the release files agree. In parallel, establish the physical-phone baseline before changing indexes, offline memory layout or hosting.
