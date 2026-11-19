"""Black-box persistent Carbon service tests against real native WSL PostgreSQL.

Run inside WSL after building build/service. PostgreSQL activity is observed
through a separate connection, so a returned HTTP cancellation is not its proof.
"""
import concurrent.futures
import http.client
import json
import os
import select
import socket
import struct
import subprocess
import time
import unittest
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = Path("/home/david/.config/tree-atlas-carbon-poc/postgres.json")
POOL_APPLICATION = "tree_atlas_carbon_pool"


class ServiceProof(unittest.TestCase):
    def test_reset_client_cancels_active_sql_before_deadline(self):
        client = socket.create_connection(("127.0.0.1", self.port), timeout=2)
        self.addCleanup(client.close)
        body = json.dumps({"value": "reset-client", "sleep_ms": 1500, "timeout_ms": 1500}).encode()
        client.sendall(b"POST /probe HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nX-Request-ID: " +
                       self.fresh_id().encode() + b"\r\nContent-Length: " + str(len(body)).encode() + b"\r\n\r\n" + body)
        active = self.wait_for_active(1)
        old_pid = str(active[0]["pid"])
        started = time.monotonic()
        client.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack("ii", 1, 0))
        client.close()
        until = started + 0.7
        while time.monotonic() < until:
            stats = self.stats()
            if stats["cancel_acknowledged"] >= 1 and stats["active"] == 0:
                break
            time.sleep(0.02)
        self.assertGreaterEqual(stats["cancel_acknowledged"], 1)
        self.assertEqual(stats["active"], 0)
        self.assertNotIn(old_pid, {str(row["pid"]) for row in self.activity()})
        self.assert_echo(self.probe("after reset"), "after reset")

    def test_trickled_headers_have_absolute_deadline(self):
        started = time.monotonic()
        closed = False
        with socket.create_connection(("127.0.0.1", self.port), timeout=2) as client:
            client.sendall(b"GET /health HTTP/1.1\r\nHost: localhost\r\nX-Slow: ")
            while time.monotonic() - started < 2.3:
                try:
                    client.sendall(b"x")
                    if select.select([client], [], [], 0.1)[0]:
                        closed = not client.recv(8192)
                        if closed: break
                except (BrokenPipeError, ConnectionResetError):
                    closed = True
                    break
        self.assertTrue(closed, "Header trickle evaded the absolute deadline")
        self.assertLess(time.monotonic() - started, 2.3)

    def test_silent_partial_body_has_absolute_deadline(self):
        with socket.create_connection(("127.0.0.1", self.port), timeout=2) as client:
            client.settimeout(1.85)
            client.sendall(b"POST /probe HTTP/1.1\r\nHost: localhost\r\nContent-Length: 100\r\n\r\n{")
            started = time.monotonic()
            try:
                result = client.recv(8192)
                self.assertEqual(result, b"")
            except ConnectionResetError:
                pass
            self.assertLess(time.monotonic() - started, 1.85)
        self.assertEqual(self.stats()["active"], 0)

    def test_second_keepalive_request_gets_its_own_phase_deadline(self):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=3)
        self.addCleanup(connection.close)
        self.assertEqual(self.call("GET", "/health", connection=connection)[0], 200)
        time.sleep(1)
        self.assert_echo(self.call("POST", "/probe", {"value": "second", "sleep_ms": 700},
                                   connection=connection), "second")

    def fresh_id(self):
        status, data = self.call("POST", "/attempt")
        self.assertEqual(status, 200, data)
        return data["id"]

    def setUp(self):
        self.config = json.loads(CONFIG.read_text())
        self.environment = dict(os.environ)
        self.environment["TREE_ATLAS_PG"] = " ".join(
            f"{key}={value}" for key, value in self.config.items()
        ) + " connect_timeout=2"
        self.process = subprocess.Popen(
            [str(ROOT / "build/service")], env=self.environment,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        self.addCleanup(self.stop_service)
        self.assertTrue(select.select([self.process.stdout], [], [], 8)[0],
                        "No listening-port notification")
        line = self.process.stdout.readline().decode().strip()
        self.assertTrue(line.startswith("PORT "), line)
        self.port = int(line.split()[1])
        self.assertEqual(self.call("GET", "/health"), (200, {"ok": True}))

    def stop_service(self):
        if self.process.poll() is None:
            self.process.terminate()
        try:
            self.process.communicate(timeout=4)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.communicate(timeout=2)
            self.fail("Service did not terminate within four seconds")
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            if not self.activity():
                return
            time.sleep(0.03)
        self.fail("PostgreSQL pool sessions outlived the service")

    def call(self, method, path, payload=None, *, request_id=None, headers=None,
             raw_body=None, connection=None, chunked=False):
        owned = connection is None
        connection = connection or http.client.HTTPConnection("127.0.0.1", self.port, timeout=4)
        values = {"Content-Type": "application/json"}
        if path == "/probe": values["X-Request-ID"] = request_id or self.fresh_id()
        if headers:
            values.update(headers)
        body = raw_body
        if payload is not None:
            body = json.dumps(payload, ensure_ascii=False).encode()
        if chunked:
            body = [body[:4], body[4:]]
        try:
            connection.request(method, path, body=body, headers=values, encode_chunked=chunked)
            response = connection.getresponse()
            data = response.read()
            self.assertIn("application/json", response.getheader("Content-Type", ""))
            return response.status, json.loads(data)
        finally:
            if owned:
                connection.close()

    def probe(self, value="probe", *, sleep_ms=0, timeout_ms=1200, request_id=None):
        return self.call("POST", "/probe", {
            "value": value, "sleep_ms": sleep_ms, "timeout_ms": timeout_ms,
        }, request_id=request_id)

    def stats(self):
        status, data = self.call("GET", "/stats")
        self.assertEqual(status, 200)
        return data

    def activity(self):
        env = dict(os.environ)
        env.update(PGHOST=self.config["host"], PGPORT=str(self.config["port"]),
                   PGDATABASE=self.config["dbname"], PGUSER=self.config["user"],
                   PGPASSWORD=self.config["password"], PGAPPNAME="tree_atlas_carbon_observer")
        sql = """SELECT COALESCE(json_agg(json_build_object(
            'pid', pid, 'state', state, 'query', query, 'wait_event', wait_event)), '[]'::json)
            FROM pg_stat_activity
            WHERE application_name = 'tree_atlas_carbon_pool'
            AND pid <> pg_backend_pid();"""
        result = subprocess.run(["psql", "-X", "-At", "-v", "ON_ERROR_STOP=1"],
                                input=sql, text=True, capture_output=True, env=env, timeout=4)
        self.assertEqual(result.returncode, 0, result.stderr)
        rows = json.loads(result.stdout)
        evidence_path = ROOT / "evidence/service-observations.jsonl"
        with evidence_path.open("a") as evidence:
            evidence.write(json.dumps({"test": self._testMethodName,
                                       "pool_sessions": rows}) + "\n")
        return rows

    def test_terminated_idle_sessions_are_replaced(self):
        before = self.activity()
        old_pids = {row["pid"] for row in before}
        self.assertEqual(len(old_pids), 2)
        env = dict(os.environ)
        env.update(PGHOST=self.config["host"], PGPORT=str(self.config["port"]),
                   PGDATABASE=self.config["dbname"], PGUSER=self.config["user"],
                   PGPASSWORD=self.config["password"], PGAPPNAME="tree_atlas_carbon_observer")
        result = subprocess.run(["psql", "-X", "-At", "-v", "ON_ERROR_STOP=1"],
            input="SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='tree_atlas_carbon_pool'",
            text=True, capture_output=True, env=env, timeout=4)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip().splitlines(), ["t", "t"])
        first = self.probe("detect disconnected slot")
        self.assertIn(first[0], {200, 503})
        recovered_pid = int(self.assert_echo(self.probe("reconnected"), "reconnected"))
        self.assertNotIn(recovered_pid, old_pids)
        self.assertLessEqual(len(self.activity()), 2)

    def test_unfinished_chunked_oversize_upload_terminates(self):
        started = time.monotonic()
        with socket.create_connection(("127.0.0.1", self.port), timeout=2) as client:
            client.settimeout(2)
            client.sendall(b"POST /probe HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n")
            # Deliberately never send a terminating zero chunk.
            client.sendall(b"1000\r\n" + b"x" * 4096 + b"\r\n")
            try:
                response = client.recv(8192)
            except ConnectionResetError:
                response = b""
            self.assertTrue(not response or b" 413 " in response)
        self.assertLess(time.monotonic() - started, 1.5)
        self.assertEqual(self.call("GET", "/health"), (200, {"ok": True}))

    def test_trickled_unfinished_chunked_upload_terminates(self):
        started = time.monotonic()
        terminated = False
        with socket.create_connection(("127.0.0.1", self.port), timeout=2) as client:
            client.settimeout(0.1)
            client.sendall(b"POST /probe HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n")
            while time.monotonic() - started < 2.6:
                try:
                    client.sendall(b"1\r\nx\r\n")
                    if select.select([client], [], [], 0.18)[0]:
                        response = client.recv(8192)
                        self.assertTrue(not response or b" 504 " in response)
                        terminated = True
                        break
                except (BrokenPipeError, ConnectionResetError):
                    terminated = True
                    break
        self.assertTrue(terminated, "Streaming input kept resetting the idle timeout")
        self.assertLess(time.monotonic() - started, 2.6)
        self.assertEqual(self.call("GET", "/health"), (200, {"ok": True}))

    def wait_for_active(self, count, *, timeout=1):
        deadline = time.monotonic() + timeout
        last = []
        while time.monotonic() < deadline:
            last = self.activity()
            active = [row for row in last if row["state"] == "active" and "pg_sleep" in row["query"]]
            if len(active) == count:
                return active
            time.sleep(0.02)
        self.fail(f"Expected {count} active PostgreSQL sleeps; last observed states: {last}")

    def assert_echo(self, response, value):
        status, data = response
        self.assertEqual(status, 200, data)
        self.assertEqual(data["echo"], value)
        self.assertEqual(data["fixture"], "Platane – Zürich 🌳")
        self.assertTrue(str(data["pid"]).isdigit())
        return str(data["pid"])

    def raw_http(self, data):
        with socket.create_connection(("127.0.0.1", self.port), timeout=3) as client:
            client.settimeout(3)
            client.sendall(data)
            result = b""
            while True:
                try:
                    chunk = client.recv(8192)
                except ConnectionResetError:
                    if not result:
                        raise
                    break
                if not chunk:
                    break
                result += chunk
        return result

    def test_health_has_no_database_query(self):
        self.assertEqual(self.call("GET", "/health"), (200, {"ok": True}))
        self.assertEqual(self.stats()["active"], 0)

    def test_unicode_and_leading_zero(self):
        self.assert_echo(self.probe("0007 – Zürich 🌳 東京"), "0007 – Zürich 🌳 東京")

    def test_quotes_sql_text_and_json_escaping_are_literal(self):
        value = "'; DROP TABLE poc_probe; -- % _ \\\n\t\""
        self.assert_echo(self.probe(value), value)
        self.assert_echo(self.probe("still present"), "still present")

    def test_empty_string(self):
        self.assert_echo(self.probe(""), "")

    def test_http_keepalive(self):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=4)
        self.addCleanup(connection.close)
        self.assertEqual(self.call("GET", "/health", connection=connection), (200, {"ok": True}))
        self.assert_echo(self.call("POST", "/probe", {"value": "keepalive"}, connection=connection),
                         "keepalive")

    def test_chunked_json(self):
        self.assert_echo(self.call("POST", "/probe", {"value": "chunked"}, chunked=True), "chunked")

    def test_mixed_case_headers(self):
        body = b'{"value":"mixed"}'
        raw = (b"POST /probe HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n"
               b"cOnTeNt-TyPe: application/json\r\nx-ReQuEsT-Id: " + self.fresh_id().encode() +
               b"\r\ncOnTeNt-LeNgTh: " + str(len(body)).encode() + b"\r\n\r\n" + body)
        result = self.raw_http(raw)
        self.assertIn(b" 200 ", result.split(b"\r\n", 1)[0])
        self.assertEqual(json.loads(result.split(b"\r\n\r\n", 1)[1])["echo"], "mixed")

    def test_invalid_json_does_not_acquire_pool(self):
        before = self.stats()
        self.assertEqual(self.call("POST", "/probe", raw_body=b'{"value":')[0], 400)
        after = self.stats()
        self.assertEqual(after["active"], 0)
        self.assertEqual(after["cancellations"], before["cancellations"])

    def test_wrong_value_type(self):
        self.assertEqual(self.call("POST", "/probe", {"value": 7})[0], 400)

    def test_embedded_nul_rejected(self):
        self.assertEqual(self.call("POST", "/probe", {"value": "a\x00b"})[0], 400)

    def test_invalid_utf8_rejected(self):
        self.assertEqual(self.call("POST", "/probe", raw_body=b'{"value":"\xff"}')[0], 400)

    def test_body_limit(self):
        self.assertEqual(self.call("POST", "/probe", {"value": "x" * 2049})[0], 413)

    def test_invalid_sleep_and_timeout(self):
        for values in [{"sleep_ms": -1}, {"sleep_ms": 1501}, {"sleep_ms": True},
                       {"timeout_ms": 0}, {"timeout_ms": 1501}]:
            with self.subTest(values=values):
                self.assertEqual(self.call("POST", "/probe", {"value": "x", **values})[0], 400)

    def test_unknown_route_and_wrong_method(self):
        self.assertEqual(self.call("GET", "/unknown")[0], 404)
        self.assertEqual(self.call("GET", "/probe")[0], 405)

    def test_wrong_media_type(self):
        self.assertEqual(self.call("POST", "/probe", {"value": "x"},
                                   headers={"Content-Type": "text/plain"})[0], 415)

    def test_duplicate_content_length_is_rejected(self):
        result = self.raw_http(b"POST /probe HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n"
                               b"Content-Length: 2\r\nContent-Length: 3\r\n\r\n{}")
        self.assertIn(b" 400 ", result.split(b"\r\n", 1)[0])

    def test_transfer_encoding_and_length_conflict_rejected(self):
        result = self.raw_http(b"POST /probe HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n"
                               b"Transfer-Encoding: chunked\r\nContent-Length: 2\r\n\r\n0\r\n\r\n")
        self.assertIn(b" 400 ", result.split(b"\r\n", 1)[0])

    def test_sequential_requests_reuse_database_sessions(self):
        pids = {self.assert_echo(self.probe(f"reuse-{i}"), f"reuse-{i}") for i in range(8)}
        self.assertLessEqual(len(pids), 2)
        self.assertLessEqual(len(self.activity()), 2)
        self.assertEqual(self.stats()["capacity"], 2)

    def test_two_queries_are_really_concurrent(self):
        started = time.monotonic()
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            first = executor.submit(self.probe, "parallel-a", sleep_ms=900)
            second = executor.submit(self.probe, "parallel-b", sleep_ms=900)
            active = self.wait_for_active(2)
            self.assertEqual(len({row["pid"] for row in active}), 2)
            self.assert_echo(first.result(timeout=3), "parallel-a")
            self.assert_echo(second.result(timeout=3), "parallel-b")
        self.assertLess(time.monotonic() - started, 1.65)

    def test_pool_limit_and_bounded_overload(self):
        observed = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
            tasks = [executor.submit(self.probe, f"load-{i}", sleep_ms=700) for i in range(20)]
            while not all(task.done() for task in tasks):
                observed.append(len(self.activity()))
                time.sleep(0.025)
            responses = [task.result() for task in tasks]
        self.assertTrue(observed)
        self.assertLessEqual(max(observed), 2)
        self.assertTrue(any(status == 200 for status, _ in responses))
        self.assertTrue(any(status == 503 for status, _ in responses))
        self.assertTrue(all(status in {200, 503} for status, _ in responses), responses)
        self.assertLessEqual(self.stats()["max_active"], 2)

    def test_deadline_cancels_real_sql_and_pool_recovers(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(self.probe, "deadline", sleep_ms=1500, timeout_ms=200)
            active = self.wait_for_active(1)
            old_pid = str(active[0]["pid"])
            status, data = future.result(timeout=2)
        self.assertEqual(status, 504, data)
        self.assertEqual(data["error"], "timeout")
        self.wait_for_active(0, timeout=0.5)
        pids = {self.assert_echo(self.probe(f"after-{i}"), f"after-{i}") for i in range(6)}
        self.assertNotIn(old_pid, pids, "Cancelled session was reused")
        self.assertGreaterEqual(self.stats()["cancellations"], 1)
        self.assertGreaterEqual(self.stats()["cancel_acknowledged"], 1,
                                "Cancellation dispatch did not produce PostgreSQL SQLSTATE 57014")

    def test_explicit_cancel_active_query(self):
        request_id = self.fresh_id()
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(self.probe, "cancel-active", sleep_ms=1400,
                                     timeout_ms=1500, request_id=request_id)
            active = self.wait_for_active(1)
            old_pid = str(active[0]["pid"])
            self.assertEqual(self.call("POST", "/cancel", {"id": request_id}),
                             (200, {"cancelled": True}))
            status, data = future.result(timeout=2)
        self.assertEqual(status, 409, data)
        self.assertEqual(data["error"], "cancelled")
        self.wait_for_active(0, timeout=0.5)
        self.assertGreaterEqual(self.stats()["cancel_acknowledged"], 1,
                                "Cancellation dispatch did not produce PostgreSQL SQLSTATE 57014")
        for i in range(6):
            self.assertNotEqual(self.assert_echo(self.probe(f"clean-{i}"), f"clean-{i}"), old_pid)

    def test_cancelled_waiter_never_starts_query(self):
        queued_id = self.fresh_id()
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
            first = executor.submit(self.probe, "occupy-a", sleep_ms=900)
            second = executor.submit(self.probe, "occupy-b", sleep_ms=900)
            before = {row["pid"] for row in self.wait_for_active(2)}
            queued = executor.submit(self.probe, "must-not-run", sleep_ms=500, request_id=queued_id)
            time.sleep(0.04)
            self.assertEqual(self.call("POST", "/cancel", {"id": queued_id}),
                             (200, {"cancelled": True}))
            status, data = queued.result(timeout=1)
            self.assertEqual(status, 409, data)
            self.assertEqual(data["error"], "cancelled")
            self.assertEqual({row["pid"] for row in self.wait_for_active(2)}, before)
            self.assert_echo(first.result(timeout=2), "occupy-a")
            self.assert_echo(second.result(timeout=2), "occupy-b")
        self.assert_echo(self.probe("later"), "later")
        self.wait_for_active(0)

    def test_stale_cancellation_does_not_hit_another_borrower(self):
        completed = self.fresh_id()
        self.assert_echo(self.probe("complete", request_id=completed), "complete")
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(self.probe, "new-borrower", sleep_ms=500)
            self.wait_for_active(1)
            self.assertEqual(self.call("POST", "/cancel", {"id": completed}),
                             (404, {"cancelled": False}))
            self.assert_echo(future.result(timeout=2), "new-borrower")

    def test_unknown_cancel(self):
        self.assertEqual(self.call("POST", "/cancel", {"id": str(uuid.uuid4())}),
                         (404, {"cancelled": False}))

    def test_completed_request_id_cannot_be_reused(self):
        completed = self.fresh_id()
        self.assert_echo(self.probe("completed-id", request_id=completed), "completed-id")
        status, data = self.probe("reused-id", request_id=completed)
        self.assertEqual(status, 409, data)
        self.assertEqual(data["error"], "conflict")
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            fresh = executor.submit(self.probe, "fresh-id", sleep_ms=400,
                                    request_id=self.fresh_id())
            self.wait_for_active(1)
            self.assertEqual(self.call("POST", "/cancel", {"id": completed}),
                             (404, {"cancelled": False}))
            self.assert_echo(fresh.result(timeout=2), "fresh-id")

    def test_duplicate_active_id_rejected(self):
        request_id = self.fresh_id()
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(self.probe, "first", sleep_ms=700, request_id=request_id)
            self.wait_for_active(1)
            status, data = self.probe("duplicate", request_id=request_id)
            self.assertEqual(status, 409, data)
            self.assert_echo(future.result(timeout=2), "first")

    def test_write_half_close_still_receives_response(self):
        body = b'{"value":"half-close","sleep_ms":300}'
        wire = (b"POST /probe HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\n"
                b"X-Request-ID: " + self.fresh_id().encode() + b"\r\nConnection: close\r\n"
                b"Content-Length: " + str(len(body)).encode() + b"\r\n\r\n" + body)
        with socket.create_connection(("127.0.0.1", self.port), timeout=3) as client:
            client.settimeout(3)
            client.sendall(wire)
            client.shutdown(socket.SHUT_WR)
            result = b""
            while True:
                chunk = client.recv(8192)
                if not chunk:
                    break
                result += chunk
        self.assertIn(b" 200 ", result.split(b"\r\n", 1)[0])
        self.assertEqual(json.loads(result.split(b"\r\n\r\n", 1)[1])["echo"], "half-close")


if __name__ == "__main__":
    unittest.main(verbosity=2)
