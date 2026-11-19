"""Real local staging constraints and role permissions; no mocks or app imports.

Synthetic SQL changes are always rolled back. The optional interrupted-import
test must be run before the frozen Porto release is imported.
"""
import csv
import io
import json
import os
from pathlib import Path
import subprocess
import unittest
import uuid

ROOT = Path(__file__).resolve().parent.parent
PRIVATE = Path('/home/david/.config/tree-atlas-postgres-pilot')
NODE = '/home/david/.nvm/versions/node/v26.13.0/bin/node'
DATASET = 'porto'
PORTO_RELEASE = 'porto-6be0471b6c303ac2'


def connection(role):
    config = json.loads((PRIVATE / f'{role}.json').read_text())
    environment = dict(os.environ)
    environment.update(PGHOST=config['host'], PGPORT=str(config['port']),
                       PGDATABASE=config['dbname'], PGUSER=config['user'],
                       PGPASSWORD=config['password'],
                       PGAPPNAME='tree_atlas_staging_regression')
    return environment


def sql(text, role='loader'):
    arguments = ['psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1']
    if role == 'admin':
        arguments = ['runuser', '-u', 'postgres', '--', *arguments, '-d', 'tree_atlas_pilot']
    return subprocess.run(arguments,
        input="SET standard_conforming_strings=on;\n" + text,
        text=True, capture_output=True,
        env=None if role == 'admin' else connection(role), timeout=20)


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def tree(source_id='0007', position=None, tag='0007'):
    return dict(dataset=DATASET, sourceId=source_id, idScope='release',
        position=[-8.62, 41.16] if position is None else position,
        tag=tag, scientificName='Acer', commonName=None, location='Porto',
        height={'kind': 'unknown'}, crown={'kind': 'unknown'},
        circumference={'kind': 'unknown'}, plantingYear=None,
        plantingEstimated=False, age=None, observedAt=None, status='removed')


class StagingProof(unittest.TestCase):
    def setUp(self):
        self.release = 'porto-test-' + uuid.uuid4().hex

    def start(self, count=1, located=None):
        located = count if located is None else located
        metadata = {'contractVersion': '1.0.0', 'searchNormalizer':
                    'nfd-diacritic-unicode17-default-lower-trim-v1',
                    'testFixture': True}
        return ('BEGIN;\nINSERT INTO atlas.releases '
            '(dataset,release,metadata,expected_count,expected_located_count,'
            'expected_identity_sha256,expected_content_sha256) VALUES '
            f"('porto',{literal(self.release)},{literal(json.dumps(metadata))}::jsonb,"
            f"{count},{located},'{('a'*64)}','{('b'*64)}');\n")

    def insert(self, row=None, ordinal=0):
        row = row or tree()
        return ('INSERT INTO atlas.records '
            '(dataset,release,ordinal,canonical,search_id,search_tag,'
            'search_scientific,search_common,search_location) VALUES '
            f"('porto',{literal(self.release)},{ordinal},{literal(json.dumps(row, ensure_ascii=False))}::jsonb,"
            f"{literal(row['sourceId'])},{literal(row['tag'])},'acer',NULL,'porto');\n")

    def successful(self, text, role='loader'):
        result = sql(text, role)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    def rejected(self, text, *, expected=None, role='loader'):
        result = sql(text, role)
        self.assertNotEqual(result.returncode, 0, 'Database accepted invalid operation')
        if expected is not None:
            self.assertIn(expected, result.stderr)
        # A failed ON_ERROR_STOP session closes its uncommitted transaction.
        observed = self.successful('SELECT count(*) FROM atlas.releases WHERE '
                                  f'release={literal(self.release)};', 'postgres')
        self.assertEqual(observed.strip().splitlines()[-1], '0')

    def test_source_id_is_string_and_leading_zeros_survive(self):
        value = self.successful(self.start().replace('BEGIN;', 'BEGIN; SET LOCAL ROLE tree_atlas_loader;') + self.insert() +
            'RESET ROLE; ' +
            "SELECT json_build_array(source_id,canonical->>'status') FROM atlas.records "
            f'WHERE release={literal(self.release)}; ROLLBACK;', 'admin')
        self.assertIn('["0007", "removed"]', value)

    def test_duplicate_source_id_aborts_the_whole_transaction(self):
        self.rejected(self.start(2) + self.insert() + self.insert(ordinal=1) + 'COMMIT;',
                      expected='duplicate key')

    def test_duplicate_ordinal_aborts_the_whole_transaction(self):
        self.rejected(self.start(2) + self.insert() + self.insert(tree('0008')) + 'COMMIT;',
                      expected='duplicate key')

    def test_invalid_coordinate_is_rejected_and_rolls_back(self):
        self.rejected(self.start() + self.insert(tree(position=[-8.62, 999])) + 'COMMIT;')

    def test_unlocated_record_preserves_null_coordinates(self):
        row = tree()
        row['position'] = None
        command = self.start(located=0).replace('BEGIN;', 'BEGIN; SET LOCAL ROLE tree_atlas_loader;')
        command += self.insert(row)
        command += f"SELECT atlas.finish_loading('porto',{literal(self.release)}); RESET ROLE; "
        command += 'SELECT json_build_array(lon,lat,canonical->\'position\') FROM atlas.records '
        command += f'WHERE release={literal(self.release)}; ROLLBACK;'
        result = self.successful(command, 'admin')
        self.assertIn('[null, null, null]', result)

    def test_loading_release_cannot_be_committed_without_sealing(self):
        self.rejected(self.start() + self.insert() + 'COMMIT;')

    def test_canonical_dataset_must_match_its_release(self):
        row = tree()
        row['dataset'] = 'vienna'
        self.rejected(self.start() + self.insert(row) + 'COMMIT;')

    def test_loader_cannot_update_or_delete_records(self):
        for operation in ['UPDATE atlas.records SET search_id=search_id',
                          'DELETE FROM atlas.records']:
            with self.subTest(operation=operation):
                self.rejected(self.start() + self.insert() + operation +
                              f' WHERE release={literal(self.release)}; COMMIT;',
                              expected='permission denied')

    def test_loader_cannot_mark_a_release_validated(self):
        self.rejected(self.start() + "UPDATE atlas.releases SET status='validated' "
                      f'WHERE release={literal(self.release)}; COMMIT;',
                      expected='permission denied')

    def test_verifier_is_read_only(self):
        self.rejected("BEGIN; UPDATE atlas.releases SET status='validated'; ROLLBACK;",
                      role='postgres')
        value = self.successful("SELECT has_table_privilege(current_user,'atlas.records','UPDATE');", 'postgres')
        self.assertEqual(value.strip().splitlines()[-1], 'f')

    def test_staged_rows_and_dictionary_reject_late_inserts(self):
        for operation in [self.insert(tree('0008'), ordinal=1),
                          'INSERT INTO atlas.dictionary VALUES '
                          f"('porto',{literal(self.release)},0,'Acer','acer');"]:
            with self.subTest(operation=operation):
                self.rejected(self.start() + self.insert() +
                    f"SELECT atlas.finish_loading('porto',{literal(self.release)});\n" + operation,
                    expected='Release is sealed')

    def test_incomplete_record_ordinals_cannot_be_staged(self):
        self.rejected(self.start() + self.insert(ordinal=1) +
            f"SELECT atlas.finish_loading('porto',{literal(self.release)});", expected='Incomplete release')

    def test_dictionary_ordinals_must_start_at_zero_without_gaps(self):
        self.rejected(self.start() + self.insert() + 'INSERT INTO atlas.dictionary VALUES '
            f"('porto',{literal(self.release)},1,'Acer','acer'),"
            f"('porto',{literal(self.release)},2,'Porto','porto');\n" +
            f"SELECT atlas.finish_loading('porto',{literal(self.release)});", expected='Incomplete dictionary')

    def test_reader_sees_validated_rows_but_not_staged_rows(self):
        command = self.start().replace('BEGIN;', 'BEGIN; SET LOCAL ROLE tree_atlas_loader;') + self.insert()
        command += f"SELECT atlas.finish_loading('porto',{literal(self.release)}); RESET ROLE;\n"
        command += 'SET LOCAL ROLE tree_atlas_reader; SELECT json_build_object(\'stagedVisible\',count(*)) '
        command += f'FROM atlas.validated_records WHERE release={literal(self.release)}; RESET ROLE;\n'
        command += f"UPDATE atlas.releases SET status='validated' WHERE release={literal(self.release)};\n"
        command += 'SET LOCAL ROLE tree_atlas_reader; SELECT json_build_object(\'validatedVisible\',count(*)) '
        command += f'FROM atlas.validated_records WHERE release={literal(self.release)}; ROLLBACK;'
        result = self.successful(command, 'admin')
        values = [json.loads(line) for line in result.splitlines() if line.startswith('{')]
        self.assertEqual(values, [{'stagedVisible': 0}, {'validatedVisible': 1}])

    def test_reader_cannot_read_private_staging_tables(self):
        result = sql('SELECT count(*) FROM atlas.records;', 'reader')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('permission denied', result.stderr)

    def test_csv_copy_preserves_quotes_newlines_unicode_and_backslashes(self):
        label = "0007 – Zürich 🌳 '\"\n\\.\t%_"
        row = tree(tag=label)
        values = ['porto', self.release, 0, json.dumps(row, ensure_ascii=False),
                  '0007', label.lower(), 'acer', None, 'porto']
        output = io.StringIO()
        csv.writer(output, lineterminator='\n').writerow(values)
        command = self.start().replace('BEGIN;', 'BEGIN; SET LOCAL ROLE tree_atlas_loader;') + ('COPY atlas.records '
            '(dataset,release,ordinal,canonical,search_id,search_tag,'
            'search_scientific,search_common,search_location) '
            'FROM STDIN WITH (FORMAT csv);\n') + output.getvalue() + '\\.\n'
        command += ("RESET ROLE; SELECT to_json(canonical->>'tag') FROM atlas.records "
                    f'WHERE release={literal(self.release)}; ROLLBACK;')
        result = self.successful(command, 'admin')
        lines = [line for line in result.splitlines() if line.startswith('"')]
        self.assertEqual(json.loads(lines[0]), label)

    @unittest.skipUnless(os.environ.get('TREE_ATLAS_RUN_IMPORT_FAULT') == '1',
                         'Run explicitly before importing the frozen Porto release')
    def test_interrupted_real_import_leaves_no_prefix_or_release(self):
        where = f"dataset='porto' AND release='{PORTO_RELEASE}'"
        before = self.successful(f'SELECT count(*) FROM atlas.releases WHERE {where};', 'postgres')
        self.assertEqual(before.strip().splitlines()[-1], '0', 'Fault test must precede Porto import')
        result = subprocess.run([NODE, str(ROOT / 'import.mjs'), '--dataset', 'porto',
                                 '--inject-failure-after', '10'], cwd=ROOT,
                                capture_output=True, text=True, timeout=120)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('INJECTED_IMPORT_FAILURE_AFTER_10', result.stdout + result.stderr,
                      'The intended producer fault was not reached')
        for table in ['releases', 'records']:
            after = self.successful(f'SELECT count(*) FROM atlas.{table} WHERE {where};', 'postgres')
            self.assertEqual(after.strip().splitlines()[-1], '0')
        evidence = {'fault': 'producer exits after 10 real canonical rows',
                    'import_exit_code': result.returncode,
                    'retained_release_rows': 0, 'retained_record_rows': 0,
                    'passed': True}
        (ROOT / 'evidence/interrupted-import.json').write_text(json.dumps(evidence, indent=2))


if __name__ == '__main__':
    unittest.main(verbosity=2)
