import asyncio
from types import SimpleNamespace

import httpx
import pytest

import src.thread_store as thread_store_module
from src.credentials import _capture_snapshot
from src.thread_store import ThreadStore


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setenv('THREADS_DB', str(tmp_path / 'threads.db'))
    store = ThreadStore()
    import main
    monkeypatch.setattr(main, 'get_thread_store', lambda: store)
    monkeypatch.setattr(thread_store_module, '_singleton', None)
    return store


def open_client():
    from main import app
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test')


def test_get_threads_empty(store):
    async def exercise():
        async with open_client() as client:
            response = await client.get('/threads')
        assert response.status_code == 200
        assert response.json() == []
    asyncio.run(exercise())


def test_get_threads_after_upsert(store):
    store.upsert('t1', 'Hello', [{'id': 'm1', 'role': 'user', 'content': 'Hello'}])
    async def exercise():
        async with open_client() as client:
            response = await client.get('/threads')
        assert response.status_code == 200
        rows = response.json()
        assert len(rows) == 1
        row = rows[0]
        assert row['thread_id'] == 't1'
        assert row['title'] == 'Hello'
        assert row['message_count'] == 1
        assert isinstance(row['updated_at'], float)
    asyncio.run(exercise())


def test_get_unknown_thread_is_404(store):
    async def exercise():
        async with open_client() as client:
            response = await client.get('/threads/nope')
        assert response.status_code == 404
        assert response.json() == {'detail': 'not found'}
    asyncio.run(exercise())


def test_delete_roundtrip(store):
    store.upsert('t1', 'Hello', [{'id': 'm1', 'role': 'user', 'content': 'Hello'}])
    async def exercise():
        async with open_client() as client:
            deleted = await client.delete('/threads/t1')
            assert deleted.status_code == 200
            assert deleted.json() == {'ok': True}
            assert store.get('t1') is None
            again = await client.delete('/threads/t1')
            assert again.status_code == 404
    asyncio.run(exercise())


def test_capture_snapshot_from_dict_event(store):
    input = SimpleNamespace(threadId='visitor-thread')
    event = {
        'type': 'MESSAGES_SNAPSHOT',
        'messages': [
            {'id': 'm1', 'role': 'user', 'content': 'First user question'},
            {'id': 'm2', 'role': 'assistant', 'content': 'Answer'},
        ],
    }
    _capture_snapshot(input, event)
    assert store.get('visitor-thread') == {
        'thread_id': 'visitor-thread',
        'title': 'First user question',
        'messages': event['messages'],
    }


def test_capture_snapshot_from_data_string_event(store):
    input = SimpleNamespace(threadId='visitor-thread')
    messages = [{'id': 'm1', 'role': 'user', 'content': 'Hello there'}]
    event = "data: " + __import__('json').dumps({'type': 'MESSAGES_SNAPSHOT', 'messages': messages}) + "\n\n"
    _capture_snapshot(input, event)
    assert store.get('visitor-thread')['title'] == 'Hello there'
    assert store.get('visitor-thread')['messages'] == messages


def test_capture_snapshot_ignores_other_event_types_and_malformed_payloads(store):
    input = SimpleNamespace(threadId='visitor-thread')
    _capture_snapshot(input, {'type': 'TEXT_MESSAGE_CONTENT', 'delta': 'hi'})
    _capture_snapshot(input, 'data: not-json-at-all')
    _capture_snapshot(input, 'data: [broken')
    _capture_snapshot(input, 'completely unrelated string')
    assert store.list_threads() == []


def test_capture_snapshot_requires_thread_id(store):
    _capture_snapshot(SimpleNamespace(), {'type': 'MESSAGES_SNAPSHOT', 'messages': [{'id': 'm1', 'role': 'user', 'content': 'x'}]})
    assert store.list_threads() == []


def test_patch_thread_renames(store):
    store.upsert('t1', 'Hello', [{'id': 'm1', 'role': 'user', 'content': 'Hello'}])
    async def exercise():
        async with open_client() as client:
            response = await client.patch('/threads/t1', json={'title': 'Renamed'})
            assert response.status_code == 200
            row = response.json()
            assert row['thread_id'] == 't1'
            assert row['title'] == 'Renamed'
            assert row['message_count'] == 1
            assert isinstance(row['updated_at'], float)
            rows = (await client.get('/threads')).json()
            assert rows[0]['title'] == 'Renamed'
    asyncio.run(exercise())


def test_patch_unknown_thread_is_404(store):
    async def exercise():
        async with open_client() as client:
            response = await client.patch('/threads/nope', json={'title': 'X'})
        assert response.status_code == 404
        assert response.json() == {'detail': 'not found'}
    asyncio.run(exercise())


def test_patch_empty_title_is_400(store):
    store.upsert('t1', 'Hello', [{'id': 'm1', 'role': 'user', 'content': 'Hello'}])
    async def exercise():
        async with open_client() as client:
            response = await client.patch('/threads/t1', json={'title': ''})
        assert response.status_code == 400
        assert response.json() == {'detail': 'title required'}
    asyncio.run(exercise())


def test_patch_whitespace_title_is_400(store):
    store.upsert('t1', 'Hello', [{'id': 'm1', 'role': 'user', 'content': 'Hello'}])
    async def exercise():
        async with open_client() as client:
            response = await client.patch('/threads/t1', json={'title': '   '})
        assert response.status_code == 400
        assert response.json() == {'detail': 'title required'}
    asyncio.run(exercise())
