# Next steps after the local branch import

The source is now versioned on `pilot/carbon-postgres-local`; both public apps remain on their current behavior. No push or deployment is part of this work.

1. **Investigate London query deadlines locally.** The fresh quick HTTP checks returned 504 for `one-character` and `rare-genus` cases. Capture queue/summary/page/plan/cache phase timings, reproduce under controlled conditions, and compare old/new executables if needed. Keep all records, exact ordering/counts and the frozen deadline/error contract. Add a meaningful regression around an established cause before changing query code.
2. **Requalify the complete four-city HTTP contract.** After the cause is addressed, pass quick conformance and full unfiltered enumeration. Exercise short/broad queries, actual filtered middle/deep pages, distinct uncached concurrent searches and map interaction bursts. Keep overload errors explicit.
3. **Extend offline/browser evidence.** Porto passes the full real-browser offline journey. Repeat representative download/reload/search/map/saved-detail/eviction checks for London, Vienna and Geneva, especially London worker memory and browser storage. Test compatible release/app-shell updates and interrupted activation.
4. **Prove fresh-machine and restore reproducibility.** Pin/download/check the compiler and native clients, reproduce installation without the original sibling tool links, restore into a disposable database, and compare all canonical release digests. Measure API+Postgres+worker memory and peak import/WAL/temp/backup disk usage.
5. **Then plan activation and hosting.** The future EUR 30/month self-hosting budget, online/offline requirements and three-second first complete search target remain. Recheck actual stock/tax/backups; design HTTPS/admission/observability, catalogue-last activation, old-release retention and rollback. Hosted work or a public push needs a separate request. Do not treat a local running-backend timing as a hosted wake-up pass.

Open choices include long-term Carbon/native ownership, whether measured spatial needs justify PostGIS (not installed), offline street-basemap licensing/storage, recovery/retention goals and the eventual API origin. No fallback language, provider or new source import has been selected automatically.

The source adapters/monthly refresh proposal is still a future release workflow. The current database contains frozen validated releases; do not update those canonical rows in place. Restricted or unverified source research remains separate from this four-city pilot.

Read [workspace setup](README.md), [fresh validation and limits](BRANCH-VALIDATION.md), [historical evidence](HISTORICAL-EVIDENCE.md), and the sealed [contract](tree-atlas-contract-v1/CONTRACT.md) before implementing another step.
