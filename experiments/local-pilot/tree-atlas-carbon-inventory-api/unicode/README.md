# Frozen native Unicode normalization

The wrapper implements the frozen Unicode 17 query-normalizer through the C
interface of isolated ICU **78.3**. It changes no system package or database.
`assert_version()` rejects a different ICU/Unicode data version at runtime.

`atlas_unicode::normalize(const std::string&)` strictly decodes scalar UTF-8,
rejects more than 500 UTF-16 units before normalization, performs NFD, removes
the exact Unicode Diacritic property, lowercases in the explicit root locale,
then trims the ECMAScript whitespace/line-terminator set. It does not use ICU's
broader whitespace predicate. Embedded NUL remains valid string data; callers
must not truncate it when passing query parameters to PostgreSQL.

`utf16_length()` validates scalar UTF-8 without imposing the query limit. The
implementation uses only ICU's C API, so ICU's system libstdc++ internals do not
cross the service's bundled Carbon C++ string ABI.

The official Ubuntu 22.04 x64 ICU client archive is SHA-256 pinned and checked
against its official GitHub release digest. `icu-client.json` records the URL,
digest and archive size. It is extracted under `tools/icu/usr/local`; no system
library is replaced. The ICU licence remains with the isolated distribution.

From this directory in WSL:

```sh
python3 fetch_icu.py    # initial dependency download only
python3 build_probe.py
/home/david/.nvm/versions/node/v26.13.0/bin/node parity.mjs
```

Build native objects with the pinned Carbon toolchain's `clang`, then link with
`carbon link`. Direct `carbon clang` executable linking does not automatically
add the bundled C++ runtime. Add these final service flags:

```text
-I<unicode>/tools/icu/usr/local/include
-L<unicode>/tools/icu/usr/local/lib
-Wl,-rpath,<unicode>/tools/icu/usr/local/lib
-licuuc -licudata
```

The actual linked paths are recorded in `runtime-libraries.txt`. The native
probe passed **1,132,108 cases** against pinned Node 26.13.0 / ICU 78.3:

- All **1,112,064 Unicode scalar values** individually.
- 20,000 deterministic contextual strings, including case-ignorable Greek sigma
  flanks, combining-order changes, supplementary characters and trim boundaries.
- The ten frozen literal examples and 22 explicit contextual/length cases.
- Twelve invalid UTF-8 or overlength cases, including surrogate encodings,
  overlong sequences, truncated sequences and 502-unit astral input.

`parity-results.json` records the completed run. This is normalization evidence,
not full HTTP, PostgreSQL query or production latency conformance. The probe's
hex protocol preserves arbitrary bytes and avoids accidental NUL truncation.
