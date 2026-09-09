"""Small, explicit SQLite transport for Turso's libSQL HTTP protocol.

This adapter is not selected by the application until cloud Workspace setup
and migration are implemented. It never stores a local database or retries an
uncertain request. Business idempotency belongs to the existing Store receipts.
"""

from __future__ import annotations

import base64
import json
import math
import re
import sqlite3
from collections.abc import Callable, Iterable, Mapping
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import requests


MAX_RESPONSE_BYTES = 32 * 1024 * 1024
_DML = {"INSERT", "UPDATE", "DELETE", "REPLACE"}


class TursoError(sqlite3.OperationalError):
    """An application-translatable error without SQL, tokens, or response text."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def database_url(value: str) -> str:
    """Accept only an authenticated Turso service origin, without URL secrets."""
    try:
        parsed = urlsplit(str(value).strip())
        port = parsed.port
    except ValueError:
        raise TursoError("cloud_storage_invalid_url") from None
    if (
        parsed.scheme not in {"libsql", "https"}
        or not parsed.hostname
        or not parsed.hostname.lower().endswith(".turso.io")
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or parsed.path not in {"", "/"}
        or port not in {None, 443}
    ):
        raise TursoError("cloud_storage_invalid_url")
    return urlunsplit(("https", parsed.netloc.lower(), "", "", ""))


def _encode(value: Any) -> dict[str, Any]:
    if value is None:
        return {"type": "null"}
    if isinstance(value, int):
        if not -(2**63) <= value < 2**63:
            raise OverflowError("SQLite integer outside signed 64-bit range")
        return {"type": "integer", "value": str(int(value))}
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("Non-finite SQL parameter")
        return {"type": "float", "value": value}
    if isinstance(value, str):
        return {"type": "text", "value": value}
    if isinstance(value, (bytes, bytearray, memoryview)):
        return {"type": "blob", "base64": base64.b64encode(value).decode("ascii")}
    raise sqlite3.ProgrammingError("Unsupported SQL parameter type")


def _decode(value: Mapping[str, Any]) -> Any:
    kind = value["type"]
    if kind == "null":
        return None
    if kind == "integer":
        return int(value["value"])
    if kind == "float":
        return float(value["value"])
    if kind == "text":
        return str(value["value"])
    if kind == "blob":
        return base64.b64decode(value["base64"], validate=True)
    raise ValueError("Unknown SQL value type")


def _verb(sql: str) -> str:
    cleaned = re.sub(r"/\*.*?\*/|--[^\n]*", " ", sql, flags=re.S).lstrip()
    return cleaned.split(None, 1)[0].rstrip(";").upper() if cleaned else ""


class TursoRow:
    """sqlite3.Row's named and positional access without its C cursor coupling."""

    def __init__(self, cursor: "TursoCursor", values: tuple[Any, ...]):
        self._names = tuple(column[0] for column in cursor.description or ())
        self._values = values

    def keys(self) -> list[str]:
        return list(self._names)

    def __getitem__(self, key: str | int | slice) -> Any:
        if isinstance(key, str):
            for index, name in enumerate(self._names):
                if name.lower() == key.lower():
                    return self._values[index]
            raise IndexError("No item with that key")
        return self._values[key]

    def __iter__(self):
        return iter(self._values)

    def __len__(self) -> int:
        return len(self._values)


class TursoCursor:
    def __init__(self, connection: "TursoConnection"):
        self.connection = connection
        self.description = None
        self.rowcount = -1
        self.lastrowid = None
        self.arraysize = 1
        self._rows: list[tuple[Any, ...]] = []
        self._index = 0

    def execute(self, sql: str, parameters: Any = ()) -> "TursoCursor":
        result = self.connection._execute(sql, parameters)
        try:
            self.description = tuple(
                (column["name"], None, None, None, None, None, None)
                for column in result["cols"]
            ) or None
            self._rows = [tuple(_decode(value) for value in row) for row in result["rows"]]
            if any(len(row) != len(self.description or ()) for row in self._rows):
                raise ValueError("Invalid row shape")
            self._index = 0
            self.rowcount = int(result["affected_row_count"]) if _verb(sql) in _DML else -1
            row_id = result.get("last_insert_rowid")
            self.lastrowid = int(row_id) if row_id is not None else None
        except (KeyError, ValueError, TypeError):
            self.connection._broken = True
            raise TursoError("cloud_storage_outcome_unknown") from None
        return self

    def executemany(self, sql: str, parameters: Iterable[Any]) -> "TursoCursor":
        if _verb(sql) not in _DML:
            raise sqlite3.ProgrammingError("executemany requires a DML statement")
        count = self.connection.execute_batch((sql, values) for values in parameters)
        self.description = None
        self._rows = []
        self._index = 0
        self.rowcount = count
        return self

    def executescript(self, sql: str) -> "TursoCursor":
        self.connection._sequence(sql)
        self.description = None
        self.rowcount = -1
        self._rows = []
        self._index = 0
        return self

    def fetchone(self) -> Any:
        if self._index >= len(self._rows):
            return None
        values = self._rows[self._index]
        self._index += 1
        factory = self.connection.row_factory
        if factory is sqlite3.Row:
            factory = TursoRow
        return factory(self, values) if factory else values

    def fetchmany(self, size: int | None = None) -> list[Any]:
        count = self.arraysize if size is None else size
        rows = []
        for _ in range(max(0, count)):
            row = self.fetchone()
            if row is None:
                break
            rows.append(row)
        return rows

    def fetchall(self) -> list[Any]:
        return self.fetchmany(len(self._rows) - self._index)

    def __iter__(self):
        return self

    def __next__(self):
        row = self.fetchone()
        if row is None:
            raise StopIteration
        return row


class TursoConnection:
    """One serialized remote stream; no retry or failover to a local writer."""

    def __init__(
        self,
        url: str,
        token: str,
        *,
        transport: Callable[[str, dict[str, Any]], dict[str, Any]] | None = None,
        timeout: float = 15,
    ):
        self._url = database_url(url)
        if not token or any(character.isspace() for character in token):
            raise TursoError("cloud_storage_invalid_token")
        self._token = token
        self._timeout = timeout
        self._session = requests.Session() if transport is None else None
        self._transport = transport or self._post
        self._baton: str | None = None
        self._closed = False
        self._broken = False
        self._needs_rollback = False
        self.in_transaction = False
        self.row_factory = None

    def _post(self, url: str, payload: dict[str, Any]) -> dict[str, Any]:
        assert self._session is not None
        try:
            with self._session.post(
                url + "/v2/pipeline",
                headers={"Authorization": "Bearer " + self._token},
                json=payload,
                timeout=(5, self._timeout),
                allow_redirects=False,
                stream=True,
            ) as response:
                if response.status_code in {401, 403}:
                    raise TursoError("cloud_storage_unauthorized")
                if response.status_code == 429:
                    raise TursoError("cloud_storage_limit_reached")
                if not 200 <= response.status_code < 300:
                    raise TursoError("cloud_storage_unavailable")
                content = bytearray()
                for chunk in response.iter_content(chunk_size=65536):
                    content.extend(chunk)
                    if len(content) > MAX_RESPONSE_BYTES:
                        raise TursoError("cloud_storage_response_too_large")
                result = json.loads(content)
                if not isinstance(result, dict):
                    raise ValueError("Invalid pipeline response")
                return result
        except TursoError:
            raise
        except (requests.RequestException, ValueError):
            raise TursoError("cloud_storage_outcome_unknown") from None

    def _request(self, request: dict[str, Any]) -> dict[str, Any]:
        if self._closed or self._broken:
            raise TursoError("cloud_storage_connection_closed")
        try:
            # Read server transaction state in the same round trip. A missing
            # baton after an autocommit read is valid and starts a fresh stream
            # on the next call; it does not close this logical connection.
            requests_ = [request]
            if request["type"] != "close":
                requests_.append({"type": "get_autocommit"})
            response = self._transport(self._url, {"baton": self._baton, "requests": requests_})
            baton = response["baton"]
            if baton is not None and not isinstance(baton, str):
                raise ValueError("Invalid baton")
            self._baton = baton
            if response.get("base_url"):
                self._url = database_url(response["base_url"])
            results = response["results"]
            if len(results) != len(requests_):
                raise ValueError("Invalid result count")
            if request["type"] != "close":
                status = results[1]
                if status["type"] != "ok" or status["response"]["type"] != "get_autocommit":
                    raise ValueError("Missing transaction state")
                autocommit = status["response"]["is_autocommit"]
                if not isinstance(autocommit, bool) or (not autocommit and baton is None):
                    raise ValueError("Invalid transaction state")
                self.in_transaction = not autocommit
            result = results[0]
            if result["type"] == "error":
                self._needs_rollback = self.in_transaction
                code = str(result["error"].get("code", ""))
                if code.startswith("SQLITE_CONSTRAINT"):
                    raise sqlite3.IntegrityError("cloud_storage_constraint_violation")
                raise sqlite3.OperationalError("cloud_storage_query_failed")
            if result["type"] != "ok" or result["response"]["type"] != request["type"]:
                raise ValueError("Invalid response type")
            if request['type'] in {'execute', 'batch'} and not isinstance(result['response'].get('result'), dict):
                raise ValueError('Missing SQL result')
            if request["type"] == "close":
                self._closed = True
            return result["response"]
        except (sqlite3.IntegrityError, sqlite3.OperationalError) as error:
            if isinstance(error, TursoError):
                self._broken = True
            raise
        except Exception:
            self._broken = True
            raise TursoError("cloud_storage_outcome_unknown") from None

    def _execute(self, sql: str, parameters: Any) -> dict[str, Any]:
        verb = _verb(sql)
        if self._needs_rollback and verb != "ROLLBACK":
            raise TursoError("cloud_storage_rollback_required")
        statement = self._statement(sql, parameters)
        if verb in _DML and not self.in_transaction:
            self._execute("BEGIN", ())
        was_in_transaction = self.in_transaction
        result = self._request({"type": "execute", "stmt": statement})["result"]
        if was_in_transaction and not self.in_transaction and verb not in {'COMMIT', 'END', 'ROLLBACK', 'RELEASE'}:
            self._broken = True
            raise TursoError('cloud_storage_outcome_unknown')
        if not self.in_transaction:
            self._needs_rollback = False
        return result

    @staticmethod
    def _statement(sql: str, parameters: Any, *, want_rows: bool = True) -> dict[str, Any]:
        statement: dict[str, Any] = {"sql": sql, "want_rows": want_rows}
        if isinstance(parameters, Mapping):
            statement["named_args"] = [{"name": str(key), "value": _encode(value)} for key, value in parameters.items()]
        else:
            statement["args"] = [_encode(value) for value in parameters]
        return statement

    def _execute_batch(self, statements: list[dict[str, Any]]) -> int:
        if self._needs_rollback:
            raise TursoError('cloud_storage_rollback_required')
        if not self.in_transaction:
            self._execute("BEGIN", ())
        steps = []
        for index, statement in enumerate(statements):
            step = {'stmt': statement}
            if index:
                step['condition'] = {'type': 'ok', 'step': index - 1}
            steps.append(step)
        result = self._request({'type': 'batch', 'batch': {'steps': steps}})['result']
        try:
            if not self.in_transaction:
                raise ValueError('Batch unexpectedly left its transaction')
            rows, errors = result['step_results'], result['step_errors']
            if len(rows) != len(steps) or len(errors) != len(steps):
                raise ValueError('Invalid batch shape')
            first_error = next((error for error in errors if error is not None), None)
            if first_error is not None:
                self._needs_rollback = self.in_transaction
                if str(first_error.get('code', '')).startswith('SQLITE_CONSTRAINT'):
                    raise sqlite3.IntegrityError('cloud_storage_constraint_violation')
                raise sqlite3.OperationalError('cloud_storage_query_failed')
            if any(row is None for row in rows):
                raise ValueError('Unexpected skipped batch step')
            return sum(int(row['affected_row_count']) for row in rows)
        except sqlite3.Error:
            raise
        except (KeyError, TypeError, ValueError):
            self._broken = True
            raise TursoError('cloud_storage_outcome_unknown') from None

    def execute_batch(self, writes: Iterable[tuple[str, Any]]) -> int:
        """Execute ordered writes in bounded requests within the current transaction."""
        count = 0
        statements = []
        byte_count = 0
        try:
            for sql, parameters in writes:
                if _verb(sql) not in _DML:
                    raise sqlite3.ProgrammingError('execute_batch requires DML statements')
                statement = self._statement(sql, parameters, want_rows=False)
                size = len(json.dumps(statement, ensure_ascii=False).encode('utf-8'))
                if statements and (len(statements) >= 128 or byte_count + size > 1024 * 1024):
                    count += self._execute_batch(statements)
                    statements, byte_count = [], 0
                statements.append(statement)
                byte_count += size
            if statements:
                count += self._execute_batch(statements)
        except BaseException:
            # A later chunk or local producer may fail after earlier writes.
            # Never allow that partial operation to be committed by a caller.
            self._needs_rollback = self.in_transaction
            raise
        return count

    def _sequence(self, sql: str) -> None:
        if self.in_transaction:
            self.commit()
        # A sequence, unlike multiple pipeline execute requests, stops on error.
        # Schema initialization is performed only in an unactivated target.
        self._request({"type": "sequence", "sql": sql})

    def cursor(self) -> TursoCursor:
        return TursoCursor(self)

    def execute(self, sql: str, parameters: Any = ()) -> TursoCursor:
        return self.cursor().execute(sql, parameters)

    def executemany(self, sql: str, parameters: Iterable[Any]) -> TursoCursor:
        return self.cursor().executemany(sql, parameters)

    def executescript(self, sql: str) -> TursoCursor:
        return self.cursor().executescript(sql)

    def commit(self) -> None:
        if self._broken:
            raise TursoError("cloud_storage_outcome_unknown")
        if self.in_transaction:
            self.execute("COMMIT")

    def rollback(self) -> None:
        if self.in_transaction and not self._broken and not self._closed:
            self.execute("ROLLBACK")

    def close(self) -> None:
        if not self._closed and not self._broken and self._baton:
            try:
                self._request({"type": "close"})
            except sqlite3.Error:
                pass
        self._closed = True
        self._token = ""
        if self._session is not None:
            self._session.close()

    def __enter__(self) -> "TursoConnection":
        return self

    def __exit__(self, error_type, error, traceback) -> bool:
        if error_type is not None:
            try:
                self.rollback()
            except sqlite3.Error:
                pass
        else:
            try:
                self.commit()
            except sqlite3.Error:
                try:
                    self.rollback()
                except sqlite3.Error:
                    pass
                raise
        return False
