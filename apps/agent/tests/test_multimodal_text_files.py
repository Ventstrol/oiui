"""Tests for textual document inlining in multimodal messages."""

import base64

import pytest

from src import multimodal_text_files
from ag_ui.core.types import DocumentInputContent, ImageInputContent, InputContentDataSource, TextInputContent


@pytest.fixture
def convert():
    from ag_ui_langgraph import utils as agui_utils

    original = agui_utils.convert_agui_multimodal_to_langchain
    multimodal_text_files._original_convert = None
    multimodal_text_files.apply()
    try:
        yield agui_utils.convert_agui_multimodal_to_langchain
    finally:
        agui_utils.convert_agui_multimodal_to_langchain = original
        multimodal_text_files._original_convert = None


def _document(filename: str, mime: str, body: str) -> DocumentInputContent:
    return DocumentInputContent(
        source=InputContentDataSource(value=base64.b64encode(body.encode()).decode(), mime_type=mime),
        metadata={"filename": filename},
    )


def test_excalidraw_document_becomes_text_block(convert):
    body = '{"type":"excalidraw","elements":[{"type":"rectangle"}]}'
    blocks = convert([_document("sketch.excalidraw", "application/octet-stream", body)])
    assert len(blocks) == 1
    assert blocks[0]["type"] == "text"
    assert 'Attached file: "sketch.excalidraw"' in blocks[0]["text"]
    assert '"type":"rectangle"' in blocks[0]["text"]


def test_json_document_becomes_text_block(convert):
    blocks = convert([_document("data.json", "application/json", '{"a": 1}')])
    assert blocks[0]["type"] == "text"
    assert '"a": 1' in blocks[0]["text"]


def test_image_part_untouched(convert):
    image = ImageInputContent(source=InputContentDataSource(value="aGk=", mime_type="image/png"))
    blocks = convert([image])
    assert blocks[0]["type"] == "image_url"
    assert blocks[0]["image_url"]["url"].startswith("data:image/png;base64,")


def test_binary_document_keeps_existing_behavior(convert):
    blocks = convert([_document("report.pdf", "application/pdf", "%PDF-1.4")])
    assert blocks[0]["type"] == "image_url"


def test_url_source_text_document_inlined_verbatim(convert):
    from ag_ui.core.types import InputContentUrlSource

    item = DocumentInputContent(source=InputContentUrlSource(value="http://x/f.md"), metadata={"filename": "f.md"})
    blocks = convert([item])
    assert blocks[0]["type"] == "text"
    assert "http://x/f.md" in blocks[0]["text"]


def test_oversized_document_truncated(convert):
    blocks = convert([_document("big.txt", "text/plain", "x" * 300_000)])
    assert len(blocks[0]["text"]) < multimodal_text_files.MAX_INLINE_CHARS + 200
    assert "truncated" in blocks[0]["text"]
