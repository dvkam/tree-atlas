# Local staging review — 2026-11-08

Intent: import the four sealed canonical inventories into separate local
PostgreSQL stages, verify every record independently, and leave apps and hosting
unchanged. The frozen contract/reference files were not edited.

The work used the requested Pocock module/interface guidance and Pstack
adversarial review and direct verification. A design reviewer and an independent
fault-test reviewer examined the schema, loader and validation transition. A
separate verifier author implemented independent database readback. These are
independent runs of the available model, not cross-provider consensus.

Acted on during review:

1. Plain parent-status checks could permit a late insert around sealing if a
   loading parent were visible across transactions. The insert trigger now
   locks the parent FOR SHARE as a fixed-search-path security-definer function;
   finish_loading takes FOR UPDATE. A deferred constraint also rejects any
   transaction that tries to commit a loading release. This was corrected on
   the empty database before imports; the new setup includes the correction.
2. Dictionary sealing now checks zero-based minimum and contiguous maximum,
   not just the existence of one expected ordinal.
3. Idempotent imports check expected located count as well as metadata and
   identity/content fingerprints.
4. Loader/admin commands explicitly constrain the local host/socket, port,
   database and role and discard inherited PG settings. No secrets enter argv.
5. The Python validation gate refuses optimized execution so acceptance
   assertions cannot be disabled. The refusal was exercised before validation.

Direct evidence: all four imports committed as immutable staged releases.
Sixteen standard real-database checks passed; the separate deliberate ten-row
producer failure left zero retained release/record rows. All synthetic SQL
fixtures rolled back. A second actual importer run returned unchanged for all
four releases, without duplication.

The independent reader uses the sealed oracle only for expected semantics,
never loader helpers. It read all 1,657,347 actual PostgreSQL canonical records,
ordinals, coordinates and every normalized field, and matched full identity,
content and dictionary digests. All 48 SQL query memberships/viewport sets,
192 derived page slices, 16 suggestions and 22 literal SQL cases passed. Its
comparator rejected 11 corrupted-output variants. Verification ran in one
read-only repeatable-read snapshot and wrote a success report only after the
SQL process completed successfully.

Lead judgment: accept the local validated staging step. The administrator's
guarded transition bound the successful report to the current freeze, lock and
reference hashes and atomically validated all four immutable stages. Restricted
reader checks then returned the exact 1,657,347 records. No loading releases or
owned import/verification sessions remained; the old synthetic PoC fixture was
unchanged. Trusted local superusers can override protections; no defence against
the database owner is claimed.

Noted limits: the loader is single-writer; a concurrent identical writer may
fail safely on uniqueness rather than return unchanged. Actual source content
is frozen, not newly acquired upstream. CSV boundary tests and actual TEXT COPY
readback are separate evidence. Direct SQL membership/slices do not establish
HTTP pagination, Carbon adapter, PostGIS, clustering, offline browser behavior,
refresh publication, backups or interactive speed. Those remain later gates.
