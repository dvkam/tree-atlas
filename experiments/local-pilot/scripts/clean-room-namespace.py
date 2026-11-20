"""Private mount harness. This file runs only under unshare, never directly."""
import os
import json
from pathlib import Path
import subprocess
import sys

if len(sys.argv) < 2:
    raise SystemExit("Expected disposable rootfs path")
rootfs = Path(sys.argv[1]).resolve(strict=True)
online = len(sys.argv) > 2 and sys.argv[2] == "--online"
if not online and len(sys.argv) != 2:
    raise SystemExit("Unsupported namespace mode")
if os.geteuid() != 0 or rootfs.name != "rootfs" or not rootfs.parent.name.startswith("tree-atlas-clean-") or rootfs.parent.parent != Path("/var/tmp"):
    raise SystemExit("Only the dedicated disposable rootfs is accepted")
namespaces = {name: {"self": str(Path(f"/proc/self/ns/{name}").readlink()),
                     "hostInit": str(Path(f"/proc/1/ns/{name}").readlink())}
              for name in ("mnt", "pid", "net")}
for name in ("mnt", "pid") if online else ("mnt", "pid", "net"):
    if namespaces[name]["self"] == namespaces[name]["hostInit"]:
        raise SystemExit(f"Refusing to run outside a private {name} namespace")
subprocess.run(["mount", "--make-rprivate", "/"], check=True)
(rootfs / "dev").mkdir(exist_ok=True)
(rootfs / "proc").mkdir(exist_ok=True)
subprocess.run(["mount", "--rbind", "/dev", str(rootfs / "dev")], check=True)
subprocess.run(["mount", "--make-rslave", str(rootfs / "dev")], check=True)
subprocess.run(["mount", "-t", "proc", "proc", str(rootfs / "proc")], check=True)
(rootfs / "work").mkdir(exist_ok=True)
(rootfs / "work/namespace-proof.json").write_text(json.dumps({
    "mode": "online-preparation" if online else "restore",
    "namespaces": namespaces,
    "privateMount": namespaces["mnt"]["self"] != namespaces["mnt"]["hostInit"],
    "privatePid": namespaces["pid"]["self"] != namespaces["pid"]["hostInit"],
    "privateNetwork": namespaces["net"]["self"] != namespaces["net"]["hostInit"],
    "sharedKernelAndDev": True,
}, indent=2) + "\n")
if online:
    command = sys.argv[3:]
    if not command:
        raise SystemExit("An explicit preparation command is required")
else:
    subprocess.run(["ip", "link", "set", "lo", "up"], check=True)
    command = ["python3", "/work/tree-atlas/experiments/local-pilot/scripts/clean-room-runtime.py", "--restore"]
environment = {"PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
               "HOME": "/root", "LANG": "C.UTF-8", "DEBIAN_FRONTEND": "noninteractive"}
raise SystemExit(subprocess.run(["chroot", str(rootfs), *command], env=environment, stdin=subprocess.DEVNULL).returncode)
