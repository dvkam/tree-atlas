# Review decision

Two independent subagents reviewed the contract/reference work using the requested
Pocock interface guidance and Pstack adversarial review/proof workflow. Both used
the available inherited model; this is not cross-provider consensus. The reference
author was a separate agent. The lead read the artifacts and reran the corrected
self-tests and independent Python hashes before accepting the freeze.

First-round findings were actionable: the reference accepted unsafe pagination
integers; suggestion input bypassed scalar/length validation; promised literal
status/coincident witnesses were absent; query-key encoding lacked independent
goldens. Those issues are fixed. The query-key goldens cover normalization,
negative zero, pagination and viewport changes. Real-release suggestions were
added, and cohort midpoint offsets are labelled rather than described as matching
set midpoints. Both reviewers rechecked the changes and accepted with no remaining
actionable blocker to the local contract freeze.

Lead judgment: freeze version 1.0.0 for the four locked inventory partitions.
Preserve offline completeness as a requirement. Do not treat the current cache
as a complete pack, infer legacy normalizer versions, equate cluster counts with
exact viewport counts, or claim the unchanged app already conforms to every new
field. Locale-independent matching is an explicit correction; it is versioned
separately from source import normalization.

Reference evidence covers 1,657,347 canonical records, 3,239 detail assets, 48
query cases, 192 selected page expectations and 16 suggestion cases. Literal
specification checks pass 99 assertions, detect nine semantic mutations, and the
candidate checker rejects seven incorrect-response variants. The candidate
checker hashes actual enumerated IDs; matching counts alone cannot pass.

The independent reader starts from published canonical detail records. It does
not prove upstream source completeness or importer correctness; raw acquisition
hashes were preserved as evidence but not reverified in this step. Map assets are
byte-verified, not a proof of cluster membership/click behavior. Complete offline
storage, publication races, database queries and browser journeys are future
interface checks. Literal lifecycle cases record their expected outcomes without
claiming an executed implementation pass.

Next stage: stage canonical records under the frozen release identities, preserve
full content/ordinal digests, then compare actual public query results against
these independent expectations. No inventory import or deployment occurred here.
