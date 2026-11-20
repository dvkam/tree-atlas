"""Independent hashlib check of literal normalized wire tuples, not search code."""
import hashlib
import json
from pathlib import Path

base = json.loads(Path(__file__).with_name("query-key-input.json").read_text())
cases = [
    (base, "94c169eadc0783cca93156daab852eac14a9f061571690a5164401b0ff20a699"),
    (base[:7] + [25, 25], "a5f2bfabee802c885e17ec9bd80b8de143bfea6d25ec6f7bb2b6057ddc83ec07"),
    (base[:5] + [[-1, -1, 1, 1]] + base[6:], "7cb34a4cfe217852470cc60b1cfd7782cdc7e911bad2fddca17d5ae516919512"),
]
for wire, expected in cases:
    actual = hashlib.sha256(json.dumps(wire, separators=(",", ":")).encode()).hexdigest()
    assert actual == expected
print("3 literal query-key wire hashes verified independently with hashlib")
