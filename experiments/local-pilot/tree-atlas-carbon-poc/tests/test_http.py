"""Black-box localhost HTTP tests against the real Carbon executable and PostgreSQL."""
import json
import os
import select
import socket
import subprocess
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = Path("/home/david/.config/tree-atlas-carbon-poc/postgres.json")

class HttpProof(unittest.TestCase):
    def request(self, body, expected_status=200, *, prefix=None, headers=None,
                fragments=False, db_mode="normal"):
        config = json.loads(CONFIG.read_text())
        env = dict(os.environ)
        if db_mode == "unavailable": config["port"] = 1
        if db_mode == "bad_password": config["password"] = "deliberately_wrong_poc_password"
        env["TREE_ATLAS_PG"] = " ".join(f"{k}={v}" for k,v in config.items()) + " connect_timeout=2"
        if db_mode == "missing": del env["TREE_ATLAS_PG"]
        process = subprocess.Popen([str(ROOT / "build/http_probe")], env=env,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.addCleanup(self.cleanup, process)
        self.assertTrue(select.select([process.stdout], [], [], 5)[0], "No listening-port notification")
        ready = process.stdout.readline().decode().strip()
        self.assertTrue(ready.startswith("PORT "), ready)
        port = int(ready.split()[1])
        request = (prefix or "POST /probe HTTP/1.1\r\n")
        request += headers if headers is not None else f"Host: localhost\r\nContent-Length: {len(body)}\r\n"
        wire = request.encode() + b"\r\n" + body
        started = time.monotonic()
        with socket.create_connection(("127.0.0.1", port), timeout=3) as client:
            client.settimeout(4)
            if fragments:
                for part in [wire[:9], wire[9:-3], wire[-3:]]:
                    client.sendall(part)
                    time.sleep(0.02)
            else: client.sendall(wire)
            result = b""
            while True:
                chunk = client.recv(8192)
                if not chunk: break
                result += chunk
        _, stderr = process.communicate(timeout=5)
        self.assertEqual(process.returncode, 0, stderr.decode(errors="replace"))
        head, payload = result.split(b"\r\n\r\n", 1)
        self.assertEqual(int(head.split()[1]), expected_status)
        self.assertIn(b"application/json; charset=utf-8", head)
        declared = [x for x in head.split(b"\r\n") if x.lower().startswith(b"content-length:")]
        self.assertEqual(int(declared[0].split(b":",1)[1]), len(payload))
        self.assertLess(time.monotonic() - started, 5)
        return json.loads(payload)

    def cleanup(self, process):
        if process.poll() is None: process.kill()
        process.communicate(timeout=3)

    def echo(self, value, **kwargs):
        result = self.request(json.dumps({"value":value}, ensure_ascii=False).encode(), **kwargs)
        self.assertEqual(result, {"echo":value, "database":"tree_atlas_poc", "fixture":"Platane – Zürich 🌳"})

    def test_unicode_and_leading_zero(self): self.echo("0007 – Zürich 🌳 東京")
    def test_sql_injection_is_literal(self): self.echo("'; DROP TABLE public.poc_probe; -- % _ \\")
    def test_empty_string(self): self.echo("")
    def test_json_escaping(self): self.echo('quote " slash \\ newline\n tab\t')
    def test_fragmented_http(self): self.echo("fragments", fragments=True)
    def test_mixed_case_header(self): self.request(b'{"value":"case"}', headers='Host: localhost\r\ncOnTeNt-LeNgTh: 16\r\n')
    def test_malformed_json(self): self.request(b'{"value":', 400)
    def test_trailing_json_garbage(self): self.request(b'{"value":"x"} BAD', 400)
    def test_wrong_json_type(self): self.request(b'{"value":123}', 400)
    def test_missing_field(self): self.request(b'{}', 400)
    def test_embedded_nul(self): self.request(b'{"value":"a\\u0000b"}', 400)
    def test_invalid_utf8(self): self.request(b'{"value":"\xff"}', 400)
    def test_body_limit(self): self.request(b'x' * 2049, 413)
    def test_unknown_route(self): self.request(b'{}', 404, prefix="POST /other HTTP/1.1\r\n")
    def test_duplicate_length(self): self.request(b'{}', 400, headers="Content-Length: 2\r\ncontent-length: 2\r\n")
    def test_transfer_encoding_rejected(self): self.request(b'{}', 400, headers="Content-Length: 2\r\ntRaNsFeR-EnCoDiNg: chunked\r\n")
    def test_unavailable_database(self): self.request(b'{"value":"x"}', 503, db_mode="unavailable")
    def test_bad_credentials(self): self.request(b'{"value":"x"}', 503, db_mode="bad_password")
    def test_missing_database_config(self): self.request(b'{"value":"x"}', 503, db_mode="missing")

    def test_absolute_receive_deadline(self):
        process = subprocess.Popen([str(ROOT / "build/http_probe")],
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.addCleanup(self.cleanup, process)
        self.assertTrue(select.select([process.stdout], [], [], 5)[0])
        port = int(process.stdout.readline().split()[1])
        started = time.monotonic()
        with socket.create_connection(("127.0.0.1", port), timeout=3) as client:
            client.settimeout(3)
            client.sendall(b"P")
            for _ in range(4):
                time.sleep(0.25)
                client.sendall(b"O")
            response = client.recv(8192)
            self.assertIn(b"400 Bad Request", response)
        process.communicate(timeout=3)
        self.assertEqual(process.returncode, 0)
        self.assertLess(time.monotonic() - started, 2.8)

if __name__ == "__main__": unittest.main(verbosity=2)
