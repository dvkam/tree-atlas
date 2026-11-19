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
  package scripts from starting services during installation.
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

The scripts and input/timeout regressions are implemented. Actual clean-image
installation, restore and application results must be read from the completed
report; an input-test pass or a `prepared:true` report is not a recovery pass.
Never report a partial/failed run as a clean setup result. This document will
record the executed source commit and measured result after the run completes.
