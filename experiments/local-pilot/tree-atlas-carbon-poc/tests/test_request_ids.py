"""Public HTTP conformance for bounded, server-issued single-use attempts."""
import concurrent.futures
import http.client
import json
import time
import unittest
import uuid

import test_service


class RequestIdProof(unittest.TestCase):
    # Share only HTTP/process fixtures, not another TestCase's test methods.
    setUp = test_service.ServiceProof.setUp
    stop_service = test_service.ServiceProof.stop_service
    call = test_service.ServiceProof.call
    probe = test_service.ServiceProof.probe
    stats = test_service.ServiceProof.stats
    activity = test_service.ServiceProof.activity
    assert_echo = test_service.ServiceProof.assert_echo
    fresh_id = test_service.ServiceProof.fresh_id

    def issue(self, connection=None):
        status, body = self.call("POST", "/attempt", connection=connection)
        self.assertEqual(status, 200, body)
        self.assertRegex(body["id"], r"^[0-9a-f]{32}-[0-9a-f]{16}$")
        return body["id"]

    def test_unissued_and_consumed_ids_are_rejected(self):
        self.assertEqual(self.probe("unissued", request_id=str(uuid.uuid4()))[0], 409)
        issued = self.issue()
        self.assert_echo(self.probe("issued", request_id=issued), "issued")
        self.assertEqual(self.probe("replay", request_id=issued),
                         (409, {"error": "conflict"}))
        self.assertEqual(self.call("POST", "/cancel", {"id": issued}),
                         (404, {"cancelled": False}))

    def test_pre_submit_cancel_prevents_delayed_work(self):
        issued = self.issue()
        self.assertEqual(self.call("POST", "/cancel", {"id": issued}),
                         (200, {"cancelled": True}))
        self.assertEqual(self.probe("after-early-cancel", request_id=issued),
                         (409, {"error": "conflict"}))
        self.assertEqual(self.call("POST", "/cancel", {"id": issued}),
                         (404, {"cancelled": False}))

    def test_bounded_reservations_recover_after_more_than_4096_issues(self):
        def reserve_batch(_):
            connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=4)
            try:
                return [self.issue(connection) for _ in range(512)]
            finally:
                connection.close()

        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as workers:
            issued = [token for batch in workers.map(reserve_batch, range(8)) for token in batch]
        self.assertEqual(len(set(issued)), 4096)
        self.assertEqual(self.call("POST", "/attempt")[0], 503)
        completed = issued[0]
        self.assert_echo(self.probe("free-one-slot", request_id=completed), "free-one-slot")
        new_token = self.issue()
        self.assertNotIn(new_token, issued)
        self.assertEqual(int(new_token.rsplit("-", 1)[1], 16), 4097)
        self.assertEqual(self.probe("old-replay", request_id=completed)[0], 409)
        self.assert_echo(self.probe("after-capacity", request_id=new_token), "after-capacity")
        self.assertEqual(self.call("GET", "/health"), (200, {"ok": True}))

    def test_unused_reservation_expires_without_permitting_reuse(self):
        issued = self.issue()
        time.sleep(30.1)
        self.assertEqual(self.probe("expired", request_id=issued),
                         (409, {"error": "conflict"}))
        self.assertEqual(self.call("POST", "/cancel", {"id": issued}),
                         (404, {"cancelled": False}))
        fresh = self.issue()
        self.assertNotEqual(issued, fresh)
        self.assert_echo(self.probe("after-expiry", request_id=fresh), "after-expiry")

    def test_more_than_4096_completed_queries_do_not_exhaust_lifetime(self):
        started = time.monotonic()
        observed = 0
        first = None
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=4)
        self.addCleanup(connection.close)
        for number in range(4097):
            issued = self.issue(connection)
            if first is None:
                first = issued
            expected = f"lifetime-{number}"
            result = self.call("POST", "/probe", {"value": expected},
                               request_id=issued, connection=connection)
            self.assert_echo(result, expected)
            observed += 1
            if observed % 512 == 0:
                self.assertEqual(self.stats()["attempts_tracked"], 0)
        self.assertEqual(observed, 4097)
        self.assertEqual(self.stats()["attempts_tracked"], 0)
        self.assertEqual(self.probe("old-after-4097", request_id=first)[0], 409)
        self.assertEqual(self.call("POST", "/cancel", {"id": first}),
                         (404, {"cancelled": False}))
        (test_service.ROOT / "evidence/request-id-lifetime.json").write_text(json.dumps({
            "completed_public_http_queries": observed,
            "elapsed_ms": round((time.monotonic() - started) * 1000, 2),
            "tracked_after_completion": self.stats()["attempts_tracked"],
            "oldest_id_replay_status": 409,
            "oldest_id_cancel_status": 404,
            "scope": "actual HTTP responses and real PostgreSQL synthetic fixture; no imported inventories",
        }, indent=2))


if __name__ == "__main__":
    unittest.main()
