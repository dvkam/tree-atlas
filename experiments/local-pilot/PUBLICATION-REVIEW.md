# Pilot source publication review

Reviewed on 19 November 2026. The initial reviewed tip was
`893353dd716ba2bb5d8a3145629341e6f76cacfa`, with 50 reachable commits. The public
baseline was `8fb090145c0852a83dec1038fa663e7ba15e0de3`.

The review found no identified secret or source-licence publication blocker.
Publication is limited to `pilot/carbon-postgres-local` and a draft PR targeting
`main`. It does not authorize a merge, hosting, issue creation, database
publication, backend activation or deployment. The final review-document/helper
commits must pass a full-history textual scan and a complete new-object/metadata
scan before the push. The original scan plus that final delta cover the exact
published tip. GitHub records the actual branch and draft PR state.

## Secret review

The [sanitized review record](validation/publication-secrets-2026-11-19.json)
records the tool checksum, configuration, counts, report hashes and limits.

| Check | Observed coverage and result |
| --- | --- |
| Full reachable Git history | 50 commits, including 27 already-public base commits and all 23 original pilot commits |
| General history scanner | Gitleaks 8.30.1, verified official release, upstream default rules, 100 percent redaction, no baseline or added path/rule allowlist |
| Historical object inventory | Every one of 62,625 unique blobs, 895,800,348 raw bytes; largest raw blob 27,684,647 bytes |
| Binary/compressed supplement | All 61,855 inventory `.bin` blobs decoded from gzip; 10,297,682,452 exported bytes, with no file-size skip |
| Commit and path metadata | All commit messages, author/committer metadata and changed filenames, including root introductions and deletions; 3,855,761 bytes |
| General content scanner | 10,301,538,213 bytes including decoded payloads and metadata; decode depth 5 and archive depth 4 |
| Known local credential check | Four current local database passwords compared with raw blobs, decoded gzip streams and metadata; zero matches, with no values logged or committed |
| Scanner findings | 191 `generic-api-key` findings in the sealed reference file, individually verified as public query hashes; zero confirmed secrets |
| Positive control | A real two-commit temporary Git fixture proved detection in a deleted raw file, a gzip stream across a 1 MiB boundary, an old commit message and a deleted filename |

Gitleaks returned exit code 1 for its findings. The review did not convert that
into a claim of zero scanner findings. Every flagged value was a deterministic
`queryKey` SHA-256 reproduced from public frozen input with Node 26.13.0 and the
Unicode 17 contract. All 192 reference keys were recomputed. These hashes provide
correlation, not authentication. The 191 flagged values were checked against
that set and their unchanged historical source blob. No blanket ignore was added
and the sealed reference was not edited or resealed.

The scanner configuration ignores inline `gitleaks:allow` comments, uses
`/dev/null` instead of a fingerprint ignore file, and has no target-size limit.
No repository or environment Gitleaks configuration overrode the upstream rules.
The export scanner checked every unique blob, including content absent from
Git's textual patches. Reports, exported content, credential comparisons and
tool binaries stay in a private 0700 native directory outside Git. Only the
sanitized record is committed.

Pattern scanning cannot prove the absence of every unknown, encrypted or
deliberately hidden secret. This review covers the history reachable from the
published head. Unrelated refs, reflogs and private untracked runtime artifacts
are outside that push. Do not publish the private scan workspace or reports.

## Source and licence review

The [licence review](PUBLICATION-LICENCE-REVIEW.md) records the source permissions,
nonstandard terms and dependency obligations. It examined all six catalogue and
five provenance versions in the 50-commit history, including 44 source IDs. It
checked the separately installed dependency declarations and native copyright
files. All 18 commits carrying generated Unicode mappings include the correct
complete Unicode/ICU notice. No upstream reference copies or compiled
third-party distributions were added.

The project code keeps its MIT licence. Municipal records retain their source
terms and attribution. ODbL datasets and Utrecht's CC BY-SA records are not
relicensed as MIT. Amsterdam's official CC0 register entry was checked against
the exact linked endpoint and current schema version; its metadata-age caveat
remains documented. No blocked inventory was added to the catalogue.

A future binary/container or new combined-database distribution requires its
own review of shipped notices, corresponding source or relinking requirements
and per-dataset terms. The source-publication verdict does not approve those
future artifacts.

## Public app and deployment guards

An independent review examined every original pilot commit tree and all 318
unique pilot-history blobs. Each commit preserves preexisting public files and
adds only pilot source plus the two root lint/format exclusions. No binary,
symlink, gitlink, oversized source artifact or sensitive filename candidate was
found. All 23 original pilot commits have David Kaminski as both author and
committer. Review follow-up commits use the same identity.

The `.github` tree is identical across that history. The existing workflow only
runs on pushes to `main` and pull requests. Its Pages deployment job requires
both a push event and `refs/heads/main`. A pilot-branch push cannot trigger that
push job; a draft PR can run the public app checks but cannot meet the deployment
condition. Live Pages configuration uses workflow builds with `main` as source.

Before publication, both remote app heads and their latest Pages deployment
commits matched these guards:

| App | Preserved main/deployment commit |
| --- | --- |
| Tree Atlas | `8fb090145c0852a83dec1038fa663e7ba15e0de3` |
| Vienna Baumkataster | `c34e0c382055faa65366470a633779d38f46a9d8` |

The final check must verify those values again after creating the draft PR.
The push uses a single explicit pilot-branch refspec, with tag following disabled.
There is no force push, tag publication, main update or merge.

At the initial publication review, PR CI checked the public root package.
See the [current pilot CI scope](README.md#draft-pr-checks). The public workflow's
pnpm workspace discovery and
TypeScript/Vitest/Playwright paths exclude the isolated pilot. Failure artifacts
only upload root `test-results`, not pilot profiles, credentials or database
artifacts. A green public CI run is not fresh pilot qualification. The local
[validation](BRANCH-VALIDATION.md), [recovery](CLEAN-ROOM.md) and
[offline memory evidence](tree-atlas-local/verification/offline-memory.md) retain
those separate test scopes.

## Repeat the history checks

Use the verified Gitleaks release and checksums recorded in the sanitized review.
Keep scan output private and redacted. From the repository root in WSL, create a
new native review workspace before exporting content:

```sh
review_head=$(git rev-parse HEAD)
review_workspace=$(mktemp -d /var/tmp/tree-atlas-secret-review-XXXXXXXX)
python3 experiments/local-pilot/scripts/review-history-blobs.py --repo "$PWD" --head "$review_head" --workspace "$review_workspace"
```

The helper needs the four existing private local database credential files named
in its source. It does not print their values. It writes an object inventory,
metadata and decoded content in that private directory. The helper checks the
known credentials; the separate general scanner is still required.

With the verified `gitleaks` executable on PATH:

```sh
GOMAXPROCS=4 gitleaks git . --log-opts="--full-history $review_head" --redact=100 --no-banner --no-color --ignore-gitleaks-allow --gitleaks-ignore-path /dev/null --max-target-megabytes=0 --max-decode-depth=5 --max-archive-depth=4 --timeout=1200 --report-format=json --report-path="$review_workspace/git-history-redacted.json" > "$review_workspace/git-history.log" 2>&1
GOMAXPROCS=4 gitleaks dir "$review_workspace/exported-blobs" --redact=100 --no-banner --no-color --ignore-gitleaks-allow --gitleaks-ignore-path /dev/null --max-target-megabytes=0 --max-decode-depth=5 --max-archive-depth=4 --timeout=1800 --report-format=json --report-path="$review_workspace/all-blobs-redacted.json" > "$review_workspace/all-blobs.log" 2>&1
python3 -W error::ResourceWarning -m unittest discover -s experiments/local-pilot/scripts -p test_review_history_blobs.py -v
python3 experiments/local-pilot/scripts/verify-source-import.py
```

Run the two scanners even if the first returns a findings exit code. Inspect and
classify each finding. A new finding is not approved merely because the earlier
191 public query hashes were benign. Leave the sealed oracle unchanged. Keep
private scan material out of Git and PR attachments.
