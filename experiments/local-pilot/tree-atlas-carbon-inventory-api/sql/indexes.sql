-- Optional measured read-path indexes. Adds no source/canonical data and does
-- not alter the frozen staged schema's content. Apply as local database owner.
-- CONCURRENTLY keeps existing validated readers available during index builds.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA atlas_api;
CREATE INDEX CONCURRENTLY IF NOT EXISTS inventory_search_trigrams
  ON atlas.records USING gin(search_id atlas_api.gin_trgm_ops,search_tag atlas_api.gin_trgm_ops,
    search_scientific atlas_api.gin_trgm_ops,search_common atlas_api.gin_trgm_ops,search_location atlas_api.gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS inventory_dictionary_trigrams
  ON atlas.dictionary USING gin(normalized atlas_api.gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS inventory_spatial_cover
  ON atlas.records(dataset,release,lon,lat,ordinal);
ANALYZE atlas.records;
ANALYZE atlas.dictionary;
