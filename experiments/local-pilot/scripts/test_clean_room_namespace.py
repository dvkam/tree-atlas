"""A timeout must close the disposable namespace and all its owned children."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import unittest
import uuid
import importlib.util
import tempfile

spec = importlib.util.spec_from_file_location("clean_room", Path(__file__).with_name("clean-room.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


@unittest.skipUnless(hasattr(os, "geteuid") and os.geteuid() == 0 and shutil.which("unshare"), "WSL root namespace test")
class CleanRoomNamespaceTests(unittest.TestCase):
    def test_timed_out_unshare_parent_leaves_no_owned_child(self):
        token = "tree-atlas-clean-child-" + uuid.uuid4().hex
        script = ("import subprocess,sys,time; "
                  "subprocess.Popen([sys.executable,'-c','import time; time.sleep(30)',sys.argv[1]]); "
                  "print('started',flush=True); time.sleep(30)")
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory) / "child.log"
            with self.assertRaises(subprocess.TimeoutExpired):
                module.checked(module.namespace_command([sys.executable, "-c", script, token]), log, timeout=1)
            self.assertIn("started", log.read_text())
        for _ in range(50):
            remaining = []
            for entry in Path("/proc").iterdir():
                if not entry.name.isdigit():
                    continue
                try:
                    if token.encode() in (entry / "cmdline").read_bytes():
                        remaining.append(entry.name)
                except OSError:
                    pass
            if not remaining:
                break
            time.sleep(.05)
        self.assertEqual(remaining, [], "Owned namespace child survived parent timeout")


if __name__ == "__main__":
    unittest.main()
