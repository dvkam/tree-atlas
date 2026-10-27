# North and east source review

Reviewed 27 October 2026. 16 inventories passed acquisition. Five locations remain unpublished. Public visibility alone does not establish redistribution permission.

| Location                                                                  | Records | Terms                                                    |
| ------------------------------------------------------------------------- | ------: | -------------------------------------------------------- |
| [Liège](source-apis/liege.md)                                             |   28473 | CC BY 4.0                                                |
| [Eindhoven](source-apis/eindhoven.md)                                     |  128034 | Public domain                                            |
| [Arnhem](source-apis/arnhem.md)                                           |   47423 | CC BY 4.0                                                |
| [Leipzig](source-apis/leipzig.md)                                         |  187989 | Datenlizenz Deutschland — Namensnennung 2.0              |
| [Berlin](source-apis/berlin.md)                                           |  962545 | Datenlizenz Deutschland — Zero 2.0                       |
| [Rostock](source-apis/rostock.md)                                         |   70590 | CC0 1.0                                                  |
| [Luxembourg national remarkable trees](source-apis/luxembourgnational.md) |     238 | CC0 1.0                                                  |
| [Frankfurt](source-apis/frankfurt.md)                                     |  163569 | Datenlizenz Deutschland — Namensnennung 2.0              |
| [Nantes](source-apis/nantes.md)                                           |  124583 | Licence Ouverte                                          |
| [Ghent](source-apis/ghent.md)                                             |   68240 | Modellicentie Gratis Hergebruik                          |
| [Delft](source-apis/delft.md)                                             |   36763 | CC BY 4.0                                                |
| [Utrecht](source-apis/utrecht.md)                                         |  162653 | CC BY-SA 4.0                                             |
| [Cologne](source-apis/cologne.md)                                         |  108071 | Datenlizenz Deutschland — Zero 2.0                       |
| [Antwerp](source-apis/antwerp.md)                                         |  135017 | Gratis Open Data Licentie Vlaanderen v1.0                |
| [Rotterdam](source-apis/rotterdam.md)                                     |  199558 | Public Domain Mark 1.0                                   |
| [Brussels remarkable trees](source-apis/brussels.md)                      |    4789 | Publisher information-reuse terms (attribution required) |

## Remaining locations

- [luxembourg](source-apis/luxembourg.md): The official map exposes DYNDATA/SCENERY/FeatureServer/0. A sample query returned Latin names and WGS84 points. Service copyright and portal item licenseInfo are empty. The national open-data catalogue returned no matching city tree cadastre. Bulk redistribution permission remains unverified.
- [gdansk](source-apis/gdansk.md): The official CKAN record links an October 2026 Gdanska_Zielen_WFS service and field dictionaries. Its licence fields are empty. Service requests failed or timed out during this review. Both a working full export and applicable reuse terms must be verified.
- [wroclaw](source-apis/wroclaw.md): The official ZZM MapServer layer 3 returned 104012 records in a count query. It exposes Latin/common names, arbotag and circumference fields. Service copyright is empty. General portal permissions for other resources do not establish permission for this tree layer. Redistribution terms remain unverified.
- [poznan](source-apis/poznan.md): The official 3D model and public configuration expose inventoried vegetation and separate remote-sensing layers. The map offers area-based exports. This review did not verify a complete repeatable individual-tree export with applicable redistribution terms. LiDAR trees must not be presented as species inventories.
- [warsaw](source-apis/warsaw.md): The official page distinguishes Baza Zieleni field inventory from canopy mapping. The linked map failed to connect during this review. No complete licensed individual-tree export was verified. A WMS map alone does not meet the search and details contract.

## Checks and limitations

Acquisition checks full source counts or object-ID sets. It preserves null geometry and release-scoped identity. Counts describe records, which can include empty planting sites or removed trees. They do not prove coverage of all trees in a city.

Rostock returns latitude first for EPSG:4326; the downloader swaps axes. Cologne returns UTM zone 32 coordinates despite a WGS84 request; the downloader projects them. Frankfurt CSV also uses UTM zone 32. Tests pin these conversions to known points.

Ghent has missing GIS identifiers, so release row IDs preserve those records. Cologne tree tags repeat, so the importer fetches one complete response and assigns release row IDs. Utrecht includes both park/street and woodland layers; source IDs include the layer. Rotterdam special-tree and genus views overlap the general inventory and are not appended.

Nantes includes empty planting sites. Those records retain an unknown status and explanatory note. Brussels and national Luxembourg contain selected remarkable trees only. Brussels uses the publisher's custom information-reuse terms, not a standard open-data licence; only factual fields are included. Utrecht's current service distribution carries CC BY-SA 4.0, distinct from older downloads with different terms.

No upstream photographs, narrative descriptions, staff details, or personal contact fields are published. Raw responses stay outside Git. Published records contain the validated atlas fields.
