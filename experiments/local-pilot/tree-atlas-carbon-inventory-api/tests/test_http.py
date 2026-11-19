"""Black-box Carbon inventory HTTP regressions against validated local releases.

No native adapter implementation is imported. Run after build/service exists.
The optional lock/cancel fault requires WSL root peer administration.
"""
import concurrent.futures
import contextlib
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

ROOT = Path(__file__).resolve().parents[1]
FROZEN = ROOT.parent / 'tree-atlas-contract-v1'
CONFIG = Path('/home/david/.config/tree-atlas-postgres-pilot/reader.json')
LOCK = json.loads((FROZEN / 'baseline.lock.json').read_text())
REFERENCE = json.loads((FROZEN / 'reference/reference-results.json').read_text())
DATASETS = {row['id']: row for row in LOCK['datasets']}


def environment():
    config = json.loads(CONFIG.read_text())
    assert config['host'] == '127.0.0.1' and config['dbname'] == 'tree_atlas_pilot'
    assert config['user'] == 'tree_atlas_reader' and int(config['port']) == 5432
    env = {key: value for key, value in os.environ.items() if not key.startswith('PG')}
    env['TREE_ATLAS_PG'] = ' '.join(f'{key}={value}' for key, value in config.items()) + \
        " connect_timeout=3 options='-c default_transaction_read_only=on -c statement_timeout=3500 -c lock_timeout=3500'"
    env.update(PGHOST=config['host'], PGPORT=str(config['port']), PGDATABASE=config['dbname'],
               PGUSER=config['user'], PGPASSWORD=config['password'],
               PGAPPNAME='tree_atlas_http_test_observer')
    return env


class HttpInventoryProof(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.env = environment()
        cls.process = subprocess.Popen([str(ROOT / 'build/service')], env=cls.env,
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            if not select.select([cls.process.stdout], [], [], 10)[0]:
                raise RuntimeError('No service port notification')
            line = cls.process.stdout.readline().decode().strip()
            if not line.startswith('PORT '):
                raise RuntimeError('Local inventory service did not start')
            cls.port = int(line.split()[1])
        except Exception:
            cls.process.terminate()
            cls.process.communicate(timeout=5)
            raise

    @classmethod
    def tearDownClass(cls):
        if cls.process.poll() is None:
            cls.process.terminate()
        try:
            cls.process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            cls.process.kill()
            cls.process.communicate(timeout=2)
            raise AssertionError('Owned inventory service required forced cleanup')
        assert cls.process.returncode == 0
        until = time.monotonic() + 3
        while True:
            result = subprocess.run(['psql', '-X', '-At', '-v', 'ON_ERROR_STOP=1'], env=cls.env,
                input="SELECT count(*) FROM pg_stat_activity WHERE application_name='tree_atlas_inventory_api';",
                text=True, capture_output=True, timeout=5)
            assert result.returncode == 0, 'Could not inspect pool cleanup'
            if result.stdout.strip() == '0':
                break
            assert time.monotonic() < until, 'Pool sessions survived HTTP tests'
            time.sleep(0.025)

    def raw(self, method, path, payload=None, *, token=None, raw_body=None, headers=None):
        client = http.client.HTTPConnection('127.0.0.1', self.port, timeout=6)
        values = {'Content-Type': 'application/json'}
        if token is not None:
            values['X-Request-ID'] = token
        if headers:
            values.update(headers)
        body = raw_body if raw_body is not None else None if payload is None else json.dumps(payload).encode()
        try:
            client.request(method, path, body, values)
            response = client.getresponse()
            data = response.read()
            self.assertIn('application/json', response.getheader('Content-Type', ''))
            return response.status, json.loads(data)
        finally:
            client.close()

    def issue(self):
        status, body = self.raw('POST', '/attempt')
        self.assertEqual(status, 200, body)
        return body['id']

    def call(self, path, payload, *, token=None):
        return self.raw('POST', path, payload, token=token or self.issue())

    def query(self, city='vienna', **changes):
        dataset = DATASETS[city]
        return {'contractVersion': '1.0.0', 'dataset': city, 'release': dataset['release'],
                'q': '', 'area': None, 'viewport': dataset['bounds'], 'zoom': 12,
                'offset': 0, 'limit': 25, 'requestKey': 'http-proof', **changes}

    def stats(self):
        status, body = self.raw('GET', '/stats')
        self.assertEqual(status, 200, body)
        return body

    def observe(self, sql):
        result = subprocess.run(['psql', '-X', '-At', '-v', 'ON_ERROR_STOP=1'],
                                env=self.env, input=sql, text=True, capture_output=True, timeout=4)
        self.assertEqual(result.returncode, 0, 'Could not inspect local test state')
        return result.stdout.strip()

    def activity(self):
        return json.loads(self.observe("""SELECT COALESCE(json_agg(json_build_object(
            'pid',pid,'state',state,'wait',wait_event_type)), '[]'::json)
            FROM pg_stat_activity WHERE application_name='tree_atlas_inventory_api';"""))

    def wait_for_blocked_query(self):
        until = time.monotonic() + 1
        while time.monotonic() < until:
            blocked = [row for row in self.activity() if row['state'] == 'active' and row['wait'] == 'Lock']
            if blocked:
                return blocked[0]['pid']
            time.sleep(0.015)
        self.fail('No actual inventory SQL query was observed waiting on the owned table lock')

    @contextlib.contextmanager
    def records_lock(self):
        if os.geteuid() != 0 or os.environ.get('TREE_ATLAS_HTTP_FAULTS') != '1':
            self.skipTest('Set TREE_ATLAS_HTTP_FAULTS=1 and run as WSL root for owned local lock faults')
        env = {key: value for key, value in os.environ.items() if not key.startswith('PG')}
        args = ['runuser', '-u', 'postgres', '--', 'psql', '-h', '/var/run/postgresql',
                '-p', '5432', '-U', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', 'tree_atlas_pilot']
        process = subprocess.Popen(args, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True)
        released = False
        pid = None

        def release():
            nonlocal released
            if released:
                return
            released = True
            try:
                process.stdin.write('ROLLBACK;\n\\q\n')
                process.stdin.flush()
                process.communicate(timeout=3)
            except (BrokenPipeError, subprocess.TimeoutExpired):
                if pid is not None:
                    subprocess.run(args, env=env, input=f'SELECT pg_terminate_backend({pid});',
                                   text=True, capture_output=True, timeout=3)
                process.kill()
                process.communicate(timeout=2)
                self.fail('Owned administrative lock required forced cleanup')
            self.assertEqual(process.returncode, 0, 'Owned lock session did not exit cleanly')

        try:
            process.stdin.write('BEGIN;\nSELECT pg_backend_pid();\n')
            process.stdin.flush()
            self.assertTrue(select.select([process.stdout], [], [], 3)[0], 'No owned lock backend ID')
            pid = int(process.stdout.readline().strip())
            process.stdin.write('LOCK TABLE atlas.records IN ACCESS EXCLUSIVE MODE;\n')
            process.stdin.flush()
            until = time.monotonic() + 2
            while time.monotonic() < until:
                if self.observe(f"SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid={pid} AND relation='atlas.records'::regclass AND mode='AccessExclusiveLock' AND granted);") == 't':
                    break
                time.sleep(0.02)
            else:
                self.fail('Owned exclusive lock was not acquired')
            yield release
        finally:
            release()

    def assert_cancelled_and_retired(self, old_pid, before):
        until = time.monotonic() + 0.8
        while time.monotonic() < until:
            current = self.stats()
            if current['cancel_acknowledged'] > before and old_pid not in {row['pid'] for row in self.activity()}:
                return
            time.sleep(0.02)
        self.fail('Actual cancelled SQL was not acknowledged and its session retired')

    def test_health(self):
        self.assertEqual(self.raw('GET', '/health'), (200, {'ok': True}))

    def test_catalogue_exposes_only_the_four_validated_pins(self):
        status, body = self.call('/v1/catalogue', {'contractVersion': '1.0.0', 'requestKey': 'catalogue-proof'})
        self.assertEqual(status, 200, body)
        self.assertEqual(body['requestKey'], 'catalogue-proof')
        self.assertEqual({entry['dataset']: entry['release'] for entry in body['datasets']},
                         {key: value['release'] for key, value in DATASETS.items()})
        self.assertEqual(sum(entry['count'] for entry in body['datasets']), 1657347)

    def test_release_metadata_binds_content_and_source_attribution(self):
        expected = next(row for row in REFERENCE['datasets'] if row['dataset'] == 'porto')
        status, body = self.call('/v1/release', {'contractVersion': '1.0.0', 'dataset': 'porto',
            'release': expected['release'], 'requestKey': 'release-proof'})
        self.assertEqual(status, 200, body)
        # The concrete local wire exposes release metadata directly.
        self.assertEqual(body['contentSha256'], expected['contentSha256'])
        self.assertEqual(body['identitySha256'], expected['identitySha256'])
        self.assertEqual(body['source']['attribution'], DATASETS['porto']['attribution'])
        self.assertEqual(body['source']['license'], DATASETS['porto']['license'])

    def test_initial_page_is_pinned_and_complete(self):
        expected = next(row for row in REFERENCE['datasets'] if row['dataset'] == 'vienna')
        all_case = next(row for row in expected['queries'] if row['q'] == '' and row['area'] is None)
        status, result = self.call('/v1/query', self.query())
        self.assertEqual(status, 200, result)
        self.assertEqual(result['contractVersion'], '1.0.0')
        self.assertEqual(result['dataset'], 'vienna')
        self.assertEqual(result['release'], expected['release'])
        self.assertEqual(result['requestKey'], 'http-proof')
        self.assertEqual(result['queryKey'], all_case['pages'][0]['queryKey'])
        self.assertEqual(result['total'], expected['count'])
        self.assertEqual(result['locatedTotal'], expected['locatedCount'])
        self.assertEqual([item['sourceId'] for item in result['items']], all_case['pages'][0]['ids'])
        self.assertLessEqual(len(result['markers']), 1000)
        self.assertEqual(result['releaseFingerprint'], expected['contentSha256'])

    def test_invalid_input_does_not_become_success(self):
        invalid = [{'q': 'x' * 501}, {'q': 42}, {'offset': -1}, {'offset': 9007199254740992},
                   {'offset': 0.5}, {'limit': 0}, {'limit': 101}, {'zoom': 25},
                   {'area': [1, 0, 0, 1]}, {'viewport': None}, {'viewport': [0, 0, 0, 1]},
                   {'requestKey': ''}, {'contractVersion': '2.0.0'}, {'contractVersion': None}]
        for changes in invalid:
            with self.subTest(changes=changes):
                status, body = self.call('/v1/query', self.query(**changes))
                self.assertEqual(status, 400, body)
                self.assertIn('error', body)

    def test_escaped_unpaired_surrogates_are_rejected(self):
        for value in ['\ud800', '\udfff', 'x\ud800y']:
            with self.subTest(value=repr(value)):
                self.assertEqual(self.call('/v1/query', self.query(q=value))[0], 400)

    def test_nul_query_is_literal_zero_membership(self):
        status, body = self.call('/v1/query', self.query(q='\x00'))
        self.assertEqual(status, 200, body)
        self.assertEqual((body['total'], body['locatedTotal'], body['viewportLocatedTotal']), (0, 0, 0))
        self.assertEqual(body['items'], [])

    def test_sql_looking_query_is_literal_data(self):
        status, body = self.call('/v1/query', self.query(q="'; DROP TABLE atlas.records; --"))
        self.assertEqual(status, 200, body)
        self.assertEqual(body['total'], 0)
        status, body = self.call('/v1/query', self.query())
        self.assertEqual(status, 200, body)
        self.assertEqual(body['total'], DATASETS['vienna']['count'])

    def test_valid_500_unit_escaped_body_exceeds_old_body_limit(self):
        request = self.query(q='\ufeff' * 500)
        self.assertGreater(len(json.dumps(request).encode()), 2048)
        status, body = self.call('/v1/query', request)
        self.assertEqual(status, 200, body)
        self.assertEqual(body['total'], DATASETS['vienna']['count'])

    def test_interior_viewport_does_not_filter_list(self):
        request = self.query(viewport=[-1, -1, 1, 1])
        status, body = self.call('/v1/query', request)
        self.assertEqual(status, 200, body)
        self.assertEqual(body['total'], DATASETS['vienna']['count'])
        self.assertEqual(body['viewportLocatedTotal'], 0)
        self.assertEqual(body['representedLocatedCount'], 0)
        self.assertEqual(body['markers'], [])

    def test_missing_release_does_not_fall_back_to_latest(self):
        status, body = self.call('/v1/query', self.query(release='missing-release'))
        self.assertEqual(status, 404, body)
        self.assertEqual(body['error'], 'release_unavailable')

    def test_detail_missing_record_is_distinct_from_missing_release(self):
        request = {'contractVersion': '1.0.0', 'dataset': 'vienna',
                   'release': DATASETS['vienna']['release'], 'sourceId': '__missing__record__',
                   'requestKey': 'missing-detail-proof'}
        status, body = self.call('/v1/detail', request)
        self.assertEqual(status, 200, body)
        self.assertIsNone(body['tree'])
        request['release'] = 'missing-release'
        self.assertEqual(self.call('/v1/detail', request)[0], 404)

    def test_composite_source_identity_is_exact_and_not_split(self):
        request = {'contractVersion': '1.0.0', 'dataset': 'geneva',
                   'release': DATASETS['geneva']['release'], 'sourceId': '393253:object:229499',
                   'requestKey': 'composite-detail-proof'}
        status, body = self.call('/v1/detail', request)
        self.assertEqual(status, 200, body)
        self.assertEqual(body['tree']['sourceId'], request['sourceId'])
        self.assertEqual(body['tree']['idScope'], 'release')
        request['sourceId'] = '393253'
        status, body = self.call('/v1/detail', request)
        self.assertEqual(status, 200, body)
        self.assertIsNone(body['tree'])

    def test_spent_attempt_cannot_be_reused(self):
        token = self.issue()
        self.assertEqual(self.call('/v1/query', self.query(q='___not_recorded___'), token=token)[0], 200)
        self.assertEqual(self.call('/v1/query', self.query(), token=token)[0], 409)
        self.assertEqual(self.raw('POST', '/cancel', {'id': token}), (404, {'cancelled': False}))

    def test_pre_submit_cancellation_invalidates_reservation(self):
        token = self.issue()
        self.assertEqual(self.raw('POST', '/cancel', {'id': token}), (200, {'cancelled': True}))
        self.assertEqual(self.call('/v1/query', self.query(), token=token)[0], 409)

    def test_method_media_type_and_json_validation(self):
        self.assertEqual(self.raw('GET', '/v1/query')[0], 405)
        self.assertEqual(self.raw('POST', '/v1/query', self.query(), token=self.issue(),
                                  headers={'Content-Type': 'text/plain'})[0], 415)
        self.assertEqual(self.raw('POST', '/v1/query', raw_body=b'{', token=self.issue())[0], 400)

    def test_cache_does_not_reuse_request_correlation(self):
        first = self.call('/v1/query', self.query(requestKey='first-caller'))
        second = self.call('/v1/query', self.query(offset=25, requestKey='second-caller'))
        self.assertEqual(first[0], 200, first)
        self.assertEqual(second[0], 200, second)
        self.assertEqual(first[1]['requestKey'], 'first-caller')
        self.assertEqual(second[1]['requestKey'], 'second-caller')
        self.assertNotEqual(first[1]['queryKey'], second[1]['queryKey'])
        self.assertNotEqual(first[1]['items'], second[1]['items'])

    def test_real_coincident_trees_remain_reachable_at_maximum_zoom(self):
        point = None
        for city in ['geneva', 'vienna']:
            found = json.loads(self.observe(f"""SELECT COALESCE((SELECT json_build_object(
                'lon',lon,'lat',lat,'count',count(*)) FROM atlas.validated_records
                WHERE dataset='{city}' AND lon IS NOT NULL GROUP BY lon,lat
                HAVING count(*)>1 ORDER BY count(*),lon,lat LIMIT 1),'null'::json);"""))
            if found:
                point = {'dataset': city, **found}
                break
        output = ROOT / 'evidence/coincident-maxzoom.json'
        if point is None:
            output.write_text(json.dumps({'passed': False, 'coverage': 'No actual coincident coordinates found'}))
            self.skipTest('No actual coincident coordinates found; max-zoom coverage remains unverified')
        city = point['dataset']
        area = [point['lon'] - 1e-9, point['lat'] - 1e-9, point['lon'] + 1e-9, point['lat'] + 1e-9]
        expected = json.loads(self.observe(f"""SELECT COALESCE(json_agg(source_id ORDER BY ordinal),'[]'::json)
            FROM atlas.validated_records WHERE dataset='{city}' AND release='{DATASETS[city]['release']}'
            AND lon>={area[0]!r}::float8 AND lon<={area[2]!r}::float8
            AND lat>={area[1]!r}::float8 AND lat<={area[3]!r}::float8;"""))
        self.assertGreaterEqual(len(expected), 2)
        request = self.query(city, area=area, viewport=area, zoom=24, limit=100)
        status, result = self.call('/v1/query', request)
        self.assertEqual(status, 200, result)
        self.assertEqual(result['total'], len(expected))
        self.assertEqual(result['viewportLocatedTotal'], len(expected))
        self.assertTrue(any(marker['kind'] == 'cluster' and marker['count'] > 1 for marker in result['markers']))
        returned = []
        member_pages = 0
        for marker in result['markers']:
            if marker['kind'] == 'tree':
                returned.append(marker['tree']['sourceId'])
                continue
            members = []
            for offset in range(marker['count']):
                status, page = self.call('/v1/cluster-members', {**request, 'clusterId': marker['id'], 'offset': offset, 'limit': 1})
                self.assertEqual(status, 200, page)
                self.assertEqual(page['total'], marker['count'])
                self.assertEqual(len(page['items']), 1)
                members.append(page['items'][0]['sourceId'])
                member_pages += 1
            self.assertEqual(members, sorted(members), 'Cluster members lost prepared ordinal order')
            returned.extend(members)
        self.assertEqual(len(set(returned)), len(returned))
        self.assertEqual(sorted(returned), sorted(expected))
        output.write_text(json.dumps({'passed': True, 'dataset': city, 'release': DATASETS[city]['release'],
            'coordinates': [point['lon'], point['lat']], 'zoom': 24, 'exactViewportCount': len(expected),
            'memberPages': member_pages, 'allIdentitiesReachableExactlyOnce': True,
            'scope': 'Actual validated-record SQL coordinates/IDs versus public HTTP; no canonical data changes'}, indent=2))

    def test_explicit_cancel_interrupts_real_blocked_inventory_sql(self):
        before = self.stats()['cancel_acknowledged']
        with self.records_lock(), concurrent.futures.ThreadPoolExecutor(max_workers=1) as workers:
            token = self.issue()
            request = self.query(q='cancel-lock-' + str(uuid.uuid4()))
            future = workers.submit(self.call, '/v1/query', request, token=token)
            pid = self.wait_for_blocked_query()
            started = time.monotonic()
            self.assertEqual(self.raw('POST', '/cancel', {'id': token}), (200, {'cancelled': True}))
            status, body = future.result(timeout=1.5)
            self.assertEqual((status, body.get('error')), (409, 'cancelled'))
            self.assertLess(time.monotonic() - started, 1.5)
            self.assert_cancelled_and_retired(pid, before)
        self.assertEqual(self.raw('GET', '/health'), (200, {'ok': True}))

    def test_deadline_interrupts_real_blocked_inventory_sql(self):
        before = self.stats()['cancel_acknowledged']
        with self.records_lock(), concurrent.futures.ThreadPoolExecutor(max_workers=1) as workers:
            started = time.monotonic()
            future = workers.submit(self.call, '/v1/query', self.query(q='deadline-lock-' + str(uuid.uuid4())))
            pid = self.wait_for_blocked_query()
            status, body = future.result(timeout=4)
            elapsed = time.monotonic() - started
            self.assertEqual((status, body.get('error')), (504, 'timeout'))
            self.assertGreater(elapsed, 2.2)
            self.assertLess(elapsed, 3.5)
            self.assert_cancelled_and_retired(pid, before)
        self.assertEqual(self.raw('GET', '/health'), (200, {'ok': True}))

    def test_reset_client_cancels_real_inventory_sql(self):
        before = self.stats()['cancel_acknowledged']
        with self.records_lock():
            request = self.query(q='reset-lock-' + str(uuid.uuid4()))
            body = json.dumps(request).encode()
            token = self.issue()
            client = socket.create_connection(('127.0.0.1', self.port), timeout=3)
            try:
                client.sendall(b'POST /v1/query HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nX-Request-ID: ' +
                               token.encode() + b'\r\nContent-Length: ' + str(len(body)).encode() + b'\r\n\r\n' + body)
                pid = self.wait_for_blocked_query()
                client.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack('ii', 1, 0))
                client.close()
                self.assert_cancelled_and_retired(pid, before)
            finally:
                client.close()
        self.assertEqual(self.raw('GET', '/health'), (200, {'ok': True}))

    def test_delayed_detail_survives_legitimate_write_half_close(self):
        dataset = next(row for row in REFERENCE['datasets'] if row['dataset'] == 'vienna')
        source_id = next(case for case in dataset['queries'] if case['name'] == 'all')['pages'][0]['ids'][0]
        before = self.stats()['cancel_acknowledged']
        with self.records_lock() as release:
            request = {'contractVersion': '1.0.0', 'dataset': 'vienna', 'release': dataset['release'],
                       'sourceId': source_id, 'requestKey': 'half-close-detail'}
            body = json.dumps(request).encode()
            token = self.issue()
            with socket.create_connection(('127.0.0.1', self.port), timeout=3) as client:
                client.settimeout(4)
                client.sendall(b'POST /v1/detail HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nConnection: close\r\nX-Request-ID: ' +
                               token.encode() + b'\r\nContent-Length: ' + str(len(body)).encode() + b'\r\n\r\n' + body)
                client.shutdown(socket.SHUT_WR)
                pid = self.wait_for_blocked_query()
                time.sleep(0.25)
                self.assertIn(pid, {row['pid'] for row in self.activity()})
                self.assertEqual(self.stats()['cancel_acknowledged'], before)
                release()
                response = b''
                while True:
                    chunk = client.recv(65536)
                    if not chunk:
                        break
                    response += chunk
            header, payload = response.split(b'\r\n\r\n', 1)
            self.assertIn(b' 200 ', header.split(b'\r\n', 1)[0])
            self.assertEqual(json.loads(payload)['tree']['sourceId'], source_id)
            self.assertEqual(self.stats()['cancel_acknowledged'], before)


if __name__ == '__main__':
    unittest.main(verbosity=2)
