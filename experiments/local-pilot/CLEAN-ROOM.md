# Clean userspace setup and database recovery proof

The clean-room scripts test a fresh Ubuntu 24.04 userspace and a restored local
database without reusing the original compiler, native clients, Node installation,
frontend dependencies, package caches, private credentials or database files.
This is a clean container-style filesystem on the WSL kernel, not a fresh VM,
physical server, security sandbox or hosted deployment.

## Inputs and isolation

- Official Canonical minimal Ubuntu root filesystem, published build `20261105`,
  verified against the committed SHA-256 pin. The [official image directory](https://cloud-images.ubuntu.com/minimal/releases/noble/release/)
  and [SHA256 listing](https://cloud-images.ubuntu.com/minimal/releases/noble/release/SHA256SUMS)
  identify the image. If the moving URL changes, the pin fails rather than silently
  choosing a newer image.
- Native packages are installed from that image's signed Ubuntu package sources;
  the resulting exact `dpkg-query` manifest is retained. `policy-rc.d` prevents
  package scripts from starting services during installation. The helper checks
  that installed PostgreSQL clusters are down and no image processes remain.
  The package manifest records this run's versions. Future `apt` resolution can
  change because the package repositories are not locked to a snapshot.
- Node 26.13.0, Carbon nightly `2026.11.07`, libpq 17.11, ICU 78.3 and pnpm 11.25.0
  are fetched anew with pinned checksums/lockfile verification. No dependency
  directories or host home directory are mounted into the new userspace.
- Source and public data come from `git archive <recorded-commit>` of a **clean committed tree**.
  The exact commit and source archive SHA-256 are recorded. Uncommitted source,
  original sibling tools and ignored runtime files cannot leak into the snapshot.
  For a Windows-mounted checkout, the source export uses the fixed installed
  Windows Git executable with a separately converted repository argument; native
  Linux checkouts use Linux Git. This avoids rehashing 62,000 files through WSL's
  Windows filesystem bridge. Status checks have a 60-second limit, and archive
  uses the exact recorded commit rather than a moving `HEAD`. Host Git exports
  source only; application compilers and dependencies are still installed anew.
- The host PostgreSQL database is read only for `pg_dump -Fc -Z6`. There are no
  host DROP/CREATE/UPDATE operations. The backup archive is private to the native
  workspace and its hash/size/duration are recorded.
- Runtime executes in new mount, PID and network namespaces with only loopback
  enabled. The harness checks and records their IDs before mounting its own `/proc`.
  Its new PostgreSQL cluster may use `127.0.0.1:5432` and `tree_atlas_pilot` because
  that loopback network is separate from the existing server.
- `/dev` and the kernel are shared for the controlled local experiment. This is
  operational isolation, not an adversarial-code sandbox.
- Every forked namespace uses `--kill-child=KILL`; the PID namespace closes all
  owned children if the orchestrator times out. A real timeout regression checks
  that no test-owned long-lived child remains.

## Run in WSL

The host runner needs WSL root access, Python 3.12 or later, `unshare`, `mount`,
`chroot`, `ip`, and Git. A Windows-mounted checkout also needs WSL Windows
executable support and the installed Git at `C:\Program Files\Git\cmd\git.exe`.
The existing validated PostgreSQL database must accept local peer administration
for its read-only backup. The helper installs application prerequisites only
inside the new filesystem.

Complete ordinary source checks and commit the tested source first. Keep timing
benchmarks and other inventory tests quiescent during package builds, the dump and
restore. The native filesystem needs at least 12 GiB free, with at least 20 GiB
remaining on the Windows backing drive before starting. No host packages are
installed by this procedure.

From the repository root, run the guarded helper as WSL root:

```sh
sudo python3 experiments/local-pilot/scripts/clean-room.py --prepare
```

Preparation creates a new private directory such as
`/var/tmp/tree-atlas-clean-xxxxxxxx`, downloads and extracts the checked image,
installs only its prerequisite packages, and prints the workspace path. It does
not connect to the host database. No existing directory is overwritten.

When the source tree is clean and other query tests are stopped:

```sh
sudo python3 experiments/local-pilot/scripts/clean-room.py \
  --run --workspace /var/tmp/tree-atlas-clean-xxxxxxxx
```

The run refuses another source location, a reused cluster/dependency setup, an
unprepared directory or a workspace outside the dedicated native prefix. Keep
the terminal open; the source dump and fresh native-client/package build can
take several minutes. Private raw logs stay under the 0700 workspace. A final
summary is copied to the ignored `.verification/clean-room/report.json`.

## Recovery and checks

Inside the new network namespace, the run initializes a fresh PostgreSQL 16
cluster, creates newly generated restricted-role credentials, and restores the
backup into that cluster. It installs the **current source** API SQL functions,
runs ordinary VACUUM/ANALYZE, and verifies all 1,657,347 canonical records and
normalized columns with the existing independent read-only verifier. This also
checks complete identity/content/dictionary digests, all 48 frozen SQL query sets,
192 page slices, 16 suggestion cases and literal edge fixtures.

It then builds the Carbon/native inventory executable from the fresh compiler and
native clients, runs quick HTTP conformance, runs the frontend's strict source
checks and 63 regressions, builds the frontend, and exercises its documented
build/start/health/stop launcher against the isolated restored database. No
municipal service is called by runtime queries. This clean-room step does not
claim a new physical-browser, offline-memory or full HTTP enumeration pass; those
have their own checks.

The cluster is stopped in `finally`, reader sessions must be zero, and namespace
exit removes all owned runtime processes and mounts. The workspace, dump and
stopped cluster remain private for inspection; do not commit them or delete an
unverified computed path. Reported disk values are directory-size checkpoints,
not continuously sampled peak WAL/temp usage. Restoration time includes guarded
setup, restore, source SQL installation and VACUUM/ANALYZE; independent readback
and later application checks are timed separately.

## Evidence status

The fresh userspace and isolated restore passed on 19 November 2026. The run
executed committed source `06015e5d21e9a0cf16f2a14f8f53618a223abcb8`. It began at
07:22:21 UTC and completed at 07:26:19 UTC. The [sanitized qualification record](validation/clean-room-2026-11-19.json)
contains exact timestamps, source and archive hashes, package versions, test
counts and the SHA-256 of the private raw report.

| Phase | Observed time |
| --- | ---: |
| Download and extract Ubuntu image | 14.328 s |
| Install fresh native packages | 42.421 s |
| Export and extract committed source | 18.502 s |
| Read-only database backup | 7.739 s |
| Fetch and build fresh tools and frontend dependencies | 43.481 s |
| Set up and restore database, apply current SQL and indexes, VACUUM/ANALYZE | 47.255 s |
| Check every canonical record with the independent verifier | 78.222 s |
| Run quick HTTP conformance | 17.485 s |
| Run frontend source checks | 5.765 s |
| Exercise frontend launcher, including its build | 2.465 s |

The second command took 237.344 seconds in total. That includes source export,
backup, fresh dependencies and application checks. Preparation ran separately.
The phase table does not include every subprocess or measurement overhead.

The restored database contained all 1,657,347 records. London had 1,111,784,
Vienna 233,102, Geneva 240,827 and Porto 71,634. Every release retained its
validated status. The independent checker verified all normalized records,
identity and content digests, dictionary digests, 48 query sets, 192 page slices,
16 suggestion cases and 22 literal SQL cases.

The fresh Carbon build passed quick HTTP conformance with 192 selected pages,
16 suggestion cases, eight detail checks and the small complete-filter and map
membership cases. The frontend passed its six source checks, including all 63
regressions. Its Vite build and documented launcher passed. The final reader
session count was zero, the isolated cluster stopped, and the host process scan
found no process left inside the disposable filesystem.

This run installed PostgreSQL `16.15-0ubuntu0.24.04.1`, libmicrohttpd
`1.0.0-2.1ubuntu2`, json-c `0.17-1build1`, OpenSSL development libraries
`3.0.13-0ubuntu3.16` and GCC/G++ 13 `13.3.0-6ubuntu2~24.04.1`.
It fetched Node 26.13.0, Carbon nightly `2026.11.07+ca18985`, libpq 17.11,
ICU 78.3 and pnpm 11.25.0 anew. The frozen lockfile installed 157 frontend
packages with no reused packages.

The completed directory occupied 7,602,938,645 bytes, about 7.08 GiB. It includes
the retained image, source archive, copied public assets, downloads, dependencies,
backup, logs and stopped database. The restored database itself occupied
1,914,035,223 bytes. These are directory-size checkpoints, not peak disk or memory
measurements.

Earlier attempts found two setup defects. Linux Git took several minutes to
check the Windows-mounted checkout. The exporter now uses the fixed Windows Git
executable there, retains the full clean-tree check, limits its duration, and
archives the recorded commit. A genuinely fresh user also lacked `.config`.
The first database setup stopped at that missing parent before creating roles or
importing records. Setup now creates the missing parent with the correct owner
and private permissions. It preserves an existing real directory and rejects a
symlink or file. Executable regressions cover those cases. The successful run
used another new filesystem, new downloads, new credentials and a new cluster.
The failed workspace remains private and stopped.

The official Ubuntu HTTP mirror also timed out during the first preparation.
The helper uses the same signed official sources over HTTPS with bounded IPv4
retries. No package installation changed the host system.

The independent verifier retains a historical `date` label in its output. The
outer report records the actual execution timestamps above. The exported source
has no `.git` directory, so the outer commit and archive hash identify the HTTP
source as well. This run repeated quick HTTP checks. Full HTTP enumeration and
browser offline and memory checks have separate evidence. It did not repeat
those browser tests inside this filesystem or test a fresh VM, physical device,
hosted cold load, encrypted cancellation fault or production traffic.
