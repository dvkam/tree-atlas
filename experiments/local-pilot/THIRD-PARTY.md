# Third-party material in the local pilot

The pilot's project code is covered by the repository's root [MIT licence](../../LICENSE). The [root NOTICE](../../NOTICE) keeps source-data attribution and dataset terms separate from that code licence. The isolated frontend is copied from this repository at baseline commit `8fb090145c0852a83dec1038fa663e7ba15e0de3`; it does not import another author's Git history.

The [source publication review](PUBLICATION-LICENCE-REVIEW.md) records the history checks, source permissions and dependency licence evidence reviewed on 19 November 2026.

## Generated Unicode tables

`tree-atlas-local/src/frozen-normalizer-data.json` contains generated Unicode 17 mappings and properties. Its generator uses pinned Node 26.13.0 and canonical-combining-class data from the official ICU 78.3 client. The runtime table preserves the frozen search contract; it is not authored tree inventory data.

The accompanying [Unicode/ICU licence](licenses/UNICODE-ICU-LICENSE.txt) is copied unchanged from the official installed ICU 78.3 package's `share/icu/78.3/LICENSE`. It includes Unicode License V3 and the package's other notices. Keep it with the generated data and associated documentation. The generator, version assertions and reference checks are committed; the downloaded ICU binaries and archives are not.

## Carbon reference examples

The original local experiment retained upstream Carbon test examples under `upstream-*.carbon`. Those reference-only copies and the GitHub tree dump are omitted here. Their original URLs remain in the callback experiment README; the runnable project probes are retained. If upstream source examples are later vendored, preserve their `Apache-2.0 WITH LLVM-exception` notices and provide the applicable full licence rather than treating them as MIT project code.

## Runtime and build dependencies

Carbon, libpq, GNU libmicrohttpd, json-c, ICU, Node and frontend packages remain separately licensed dependencies. Their downloaded distributions, compiled libraries, toolchains and `node_modules` are excluded. Pinned download/build recipes and the frontend lockfile identify the versions used. A future binary/container distribution must include the required dependency notices and satisfy their distribution terms; this source import is not a production binary package.

## Municipal records and fixtures

The frozen contract includes release metadata, exact counts, hashes, source references and limited reference records derived from the existing licensed public releases. Dataset permissions and attribution remain those recorded in the root NOTICE, source provenance and per-city documentation. Code licensing does not replace them. No new source acquisition, restricted export or private raw record collection was added by this branch import.
