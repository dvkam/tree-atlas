# Publishing progress and testing a Raspberry Pi server

Research and local inspection date: 19 November 2026.

The initial assessment recommended publishing `pilot/carbon-postgres-local`
through a draft pull request into `main`, after a full source and secret review.
The subsequent request authorizes that branch push and draft PR if the review
has no publication blocker. See [the publication review](PUBLICATION-REVIEW.md).
A draft PR provides a review record. The runtime remains local, and this source
publication does not authorize a merge, issue creation, server configuration or
deployment. GitHub records the actual branch and PR state.

## Branch publication and review

The inspected [workflow](../../.github/workflows/check.yml) runs the public
application checks on pull requests and on pushes to `main`. Its Pages deployment
job requires both a push event and `refs/heads/main`. Pushing the pilot branch or
opening its PR does not satisfy that deployment condition. Merging into `main`
does. Check the workflow again before publication if it has changed.

The public root checks exclude `experiments/local-pilot`. A green PR check would
therefore cover the public app, not the Carbon/PostgreSQL/offline pilot. Add
dedicated pilot checks before making this experiment a required production path.
The existing local evidence remains useful and should appear in the PR body.

Use a draft PR for the full pilot branch. Keep the existing logical commits and
identify the tested revisions in the description. Mark it ready only when the
remaining issues have explicit acceptance criteria. GitHub prevents merging a
draft until it is marked ready. [GitHub draft PR documentation](https://docs.github.com/en/pull-requests/how-tos/create-pull-requests/changing-the-stage-of-a-pull-request).

Before the first public push:

1. Inspect the whole branch diff and every added historical report. Review the
   branch history as well as the final working tree.
2. Run `scripts/verify-source-import.py` for the committed source, or `--index`
   for staged changes. It checks unchanged public files, frozen hashes, archive
   hashes, binary artifacts and private-key markers. It is not a complete secret
   scanner.
3. Check for credentials, connection strings, database dumps, private logs and
   machine-specific data. Keep only sanitized evidence. Enable GitHub secret
   scanning and push protection as another check. These features do not detect
   every possible secret. [GitHub secret leakage guidance](https://docs.github.com/en/code-security/concepts/secret-security/secret-leakage-risks).
4. Check source and dataset attribution. The repository's MIT code licence does
   not replace dataset or dependency licences. Do not add a restricted inventory
   because the branch has a draft PR.

## Where the database lives

The actual PostgreSQL cluster is inside WSL, outside this Git checkout:

| Item | Current location |
| --- | --- |
| Running cluster data | `/var/lib/postgresql/16/main` |
| PostgreSQL server configuration | `/etc/postgresql/16/main/postgresql.conf` |
| Pilot database | `tree_atlas_pilot` in that cluster |
| Application credentials | `/home/david/.config/tree-atlas-postgres-pilot/` |
| Private restore experiments | `/var/tmp/tree-atlas-clean-*` |
| Ignored current verification reports | `experiments/local-pilot/.verification/` and component evidence directories |

Read-only inspection found `listen_addresses = localhost` and a pilot database
size of about 2.00 GB on disk. This is not a RAM requirement. The exact restored database in the clean-userspace proof
was 1,914,035,223 bytes. Neither figure includes all future WAL, temporary files,
retained releases or backups. See [the recovery proof](CLEAN-ROOM.md).

GitHub should contain code, schema/install scripts, source adapters, dependency
pins, tests, documentation and sanitized evidence. Keep `PGDATA`, database dumps,
password files and raw traces outside Git. The existing `public/data` files are
licensed, deliberately published static release assets. They are a different
artifact from the running PostgreSQL cluster or its backup.

On a Pi, store PostgreSQL's persistent data on the SSD. Keep backups on a second
device or encrypted remote storage too. A backup on the same SSD does not survive
that SSD failing. Use a logical `pg_dump`/`pg_restore` transfer between x86-64 and
ARM machines. Do not copy the live WSL data directory. PostgreSQL documents
logical dumps as the method for cross-architecture transfers. [PostgreSQL SQL
dump documentation](https://www.postgresql.org/docs/16/backup-dump.html).

## Raspberry Pi feasibility and practical starting specifications

A Raspberry Pi can run PostgreSQL. PostgreSQL documents ARM and Linux support.
That does not establish the throughput or memory use of this application on a
particular board. [PostgreSQL supported platforms](https://www.postgresql.org/docs/16/supported-platforms.html).

The user may have a Pi 3. The official Model B and Model B+ both have 1 GB RAM
and a 64-bit processor. Their USB ports are USB 2.0. Model B has 100 Mbps Ethernet;
Model B+ uses Ethernet over USB 2.0, with a stated maximum of 300 Mbps. A USB SSD
can be useful, but it does not remove those CPU, RAM and I/O constraints.
[Pi 3 Model B specifications](https://www.raspberrypi.com/products/raspberry-pi-3-model-b/),
[Pi 3 Model B+ specifications](https://www.raspberrypi.com/products/raspberry-pi-3-model-b-plus/).

Pi 3 Model A+ has 512 MB RAM and one USB 2.0 port. Confirm the exact model before
planning its role. [Pi 3 Model A+ specifications](https://www.raspberrypi.com/products/raspberry-pi-3-model-a-plus/).

Use an existing Pi 3 B/B+ for private database and recovery experiments. Its
1 GB RAM is a tight target for PostgreSQL, the OS, imports and the backend together.
The complete database need not fit in RAM, but disk reads and concurrent scans
will matter. We have no Pi measurement that supports the three-second search
target. Do not buy parts on the assumption that the current complete Carbon
backend already runs there.

Run these read-only commands on the Pi to confirm the board, operating-system
architecture, memory and storage. `aarch64` identifies a 64-bit ARM OS; a 64-bit
processor can still have a 32-bit OS installed.

```sh
tr -d '\0' < /proc/device-tree/model
uname -m
free -h
lsblk -o NAME,SIZE,TYPE,MOUNTPOINTS
```

These are engineering recommendations for the next full-service test, not
vendor minimum requirements or measured guarantees:

| Part | Practical starting point | More headroom |
| --- | --- | --- |
| Board and memory | Pi 4 or Pi 5 with 4 GB RAM | Pi 5 with 8 GB RAM |
| Operating system | Supported 64-bit Linux without a desktop | The same, with repeatable install/update instructions |
| Database storage | USB SSD with at least 32 GB free for the pilot experiment | Larger SSD with space for old releases, imports and backups |
| Networking | Wired Ethernet | Measured upstream bandwidth and a recovery plan for home outages |
| Power and cooling | Correct model-specific supply and adequate cooling | Active cooling for sustained Pi 5 work and power-loss protection |

Pi 4 provides USB 3.0 and Gigabit Ethernet. Pi 5 can use NVMe through the
appropriate M.2 HAT+. Raspberry Pi publishes a 64-bit Lite OS. The manufacturer
recommends active cooling for best sustained performance and documents the
Pi 5 power requirements. Check SSD and adapter power demand as well.
[Pi 4 specifications](https://www.raspberrypi.com/products/raspberry-pi-4-model-b/),
[M.2 HAT+ documentation](https://www.raspberrypi.com/documentation/accessories/m2-hat-plus.html),
[Raspberry Pi OS downloads](https://www.raspberrypi.com/software/operating-systems/),
[power and cooling documentation](https://www.raspberrypi.com/documentation/computers/raspberry-pi.html).

The 32 GB free-space recommendation allows room beyond today's roughly 2 GB
database. Peak restore/import/WAL space is still unmeasured. It is not a promise
that every future inventory will fit. The offline browser-memory measurements
belong to the client. They do not measure PostgreSQL's server RAM requirement.

## The current Carbon build has an ARM64 gate

Local `file -L` inspection identified both the installed Carbon compiler and
`tree-atlas-carbon-inventory-api/build/service` as x86-64 Linux ELF executables.
The ICU fetch script explicitly selects `icu4c-78.3-Ubuntu22.04-x64.tgz`.
Those binaries cannot run natively on the Pi's ARM processor.

The official pinned Carbon release API returned one toolchain tarball, with no
separately identified ARM64 asset. Carbon's own documentation describes the
nightlies as experimental and available on limited platforms. This review did
not verify a working ARM64 build or cross-compile route. It does not establish
that such a route is impossible. [Pinned Carbon release metadata](https://api.github.com/repos/carbon-language/carbon-lang/releases/tags/v0.0.0-0.nightly.2026.11.07),
[Carbon project status and installation](https://docs.carbon-lang.dev/).

Before selecting the Pi for the whole backend, build the actual Carbon/native
executable for ARM64 and provide ARM64 libpq and the pinned ICU behaviour. Verify
compilation, Unicode parity, PostgreSQL access, pooling, cancellation and all
HTTP contracts on the board. An x86 container does not make the executable a
native ARM binary. Emulation would need separate performance qualification.

Two paths remain open. Test PostgreSQL alone on the existing Pi while keeping
Carbon on the verified x86 machine over a private connection, or complete the
ARM64 build gate before moving both. A fallback language or a different server
has not been selected automatically.

## Security before opening a network service

Start with private access from the user's own devices. One option is Tailscale
Serve with explicit access rules. Serve shares a service within the tailnet;
Funnel makes it public. This distinction matters when testing from home or
behind carrier-grade NAT. A tunnel changes reachability, not the application's
security requirements. [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve),
[Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel).

The offline app also needs a secure browser origin. Use trusted HTTPS when
opening it from a phone through the Pi's LAN address or VPN hostname. Plain
`http://192.168.x.x` does not receive the localhost exception that lets our
current `http://127.0.0.1` test register a service worker. A private network does
not make an HTTP origin secure. Test app-shell installation and offline refresh
from the actual phone URL. [MDN service worker requirements](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API),
[MDN secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts).

For a later public service, use an HTTPS reverse proxy in front of the local
backend. Caddy can obtain and renew certificates for a configured public domain.
Verify the chosen challenge, DNS and network path. Prefer a common origin for
frontend and API; a public static page cannot fetch a private tailnet backend
for visitors who are outside that tailnet. [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https).

Serve the Pi's API over HTTPS too when an HTTPS page accesses its LAN address.
HTTP LAN requests can face mixed-content blocks and local-network permission
checks. Current Chrome documents permission-gated exceptions; this pilot has
not qualified that route across its target browsers. Prefer a common trusted
HTTPS origin with a reverse proxy. A browser's network permission does not
authenticate the user to the backend. [MDN mixed content](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Mixed_content),
[Chrome Local Network Access](https://developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access).

Required work before network exposure:

- Install current security updates. The tested pilot uses PostgreSQL 16.15 and
  libpq 17.11. PostgreSQL published 16.16 and 17.12 on 12 November 2026 with
  security fixes. Update the server and client pins, review release-specific
  reindex guidance, and rerun restore, query and cancellation checks before
  exposure. This assessment did not upgrade the local installation.
  [PostgreSQL 16.16 notes](https://www.postgresql.org/docs/16/release-16-16.html),
  [PostgreSQL 17.12 notes](https://www.postgresql.org/docs/17/release-17-12.html).
- Keep PostgreSQL on loopback or a Unix socket when the backend shares the
  machine. Do not forward port 5432 from the home router. If database and backend
  are separate, restrict the private network path and database role/source
  rules. Use verified TLS for a database connection across machines. PostgreSQL
  listening rules and authentication are separate controls. [Connection
  configuration](https://www.postgresql.org/docs/16/runtime-config-connection.html),
  [pg_hba.conf](https://www.postgresql.org/docs/16/auth-pg-hba-conf.html),
  [TLS configuration](https://www.postgresql.org/docs/16/ssl-tcp.html).
- Keep separate reader and importer credentials. The HTTP process must retain
  read-only access, no superuser privileges and no schema-write privileges. Use
  SCRAM for password authentication. Keep secret files private, outside Git and
  frontend bundles. [PostgreSQL password authentication](https://www.postgresql.org/docs/16/auth-password.html).
- Run the backend as a dedicated unprivileged service account. Replace fixed
  workstation paths. Use service supervision, resource limits, restricted file
  access and a tested restart procedure. Keep administrative SSH access private
  and use keys. Do not run the web application as root.
- Preserve body, time, pool and concurrency limits. Add admission/rate limits at
  the proxy and test bursts on the actual hardware. Restrict `/stats` to private
  monitoring. Request attempt tokens are cancellation/correlation controls;
  they do not authenticate a person or authorize private access.
- If access is gated, enforce authentication at the server or proxy. A hidden
  frontend route, dropdown or JavaScript password is not an access gate. Review
  trusted proxy headers and cross-origin policy. CORS does not block a direct
  HTTP client from calling an exposed service.
- Keep logs free of passwords and unnecessary query/location history. Monitor
  free space, backup age, failed restores, temperature, throttling, memory,
  connection saturation and HTTP errors. Test power loss and recovery without
  disabling PostgreSQL durability settings to improve a benchmark.
- Keep an encrypted backup away from the Pi. Define acceptable data loss and
  recovery time, then restore and compare release digests regularly. Include
  schema, role/grant recreation, configuration and secret-recovery instructions.
  A monthly municipal refresh schedule is not a backup schedule.

## Cost planning

With an owned Pi and internet connection, recurring costs include electricity,
off-device backup storage and any domain or networking service. New SSD, supply,
cooling and replacement media are capital costs. Time spent maintaining updates,
backups and outages also matters. No current retail price or hosted service plan
has been selected here.

Use the measured total wall power, including the SSD, to estimate electricity:

```text
monthly electricity EUR = average watts / 1000 * 24 * 30 * tariff EUR per kWh
```

For illustration only, 10 W at EUR 0.30/kWh costs EUR 2.16 per 30 days. This is
arithmetic using assumed inputs, not a measured Pi power figure or the user's
electricity tariff. The EUR 30 monthly ceiling remains a planning budget.

## Local issue drafts

Create GitHub issues after publication is authorized. Each issue should identify
its test gate and link to evidence. Do not open a separate issue for every small
refactor. These drafts track work that can otherwise be lost between chats:

| Priority | Suggested issue | Acceptance evidence |
| --- | --- | --- |
| High | Qualify offline memory on real phones | Keep every pinned record searchable. Choose an explicit device memory/storage budget. Pass four-city offline journeys and retained-profile restart on representative Android/iOS devices. Record complete counts, frozen query results, peak memory and errors. |
| High | Prove the Carbon/native stack on ARM64 | Record board, RAM, OS and tool identities. Build Carbon, ICU and libpq for ARM64. Pass Unicode parity, full HTTP conformance, cancellation/concurrency faults and the three-second first-search target under the agreed workload. Stop the full Pi migration if the build route fails. |
| High | Update and requalify database security patches | Review 16.16/17.12 or newer supported releases at execution time. Update checked pins. Apply required maintenance. Pass independent full-record verification, restore and cancellation tests. |
| High | Make the pilot a supervised private server | Remove fixed home paths. Use an unprivileged account and explicit configuration. Keep the database private. Verify TLS/private access, reader-only grants, restricted diagnostics, rate/admission limits, restart and resource limits. |
| High | Automate encrypted backups and recovery checks | Set recovery-point/time objectives and retention. Back up off-device. Restore to a new cluster and reconcile every release digest. Demonstrate loss of the primary SSD without relying on a backup stored on it. |
| Medium | Add dedicated pilot CI and publication checks | Run strict frontend/unit checks and source/contract audits on the pilot PR. Provision synthetic PostgreSQL or a licensed reproducible fixture for HTTP tests. Keep secrets and bulk private artifacts out of uploads. Confirm branch/PR jobs cannot deploy Pages. |
| Medium | Automate monthly immutable imports and rollback | Fetch each provider through its adapter. Compare complete IDs/counts and canonical digests. Publish a new validated release only after conformance. Retain the old release and test interrupted refresh and rollback. Do not mutate frozen canonical rows. |
| Medium | Qualify home-hosted performance and capacity | Measure the actual Pi, SSD and upstream link. Test complete first search, uncached broad queries, map bursts and simultaneous refresh/backup work. Record errors, temperature, memory and disk peaks. Define explicit overload behaviour. |

These are local drafts only. The current memory work should update its own
evidence before the first issue becomes a device-qualification task.
