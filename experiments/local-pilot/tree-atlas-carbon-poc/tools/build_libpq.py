"""Build only an isolated libpq client; never install or upgrade a database server."""
import ctypes
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
VERSION = "17.11"
SHA256 = "dd27f2b3c59e73ed14aa3324901242bf69a032a6347805f274e6260322d42979"
URL = f"https://ftp.postgresql.org/pub/source/v{VERSION}/postgresql-{VERSION}.tar.bz2"
PREFIX = ROOT / f"tools/libpq-{VERSION}"


def main():
    evidence = ROOT / "evidence"
    archive = ROOT / "tools" / f"postgresql-{VERSION}.tar.bz2"
    checksum = urllib.request.urlopen(URL + ".sha256", timeout=30).read().decode()
    expected = checksum.split()[0]
    if expected != SHA256:
        raise RuntimeError("Official checksum changed from the reviewed pin")
    if not archive.exists():
        with urllib.request.urlopen(URL, timeout=60) as source, archive.open("wb") as target:
            while chunk := source.read(1024 * 1024):
                target.write(chunk)
    actual = hashlib.sha256(archive.read_bytes()).hexdigest()
    if actual != expected:
        raise RuntimeError("Official source checksum mismatch")
    (evidence / "libpq-source.sha256").write_text(checksum)
    commands = []
    with tempfile.TemporaryDirectory(prefix="tree-atlas-libpq-") as directory:
        temporary = Path(directory)
        with tarfile.open(archive) as source:
            source.extractall(temporary, filter="data")
        source = temporary / f"postgresql-{VERSION}"
        build = temporary / "build"
        build.mkdir()
        sequence = [
            [str(source / "configure"), f"--prefix={PREFIX}", "--without-readline",
             "--without-zlib", "--without-icu", "--with-ssl=openssl"],
            ["make", "-j4", "-C", "src/interfaces/libpq"],
            ["make", "-C", "src/interfaces/libpq", "install"],
            ["make", "-C", "src/include", "install"],
        ]
        with (evidence / "libpq-build.log").open("w") as log:
            for command in sequence:
                commands.append(command)
                print("Running", command, flush=True)
                result = subprocess.run(command, cwd=build, stdout=log, stderr=subprocess.STDOUT)
                if result.returncode:
                    raise RuntimeError(f"Build failed; inspect evidence/libpq-build.log ({command})")
    library = PREFIX / "lib/libpq.so.5"
    native = ctypes.CDLL(str(library))
    version = native.PQlibVersion()
    symbols = ["PQcancelCreate", "PQcancelStart", "PQcancelPoll", "PQcancelSocket", "PQcancelFinish"]
    for name in symbols:
        getattr(native, name)
    dependencies = subprocess.run(["ldd", str(library)], text=True, capture_output=True, check=True)
    (evidence / "libpq-client-libraries.txt").write_text(dependencies.stdout)
    packages = subprocess.run(["dpkg-query", "-W", "gcc", "make", "bison", "flex", "libssl-dev",
                               "postgresql-16", "libpq5"], text=True, capture_output=True, check=True)
    (evidence / "libpq-client-build-packages.txt").write_text(packages.stdout)
    manifest = {"source_url": URL, "checksum_url": URL + ".sha256",
                "sha256": actual, "prefix": str(PREFIX), "library": str(library.resolve()),
                "PQlibVersion": version, "cancel_symbols_verified": symbols,
                "build_commands": commands,
                "server_install_or_upgrade": False,
                "scope": "Isolated client only; existing WSL PostgreSQL server and system libpq unchanged"}
    (evidence / "libpq-client-build.json").write_text(json.dumps(manifest, indent=2))
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
