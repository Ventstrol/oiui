"""Simple server-side chat thread persistence backed by sqlite3."""

import json
import os
import sqlite3
import threading
import time

_AGENT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_DB_PATH = os.path.join(_AGENT_DIR, 'data', 'threads.db')

_schema = (
    'CREATE TABLE IF NOT EXISTS threads ('
    'thread_id TEXT PRIMARY KEY, '
    'title TEXT NOT NULL, '
    'updated_at REAL NOT NULL, '
    'messages_json TEXT NOT NULL)'
)


def _resolve_db_path():
    return os.environ.get('THREADS_DB', '').strip() or DEFAULT_DB_PATH


class ThreadStore:
    def __init__(self, db_path=None):
        self._db_path = db_path or _resolve_db_path()
        parent = os.path.dirname(self._db_path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        self._lock = threading.Lock()
        self._connection = sqlite3.connect(self._db_path, check_same_thread=False)
        with self._lock:
            self._connection.execute(_schema)
            self._connection.commit()

    def upsert(self, thread_id, title, messages):
        payload = json.dumps(list(messages))
        with self._lock:
            self._connection.execute(
                'INSERT INTO threads (thread_id, title, updated_at, messages_json) VALUES (?, ?, ?, ?) '
                'ON CONFLICT(thread_id) DO UPDATE SET title=excluded.title, updated_at=excluded.updated_at, '
                'messages_json=excluded.messages_json',
                (thread_id, title, time.time(), payload),
            )
            self._connection.commit()

    def list_threads(self):
        with self._lock:
            rows = self._connection.execute(
                'SELECT thread_id, title, updated_at, messages_json FROM threads ORDER BY updated_at DESC LIMIT 100'
            ).fetchall()
        return [
            {
                'thread_id': thread_id,
                'title': title,
                'updated_at': updated_at,
                'message_count': len(json.loads(messages_json)),
            }
            for thread_id, title, updated_at, messages_json in rows
        ]

    def get(self, thread_id):
        with self._lock:
            row = self._connection.execute(
                'SELECT thread_id, title, messages_json FROM threads WHERE thread_id = ?', (thread_id,)
            ).fetchone()
        if row is None:
            return None
        return {
            'thread_id': row[0],
            'title': row[1],
            'messages': json.loads(row[2]),
        }

    def delete(self, thread_id):
        with self._lock:
            cursor = self._connection.execute('DELETE FROM threads WHERE thread_id = ?', (thread_id,))
            self._connection.commit()
        return cursor.rowcount > 0


_singleton = None


def get_thread_store():
    global _singleton
    if _singleton is None:
        _singleton = ThreadStore()
    return _singleton
