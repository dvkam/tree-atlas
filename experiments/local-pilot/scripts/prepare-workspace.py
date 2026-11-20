"""Prepare the read-only asset input expected by the frozen pilot layout.

Only creates a generated compatibility directory/link. It does not copy data,
change source assets, install dependencies, connect to PostgreSQL, or reseal the
contract. Run from WSL; Windows may require extra rights for directory symlinks.
"""
import argparse
import json
import os
from pathlib import Path


def prepare(repo: Path) -> dict[str, object]:
    repo = repo.resolve(strict=True)
    workspace = repo / "experiments/local-pilot"
    if not workspace.is_dir() or workspace.is_symlink():
        raise RuntimeError("The expected experiments/local-pilot directory is missing or linked.")
    if workspace.resolve() != workspace:
        raise RuntimeError("The pilot directory must stay inside this checkout without linked parents.")
    source = repo / "public/data"
    if not source.is_dir() or source.resolve() != source:
        raise RuntimeError("The checkout's public/data directory is missing or linked elsewhere.")
    if not (source / "manifest.json").is_file():
        raise RuntimeError("The checkout's public/data/manifest.json is missing.")

    compatibility = workspace / "tree-atlas"
    public = compatibility / "public"
    for parent in (compatibility, public):
        if parent.is_symlink() or (parent.exists() and not parent.is_dir()):
            raise RuntimeError(f"Refusing to replace or follow an unexpected compatibility path: {parent}")
    public.mkdir(parents=True, exist_ok=True)
    link = public / "data"
    if link.is_symlink():
        if link.resolve() != source:
            raise RuntimeError(f"The existing asset link points elsewhere: {link}")
        created = False
    elif link.exists():
        raise RuntimeError(f"Refusing to replace an existing asset path: {link}")
    else:
        link.symlink_to(os.path.relpath(source, public), target_is_directory=True)
        created = True
    return {"assetInput": str(link), "source": str(source), "created": created,
            "inventoryCopied": False, "sourceChanged": False, "deployment": False}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    repo = Path(__file__).resolve().parents[3]
    print(json.dumps(prepare(repo), indent=2))


if __name__ == "__main__":
    main()
