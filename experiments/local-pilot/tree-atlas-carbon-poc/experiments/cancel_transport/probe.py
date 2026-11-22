"""Local regression for a stalled PostgreSQL cancellation transport.

Normal PostgreSQL TCP streams, including TLS negotiation, pass unchanged. Only
the EOF on a genuine PostgreSQL CancelRequest connection is delayed. The fault
scenario explicitly disables SSL/GSS locally to identify that control packet;
it does not test encrypted cancel-channel faults. No packets,
connection strings or credentials are logged. No database state is changed.
"""
import concurrent.futures
import argparse
import http.client
import json
import os
import select
import socket
import struct
import subprocess
import threading
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONFIG = Path("/home/david/.config/tree-atlas-carbon-poc/postgres.json")
CANCEL_CODE = 80877102


def exact(sock, count):
    result = b""
    while len(result) < count:
        chunk = sock.recv(count - len(result))
        if not chunk:
            raise RuntimeError("Unexpected stream closure")
        result += chunk
    return result


class Proxy:
    def __init__(self, host, port):
        self.upstream = (host, port)
        self.listener = socket.socket()
        self.listener.bind(("127.0.0.1", 0))
        self.listener.listen(8)
        self.listener.settimeout(0.1)
        self.port = self.listener.getsockname()[1]
        self.stopping = threading.Event()
        self.cancel_received = threading.Event()
        self.cancel_released = threading.Event()
        self.release_cancel_eof = threading.Event()
        self.lock = threading.Lock()
        self.sockets = set()
        self.workers = []
        self.events = {}
        self.thread = threading.Thread(target=self.accept, daemon=True)
        self.thread.start()

    def accept(self):
        while not self.stopping.is_set():
            try:
                client, _ = self.listener.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            worker = threading.Thread(target=self.handle, args=(client,), daemon=True)
            self.workers.append(worker)
            worker.start()

    def handle(self, client):
        server = None
        try:
            client.settimeout(2)
            with self.lock:
                self.sockets.add(client)
            first = exact(client, 8)
            length, code = struct.unpack("!II", first)
            server = socket.create_connection(self.upstream, timeout=2)
            with self.lock:
                self.sockets.add(server)
            if length == 16 and code == CANCEL_CODE:
                request = first + exact(client, 8)
                server.sendall(request)
                # PostgreSQL signals completion of a cancel transport by EOF.
                if server.recv(1) != b"":
                    raise RuntimeError("Unexpected cancel-channel data")
                held_at = time.monotonic()
                self.events["upstream_cancel_eof_observed"] = True
                self.events["cancel_seen_at"] = held_at
                self.cancel_received.set()
                self.release_cancel_eof.wait(3)
                self.events["held_eof_ms"] = round((time.monotonic() - held_at) * 1000, 2)
                self.cancel_released.set()
                return
            server.sendall(first)
            client.settimeout(0.5)
            server.settimeout(0.5)
            while not self.stopping.is_set():
                readable, _, _ = select.select([client, server], [], [], 0.1)
                for source in readable:
                    data = source.recv(65536)
                    if not data:
                        return
                    (server if source is client else client).sendall(data)
        except (OSError, RuntimeError):
            # No socket data or credentials appear in failure diagnostics.
            if not self.stopping.is_set():
                self.events["transport_error"] = True
        finally:
            for sock in (client, server):
                if sock is not None:
                    with self.lock:
                        self.sockets.discard(sock)
                    sock.close()

    def close(self):
        self.release_cancel_eof.set()
        self.stopping.set()
        self.listener.close()
        with self.lock:
            sockets = list(self.sockets)
        for sock in sockets:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            sock.close()
        self.thread.join(timeout=1)
        for worker in self.workers:
            worker.join(timeout=1)


def call(port, payload):
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    try:
        connection.request("POST", "/attempt")
        issued = connection.getresponse()
        token = json.loads(issued.read())
        if issued.status != 200 or "id" not in token:
            raise RuntimeError("Could not reserve a request attempt")
        started = time.monotonic()
        connection.request("POST", "/probe", json.dumps(payload), {
            "Content-Type": "application/json", "X-Request-ID": token["id"],
        })
        response = connection.getresponse()
        body = json.loads(response.read())
        return response.status, body, (time.monotonic() - started) * 1000
    finally:
        connection.close()


def remaining_pool_sessions():
    private = json.loads(CONFIG.read_text())
    environment = dict(os.environ)
    environment.update(PGHOST=private["host"], PGPORT=str(private["port"]),
                       PGDATABASE=private["dbname"], PGUSER=private["user"],
                       PGPASSWORD=private["password"])
    result = subprocess.run(["psql", "-X", "-At", "-v", "ON_ERROR_STOP=1"],
        input="SELECT count(*) FROM pg_stat_activity WHERE application_name='tree_atlas_carbon_pool';",
        text=True, capture_output=True, env=environment, timeout=3)
    if result.returncode:
        raise RuntimeError("Could not verify pool session cleanup")
    return int(result.stdout.strip())


def main():
    arguments = argparse.ArgumentParser(description=__doc__)
    arguments.add_argument("--output", type=Path, default=ROOT / "evidence/cancel-transport-nonblocking.json")
    output = arguments.parse_args().output
    if remaining_pool_sessions() != 0:
        raise RuntimeError("Another pool service is running; fault test requires exclusive local service ownership")
    private = json.loads(CONFIG.read_text())
    proxy = Proxy(private["host"], int(private["port"]))
    private["port"] = proxy.port
    environment = dict(os.environ)
    environment["TREE_ATLAS_PG"] = " ".join(f"{key}={value}" for key, value in private.items()) + " connect_timeout=2 sslmode=disable gssencmode=disable"
    try:
        process = subprocess.Popen([str(ROOT / "build/service")], env=environment,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except OSError:
        proxy.close()
        raise
    report = {
        "scope": "bounded cancellation regression, localhost plaintext only",
        "configured_request_deadline_ms": 200,
        "query_sleep_ms": 1500,
        "source": "https://www.postgresql.org/docs/17/libpq-cancel.html",
        "http_completion_limit_ms": 900,
        "mechanism": "Forward genuine CancelRequest; delay only its EOF, leaving normal SQL streams unchanged",
    }
    try:
        if not select.select([process.stdout], [], [], 8)[0]:
            raise RuntimeError("Service did not announce its port")
        line = process.stdout.readline().decode().strip()
        if not line.startswith("PORT "):
            raise RuntimeError("Service did not start through transparent proxy")
        http_port = int(line.split()[1])
        baseline = call(http_port, {"value": "proxy-baseline"})
        if baseline[0] != 200 or baseline[1].get("echo") != "proxy-baseline":
            raise RuntimeError("Normal PostgreSQL traffic did not pass")
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            started = time.monotonic()
            future = executor.submit(call, http_port, {
                "value": "cancel-transport-diagnostic", "sleep_ms": 1500, "timeout_ms": 200,
            })
            if not proxy.cancel_received.wait(3):
                raise RuntimeError("No genuine PostgreSQL cancel-channel EOF observed")
            time.sleep(1)
            report["elapsed_before_release_ms"] = round((time.monotonic() - started) * 1000, 2)
            report["http_pending_while_cancel_eof_held"] = not future.done()
            # Check while the fault still holds. A quick response released by
            # the test itself would conceal the original synchronous blocker.
            if future.done():
                status, body, elapsed = future.result()
                report["observed_http_status"] = status
                report["observed_http_error"] = body.get("error")
                report["observed_http_elapsed_ms"] = round(elapsed, 2)
                with concurrent.futures.ThreadPoolExecutor(max_workers=2) as recovery:
                    recovered = list(recovery.map(lambda number: call(http_port, {
                        "value": f"recovery-{number}", "sleep_ms": 100,
                    }), range(2)))
                report["recovery_while_eof_held"] = [
                    {"status": item[0], "echo": item[1].get("echo"), "pid": item[1].get("pid")}
                    for item in recovered
                ]
            proxy.release_cancel_eof.set()
            status, body, elapsed = future.result(timeout=3)
            if not proxy.cancel_released.wait(1):
                raise RuntimeError("Proxy did not finish the controlled EOF hold")
            report["observed_http_status"] = status
            report["observed_http_error"] = body.get("error")
            report["observed_http_elapsed_ms"] = round(elapsed, 2)
        report["upstream_cancel_eof_observed"] = proxy.events.get("upstream_cancel_eof_observed", False)
        report["held_cancel_eof_ms"] = proxy.events.get("held_eof_ms")
        recovered = report.get("recovery_while_eof_held", [])
        report["bounded_cancellation_passed"] = (
            not report["http_pending_while_cancel_eof_held"] and
            report["observed_http_elapsed_ms"] < 900 and status == 504 and body.get("error") == "timeout" and
            report["upstream_cancel_eof_observed"] and
            len(recovered) == 2 and all(item["status"] == 200 and item["echo"] == f"recovery-{index}"
                                       for index, item in enumerate(recovered)) and
            len({item["pid"] for item in recovered}) == 2
        )
        report["conclusion"] = (
            "HTTP deadline response and both pool slots recovered before the stalled cancellation channel was released"
            if report["bounded_cancellation_passed"] else "Cancellation remained blocked or pool recovery failed"
        )
    except Exception as error:
        report["failure"] = type(error).__name__ + ": " + str(error)
        report["bounded_cancellation_passed"] = False
    finally:
        proxy.release_cancel_eof.set()
        if process.poll() is None:
            process.terminate()
        try:
            process.communicate(timeout=4)
        except subprocess.TimeoutExpired:
            process.kill()
            process.communicate(timeout=2)
            report["forced_owned_process_cleanup"] = True
        proxy.close()
        report["owned_service_exit_code"] = process.returncode
        report["proxy_worker_threads_remaining"] = sum(worker.is_alive() for worker in proxy.workers)
        report["proxy_sockets_remaining"] = len(proxy.sockets)
        until = time.monotonic() + 3
        remaining = remaining_pool_sessions()
        while remaining and time.monotonic() < until:
            time.sleep(0.05)
            remaining = remaining_pool_sessions()
        report["postgres_pool_sessions_remaining"] = remaining
        report["cleanup_passed"] = (
            process.returncode == 0 and not report.get("forced_owned_process_cleanup", False) and
            report["proxy_worker_threads_remaining"] == 0 and report["proxy_sockets_remaining"] == 0 and
            remaining == 0
        )
        output.write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    return 0 if report.get("bounded_cancellation_passed", False) and report["cleanup_passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
