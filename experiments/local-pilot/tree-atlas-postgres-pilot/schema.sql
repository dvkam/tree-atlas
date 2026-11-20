CREATE SCHEMA atlas AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
CREATE TABLE atlas.schema_version (version integer PRIMARY KEY CHECK(version=1));
INSERT INTO atlas.schema_version VALUES(1);
CREATE TABLE atlas.releases (
  dataset text NOT NULL CHECK(dataset IN ('london','vienna','geneva','porto')),
  release text NOT NULL CHECK(release ~ '^[a-z0-9-]+$'),
  metadata jsonb NOT NULL CHECK(jsonb_typeof(metadata)='object'),
  expected_count bigint NOT NULL CHECK(expected_count>0),
  expected_located_count bigint NOT NULL CHECK(expected_located_count BETWEEN 0 AND expected_count),
  expected_identity_sha256 text NOT NULL CHECK(expected_identity_sha256 ~ '^[a-f0-9]{64}$'),
  expected_content_sha256 text NOT NULL CHECK(expected_content_sha256 ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'loading' CHECK(status IN ('loading','staged','validated')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(dataset,release)
);
CREATE TABLE atlas.records (
  dataset text NOT NULL,
  release text NOT NULL,
  ordinal bigint NOT NULL CHECK(ordinal>=0),
  canonical jsonb NOT NULL,
  source_id text GENERATED ALWAYS AS (canonical->>'sourceId') STORED NOT NULL,
  lon double precision GENERATED ALWAYS AS ((canonical->'position'->>0)::double precision) STORED,
  lat double precision GENERATED ALWAYS AS ((canonical->'position'->>1)::double precision) STORED,
  search_id text NOT NULL,
  search_tag text,
  search_scientific text,
  search_common text,
  search_location text,
  PRIMARY KEY(dataset,release,source_id),
  UNIQUE(dataset,release,ordinal),
  FOREIGN KEY(dataset,release) REFERENCES atlas.releases(dataset,release),
  CHECK(jsonb_typeof(canonical)='object'),
  CHECK(canonical ?& ARRAY['dataset','sourceId','idScope','position','tag','scientificName','commonName','location','height','crown','circumference','plantingYear','plantingEstimated','age','observedAt','status']),
  CHECK(jsonb_typeof(canonical->'sourceId')='string' AND length(source_id)>0),
  CHECK(jsonb_typeof(canonical->'dataset')='string' AND canonical->>'dataset'=dataset),
  CHECK(jsonb_typeof(canonical->'idScope')='string' AND canonical->>'idScope' IN ('stable','release')),
  CHECK(jsonb_typeof(canonical->'status')='string' AND canonical->>'status' IN ('existing','removed','unknown')),
  CHECK((canonical->'position'='null'::jsonb AND lon IS NULL AND lat IS NULL) OR
    (jsonb_typeof(canonical->'position')='array' AND jsonb_array_length(canonical->'position')=2 AND
     jsonb_typeof(canonical->'position'->0)='number' AND jsonb_typeof(canonical->'position'->1)='number' AND
     lon BETWEEN -180 AND 180 AND lat BETWEEN -90 AND 90)),
  CHECK((lon IS NULL)=(lat IS NULL))
);
CREATE TABLE atlas.dictionary (
  dataset text NOT NULL,
  release text NOT NULL,
  ordinal bigint NOT NULL CHECK(ordinal>=0),
  value text NOT NULL,
  normalized text NOT NULL,
  PRIMARY KEY(dataset,release,ordinal),
  UNIQUE(dataset,release,value),
  FOREIGN KEY(dataset,release) REFERENCES atlas.releases(dataset,release)
);
-- BEGIN SEAL HARDENING
CREATE OR REPLACE FUNCTION atlas.loading_only() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Canonical rows are append-only'; END IF;
  PERFORM 1 FROM atlas.releases r WHERE r.dataset=NEW.dataset AND r.release=NEW.release AND r.status='loading' FOR SHARE;
  IF NOT FOUND
    THEN RAISE EXCEPTION 'Release is sealed'; END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION atlas.require_sealed_commit() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,atlas AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM atlas.releases WHERE dataset=NEW.dataset AND release=NEW.release AND status='loading')
    THEN RAISE EXCEPTION 'Loading releases cannot commit'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER sealed_commit AFTER INSERT OR UPDATE ON atlas.releases
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION atlas.require_sealed_commit();
REVOKE ALL ON FUNCTION atlas.loading_only(),atlas.require_sealed_commit() FROM PUBLIC;
-- END SEAL HARDENING
CREATE TRIGGER records_guard BEFORE INSERT OR UPDATE OR DELETE ON atlas.records
FOR EACH ROW EXECUTE FUNCTION atlas.loading_only();
CREATE TRIGGER dictionary_guard BEFORE INSERT OR UPDATE OR DELETE ON atlas.dictionary
FOR EACH ROW EXECUTE FUNCTION atlas.loading_only();
CREATE FUNCTION atlas.release_transition() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,atlas AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Release retention is immutable'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'loading' THEN RAISE EXCEPTION 'New release must start loading'; END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') OR
     NOT ((OLD.status='loading' AND NEW.status='staged') OR (OLD.status='staged' AND NEW.status='validated'))
    THEN RAISE EXCEPTION 'Invalid immutable release transition'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER releases_guard BEFORE INSERT OR UPDATE OR DELETE ON atlas.releases
FOR EACH ROW EXECUTE FUNCTION atlas.release_transition();
CREATE FUNCTION atlas.finish_loading(d text,r text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas AS $$
DECLARE wanted bigint; located bigint; actual bigint; actual_located bigint; first_ordinal bigint; last_ordinal bigint; dict_count bigint;
BEGIN
  SELECT expected_count,expected_located_count INTO wanted,located FROM atlas.releases
    WHERE dataset=d AND release=r AND status='loading' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No loading release'; END IF;
  SELECT count(*),count(lon),min(ordinal),max(ordinal) INTO actual,actual_located,first_ordinal,last_ordinal
    FROM atlas.records WHERE dataset=d AND release=r;
  IF actual<>wanted OR actual_located<>located OR first_ordinal<>0 OR last_ordinal<>wanted-1
    THEN RAISE EXCEPTION 'Incomplete release'; END IF;
  SELECT count(*),min(ordinal),max(ordinal) INTO dict_count,first_ordinal,last_ordinal FROM atlas.dictionary WHERE dataset=d AND release=r;
  IF dict_count>0 AND (first_ordinal<>0 OR last_ordinal<>dict_count-1)
    THEN RAISE EXCEPTION 'Incomplete dictionary'; END IF;
  UPDATE atlas.releases SET status='staged' WHERE dataset=d AND release=r;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA atlas FROM PUBLIC;
GRANT USAGE ON SCHEMA atlas TO tree_atlas_loader,tree_atlas_verify,tree_atlas_reader;
GRANT SELECT ON atlas.releases TO tree_atlas_loader;
GRANT INSERT(dataset,release,metadata,expected_count,expected_located_count,expected_identity_sha256,expected_content_sha256)
  ON atlas.releases TO tree_atlas_loader;
GRANT INSERT(dataset,release,ordinal,canonical,search_id,search_tag,search_scientific,search_common,search_location)
  ON atlas.records TO tree_atlas_loader;
GRANT INSERT ON atlas.dictionary TO tree_atlas_loader;
GRANT EXECUTE ON FUNCTION atlas.finish_loading(text,text) TO tree_atlas_loader;
GRANT SELECT ON ALL TABLES IN SCHEMA atlas TO tree_atlas_verify;
CREATE VIEW atlas.validated_releases AS SELECT * FROM atlas.releases WHERE status='validated';
CREATE VIEW atlas.validated_records AS SELECT t.* FROM atlas.records t JOIN atlas.releases r USING(dataset,release) WHERE r.status='validated';
CREATE VIEW atlas.validated_dictionary AS SELECT t.* FROM atlas.dictionary t JOIN atlas.releases r USING(dataset,release) WHERE r.status='validated';
GRANT SELECT ON atlas.validated_releases,atlas.validated_records,atlas.validated_dictionary TO tree_atlas_reader;
