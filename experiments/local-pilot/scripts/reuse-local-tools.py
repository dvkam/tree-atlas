"""Explicitly reuse ignored, preinstalled WSL tools; never copy credentials or data."""
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LINKS = (
    ("tree-atlas-carbon-poc/tools/carbon_toolchain-0.0.0-0.nightly.2026.11.07", "bin/carbon"),
    ("tree-atlas-carbon-poc/tools/libpq-17.11", "lib/libpq.so.5"),
    ("tree-atlas-carbon-inventory-api/unicode/tools/icu", "usr/local/lib/libicuuc.so.78"),
    ("tree-atlas-local/node_modules", ".bin/tsc"),
)


def reuse(source_root: Path, destination_root: Path = ROOT):
    source_root = source_root.resolve(strict=True)
    destination_root = destination_root.resolve(strict=True)
    if source_root == destination_root or source_root.is_relative_to(destination_root):
        raise ValueError("Choose a separate existing pilot workspace as the source.")
    # Preflight everything before creating links, including absent/different targets.
    pending = []
    for relative, marker in LINKS:
        source = (source_root / relative).resolve(strict=True)
        if not source.is_dir() or not (source / marker).is_file():
            raise ValueError(f"Required installed tool is missing: {relative}/{marker}")
        target = destination_root / relative
        parent = target.parent
        while parent != destination_root:
            if parent.is_symlink():
                raise ValueError(f"Refusing a symlinked destination parent: {parent}")
            parent = parent.parent
        if target.is_symlink():
            if target.resolve() != source:
                raise ValueError(f"Refusing to replace a different link: {target}")
        elif target.exists():
            raise ValueError(f"Refusing to replace an existing installation: {target}")
        else:
            pending.append((target, source))
    for target, source in pending:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.symlink_to(source, target_is_directory=True)
    return len(pending)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Existing sibling pilot folders, such as the original outputs directory")
    args = parser.parse_args()
    print(f"Created {reuse(args.source)} ignored tool links; credentials and database unchanged.")
