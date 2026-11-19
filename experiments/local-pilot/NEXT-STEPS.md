# Next steps for the local pilot

The source remains on `pilot/carbon-postgres-local`. London query fixes pass the full four-city HTTP contract without trimming search coverage. All four complete offline browser journeys pass. Fresh userspace installation and an independently verified database restore also pass. Both public apps retain their current behavior. This work has no push or deployment step.

1. **Reduce large-city offline memory and test real devices.** London reached 1,036 MiB PSS across its browser process tree and about 1,011 MiB during initial worker setup. Profile temporary copies, normalization/index construction and retained worker state. Keep every record searchable. Add memory-constrained Android/iOS checks and retained-profile browser-process restart tests before claiming mobile readiness.
2. **Broaden controlled performance and update tests.** Measure cold and warm query phases, uncached concurrent filtered queries, map bursts and explicit overload behavior. Requalify compatible release/app-shell updates and interrupted offline activation. Set device memory/storage budgets. Existing one-journey observations are not latency percentiles.
3. **Define recovery and server operations.** The [clean userspace restore](CLEAN-ROOM.md) proves fresh dependencies and exact restored records on the shared WSL kernel. A fresh VM and production recovery drill remain untested. Define backup retention, restore objectives, catalogue-last activation, old-release retention and rollback. Measure whole-service memory and peak import/WAL/temp/backup disk use. Replace fixed workstation configuration paths before a server installation.
4. **Then revisit hosting.** The future EUR 30/month self-hosting budget, online/offline scope and three-second first complete online-search target remain. Design HTTPS, admission limits and monitoring. Recheck provider cost/stock/tax when hosting is requested. Local timing does not establish hosted cold-start performance.

The future monthly workflow still imports adapters' validated snapshots into new immutable releases. Do not update frozen canonical rows in place. This work does not fetch new municipal data, add source adapters, select a fallback language or buy hosting.

Open decisions include long-term Carbon/native ownership, whether measured spatial needs justify PostGIS, offline street-basemap licensing/storage, recovery/retention goals and the eventual API origin. Restricted or unverified source research remains separate from this four-city pilot.

Read [workspace setup](README.md), [current validation](BRANCH-VALIDATION.md), [historical evidence](HISTORICAL-EVIDENCE.md), and the sealed [contract](tree-atlas-contract-v1/CONTRACT.md) before another implementation step.
