"""Controlled publication of verified cloud records and return to local SQLite.

The caller freezes HTTP and realtime writes, stops background consumers, and
holds the Workspace process lock for the entire operation. An interrupted
return keeps a durable journal and a retired cloud binding; it cannot fall back
to the old local databases.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import shutil
import sqlite3
import time
from contextlib import closing
from pathlib import Path
from uuid import uuid4

from .turso_bundle import table_digest
from .turso_migration import DATABASES, _fingerprint, _quoted
from .turso_sqlite import TursoConnection, TursoError


CLOUD_INDEX_SQL = (
    "CREATE INDEX IF NOT EXISTS reroll_cloud_effect_ready ON generation_effect_outbox(state,available_at,lease_expires_at)",
    "CREATE INDEX IF NOT EXISTS reroll_cloud_publication_ready ON generation_publication_receipts(state,available_at,lease_expires_at)",
    "CREATE INDEX IF NOT EXISTS reroll_cloud_batch_status ON batch_tasks(status,batch_id)",
)


def atomic_json(path, value):
    path = Path(path)
    temporary = path.with_name('.' + path.name + '.' + uuid4().hex + '.tmp')
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _require_drained(connection):
    pending = connection.execute("""
        SELECT 1 FROM generation_runs WHERE status NOT IN ('succeeded','failed','cancelled','discarded')
        UNION SELECT 1 FROM generation_effect_outbox WHERE state<>'completed'
        UNION SELECT 1 FROM generation_publication_receipts WHERE state<>'completed'
        UNION SELECT 1 FROM batches WHERE status IN ('queued','running','paused')
        UNION SELECT 1 FROM batch_tasks WHERE status NOT IN ('succeeded','failed','cancelled')
        LIMIT 1
    """).fetchone()
    if pending:
        raise TursoError('cloud_storage_tasks_pending')


class CloudStorageSwitch:
    def __init__(self, content, *, workspace_id, state_directory, connect=None):
        self.content = content
        self.workspace_id = workspace_id
        self.state = Path(state_directory)
        self.configuration = self.state / 'turso-connection.json'
        try:
            self.settings = json.loads(self.configuration.read_text())
            if self.settings.get('workspace_id') != workspace_id:
                raise ValueError
        except (OSError, ValueError, TypeError):
            raise TursoError('cloud_storage_configuration_required') from None
        self.connect = connect or (lambda: TursoConnection(self.settings['url'], self.settings['token']))

    def enable(self):
        """Activate only a previously prepared and fully verified import."""
        try:
            root = Path(self.settings['migration_directory']).resolve()
            root.relative_to((self.state / 'cloud-migrations').resolve())
            migration = json.loads((root / 'migration.json').read_text())
            raw = (root / 'bundle-verification.json').read_bytes()
            verified = json.loads((root / 'cloud-verification.json').read_text())
            binding = migration['binding_id']
            if migration['workspace_id'] != self.workspace_id or set(migration['sources']) != set(DATABASES):
                raise ValueError
            if not verified.get('verified') or verified['source_manifest_sha256'] != hashlib.sha256(raw).hexdigest():
                raise ValueError
            if verified['binding_id'] != binding or verified['workspace_id'] != self.workspace_id:
                raise ValueError
        except (OSError, ValueError, KeyError, TypeError):
            raise TursoError('cloud_storage_configuration_required') from None
        authority_raw = self.content.storage_authority.read_bytes()
        authority = json.loads(authority_raw)
        if authority.get('workspace_id') != self.workspace_id:
            raise TursoError('cloud_storage_binding_invalid')
        if authority.get('canvas') == 'turso' and authority.get('cloud_binding_id') == binding:
            return {'enabled': True, 'restart_required': True}
        if authority.get('canvas') != 'sqlite' or (migration.get('authority_sha256') and hashlib.sha256(authority_raw).hexdigest() != migration['authority_sha256']):
            raise TursoError('cloud_storage_source_changed')
        for name, source in migration['sources'].items():
            if any((self.content.canvas_content.parent / (name + suffix)).exists() for suffix in ('-wal', '-shm', '-journal')):
                raise TursoError('cloud_storage_source_changed')
            actual = _fingerprint(self.content.canvas_content.parent / name)
            if actual[1] != source['fingerprint'][1] or actual[3] != source['fingerprint'][3]:
                raise TursoError('cloud_storage_source_changed')
        with closing(self.connect()) as connection, connection:
            connection.execute('BEGIN IMMEDIATE')
            row = connection.execute('SELECT workspace_id,binding_id,state FROM reroll_workspace_lease').fetchall()
            if row not in ([(self.workspace_id, binding, 'staging')], [(self.workspace_id, binding, 'active')]):
                raise TursoError('cloud_storage_binding_invalid')
            if connection.execute("SELECT 1 FROM reroll_workspace_lease WHERE owner<>'' AND expires_at>CAST(strftime('%s','now') AS INTEGER)").fetchone():
                raise TursoError('cloud_storage_workspace_busy')
            _require_drained(connection)
            for sql in CLOUD_INDEX_SQL:
                connection.execute(sql)
            connection.execute("UPDATE reroll_workspace_lease SET state='active' WHERE workspace_id=? AND binding_id=?", (self.workspace_id, binding))
        atomic_json(self.content.storage_authority, {
            'schema_version': 1, 'workspace_id': self.workspace_id,
            'migration_id': 'cloud-' + binding,
            'canvas': 'turso', 'generation_runs': 'turso', 'batch_generation': 'turso',
            'cloud_binding_id': binding, 'cloud_database_url': self.settings['url'],
        })
        self.settings['status'] = 'active'
        self.settings['binding_id'] = binding
        atomic_json(self.configuration, self.settings)
        return {'enabled': True, 'restart_required': True}

    def disable(self, runtime):
        binding = runtime.binding_id
        journal = self.state / ('cloud-return-' + binding + '.json')
        resumed = self.resume_return(binding)
        if resumed is not None:
            return resumed
        runtime.require_active()
        return self._export_local(runtime, journal)

    def resume_return(self, binding):
        """Finish a retired binding's verified export after a process restart."""
        journal = self.state / ('cloud-return-' + binding + '.json')
        if journal.exists():
            saved = json.loads(journal.read_text())
            with closing(self.connect()) as connection:
                row = connection.execute('SELECT state FROM reroll_workspace_lease WHERE workspace_id=? AND binding_id=?', (self.workspace_id, binding)).fetchone()
            if row == ('retired',) and saved.get('state') in {'exported', 'completed'}:
                return self._publish_local(saved, journal)
        return None

    def _export_local(self, runtime, journal):
        binding = runtime.binding_id
        root = self.state / 'cloud-migrations' / ('return-' + uuid4().hex)
        root.mkdir(parents=True, mode=0o700)
        epoch = uuid4().hex
        saved = {'workspace_id': self.workspace_id, 'binding_id': binding, 'epoch': epoch, 'root': str(root), 'files': {}, 'state': 'exporting'}
        atomic_json(journal, saved)
        with runtime._renew_lock, closing(self.connect()) as remote, remote:
            remote.execute('BEGIN IMMEDIATE')
            runtime.fence.check(remote)
            _require_drained(remote)
            layouts = remote.execute('SELECT file_name,schema_json FROM reroll_cloud_layout ORDER BY file_name').fetchall()
            if {row[0] for row in layouts} != set(DATABASES):
                raise TursoError('cloud_storage_schema_invalid')
            for name, schema_json in layouts:
                path = root / name
                fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                os.close(fd)
                schema = json.loads(schema_json)
                with closing(sqlite3.connect(path)) as local:
                    for kind, table, sql in schema:
                        if kind not in {'table', 'index'}:
                            raise TursoError('cloud_storage_schema_invalid')
                        if kind != 'table':
                            continue
                        local.execute(sql)
                        columns = local.execute(f'PRAGMA table_info({_quoted(table)})').fetchall()
                        primary = [column[1] for column in sorted(columns, key=lambda row: row[5]) if column[5]]
                        if not primary:
                            raise TursoError('cloud_storage_schema_invalid')
                        positions = [[column[1] for column in columns].index(key) for key in primary]
                        order = ','.join(map(_quoted, primary))
                        last, count, digest = None, 0, hashlib.sha256()
                        while True:
                            remote.execute("UPDATE reroll_workspace_lease SET expires_at=CAST(strftime('%s','now') AS INTEGER)+120 WHERE workspace_id=? AND binding_id=? AND owner=? AND epoch=?", (self.workspace_id, binding, runtime.fence.owner, runtime.fence.epoch))
                            runtime._deadline = time.monotonic() + 110
                            where = '' if last is None else f' WHERE ({order}) > (' + ','.join('?' for _ in primary) + ')'
                            rows = remote.execute(f'SELECT * FROM {_quoted(table)}{where} ORDER BY {order} LIMIT 256', () if last is None else last).fetchall()
                            for row in rows:
                                values = [{'blob': base64.b64encode(value).decode('ascii')} if isinstance(value, bytes) else value for value in row]
                                encoded = json.dumps(values, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')
                                digest.update(len(encoded).to_bytes(8, 'big'))
                                digest.update(encoded)
                                count += 1
                            local.executemany(f'INSERT INTO {_quoted(table)} VALUES (' + ','.join('?' for _ in columns) + ')', rows)
                            if len(rows) < 256:
                                break
                            last = tuple(rows[-1][index] for index in positions)
                        if table_digest(local, table) != {'rows': count, 'sha256': digest.hexdigest()}:
                            raise TursoError('cloud_storage_export_mismatch')
                    for kind, _, sql in schema:
                        if kind == 'index':
                            local.execute(sql)
                    metadata = {'canvas-content.sqlite3': 'store_metadata', 'generation-runs.sqlite3': 'generation_run_store_metadata'}.get(name)
                    if metadata is None:
                        metadata = 'reroll_batch_metadata'
                        local.execute('CREATE TABLE IF NOT EXISTS reroll_batch_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)')
                    local.execute(f"INSERT INTO {metadata}(key,value) VALUES('cloud_return_epoch',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (epoch,))
                    local.commit()
                    if local.execute('PRAGMA integrity_check').fetchall() != [('ok',)] or local.execute('PRAGMA foreign_key_check').fetchall():
                        raise TursoError('cloud_storage_export_mismatch')
                saved['files'][name] = _fingerprint(path)[3]
            saved['state'] = 'exported'
            atomic_json(journal, saved)
            runtime.fence.check(remote)
            remote.execute("UPDATE reroll_workspace_lease SET state='retired',owner='',expires_at=0 WHERE workspace_id=? AND binding_id=?", (self.workspace_id, binding))
            # Revocation also covers a lost COMMIT response. The journal and
            # remote retired state allow an explicit retry to finish publication.
            runtime.fence._revoked.set()
        return self._publish_local(saved, journal)

    def _publish_local(self, saved, journal):
        root = Path(saved['root']).resolve()
        root.relative_to((self.state / 'cloud-migrations').resolve())
        if saved['workspace_id'] != self.workspace_id or set(saved['files']) != set(DATABASES):
            raise TursoError('cloud_storage_binding_invalid')
        current = json.loads(self.content.storage_authority.read_text())
        if current.get('canvas') == 'sqlite' and current.get('cloud_return_epoch') == saved['epoch']:
            # Publication may have succeeded before journal/config persistence
            # failed. Never copy the old export over subsequent local edits.
            saved['state'] = 'completed'
            atomic_json(journal, saved)
            self.settings['status'] = 'retired'
            atomic_json(self.configuration, self.settings)
            return {'enabled': False, 'restart_required': True}
        data = self.content.canvas_content.parent
        backup = root / 'previous-local'
        backup.mkdir(mode=0o700, exist_ok=True)
        for name in DATABASES:
            if any((data / (name + suffix)).exists() for suffix in ('-wal', '-shm', '-journal')):
                raise TursoError('cloud_storage_local_copy_incomplete')
        for name, fingerprint in saved['files'].items():
            if _fingerprint(root / name)[3] != fingerprint:
                raise TursoError('cloud_storage_export_mismatch')
            destination = data / name
            if destination.exists() and not (backup / name).exists():
                shutil.copyfile(destination, backup / name)
            temporary = data / ('.' + name + '.' + saved['epoch'] + '.tmp')
            shutil.copyfile(root / name, temporary)
            temporary.chmod(0o600)
            if _fingerprint(temporary)[3] != fingerprint:
                raise TursoError('cloud_storage_export_mismatch')
            with temporary.open('rb') as stream:
                os.fsync(stream.fileno())
            os.replace(temporary, destination)
        atomic_json(self.content.storage_authority, {
            'schema_version': 1, 'workspace_id': self.workspace_id,
            'migration_id': 'cloud-return-' + saved['epoch'],
            'canvas': 'sqlite', 'generation_runs': 'sqlite', 'cloud_return_epoch': saved['epoch'],
        })
        saved['state'] = 'completed'
        atomic_json(journal, saved)
        self.settings['status'] = 'retired'
        atomic_json(self.configuration, self.settings)
        return {'enabled': False, 'restart_required': True}
