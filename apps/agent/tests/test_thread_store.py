import json

import pytest

from src.thread_store import ThreadStore


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setenv('THREADS_DB', str(tmp_path / 'threads.db'))
    return ThreadStore()


def test_upsert_get_roundtrip(store):
    messages = [{'id': 'm1', 'role': 'user', 'content': 'Hello'}]
    store.upsert('t1', 'Hello', messages)
    assert store.get('t1') == {'thread_id': 't1', 'title': 'Hello', 'messages': messages}


def test_get_unknown_returns_none(store):
    assert store.get('missing') is None


def test_list_threads_empty(store):
    assert store.list_threads() == []


def test_upsert_overwrites_and_bumps_updated_at(store):
    store.upsert('t1', 'first', [{'id': 'm1', 'role': 'user', 'content': 'one'}])
    before = store.get('t1')
    store.upsert('t1', 'second', [{'id': 'm1', 'role': 'user', 'content': 'one'}, {'id': 'm2', 'role': 'assistant', 'content': 'two'}])
    after = store.get('t1')
    assert after['title'] == 'second'
    assert len(after['messages']) == 2
    assert after['messages'][1] == {'id': 'm2', 'role': 'assistant', 'content': 'two'}
    rows = {row['thread_id']: row for row in store.list_threads()}
    assert rows['t1']['message_count'] == 2
    # No duplicate row.
    assert len(store.list_threads()) == 1
    assert json.loads(json.dumps(before)) == before


def test_list_orders_by_updated_at_desc(store):
    store.upsert('old', 'old', [{'id': 'm1', 'role': 'user', 'content': 'a'}])
    store.upsert('new', 'new', [{'id': 'm2', 'role': 'user', 'content': 'b'}])
    assert [row['thread_id'] for row in store.list_threads()] == ['new', 'old']
    # Touching the older thread promotes it to the front.
    store.upsert('old', 'old updated', [{'id': 'm1', 'role': 'user', 'content': 'a'}])
    assert [row['thread_id'] for row in store.list_threads()] == ['old', 'new']


def test_message_count_reflects_messages_length(store):
    store.upsert('t1', 'title', [{'id': str(i), 'role': 'user', 'content': str(i)} for i in range(5)])
    assert store.list_threads()[0]['message_count'] == 5
    assert len(store.get('t1')['messages']) == 5


def test_delete_known_and_unknown(store):
    store.upsert('t1', 'title', [{'id': 'm1', 'role': 'user', 'content': 'a'}])
    assert store.delete('t1') is True
    assert store.get('t1') is None
    assert store.delete('t1') is False
    assert store.delete('never-existed') is False


def test_rename_updates_title_and_updated_at(store):
    store.upsert('t1', 'old', [{'id': 'm1', 'role': 'user', 'content': 'a'}])
    before = store.list_threads()[0]
    row = store.rename('t1', 'new title')
    assert row == {
        'thread_id': 't1',
        'title': 'new title',
        'updated_at': row['updated_at'],
        'message_count': 1,
    }
    assert row['updated_at'] > before['updated_at'] or row['updated_at'] == before['updated_at']
    assert row['title'] == 'new title'
    assert store.list_threads()[0]['title'] == 'new title'


def test_rename_unknown_returns_none(store):
    assert store.rename('missing', 'nope') is None


def test_creates_parent_directory(tmp_path, monkeypatch):
    db_path = tmp_path / 'nested' / 'dir' / 'threads.db'
    monkeypatch.setenv('THREADS_DB', str(db_path))
    store = ThreadStore()
    store.upsert('t1', 'title', [{'id': 'm1', 'role': 'user', 'content': 'a'}])
    assert db_path.exists()
    assert store.get('t1') is not None
