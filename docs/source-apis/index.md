# Source API reference

These pages describe the official interfaces used to acquire tree records. The browser reads the published Tree Atlas catalogue. It does not call these inventory APIs.

| Source                    | Acquisition interface               | Scope                                                      |
| ------------------------- | ----------------------------------- | ---------------------------------------------------------- |
| [Vienna](vienna.md)       | WFS                                 | Published municipal tree layer                             |
| [Geneva](geneva.md)       | ArcGIS FeatureServer                | Canton-wide isolated trees outside forests                 |
| [Porto](porto.md)         | CKAN discovery and GeoJSON download | Published municipal inventory                              |
| [Amsterdam](amsterdam.md) | REST v2 GeoJSON                     | Published municipal inventory, including unlocated records |
| [Hamburg](hamburg.md)     | WFS                                 | Street trees                                               |
| [Zürich](zurich.md)       | WFS                                 | Street trees, fruit trees and selected other managed trees |

Additional UK references: [London](london.md), [Camden](camden.md), [Edinburgh](edinburgh.md), [Belfast](belfast.md), and [Nottingham (not published)](nottingham.md). The manifest determines which acquired sources are currently published.

The acquisition checks below were reviewed on 26 October 2026. Counts describe that snapshot. The [catalogue manifest](../../public/data/manifest.json) identifies the releases served by the app. Their provenance files hold download dates, checksums, attribution and source links.

Run `pnpm data:download` to acquire the configured sources. Run `pnpm data:prepare` to publish immutable releases. The combined downloader assembles source evidence only after its acquisition steps succeed. A successful count check proves agreement with the downloaded interface. It does not prove that a city has recorded every tree.

Read [Copernicus coverage](../copernicus.md) separately. Its canopy polygons do not identify individual trees or species. Source licences remain separate from the application's MIT licence. See [NOTICE](../../NOTICE).
