# Controlled source import

On 19 November 2026, the five existing local pilot folders were copied into this experimental branch without changing or deleting the originals. This records the imported source snapshot, before the branch's relocation/setup changes.

| Original folder | Original files retained | Retained bytes |
| --- | ---: | ---: |
| `tree-atlas-carbon-poc` | 49 | 195,433 |
| `tree-atlas-contract-v1` | 22 | 3,905,276 |
| `tree-atlas-postgres-pilot` | 20 | 100,320 |
| `tree-atlas-carbon-inventory-api` | 51 | 241,402 |
| `tree-atlas-local` | 85 | 1,227,093 |
| Total | 227 | 5,669,524 |

The sealed contract's 22 files were compared byte-for-byte with the original directory after copying. They were not edited or resealed. Sources, configuration, lockfiles, fixture data, runtime-generated Unicode source tables, checksum recipes, tests and selected historical reports were retained. The copied frontend baseline is the existing public app commit `8fb090145c0852a83dec1038fa663e7ba15e0de3`.

Downloaded compiler/client/ICU distributions, archives, dependency folders, compiled objects and extensionless callback executables, machine build logs, screenshots, traces, raw Playwright configuration reports, duplicate historical runs and upstream reference-only source copies were excluded. Two explicit compact historical summaries and a Unicode licence/notice were added; see [historical evidence](HISTORICAL-EVIDENCE.md) and [third-party material](THIRD-PARTY.md).

The import's candidate text files were inspected for private-key blocks, hardcoded quoted password assignments and nonempty sensitive JSON password/token/key values. None were found. That scoped inspection is not a universal secret-detection guarantee. The private WSL configuration files were not read. Runtime setup may create ignored local links and artifacts; they must not be staged as source.

These counts describe the initial controlled copy. Subsequent branch setup, documentation, tests and review fixes change the final file count. The original source copies and full raw verification evidence remain outside the Git repository, and nothing in this import acquires new municipal records or deploys a service.
