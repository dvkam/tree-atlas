# Geneva

## Interface and coverage

The [SITG isolated-tree dataset](https://sitg.ge.ch/donnees/sipv-ica-arbre-isole) covers the canton, outside forests. The importer uses its [ArcGIS FeatureServer layer](https://vector.sitg.ge.ch/arcgis/rest/services/SIPV_ICA_ARBRE_ISOLE/FeatureServer/0). The snapshot contains **240,827 records**.

The downloader obtains the full object-ID list and count. It requests batches of 300 IDs, with at most six concurrent requests. Every requested ID must appear exactly once. A transfer-limit response fails the batch. The downloader checks the ID set again at the end. Bounded retries handle temporary service failures.

## Field rules

- `ID_ARBRE` is the documented permanent identifier. The snapshot repeats ID `393253` twice and `395916` four times. Those records use a composite key with `OBJECTID`. They remain separate and have release-scoped identity.
- `NOM_COMPLET` supplies the botanical name. `NO_INVENTAIRE` supplies the tag. `SITUATION` is a location category.
- `HAUTEUR_TOTALE` and `DIAMETRE_COURONNE` use metres. `CIRCONFERENCE_1M` uses centimetres.
- `DATE_PLANTATION` and `DATE_OBSERVATION` use epoch milliseconds. Negative values can represent valid historic dates. `DATE_PLANTATION_ESTIMEE = 1` marks an estimated planting date.
- `SOUCHE = Oui` marks a removed tree. `STATUT` describes survey or position status; it does not describe whether a tree is alive.
- The source year `202` for record `384757` becomes unknown. A quality note preserves the source value.

Historic positions can be approximate to about 25 metres; recent survey positions can be about one metre. Do not imply a uniform accuracy. The importer does not request the observer field `ID_ACTEUR`.

## Licence and implementation

Use the [SITG category A conditions](https://sitg.ge.ch/ressources/conditions-utilisation-donnees). Retain **Données SITG / Ville de Genève**, the source date and a description of processing.

Acquisition: [download-sources.mjs](../../scripts/download-sources.mjs). Normalization and identity conflicts: [import.ts](../../src/import.ts). Tests: [import.test.ts](../../src/import.test.ts).
