# Source API reference

The browser reads immutable Tree Atlas releases. It does not call the upstream inventory APIs. The published catalogue contains 44 inventories and 7,613,581 source records. Counts describe acquired records, not every physical tree.

## Published inventories

- [Vienna](vienna.md)
- [Geneva](geneva.md)
- [Porto](porto.md)
- [Amsterdam](amsterdam.md)
- [Hamburg](hamburg.md)
- [Zürich](zurich.md)
- [London](london.md)
- [Camden](camden.md)
- [Edinburgh](edinburgh.md)
- [Belfast](belfast.md)
- [Antwerp](antwerp.md): 135,017 records; Gratis Open Data Licentie Vlaanderen v1.0.
- [Arnhem](arnhem.md): 47,423 records; CC BY 4.0.
- [Barcelona](barcelona.md): 222,476 records; CC BY 4.0.
- [Basel-Stadt](basel.md): 32,435 records; CC BY 4.0; separate permission for import into OpenStreetMap.
- [Berlin](berlin.md): 962,545 records; Datenlizenz Deutschland — Zero 2.0.
- [Bern](bern.md): 23,984 records; Open use.
- [Bologna](bologna.md): 87,285 records; CC BY 4.0.
- [Bordeaux Métropole](bordeaux.md): 84,718 records; Licence Ouverte.
- [Brussels remarkable trees](brussels.md): 4,789 records; Publisher information-reuse terms (attribution required).
- [Cascais](cascais.md): 37,944 records; Creative Commons Attribution (version not stated).
- [Cologne](cologne.md): 108,071 records; Datenlizenz Deutschland — Zero 2.0.
- [Delft](delft.md): 36,763 records; CC BY 4.0.
- [Eindhoven](eindhoven.md): 128,034 records; Public domain.
- [Florence](florence.md): 82,269 records; CC BY 4.0.
- [Frankfurt](frankfurt.md): 163,569 records; Datenlizenz Deutschland — Namensnennung 2.0.
- [Ghent](ghent.md): 68,240 records; Modellicentie Gratis Hergebruik.
- [Leipzig](leipzig.md): 187,989 records; Datenlizenz Deutschland — Namensnennung 2.0.
- [Liège](liege.md): 28,473 records; CC BY 4.0.
- [Lisbon](lisbon.md): 80,957 records; CC0.
- [Luxembourg remarkable trees](luxembourgnational.md): 238 records; CC0 1.0.
- [Lyon Métropole](lyon.md): 112,425 records; Licence Ouverte.
- [Madrid](madrid.md): 799,110 records; CC BY 4.0.
- [Milan](milan.md): 247,779 records; CC BY 4.0.
- [Montpellier](montpellier.md): 60,882 records; ODbL 1.0.
- [Nantes](nantes.md): 124,583 records; Licence Ouverte.
- [Paris](paris.md): 220,112 records; Open Database License (ODbL).
- [Rennes](rennes.md): 192,000 records; Licence ODbL 1.0.
- [Rostock](rostock.md): 70,590 records; CC0 1.0.
- [Rotterdam](rotterdam.md): 199,558 records; Public Domain Mark 1.0.
- [Strasbourg](strasbourg.md): 83,399 records; Licence Ouverte v2.0 (Etalab).
- [Toulouse](toulouse.md): 124,214 records; Licence Ouverte v2.0 (Etalab).
- [Turin](turin.md): 105,476 records; CC BY 4.0.
- [Utrecht](utrecht.md): 162,653 records; CC BY-SA 4.0.
- [Valencia](valencia.md): 157,649 records; CC BY 4.0.

## Not published

- [Luxembourg City](luxembourg.md)
- [Gdańsk](gdansk.md)
- [Wrocław](wroclaw.md)
- [Poznań](poznan.md)
- [Warsaw](warsaw.md)
- [Nottingham](nottingham.md)

Read each page for interfaces, fields, scope and terms. The [manifest](../../public/data/manifest.json) identifies active releases and their provenance. Download and preparation checks prove agreement with the tested interface; they do not establish physical completeness. Turin has an unresolved service-count mismatch.

Run `pnpm data:download`, then `pnpm data:prepare`. The orchestrator requires every registered candidate to be acquired or explicitly blocked. Read [Copernicus](../copernicus.md) separately: its canopy layer has no individual-tree species records. Dataset terms remain separate from the code licence; see [NOTICE](../../NOTICE).
