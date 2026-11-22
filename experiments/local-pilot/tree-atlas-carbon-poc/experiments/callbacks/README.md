# Callback/thread interoperability proof

Pinned compiler: `0.0.0-0.nightly.2026.11.07+ca18985`.

Actual compile, link and run checks passed:

1. `callback.carbon`: Carbon function passed directly to C++ `int (*)(int)`.
2. `thread.carbon`: two native `std::thread` instances invoke Carbon function
   bodies. A two-party gate inside those bodies requires overlapping execution;
   serialized execution would time out and fail.
3. `context.carbon`: Carbon receives a non-null C++ request pointer and reads its
   primitive member.
4. `opaque.carbon` plus `opaque.cpp`: C++ sees only a forward-declared `Request`
   in the imported header. The callback type is `int (*)(Request*)`; the Carbon
   handler uses `Core.Optional(Cpp.Request*)`, checks `HasValue()` and calls a
   primitive getter. The external implementation is compiled with native g++.

Rerun in WSL from this PoC root:

```sh
python3 experiments/callbacks/run.py
python3 experiments/callbacks/run_opaque.py
```

Rerunning generates `results.json` and `opaque-results.json` with commands and return codes.
These are isolated compiler/runtime proofs, not HTTP or PostgreSQL tests. No
packages, services, databases or network listeners were changed by these probes.

Official reference examples consulted (not vendored in this branch):

- https://github.com/carbon-language/carbon-lang/blob/trunk/integration_tests/callback_test.carbon
- https://github.com/carbon-language/carbon-lang/blob/trunk/toolchain/check/testdata/interop/cpp/function/export/function.carbon
- https://github.com/carbon-language/carbon-lang/blob/trunk/toolchain/check/testdata/interop/cpp/function/import/void_pointer.carbon

No callback/thread blocker was observed on the pinned nightly. This does not
prove arbitrary Carbon mutable state is thread-safe; each handler still needs
isolated request ownership and synchronized shared infrastructure.
