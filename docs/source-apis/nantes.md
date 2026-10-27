# Nantes

Reviewed 27 October 2026. The acquired snapshot contains 124,583 records. This is the published source inventory, not a census of every physical tree.

## Source and terms

[Official catalogue or publisher](https://data.nantesmetropole.fr/explore/dataset/244400404_patrimoine-arbore-nantes-metropole/). [Licence Ouverte](https://www.etalab.gouv.fr/licence-ouverte-open-licence). Attribution: Nantes Métropole et Ville de Nantes — Direction Nature et Jardins.

Published tree locations across Nantes Métropole and city-managed properties. Includes empty planting sites and source records awaiting qualification.

## Interface

- [datasets/244400404_patrimoine-arbore-nantes-metropole](https://data.nantesmetropole.fr/api/explore/v2.1/catalog/datasets/244400404_patrimoine-arbore-nantes-metropole)
- [exports/geojson](https://data.nantesmetropole.fr/api/explore/v2.1/catalog/datasets/244400404_patrimoine-arbore-nantes-metropole/exports/geojson)

The downloader checks ODS export counts, ArcGIS object-ID sets, or WFS counts before and after acquisition. Static files have a recorded hash and row count; they do not provide an independent completeness check. See [download-expansion-north.mjs](../../scripts/download-expansion-north.mjs) for exact requests and field mapping.

## Field rules

The import keeps source identity, Latin and common names where supplied, planting year, and location. It does not infer a species from a municipality or genus code. Unknown units remain unknown. Height classes and estimated dimensions remain source notes unless their meaning is verified. Zero dimensions do not mean a measured zero.

Example: Quercus robur; NANTES. Source status: Planté; species/site: Quercus robur. Height class: 21-30 m. Crown is an estimate; diameter units are unverified.

Coordinates are stored as WGS84 longitude then latitude. Source IDs are release-scoped. Keep links tied to the published release. The acquisition retains unlocated records; they remain searchable and have no invented map point.

## Refresh and checks

Run `node scripts/download-expansion-north.mjs nantes --refresh`, then prepare and validate the catalogue. Review upstream terms and schema before publication. [Source conformance tests](../../tests/import-north.test.ts) cover fixed factual examples; they cannot prove that the upstream inventory is complete.
