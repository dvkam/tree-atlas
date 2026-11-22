"""Local TLS cancellation-EOF fault regression against real PostgreSQL.

libpq verifies an ephemeral local certificate and encrypts ordinary SQL and
cancellation connections to a test proxy. The proxy decrypts only in memory,
forwards PostgreSQL messages to the unchanged localhost server, and withholds
only the TLS cancellation-channel EOF after PostgreSQL accepted cancellation.
No certificate, private key, packet or connection string is retained in evidence.
This does not test TLS between proxy and PostgreSQL or general network faults.
"""
import concurrent.futures
import http.client
import importlib.util
import json
import os
from pathlib import Path
import select
import socket
import ssl
import struct
import subprocess
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "plaintext_cancel_fault", ROOT / "experiments/cancel_transport/probe.py")
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
SSL_REQUEST = 80877103


class TLSProxy(base.Proxy):
    def __init__(self, host, port, certificate, key):
        self.tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        self.tls.minimum_version = ssl.TLSVersion.TLSv1_2
        self.tls.load_cert_chain(certificate, key)
        self.tls_connections = []
        self.cancel_tls_connections = 0
        self.sql_tls_connections = 0
        super().__init__(host, port)

    def handle(self, client):
        server = None
        try:
            client.settimeout(2)
            with self.lock:
                self.sockets.add(client)
            if base.exact(client, 8) != struct.pack("!II", 8, SSL_REQUEST):
                raise RuntimeError("TLS was not requested")
            client.sendall(b"S")
            raw = client
            client = self.tls.wrap_socket(client, server_side=True)
            with self.lock:
                self.sockets.discard(raw)
                self.sockets.add(client)
                self.tls_connections.append({
                    "version": client.version(), "cipher": client.cipher()[0],
                })
            first = base.exact(client, 8)
            length, code = struct.unpack("!II", first)
            server = socket.create_connection(self.upstream, timeout=2)
            with self.lock:
                self.sockets.add(server)
            if length == 16 and code == base.CANCEL_CODE:
                with self.lock:
                    self.cancel_tls_connections += 1
                server.sendall(first + base.exact(client, 8))
                if server.recv(1) != b"":
                    raise RuntimeError("Unexpected cancel-channel data")
                held_at = time.monotonic()
                self.events["upstream_cancel_eof_observed"] = True
                self.cancel_received.set()
                self.release_cancel_eof.wait(3)
                self.events["held_eof_ms"] = round((time.monotonic() - held_at) * 1000, 2)
                self.cancel_released.set()
                return
            with self.lock:
                self.sql_tls_connections += 1
            server.sendall(first)
            server.settimeout(0.5)
            client.settimeout(0.5)
            while not self.stopping.is_set():
                readable, _, _ = select.select([client, server], [], [], 0.05)
                if client.pending() and client not in readable:
                    readable.append(client)
                for source in readable:
                    data = source.recv(65536)
                    if not data:
                        return
                    (server if source is client else client).sendall(data)
        except (OSError, RuntimeError):
            if not self.stopping.is_set():
                self.events["transport_error"] = True
        finally:
            for sock in (client, server):
                if sock is not None:
                    with self.lock:
                        self.sockets.discard(sock)
                    sock.close()


def stats(port):
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
    try:
        connection.request("GET", "/stats")
        response = connection.getresponse()
        if response.status != 200:
            raise RuntimeError("Service statistics were unavailable")
        return json.loads(response.read())
    finally:
        connection.close()


def certificate(directory, name="server"):
    cert = Path(directory) / f"{name}-certificate.pem"
    key = Path(directory) / f"{name}-private-key.pem"
    subprocess.run([
        "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
        "-subj", "/CN=tree-atlas-local-fault-test", "-addext", "subjectAltName=IP:127.0.0.1",
        "-addext", "basicConstraints=critical,CA:TRUE", "-keyout", str(key), "-out", str(cert),
    ], capture_output=True, check=True, timeout=15)
    key.chmod(0o600)
    return cert, key


def main():
    if base.remaining_pool_sessions() != 0:
        raise RuntimeError("Fault test requires no other local pool service")
    report = {
        "scope": "localhost TLS-verified libpq cancellation-EOF regression",
        "configured_request_deadline_ms": 200,
        "http_completion_limit_ms": 900,
        "sslmode": "verify-full",
        "mechanism": "Hold TLS cancel-channel EOF after forwarding genuine CancelRequest to real PostgreSQL",
        "upstream_proxy_leg": "plaintext localhost, unchanged server configuration",
    }
    with tempfile.TemporaryDirectory(prefix="tree-atlas-cancel-tls-") as directory:
        cert, key = certificate(directory)
        private = json.loads(base.CONFIG.read_text())
        proxy = TLSProxy(private["host"], int(private["port"]), cert, key)
        private["host"] = "127.0.0.1"
        private["port"] = proxy.port
        environment = dict(os.environ)
        environment["TREE_ATLAS_PG"] = " ".join(f"{name}={value}" for name, value in private.items()) + (
            f" connect_timeout=2 sslmode=verify-full sslrootcert={cert} gssencmode=disable")
        process = None
        try:
            wrong_cert, _ = certificate(directory, "untrusted")
            rejected_environment = dict(environment)
            rejected_environment["TREE_ATLAS_PG"] = environment["TREE_ATLAS_PG"].replace(
                f"sslrootcert={cert}", f"sslrootcert={wrong_cert}")
            rejected = subprocess.Popen([str(ROOT / "build/service")], env=rejected_environment,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            try:
                output, _ = rejected.communicate(timeout=4)
            except subprocess.TimeoutExpired:
                rejected.kill()
                rejected.communicate(timeout=2)
                raise RuntimeError("Untrusted certificate rejection did not terminate")
            report["untrusted_certificate_rejected"] = rejected.returncode == 2 and b"PORT " not in output
            if not report["untrusted_certificate_rejected"]:
                raise RuntimeError("libpq did not reject the untrusted local certificate")
            process = subprocess.Popen([str(ROOT / "build/service")], env=environment,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if not select.select([process.stdout], [], [], 8)[0]:
                raise RuntimeError("No service listening-port notification")
            line = process.stdout.readline().decode().strip()
            if not line.startswith("PORT "):
                raise RuntimeError("Service did not start with verified TLS")
            port = int(line.split()[1])
            baseline = base.call(port, {"value": "tls-baseline"})
            if baseline[0] != 200 or baseline[1].get("echo") != "tls-baseline":
                raise RuntimeError("TLS baseline failed")
            before = stats(port)
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(base.call, port, {
                    "value": "tls-fault", "sleep_ms": 1500, "timeout_ms": 200,
                })
                if not proxy.cancel_received.wait(3):
                    raise RuntimeError("No encrypted genuine cancellation EOF observed")
                time.sleep(1)
                report["http_pending_while_tls_eof_held"] = not future.done()
                if future.done():
                    status, body, elapsed = future.result()
                    report.update(observed_http_status=status, observed_http_error=body.get("error"),
                                  observed_http_elapsed_ms=round(elapsed, 2))
                    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as recovery:
                        recovered = list(recovery.map(lambda number: base.call(port, {
                            "value": f"tls-recovery-{number}", "sleep_ms": 100,
                        }), range(2)))
                    report["recovery_while_tls_eof_held"] = [
                        {"status": item[0], "echo": item[1].get("echo"), "pid": item[1].get("pid")}
                        for item in recovered]
                    report["cancel_acknowledgements_added"] = stats(port)["cancel_acknowledged"] - before["cancel_acknowledged"]
                    report["fault_still_held_after_recovery"] = not proxy.cancel_released.is_set()
                proxy.release_cancel_eof.set()
                status, body, elapsed = future.result(timeout=3)
                if not proxy.cancel_released.wait(1):
                    raise RuntimeError("TLS proxy did not release controlled fault")
                report.update(observed_http_status=status, observed_http_error=body.get("error"),
                              observed_http_elapsed_ms=round(elapsed, 2))
            recovered = report.get("recovery_while_tls_eof_held", [])
            report.update(tls_connections=proxy.tls_connections,
                          encrypted_sql_connections=proxy.sql_tls_connections,
                          encrypted_cancel_connections=proxy.cancel_tls_connections,
                          held_tls_eof_ms=proxy.events.get("held_eof_ms"),
                          upstream_cancel_eof_observed=proxy.events.get("upstream_cancel_eof_observed", False))
            report["passed"] = (
                not report["http_pending_while_tls_eof_held"] and elapsed < 900 and
                status == 504 and body.get("error") == "timeout" and
                report["untrusted_certificate_rejected"] and
                proxy.sql_tls_connections >= 3 and proxy.cancel_tls_connections == 1 and
                report["upstream_cancel_eof_observed"] and
                report.get("fault_still_held_after_recovery", False) and
                report.get("cancel_acknowledgements_added") == 1 and
                len(recovered) == 2 and len({item["pid"] for item in recovered}) == 2 and
                all(item["status"] == 200 and item["echo"] == f"tls-recovery-{index}"
                    for index, item in enumerate(recovered)))
        except Exception as error:
            # Exception classes and fixed test messages only; no libpq diagnostics.
            report["failure_type"] = type(error).__name__
            report["passed"] = False
        finally:
            proxy.release_cancel_eof.set()
            if process is not None:
                if process.poll() is None:
                    process.terminate()
                try:
                    process.communicate(timeout=4)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.communicate(timeout=2)
                    report["forced_owned_process_cleanup"] = True
                report["owned_service_exit_code"] = process.returncode
            proxy.close()
            report["proxy_worker_threads_remaining"] = sum(worker.is_alive() for worker in proxy.workers)
            report["proxy_listener_thread_remaining"] = proxy.thread.is_alive()
            report["proxy_sockets_remaining"] = len(proxy.sockets)
            until = time.monotonic() + 3
            remaining = base.remaining_pool_sessions()
            while remaining and time.monotonic() < until:
                time.sleep(0.05)
                remaining = base.remaining_pool_sessions()
            report["postgres_pool_sessions_remaining"] = remaining
            report["cleanup_passed"] = (
                report.get("owned_service_exit_code") == 0 and
                not report.get("forced_owned_process_cleanup", False) and
                report["proxy_worker_threads_remaining"] == 0 and
                not report["proxy_listener_thread_remaining"] and
                report["proxy_sockets_remaining"] == 0 and remaining == 0)
    report["temporary_tls_material_removed"] = not Path(directory).exists()
    (ROOT / "evidence/cancel-transport-tls.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    return 0 if report.get("passed", False) and report["cleanup_passed"] and report["temporary_tls_material_removed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
