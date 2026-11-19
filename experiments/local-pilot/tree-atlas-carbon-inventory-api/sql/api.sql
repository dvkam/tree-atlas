-- Read-only inventory query functions. Input normalization/correlation stays native.
-- Apply as the local database owner; functions execute with the reader's rights.
BEGIN;
CREATE SCHEMA IF NOT EXISTS atlas_api AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA atlas_api FROM PUBLIC;

CREATE OR REPLACE FUNCTION atlas_api.require_release(p jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE PARALLEL SAFE SECURITY INVOKER SET search_path=pg_catalog,atlas_api AS $$
DECLARE result jsonb;
BEGIN
  IF COALESCE(p->>'contractVersion','1.0.0') <> '1.0.0' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='unsupported_contract';
  END IF;
  -- Do not serialize the large detail-asset descriptor on every small page.
  -- Every field consumed by the API remains present; release_info has always
  -- omitted that descriptor from its source metadata response.
  SELECT jsonb_build_object('dataset',r.dataset,'release',r.release,
    'expected_count',r.expected_count,'expected_located_count',r.expected_located_count,
    'expected_identity_sha256',r.expected_identity_sha256,'expected_content_sha256',r.expected_content_sha256,
    'metadata',jsonb_build_object('contractVersion',r.metadata->'contractVersion',
      'searchNormalizer',r.metadata->'searchNormalizer','freezeSha256',r.metadata->'freezeSha256',
      'baselineLockSha256',r.metadata->'baselineLockSha256','referenceSha256',r.metadata->'referenceSha256',
      'source',(r.metadata->'source')-'descriptor')) INTO result FROM atlas.validated_releases r
    WHERE r.dataset=p->>'dataset' AND r.release=p->>'release';
  IF result IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='release_unavailable'; END IF;
  IF result->'metadata'->>'contractVersion' IS DISTINCT FROM '1.0.0' OR
     result->'metadata'->>'searchNormalizer' IS DISTINCT FROM 'nfd-diacritic-unicode17-default-lower-trim-v1' THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='release_contract_mismatch';
  END IF;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION atlas_api.fingerprint(p jsonb) RETURNS jsonb
LANGUAGE sql STABLE PARALLEL SAFE SECURITY INVOKER SET search_path=pg_catalog,atlas_api AS $$
  SELECT atlas_api.require_release(p)->'expected_content_sha256'
$$;

CREATE OR REPLACE FUNCTION atlas_api.inside(box jsonb,lon float8,lat float8) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER AS $$
  SELECT lon >= (box->>0)::float8 AND lon <= (box->>2)::float8 AND
         lat >= (box->>1)::float8 AND lat <= (box->>3)::float8
$$;

CREATE OR REPLACE FUNCTION atlas_api.like_pattern(term text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER AS $$
  SELECT '%' || replace(replace(replace(term,chr(92),chr(92)||chr(92)),'%',chr(92)||'%'),'_',chr(92)||'_') || '%'
$$;

CREATE OR REPLACE FUNCTION atlas_api.summary_tree(tree jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER AS $$
  SELECT jsonb_build_object('dataset',tree->'dataset','sourceId',tree->'sourceId',
    'position',tree->'position','tag',tree->'tag','scientificName',tree->'scientificName',
    'commonName',tree->'commonName','location',tree->'location')
$$;

-- Both denominator and point difference are in the finite validated viewport.
CREATE OR REPLACE FUNCTION atlas_api.cell_x(box jsonb,lon float8) RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER AS $$
  SELECT CASE WHEN lon<=(box->>0)::float8 THEN 0 WHEN lon>=(box->>2)::float8 THEN 29
    ELSE greatest(0,least(29,floor(((lon-(box->>0)::float8)/((box->>2)::float8-(box->>0)::float8))*30)::integer)) END
$$;
CREATE OR REPLACE FUNCTION atlas_api.cell_y(box jsonb,lat float8) RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER AS $$
  SELECT CASE WHEN lat<=(box->>1)::float8 THEN 0 WHEN lat>=(box->>3)::float8 THEN 29
    ELSE greatest(0,least(29,floor(((lat-(box->>1)::float8)/((box->>3)::float8-(box->>1)::float8))*30)::integer)) END
$$;

CREATE OR REPLACE FUNCTION atlas_api.summary(p jsonb,term text) RETURNS jsonb
LANGUAGE plpgsql STABLE PARALLEL SAFE SECURITY INVOKER SET search_path=pg_catalog,atlas_api
SET jit=off SET max_parallel_workers_per_gather=0 SET plan_cache_mode=force_custom_plan AS $$
DECLARE metadata jsonb; total bigint; located bigint; visible bigint; markers jsonb; aggregated boolean;
        area jsonb:=p->'area'; viewport jsonb:=p->'viewport'; pattern text:=atlas_api.like_pattern(term);
BEGIN
  metadata:=atlas_api.require_release(p);
  IF COALESCE((p->>'containsNul')::boolean,false) THEN
    RETURN jsonb_build_object('total',0,'locatedTotal',0,'viewportLocatedTotal',0,
      'markers','[]'::jsonb,'representedLocatedCount',0,'mapAggregated',false,'spatialReady',true,
      'releaseFingerprint',metadata->'expected_content_sha256');
  END IF;
  IF term='' AND (area IS NULL OR area='null'::jsonb) THEN
    total:=(metadata->>'expected_count')::bigint;
    located:=(metadata->>'expected_located_count')::bigint;
  ELSE
    SELECT count(*),count(t.lon) INTO total,located FROM atlas.validated_records t
      WHERE t.dataset=p->>'dataset' AND t.release=p->>'release'
      AND (area IS NULL OR area='null'::jsonb OR atlas_api.inside(area,t.lon,t.lat))
      AND (term='' OR t.search_id LIKE pattern ESCAPE E'\\' OR t.search_tag LIKE pattern ESCAPE E'\\'
        OR t.search_scientific LIKE pattern ESCAPE E'\\' OR t.search_common LIKE pattern ESCAPE E'\\'
        OR t.search_location LIKE pattern ESCAPE E'\\');
  END IF;
  WITH grouped AS (
    SELECT atlas_api.cell_x(viewport,t.lon) AS gx,atlas_api.cell_y(viewport,t.lat) AS gy,
      count(*) AS members,avg(t.lon) AS lon,avg(t.lat) AS lat,min(t.ordinal) AS first_ordinal
    FROM atlas.validated_records t
    WHERE t.dataset=p->>'dataset' AND t.release=p->>'release'
      AND atlas_api.inside(viewport,t.lon,t.lat)
      AND (area IS NULL OR area='null'::jsonb OR atlas_api.inside(area,t.lon,t.lat))
      AND (term='' OR t.search_id LIKE pattern ESCAPE E'\\' OR t.search_tag LIKE pattern ESCAPE E'\\'
        OR t.search_scientific LIKE pattern ESCAPE E'\\' OR t.search_common LIKE pattern ESCAPE E'\\'
        OR t.search_location LIKE pattern ESCAPE E'\\')
    GROUP BY 1,2
  ), objects AS (
    SELECT g.gx,g.gy,g.members,
      CASE WHEN g.members=1 THEN jsonb_build_object('kind','tree','tree',
          (SELECT atlas_api.summary_tree(t.canonical) FROM atlas.validated_records t
           WHERE t.dataset=p->>'dataset' AND t.release=p->>'release' AND t.ordinal=g.first_ordinal))
        ELSE jsonb_build_object('kind','cluster','cell',g.gx::text||':'||g.gy::text,
          'position',jsonb_build_array(g.lon,g.lat),'count',g.members,
          'zoom',least(24,floor((p->>'zoom')::float8)::integer+1)) END AS marker
      FROM grouped g
  ) SELECT COALESCE(sum(members),0)::bigint,
      COALESCE(jsonb_agg(marker ORDER BY gx,gy),'[]'::jsonb),COALESCE(bool_or(members>1),false)
    INTO visible,markers,aggregated FROM objects;
  RETURN jsonb_build_object('total',total,'locatedTotal',located,'viewportLocatedTotal',visible,
    'markers',markers,'representedLocatedCount',visible,'mapAggregated',aggregated,'spatialReady',true,
    'releaseFingerprint',metadata->'expected_content_sha256');
END $$;

CREATE OR REPLACE FUNCTION atlas_api.page(p jsonb,term text) RETURNS jsonb
LANGUAGE plpgsql STABLE PARALLEL SAFE SECURITY INVOKER SET search_path=pg_catalog,atlas_api
SET plan_cache_mode=force_custom_plan AS $$
DECLARE area jsonb:=p->'area'; pattern text:=atlas_api.like_pattern(term); result jsonb;
        start_at bigint:=(p->>'offset')::bigint; page_limit integer:=(p->>'limit')::integer;
BEGIN
  PERFORM atlas_api.require_release(p);
  IF COALESCE((p->>'containsNul')::boolean,false) THEN RETURN jsonb_build_object('items','[]'::jsonb,'releaseFingerprint',atlas_api.fingerprint(p)); END IF;
  IF term='' AND (area IS NULL OR area='null'::jsonb) THEN
    -- Ordinals are validated contiguous. This avoids OFFSET rescanning London
    -- for each successive empty-query page without changing offset semantics.
    SELECT COALESCE(jsonb_agg(atlas_api.summary_tree(t.canonical) ORDER BY t.ordinal),'[]'::jsonb) INTO result
      FROM atlas.validated_records t WHERE t.dataset=p->>'dataset' AND t.release=p->>'release'
      AND t.ordinal>=start_at AND t.ordinal<start_at+page_limit;
  ELSE
    SELECT COALESCE(jsonb_agg(atlas_api.summary_tree(t.canonical) ORDER BY t.ordinal),'[]'::jsonb) INTO result FROM (
      SELECT t.ordinal,t.canonical FROM atlas.validated_records t
      WHERE t.dataset=p->>'dataset' AND t.release=p->>'release'
      AND (area IS NULL OR area='null'::jsonb OR atlas_api.inside(area,t.lon,t.lat))
      AND (term='' OR t.search_id LIKE pattern ESCAPE E'\\' OR t.search_tag LIKE pattern ESCAPE E'\\'
        OR t.search_scientific LIKE pattern ESCAPE E'\\' OR t.search_common LIKE pattern ESCAPE E'\\'
        OR t.search_location LIKE pattern ESCAPE E'\\')
      ORDER BY t.ordinal OFFSET start_at LIMIT page_limit
    ) t;
  END IF;
  RETURN jsonb_build_object('items',result,'releaseFingerprint',atlas_api.fingerprint(p));
END $$;

CREATE OR REPLACE FUNCTION atlas_api.viewport_page(p jsonb,term text) RETURNS jsonb
LANGUAGE plpgsql STABLE PARALLEL SAFE SECURITY INVOKER SET search_path=pg_catalog,atlas_api
SET plan_cache_mode=force_custom_plan AS $$
DECLARE area jsonb:=p->'area'; viewport jsonb:=p->'viewport'; pattern text:=atlas_api.like_pattern(term); result jsonb;
        metadata jsonb; total bigint;
BEGIN
  metadata:=atlas_api.require_release(p);
  IF COALESCE((p->>'containsNul')::boolean,false) THEN RETURN jsonb_build_object('items','[]'::jsonb,'total',0,'releaseFingerprint',metadata->'expected_content_sha256'); END IF;
  IF term='' AND (area IS NULL OR area='null'::jsonb) AND
     atlas_api.inside(viewport,(metadata->'metadata'->'source'->'bounds'->>0)::float8,(metadata->'metadata'->'source'->'bounds'->>1)::float8) AND
     atlas_api.inside(viewport,(metadata->'metadata'->'source'->'bounds'->>2)::float8,(metadata->'metadata'->'source'->'bounds'->>3)::float8) THEN
    total:=(metadata->>'expected_located_count')::bigint;
    IF total=(metadata->>'expected_count')::bigint THEN
      RETURN atlas_api.page(p,term)||jsonb_build_object('total',total);
    END IF;
  ELSE
    SELECT count(*) INTO total FROM atlas.validated_records t
    WHERE t.dataset=p->>'dataset' AND t.release=p->>'release' AND atlas_api.inside(viewport,t.lon,t.lat)
      AND (area IS NULL OR area='null'::jsonb OR atlas_api.inside(area,t.lon,t.lat))
      AND (term='' OR t.search_id LIKE pattern ESCAPE E'\\' OR t.search_tag LIKE pattern ESCAPE E'\\'
        OR t.search_scientific LIKE pattern ESCAPE E'\\' OR t.search_common LIKE pattern ESCAPE E'\\'
        OR t.search_location LIKE pattern ESCAPE E'\\');
  END IF;
  SELECT COALESCE(jsonb_agg(atlas_api.summary_tree(t.canonical) ORDER BY t.ordinal),'[]'::jsonb) INTO result FROM (
    SELECT t.ordinal,t.canonical FROM atlas.validated_records t
    WHERE t.dataset=p->>'dataset' AND t.release=p->>'release' AND atlas_api.inside(viewport,t.lon,t.lat)
      AND (area IS NULL OR area='null'::jsonb OR atlas_api.inside(area,t.lon,t.lat))
      AND (term='' OR t.search_id LIKE pattern ESCAPE E'\\' OR t.search_tag LIKE pattern ESCAPE E'\\'
        OR t.search_scientific LIKE pattern ESCAPE E'\\' OR t.search_common LIKE pattern ESCAPE E'\\'
        OR t.search_location LIKE pattern ESCAPE E'\\')
      ORDER BY t.ordinal OFFSET (p->>'offset')::bigint LIMIT (p->>'limit')::integer
  ) t;
  RETURN jsonb_build_object('items',result,'total',total,'releaseFingerprint',metadata->'expected_content_sha256');
END $$;

CREATE OR REPLACE FUNCTION atlas_api.cluster_members(p jsonb,term text) RETURNS jsonb
LANGUAGE plpgsql STABLE PARALLEL SAFE SECURITY INVOKER SET search_path=pg_catalog,atlas_api
SET plan_cache_mode=force_custom_plan AS $$
DECLARE area jsonb:=p->'area'; viewport jsonb:=p->'viewport'; pattern text:=atlas_api.like_pattern(term); result jsonb;
        x integer:=(p->>'cellX')::integer; y integer:=(p->>'cellY')::integer;
        metadata jsonb; bounds jsonb;
BEGIN
  metadata:=atlas_api.require_release(p);
  bounds:=metadata->'metadata'->'source'->'bounds';
  IF x IS NULL OR y IS NULL OR x NOT BETWEEN 0 AND 29 OR y NOT BETWEEN 0 AND 29 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_cluster';
  END IF;
  IF COALESCE((p->>'containsNul')::boolean,false) THEN RETURN jsonb_build_object('items','[]'::jsonb,'memberCount',0,'total',0,'releaseFingerprint',atlas_api.fingerprint(p)); END IF;
  -- At broad world views all of a city can share one cell. When source bounds
  -- prove every row belongs, preserve fast ordinal pagination rather than
  -- repeatedly scanning a million-row OFFSET for cluster expansion.
  IF term='' AND (area IS NULL OR area='null'::jsonb) AND
     (metadata->>'expected_count')::bigint=(metadata->>'expected_located_count')::bigint AND
     atlas_api.inside(viewport,(bounds->>0)::float8,(bounds->>1)::float8) AND
     atlas_api.inside(viewport,(bounds->>2)::float8,(bounds->>3)::float8) AND
     atlas_api.cell_x(viewport,(bounds->>0)::float8)=x AND atlas_api.cell_x(viewport,(bounds->>2)::float8)=x AND
     atlas_api.cell_y(viewport,(bounds->>1)::float8)=y AND atlas_api.cell_y(viewport,(bounds->>3)::float8)=y THEN
    RETURN atlas_api.page(p,term)||jsonb_build_object('total',metadata->'expected_count','memberCount',metadata->'expected_count');
  END IF;
  WITH matching AS NOT MATERIALIZED (
    SELECT t.ordinal,t.canonical FROM atlas.validated_records t
    WHERE t.dataset=p->>'dataset' AND t.release=p->>'release' AND atlas_api.inside(viewport,t.lon,t.lat)
      AND atlas_api.cell_x(viewport,t.lon)=x AND atlas_api.cell_y(viewport,t.lat)=y
      AND (area IS NULL OR area='null'::jsonb OR atlas_api.inside(area,t.lon,t.lat))
      AND (term='' OR t.search_id LIKE pattern ESCAPE E'\\' OR t.search_tag LIKE pattern ESCAPE E'\\'
        OR t.search_scientific LIKE pattern ESCAPE E'\\' OR t.search_common LIKE pattern ESCAPE E'\\'
        OR t.search_location LIKE pattern ESCAPE E'\\')
  ), stats AS (SELECT count(*) AS members FROM matching)
    SELECT jsonb_build_object('memberCount',stats.members,'total',stats.members,
      'items',COALESCE((SELECT jsonb_agg(atlas_api.summary_tree(t.canonical) ORDER BY t.ordinal) FROM
        (SELECT * FROM matching ORDER BY ordinal OFFSET (p->>'offset')::bigint LIMIT (p->>'limit')::integer)t),'[]'::jsonb),
      'releaseFingerprint',atlas_api.fingerprint(p)) INTO result FROM stats;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION atlas_api.detail(p jsonb,term text) RETURNS jsonb
LANGUAGE plpgsql STABLE PARALLEL SAFE SECURITY INVOKER SET search_path=pg_catalog,atlas_api AS $$
DECLARE result jsonb;
BEGIN
  PERFORM atlas_api.require_release(p);
  IF COALESCE((p->>'containsNul')::boolean,false) THEN RETURN jsonb_build_object('tree',NULL,'releaseFingerprint',atlas_api.fingerprint(p)); END IF;
  SELECT t.canonical INTO result FROM atlas.validated_records t
    WHERE t.dataset=p->>'dataset' AND t.release=p->>'release' AND t.source_id=p->>'sourceId';
  RETURN jsonb_build_object('tree',result,'releaseFingerprint',atlas_api.fingerprint(p));
END $$;

CREATE OR REPLACE FUNCTION atlas_api.suggest(p jsonb,term text) RETURNS jsonb
LANGUAGE plpgsql STABLE PARALLEL SAFE SECURITY INVOKER SET search_path=pg_catalog,atlas_api
SET plan_cache_mode=force_custom_plan AS $$
DECLARE units integer; result jsonb; pattern text:=atlas_api.like_pattern(term);
BEGIN
  PERFORM atlas_api.require_release(p);
  SELECT COALESCE(sum(CASE WHEN ascii(ch)>65535 THEN 2 ELSE 1 END),0)::integer INTO units
    FROM regexp_split_to_table(term,'') AS ch;
  IF COALESCE((p->>'containsNul')::boolean,false) OR units<2 THEN RETURN jsonb_build_object('values','[]'::jsonb,'releaseFingerprint',atlas_api.fingerprint(p)); END IF;
  SELECT COALESCE(jsonb_agg(t.value ORDER BY t.ordinal),'[]'::jsonb) INTO result FROM (
    SELECT d.ordinal,d.value FROM atlas.validated_dictionary d
      WHERE d.dataset=p->>'dataset' AND d.release=p->>'release' AND d.normalized LIKE pattern ESCAPE E'\\'
      ORDER BY d.ordinal LIMIT 8
  ) t;
  RETURN jsonb_build_object('values',result,'releaseFingerprint',atlas_api.fingerprint(p));
END $$;

CREATE OR REPLACE FUNCTION atlas_api.release_info(p jsonb,term text) RETURNS jsonb
LANGUAGE plpgsql STABLE PARALLEL SAFE SECURITY INVOKER SET search_path=pg_catalog,atlas_api AS $$
DECLARE r jsonb;
BEGIN
  r:=atlas_api.require_release(p);
  RETURN jsonb_build_object('dataset',r->'dataset','release',r->'release','count',r->'expected_count',
    'locatedCount',r->'expected_located_count','contentSha256',r->'expected_content_sha256',
    'identitySha256',r->'expected_identity_sha256','releaseFingerprint',r->'expected_content_sha256','contractVersion','1.0.0',
    'searchNormalizer',r->'metadata'->'searchNormalizer','source',(r->'metadata'->'source')-'descriptor');
END $$;

CREATE OR REPLACE FUNCTION atlas_api.catalogue(p jsonb,term text) RETURNS jsonb
LANGUAGE sql STABLE PARALLEL SAFE SECURITY INVOKER SET search_path=pg_catalog,atlas_api AS $$
  SELECT jsonb_build_object('contractVersion','1.0.0','datasets',COALESCE(jsonb_agg(
    atlas_api.release_info(jsonb_build_object('dataset',r.dataset,'release',r.release),'') ORDER BY r.dataset,r.release),'[]'::jsonb))
  FROM atlas.validated_releases r
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA atlas_api FROM PUBLIC;
GRANT USAGE ON SCHEMA atlas_api TO tree_atlas_reader;
-- Helpers execute as invoker too, so the role needs their EXECUTE rights.
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA atlas_api TO tree_atlas_reader;
COMMIT;
