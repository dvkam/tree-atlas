"""Compile one local Carbon probe and retain actual compiler/linker evidence."""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COMPILER = ROOT / "tools/carbon_toolchain-0.0.0-0.nightly.2026.11.07/bin/carbon"
SERVICE_LIBPQ = ROOT / "tools/libpq-17.11"

def run(args, timeout=120):
    result = subprocess.run([str(a) for a in args], cwd=ROOT, text=True,
                            capture_output=True, timeout=timeout)
    return {"command": [str(a) for a in args], "returncode": result.returncode,
            "stdout": result.stdout, "stderr": result.stderr}

if __name__ == "__main__":
    name = sys.argv[1]
    build = ROOT / "build"
    build.mkdir(exist_ok=True)
    results = []
    link_args = list(sys.argv[2:])
    if name == "service":
        if not (SERVICE_LIBPQ / "include/libpq-fe.h").exists():
            sys.exit("Build the isolated client first: python3 tools/build_libpq.py")
        native = run([COMPILER, "clang", "--", "-std=c++17", "-O2", "-pthread", "-Wall", "-Wextra",
                      f"-I{SERVICE_LIBPQ / 'include'}", "-c", ROOT / "src/service_runtime.cpp",
                      "-o", build / "service_runtime.o"])
        results.append(native)
        if native["returncode"]:
            (ROOT / f"evidence/{name}-build.json").write_text(json.dumps(results, indent=2))
            print(native["stderr"], file=sys.stderr)
            sys.exit(native["returncode"])
        link_args = [str(build / "service_runtime.o"), f"-L{SERVICE_LIBPQ / 'lib'}",
                     f"-Wl,-rpath,{SERVICE_LIBPQ / 'lib'}", *link_args]
    compile_result = run([COMPILER, "compile", "--no-debug-info",
                          f"--output={build/name}.o", ROOT / f"src/{name}.carbon",
                          "--", "-I/usr/include/postgresql",
                          f"-I{ROOT / 'src'}"])
    results.append(compile_result)
    if compile_result["returncode"] == 0:
        results.append(run([COMPILER, "link", f"--output={build/name}",
                            f"{build/name}.o", "--", *link_args]))
    (ROOT / f"evidence/{name}-build.json").write_text(json.dumps(results, indent=2))
    for result in results:
        print(result["stdout"], end="")
        print(result["stderr"], end="", file=sys.stderr)
    sys.exit(results[-1]["returncode"])
