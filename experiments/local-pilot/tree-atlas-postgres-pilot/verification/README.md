# Independent PostgreSQL readback

Run `verify-postgres.mjs` inside WSL with the frozen Node 26.13.0 runtime after
all four releases have finished staging. It reads the private 0600 verifier
configuration from `/home/david/.config/tree-atlas-postgres-pilot/postgres.json`.
The configured role must be `tree_atlas_verify`, on loopback PostgreSQL database
`tree_atlas_pilot`, port 5432. Credentials are passed in the child environment,
not command arguments or reports.

The verifier imports no loader code. Expected record serialization, normalization
and identities come from the sealed independent reference, and expected hashes,
counts, page slices and suggestions come from its frozen result file. It checks
the frozen artifacts before opening PostgreSQL.

One read-only repeatable-read transaction exports:

- Every canonical record in contiguous prepared order, including every generated
  position/ID projection and every stored normalized search field.
- The entire raw suggestion dictionary in prepared order, with normalized values.
- All matching IDs for each of the 48 frozen queries, with located/viewport flags.
- The 16 frozen suggestion responses.
- The frozen literal missing-position, punctuation, boundary, removed/coincident
  and pagination cases, through independent SQL `VALUES` fixtures.

The consumer recomputes full ordered identity/content and dictionary SHA-256
digests from the actual database output. Matching stored metadata or counts
alone cannot pass. It also checks exact query membership/order, located counts,
viewport membership digests and 192 expected page slices. Those page slices are
derived from complete ordered SQL result streams; this is not a claim about an
HTTP adapter's OFFSET handling. SQL predicates are independently built using
literal `strpos` and inclusive float8 bounds; they do not reuse a candidate API.

Output is `../evidence/postgres-independent-verification.json`. A new run first
replaces any older success with `passed:false`; success is written atomically
only after all output checks and a successful PostgreSQL exit. The report binds
the exact freeze, lock and reference hashes and the observed database session.
The verifier never promotes releases or performs database writes.

`selftest.mjs` verifies that the consumer rejects changed canonical content,
normalization, positions, ordinals, membership, dictionary, suggestions, release
identity, freeze identity, truncated records and writable transaction evidence.
These synthetic negative tests are not themselves a PostgreSQL conformance pass.

This stage does not test Carbon HTTP query routes, cluster expansion, a future
offline browser pack, upstream source completeness, index speed or deployment.
