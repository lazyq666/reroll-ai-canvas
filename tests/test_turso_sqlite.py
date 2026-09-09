"""Transport contracts against an independent SQLite-backed HTTP stream fake."""

import base64
import sqlite3
import unittest

import requests

from infinite_canvas.turso_sqlite import TursoConnection, TursoError, database_url


class SqlitePipeline:
    def __init__(self):
        self.database = sqlite3.connect(':memory:', isolation_level=None)
        self.calls = []
        self.baton = None
        self.serial = 0

    @staticmethod
    def value(cell):
        kind = cell['type']
        if kind == 'null':
            return None
        if kind == 'blob':
            return base64.b64decode(cell['base64'])
        return {'integer': int, 'float': float, 'text': str}[kind](cell['value'])

    @staticmethod
    def cell(value):
        if value is None:
            return {'type': 'null'}
        if isinstance(value, bytes):
            return {'type': 'blob', 'base64': base64.b64encode(value).decode()}
        if isinstance(value, int):
            return {'type': 'integer', 'value': str(value)}
        if isinstance(value, float):
            return {'type': 'float', 'value': value}
        return {'type': 'text', 'value': value}

    def execute(self, statement):
        args = (
            {v['name']: self.value(v['value']) for v in statement['named_args']}
            if 'named_args' in statement
            else [self.value(v) for v in statement.get('args', [])]
        )
        cursor = self.database.execute(statement['sql'], args)
        return {
            'cols': [{'name': c[0]} for c in cursor.description or []],
            'rows': [[self.cell(v) for v in row] for row in cursor.fetchall()],
            'affected_row_count': max(0, cursor.rowcount),
            'last_insert_rowid': str(cursor.lastrowid) if cursor.lastrowid else None,
        }

    def __call__(self, url, payload):
        self.calls.append((url, payload))
        assert payload.get('baton') == self.baton
        results = []
        for request in payload['requests']:
            kind = request['type']
            try:
                response = {'type': kind}
                if kind == 'execute':
                    response['result'] = self.execute(request['stmt'])
                elif kind == 'batch':
                    step_results, step_errors = [], []
                    for step in request['batch']['steps']:
                        condition = step.get('condition')
                        if condition and step_results[condition['step']] is None:
                            step_results.append(None)
                            step_errors.append(None)
                            continue
                        try:
                            step_results.append(self.execute(step['stmt']))
                            step_errors.append(None)
                        except sqlite3.Error as error:
                            step_results.append(None)
                            step_errors.append({'code': error.sqlite_errorname})
                    response['result'] = {'step_results': step_results, 'step_errors': step_errors}
                elif kind == 'sequence':
                    self.database.executescript(request['sql'])
                elif kind == 'get_autocommit':
                    response['is_autocommit'] = not self.database.in_transaction
                elif kind == 'close':
                    self.database.rollback()
                else:
                    raise AssertionError(kind)
                results.append({'type': 'ok', 'response': response})
            except sqlite3.Error as error:
                results.append({'type': 'error', 'error': {
                    'code': getattr(error, 'sqlite_errorname', 'SQLITE_ERROR'),
                    'message': 'Sensitive server diagnostics must not be forwarded',
                }})
        self.serial += 1
        self.baton = str(self.serial) if self.database.in_transaction else None
        return {'baton': self.baton, 'base_url': None, 'results': results}


class TursoSqliteTests(unittest.TestCase):
    def setUp(self):
        self.server = SqlitePipeline()
        self.connection = TursoConnection(
            'libsql://test.turso.io', 'test-token', transport=self.server,
        )
        self.addCleanup(self.server.database.close)
        self.addCleanup(self.connection.close)

    def test_round_trip_integer_unicode_blob_and_row_access(self):
        self.connection.row_factory = sqlite3.Row
        row = self.connection.execute(
            'SELECT :id AS identifier, typeof(:id) AS kind, :text AS title, :blob AS binary, :null AS empty',
            {'id': 2**63 - 2, 'text': '画布🌧', 'blob': b'\x00\xff', 'null': None},
        ).fetchone()
        self.assertEqual(dict(row), {
            'identifier': 2**63-2, 'kind': 'integer', 'title': '画布🌧',
            'binary': b'\x00\xff', 'empty': None,
        })
        self.assertEqual(row['IDENTIFIER'], row[0])
        self.assertEqual(tuple(row)[2], '画布🌧')
        self.assertEqual(row[1:3], ('integer', '画布🌧'))

    def test_repeated_autocommit_reads_accept_null_baton(self):
        for _ in range(3):
            self.assertEqual(self.connection.execute('SELECT 7').fetchone(), (7,))
        self.assertFalse(self.connection.in_transaction)

    def test_generator_insertion_commit_and_rollback_have_sqlite_semantics(self):
        connection = self.connection
        connection.execute('CREATE TABLE records (id INTEGER PRIMARY KEY)')
        with connection:
            cursor = connection.executemany('INSERT INTO records VALUES (?)', ((i,) for i in range(4)))
            self.assertEqual(cursor.rowcount, 4)
            self.assertTrue(connection.in_transaction)
        self.assertFalse(connection.in_transaction)
        with self.assertRaises(ValueError):
            with connection:
                connection.execute('DELETE FROM records')
                raise ValueError('Cancel user operation')
        self.assertEqual(list(connection.execute('SELECT id FROM records ORDER BY id')), [(0,), (1,), (2,), (3,)])

    def test_constraint_error_requires_rollback_and_does_not_commit_prefix(self):
        connection = self.connection
        connection.execute('CREATE TABLE records (id INTEGER PRIMARY KEY)')
        with self.assertRaises(sqlite3.IntegrityError) as rejected:
            with connection:
                connection.executemany('INSERT INTO records VALUES (?)', [(1,), (1,), (2,)])
        self.assertNotIn('Sensitive', str(rejected.exception))
        self.assertEqual(connection.execute('SELECT count(*) FROM records').fetchone(), (0,))

    def test_mixed_write_batch_preserves_order_and_rolls_back_on_error(self):
        connection = self.connection
        connection.execute('CREATE TABLE records (id INTEGER PRIMARY KEY, text TEXT)')
        with connection:
            count = connection.execute_batch([
                ('INSERT INTO records VALUES (?, ?)', (1, 'original')),
                ('UPDATE records SET text = ? WHERE id = ?', ('changed', 1)),
                ('INSERT INTO records VALUES (?, ?)', (2, 'second')),
            ])
        self.assertEqual(count, 3)
        self.assertEqual(list(connection.execute('SELECT * FROM records ORDER BY id')),
                         [(1, 'changed'), (2, 'second')])
        with self.assertRaises(sqlite3.IntegrityError):
            with connection:
                connection.execute_batch([
                    ('DELETE FROM records WHERE id = ?', (1,)),
                    ('INSERT INTO records VALUES (?, ?)', (2, 'duplicate')),
                    ('DELETE FROM records', ()),
                ])
        self.assertEqual(list(connection.execute('SELECT * FROM records ORDER BY id')),
                         [(1, 'changed'), (2, 'second')])

    def test_write_batch_rejects_transaction_control_and_invalid_generator_prefix(self):
        connection = self.connection
        connection.execute('CREATE TABLE records (id INTEGER PRIMARY KEY)')
        with self.assertRaises(sqlite3.ProgrammingError):
            with connection:
                connection.execute_batch([
                    ('INSERT INTO records VALUES (?)', (1,)), ('COMMIT', ()),
                ])
        self.assertEqual(connection.execute('SELECT count(*) FROM records').fetchone()[0], 0)

        def writes():
            for index in range(130):
                yield 'INSERT INTO records VALUES (?)', (index,)
            raise ValueError('Interrupted statement production')

        with self.assertRaises(ValueError):
            with connection:
                connection.execute_batch(writes())
        self.assertEqual(connection.execute('SELECT count(*) FROM records').fetchone()[0], 0)

    def test_large_batch_is_chunked_and_an_error_rolls_back_previous_chunks(self):
        connection = self.connection
        connection.execute('CREATE TABLE records (id INTEGER PRIMARY KEY)')
        with self.assertRaises(sqlite3.IntegrityError):
            with connection:
                connection.executemany('INSERT INTO records VALUES (?)', ((i % 280,) for i in range(300)))
        batch_calls = [payload for _, payload in self.server.calls if payload['requests'][0]['type'] == 'batch']
        self.assertEqual(len(batch_calls), 3)
        self.assertEqual(connection.execute('SELECT count(*) FROM records').fetchone(), (0,))

    def test_savepoint_rollback_uses_server_state(self):
        connection = self.connection
        connection.execute('CREATE TABLE records (id INTEGER)')
        with connection:
            connection.execute('INSERT INTO records VALUES (1)')
            connection.execute('SAVEPOINT retained')
            connection.execute('INSERT INTO records VALUES (2)')
            connection.execute('ROLLBACK TO retained')
            self.assertTrue(connection.in_transaction)
            connection.execute('RELEASE retained')
            self.assertTrue(connection.in_transaction)
        self.assertEqual(connection.execute('SELECT * FROM records').fetchall(), [(1,)])

    def test_caught_generator_failure_cannot_commit_an_earlier_batch_chunk(self):
        connection = self.connection
        connection.execute('CREATE TABLE records (id INTEGER PRIMARY KEY)')

        def broken_rows():
            for number in range(200):
                yield (number,)
            raise ValueError('Source iteration failed')

        with self.assertRaisesRegex(TursoError, 'cloud_storage_rollback_required'):
            with connection:
                with self.assertRaises(ValueError):
                    connection.executemany('INSERT INTO records VALUES (?)', broken_rows())
        self.assertEqual(connection.execute('SELECT count(*) FROM records').fetchone(), (0,))

    def test_failed_script_is_reported_and_does_not_run_later_statements(self):
        with self.assertRaises(sqlite3.OperationalError):
            self.connection.executescript('CREATE TABLE first (id); INVALID SQL; CREATE TABLE last (id);')
        names = self.connection.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        self.assertEqual(names, [('first',)])

    def test_commit_response_loss_is_not_retried_or_reported_as_saved(self):
        connection = self.connection
        connection.execute('CREATE TABLE records (id INTEGER)')
        connection.execute('INSERT INTO records VALUES (1)')
        def lose_response(url, payload):
            self.server(url, payload)
            raise requests.Timeout('Sensitive URL or credential')
        connection._transport = lose_response
        with self.assertRaises(TursoError) as unknown:
            connection.commit()
        self.assertEqual(unknown.exception.code, 'cloud_storage_outcome_unknown')
        self.assertNotIn('Sensitive', str(unknown.exception))
        count = len(self.server.calls)
        with self.assertRaises(TursoError):
            connection.commit()
        connection.rollback()
        connection.close()
        self.assertEqual(len(self.server.calls), count)
        self.assertEqual(self.server.database.execute('SELECT * FROM records').fetchall(), [(1,)])

    def test_bad_response_cannot_keep_using_a_stale_transaction(self):
        self.connection.execute('BEGIN IMMEDIATE')
        def malformed(url, payload):
            return {'baton': None, 'results': [{'type': 'ok'}]}
        self.connection._transport = malformed
        with self.assertRaises(TursoError):
            self.connection.execute('SELECT 1')
        with self.assertRaises(TursoError):
            self.connection.commit()

    def test_malformed_row_invalidates_connection(self):
        def malformed_row(url, payload):
            value = self.server(url, payload)
            value['results'][0]['response']['result']['rows'] = [[{'type': 'unknown'}]]
            return value
        self.connection._transport = malformed_row
        with self.assertRaises(TursoError):
            self.connection.execute('SELECT 1')
        with self.assertRaises(TursoError):
            self.connection.commit()

    def test_out_of_range_integer_is_rejected_before_starting_a_write(self):
        with self.assertRaises(OverflowError):
            self.connection.execute('INSERT INTO records VALUES (?)', (2**63,))
        self.assertEqual(self.server.calls, [])
        self.assertFalse(self.connection.in_transaction)

    def test_untrusted_base_url_is_rejected_before_forwarding_credentials(self):
        def redirect(url, payload):
            value = self.server(url, payload)
            value['base_url'] = 'https://attacker.example'
            return value
        self.connection._transport = redirect
        with self.assertRaises(TursoError):
            self.connection.execute('SELECT 1')
        self.assertEqual(len(self.server.calls), 1)

    def test_connection_url_rejects_plaintext_secrets_and_invalid_ports(self):
        for url in [
            'http://test.turso.io', 'https://test.turso.io.attacker.example',
            'https://secret@test.turso.io', 'https://test.turso.io/?token=secret',
            'https://test.turso.io:invalid', 'https://test.turso.io:8080',
        ]:
            with self.subTest(url=url), self.assertRaises(TursoError):
                database_url(url)


if __name__ == '__main__':
    unittest.main()
