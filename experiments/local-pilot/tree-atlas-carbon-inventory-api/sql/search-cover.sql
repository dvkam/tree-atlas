-- Covers only the normalized query projection, not canonical JSON/details.
-- The installer checks existing definition/validity before executing this DDL.
CREATE INDEX CONCURRENTLY inventory_search_cover
  ON atlas.records(dataset,release,ordinal)
  INCLUDE(lon,lat,search_id,search_tag,search_scientific,search_common,search_location);
