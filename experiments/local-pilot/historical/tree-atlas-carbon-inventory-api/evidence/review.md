# Local Carbon inventory adapter review — 2026-11-08

Intent: connect the validated four-release database to local Carbon HTTP,
preserve the frozen search/release rules, and measure actual costs without
changing the apps or deploying. The work used the requested Pocock interface
guidance and Pstack adversarial review/proof workflow. Independent available-model
subagents reviewed design, native behavior, SQL and HTTP evidence. This is not
cross-provider consensus.

## Acted-on findings

- Unicode 17 could not be replaced by the host's older ICU or locale-sensitive
  lowercase. An isolated checked ICU 78.3 library passed 1,132,108 independent
  parity cases. Native number formatting separately passed 20,012 ECMAScript
  serialization vectors.
- json-c may replace escaped lone surrogates, so the wire parser now rejects
  them before parsing. Valid embedded NUL is retained for normalization/keying
  and maps to an explicit false SQL predicate; it never becomes empty-query
  membership. Explicit contractVersion:null is rejected using field presence.
- Raw JSON number formatting was not sufficient for frozen query keys. A tested
  ECMAScript formatter handles negative zero and notation thresholds.
- Initial cold HTTP timing exposed a deadline miss. Actual nested SQL profiles
  then found heap scans, external sorting, JIT costs and a sixth-call generic-
  plan regression above five seconds. Function-local settings, a measured
  covering index, ordinary VACUUM and compact release metadata corrected the
  observed path. There was no timeout extension or approximate-count shortcut.
- The first load run rejected 13/100 ten-client warm requests because only four
  requests could wait. Increasing the bounded wait queue to 16 preserved two DB
  connections and the 250 ms wait, and removed errors at ten clients. At 25
  clients, 9/100 still received explicit busy errors; this remains stress evidence.
- Missing/null required release metadata now fails closed with IS DISTINCT FROM.
  Grid helpers bound outside coordinates before division/integer conversion, so
  valid tiny viewports do not depend on SQL predicate evaluation order. Actual
  SQL guard regressions passed; synthetic release changes rolled back.

## Acceptance evidence

The final tuned executable passed 22 HTTP semantic/lifecycle checks, including
real SQL lock faults for explicit cancel, deadline, reset and delayed legitimate
half-close. A second full run after the queue and SQL guard changes enumerated
all 1,657,347 identities over 16,576 HTTP pages and matched independent ordered
digests. It checked 192 selected pages, 16 suggestions, eight full details,
small filtered sets, cluster unions and viewport pages. Real coincident Geneva
trees were individually reachable at zoom 24. Cleanup left zero API sessions.

Per-request responses are built from fresh parsed summary-cache copies; caller
keys, list pages and scoped cluster IDs cannot contaminate another cache user.
Singleflight and cancellation state remain request-owned. Cancelled PG sessions
are retired before reuse. The metadata/data pin is immutable across the two SQL
operations that produce combined results.

Thirty fresh API process/cache measurements, with warm/uncontrolled DB/OS cache,
had a first-search p95 of 1,032.96 ms and max 1,058.78 ms including startup and
attempt reservation. One hundred warm requests at ten concurrent clients had
zero errors and p95 20.04 ms, with maxSockets=32. These are not physical mobile,
shaped-network or hosted first-navigation acceptance results. API RSS was about
44 MiB, excluding PostgreSQL and OS cache. The known sort spill remains.

Lead judgment: accept this local interoperability adapter and its measured
scope. No remaining actionable correctness defect was found in reviewed current
cohort behavior. The original apps, frozen contract, canonical data and synthetic
PoC database remain unchanged; no deployment occurred.

## Ownership and remaining limits

Carbon selects HTTP routes, method/media handling, SQL operations and final
reply forwarding. Most inventory validation, normalization, query-key encoding,
caching and lifecycle adaptation runs in C++; search/aggregation/paging runs in
PostgreSQL. This is substantial native/SQL code, not a Carbon-native web stack.
Any decision to move more domain logic into Carbon is a separate architecture
choice rather than a claim established by these integration tests.

The exhaustive HTTP check covers complete empty-query inventories. Broad-filter
full HTTP enumeration, every cluster/detail, an unlocated real inventory, browser
offline packs, remote frontend integration, HTTPS/admission controls, restore,
refresh publication and mobile/hosted performance remain unverified. Earlier
staging tests cover full SQL canonical content and frozen filtered sets; that
evidence is not relabelled as HTTP or offline proof.
