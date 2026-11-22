# Source publication licence review

Reviewed on 19 November 2026, before publishing the local pilot branch. The
reviewed tip was `893353dd716ba2bb5d8a3145629341e6f76cacfa`. Its public baseline
was `8fb090145c0852a83dec1038fa663e7ba15e0de3`.

This review found no licence blocker for publishing the source branch with its
existing notices. It does not approve a binary package, container image, new data
import or deployment. Project code and municipal data keep separate licences.

## Scope and checks

- Examined all 50 reachable commits, including the 23 pilot commits after the
  public baseline.
- Parsed all six distinct public catalogue manifests and all five distinct
  source-provenance documents in that history. They describe 44 source IDs.
  Every source entry has a licence label, licence URL and attribution. The
  current catalogue contains 7,613,581 records.
- Checked the history for vendored dependencies, upstream reference copies,
  executable/library archives, images and fonts. No such paths were present.
  The public `.bin` files are project-generated inventory formats, not compiled
  third-party libraries.
- Checked all five distinct root/pilot package manifests. Their dependency
  versions agree with the committed lockfiles. The installed pilot dependency
  set contains 157 distinct package/version pairs with declared licences.
- Checked the retained Carbon/C++ interoperability probes against their
  referenced upstream examples. The probes are project tests; the original
  reference-only `upstream-*.carbon` copies are absent from every committed tree.
- Checked all 18 commits containing the generated Unicode table. Each also has
  its Unicode/ICU licence file. Its SHA-256 is
  `e55522d81edc687a341a4411e0776e54ca654e90147f354a90458aaced4116af`,
  identical to the installed pinned ICU 78.3 package's `share/icu/78.3/LICENSE`.

This is a source and notice review. A licence field in a package manifest is not
a complete audit of every transitive source file. Recheck actual shipped files
and bundled notices before distributing executables, containers or frontend
builds.

## Pilot source permissions

The four-inventory pilot imports existing releases and limited reference
records. It does not add a newly acquired municipal export.

| Source | Primary evidence checked | Result |
| --- | --- | --- |
| London | [GLA Public Realm Trees](https://data.london.gov.uk/dataset/london-public-realm-trees-2r45m) | The publisher identifies OGL v3. Root NOTICE credits GLA and contributing public bodies. The frozen release excludes the Camden contributor rows in favour of the separate Camden inventory. |
| Vienna | [Stadt Wien OGD conditions](https://digitales.wien.gv.at/ogd-nutzungsbedingungen/) and the [tree catalogue](https://www.data.gv.at/datasets/c91a4635-8b7d-43fe-9b27-d95dec8392a7) | CC BY 4.0. Retain the stated Stadt Wien attribution, licence link and processing information. |
| Geneva | [SIPV_ICA_ARBRE_ISOLE](https://sitg.ge.ch/donnees/sipv-ica-arbre-isole) and [SITG conditions](https://sitg.ge.ch/ressources/conditions-utilisation-donnees) | This exact layer is category A, with no recorded use restriction. SITG permits reuse with source, date and processing information. Do not apply restrictions or permissions from a different SITG layer. |
| Porto | [Municipal tree catalogue](https://dadosabertos.cm-porto.pt/dataset/identificacao-e-caracterizacao-do-arvoredo-do-municipio-do-porto) | The source identifies Creative Commons CCZero. Root NOTICE and release provenance retain the municipality credit. |

The exact Geneva layer matters. `SIPV_ICA_WEB_PUBLIC_TOT` is a different layer
whose metadata mentions authorization. The pilot uses `SIPV_ICA_ARBRE_ISOLE`.

## Inherited catalogue terms

The branch retains the public baseline's 44 inventories. The root NOTICE,
per-city documentation and immutable provenance keep their individual terms;
they do not relicense data under MIT.

The history contains no published inventory ID for Nottingham, Luxembourg City,
Gdańsk, Wrocław, Poznań or Warsaw. The separate `luxembourgnational` source is
the licensed national remarkable-tree inventory, not Luxembourg City's blocked
inventory.

The less uniform source terms received additional checks:

- **Amsterdam:** The [official national register](https://data.overheid.nl/en/dataset/6f752d6c-f3d2-4cd4-b63b-77cf085740f7)
  labels its Bomen JSON resource CC0 1.0 and links directly to
  `https://api.data.amsterdam.nl/v1/bomen/`. On the review date, that exact URL
  returned an OpenAPI document titled `bomen`, version `2.0.0`. The
  [official schema](https://schemas.data.amsterdam.nl/datasets/bomen/dataset)
  names v2 as the default; both v1 and v2 reference `stamgegevens/v2`. This
  establishes the source/version connection beyond a public-access label.
  The [current API documentation](https://api.data.amsterdam.nl/v1/docs/datasets/bomen@v2.html)
  uses a less specific public-data licence statement. The register was last
  updated in 2023, and its old DCAT identifier now returns 404. Preserve both
  pieces of evidence; do not silently replace the frozen metadata or infer a
  new licence for unrelated Amsterdam tables.
- **Brussels:** [Publisher terms](https://sites.heritage.brussels/fr/legal/)
  permit reuse of information with source credit. The importer extracts factual
  species, identity and location fields. It discards photographs and narrative
  material. No standard Creative Commons licence is claimed.
- **Cascais:** The [official catalogue](https://dadosabertos.cascais.pt/pt_BR/dataset/geocascais-arvore)
  identifies Creative Commons Attribution without a version. The project
  preserves that wording and the publisher's original licence link. Do not
  invent a version when refreshing this source.
- **Paris, Rennes and Montpellier:** Their normalized datasets retain
  [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Preserve database
  notices, attribution, share-alike and access to the adapted machine-readable
  database when redistributing it. The repository contains the public assets
  and their decoder/import code. An MIT code licence does not replace ODbL for
  these databases.
- **Utrecht:** Adapted records retain
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Preserve that
  licence and attribution when redistributing them. Do not describe all source
  data or a future combined database as MIT or CC0.

The [Copernicus policy](https://land.copernicus.eu/en/data-policy) allows free
reuse with source credit, disclosure of modifications and no implied EU
endorsement. The root NOTICE credits the Street Tree Layer and its DOI; the map
also displays attribution. OpenStreetMap tile attribution remains in the map
and root NOTICE. No Copernicus download, OSM database or map tiles are vendored
in the pilot.

## Separately installed software

These dependencies are used by the local setup. Their downloaded distributions,
toolchains, libraries and `node_modules` are excluded from Git.

| Dependency inspected | Licence evidence | Publication implication |
| --- | --- | --- |
| Carbon nightly 2026-11-07 | [Apache 2.0 with LLVM exception](https://github.com/carbon-language/carbon-lang/blob/trunk/LICENSE) | Keep the toolchain's licence and bundled notices if distributing it. Referencing its API or compiling project code does not vendor the toolchain. |
| Isolated libpq 17.11; system PostgreSQL/libpq 16.15 | [PostgreSQL licence](https://www.postgresql.org/about/licence/) and installed package copyright | Retain applicable notices in a distributed client/server package. The repository carries build recipes, not PostgreSQL sources or binaries. |
| GNU libmicrohttpd 1.0.0 | Installed Ubuntu `libmicrohttpd12t64` copyright: LGPL-2.1-or-later | A future linked executable/container needs an LGPL distribution review, including notices, the library's source provisions and replacement/relinking requirements as applicable. Local linking does not relicense the project's source. |
| json-c 0.17 | [Upstream COPYING](https://github.com/json-c/json-c/blob/json-c-0.17-20230812/COPYING) and installed package copyright: MIT/Expat | Carry the copyright and permission notices when distributing the library. |
| OpenSSL 3.0.13 | [OpenSSL licence policy](https://openssl-library.org/source/license/index.html) and installed package copyright: Apache 2.0 | Carry the applicable licence and notices if distributing OpenSSL. This pilot is not an OpenSSL source import. |
| ICU 78.3 and generated Unicode 17 mappings | Committed [complete package licence](licenses/UNICODE-ICU-LICENSE.txt); [Unicode policy](https://www.unicode.org/license.txt) | Keep the committed notice with the generated table. An ICU binary distribution also needs the package's complete notices. |
| Node 26.13.0 | Node's MIT licence and bundled third-party notices | A future Node runtime distribution must retain its distribution notices. The runtime is not committed. |
| Frontend dependency set | Installed package manifests and `pnpm-lock.yaml` | Declared expressions include MIT, ISC, Apache 2.0, BSD, CC0, Unlicense, MIT/Zlib and MPL 2.0. Preserve actual bundled notices in a build distribution. |

`lightningcss` 1.33.0 and its native build package use MPL 2.0. `pako` 2.2.0
declares MIT and Zlib; `zstddec` 0.2.0 declares MIT and BSD-3-Clause. These are
not unknown-licence packages. Build tools and installed dependencies keep their
own terms. In particular, an MPL build dependency does not make all application
source MPL, and an unmodified local LGPL library is not an AGPL network-service
requirement.

Before packaging a service, inspect the executable's actual linked libraries
and the image's installed packages. Preserve their licences and any required
corresponding source or relinking materials. That is a separate distribution
gate; this branch publishes source, recipes and existing licensed data assets.
