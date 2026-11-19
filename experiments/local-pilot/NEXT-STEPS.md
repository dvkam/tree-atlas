# Next steps for the local pilot

The source remains on `pilot/carbon-postgres-local`. London query fixes pass the full four-city HTTP contract without trimming search coverage. All four complete offline browser journeys pass. Both public apps retain their current behavior; no push or deployment is authorized by this task.

1. **Complete fresh-userspace recovery proof.** Run the guarded [clean setup and restore procedure](CLEAN-ROOM.md), then record the committed source, fresh tool identities, independent canonical/normalized/dictionary/query verification, application checks and cleanup. Preserve failed attempts as failed evidence. Shared-kernel userspace proof does not establish a fresh VM or hosted operation.
2. **Reduce large-city offline memory and test real devices.** London reached 1,036 MiB PSS across its browser process tree and about 1,011 MiB during initial worker setup. Profile temporary copies, normalization/index construction and retained worker state. Keep every record searchable. Add memory-constrained Android/iOS checks and retained-profile browser-process restart tests before claiming mobile readiness.
3. **Broaden controlled performance and update tests.** Measure cold/uncontrolled versus warm query phases, uncached concurrent filtered queries, map bursts and explicit overload behavior. Requalify compatible release/app-shell updates and interrupted offline activation. Set device memory/storage budgets. Existing one-journey observations are not latency percentiles.
4. **Then plan hosting and recovery operations.** The future EUR 30/month self-hosting budget, online/offline scope and three-second first complete online-search target remain. Define HTTPS, admission limits, monitoring, backup retention, restore objectives, catalogue-last activation, old-release retention and rollback. Measure whole-service memory and peak import/WAL/temp/backup disk use. Recheck provider cost/stock/tax when hosting is requested; local timing is not a hosted wake-up pass.

The future monthly workflow still imports adapters' validated snapshots into new immutable releases. Do not update frozen canonical rows in place. No new municipal fetches, source adapters, automatic language fallback or provider purchase is part of this work.

Open decisions include long-term Carbon/native ownership, whether measured spatial needs justify PostGIS, offline street-basemap licensing/storage, recovery/retention goals and the eventual API origin. Restricted or unverified source research remains separate from this four-city pilot.

Read [workspace setup](README.md), [current validation](BRANCH-VALIDATION.md), [historical evidence](HISTORICAL-EVIDENCE.md), and the sealed [contract](tree-atlas-contract-v1/CONTRACT.md) before another implementation step.
