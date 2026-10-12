"""Inline textual document attachments as text blocks instead of image_url.

ag_ui_langgraph routes every media part (documents included) through
LangChain's ``image_url`` block, which only works for images on vision
endpoints. Text-shaped files (.excalidraw, .json, .md, code, ...) attached
from the chat UI would otherwise be dropped or rejected by the model.
This patch converts textual DocumentInputContent parts to plain text blocks
before the standard conversion runs; binary documents keep existing behavior.
"""

import base64
import logging
import os

from ag_ui.core.types import DocumentInputContent, TextInputContent

logger = logging.getLogger(__name__)

TEXTUAL_MIME_TYPES = {
    "application/json",
    "application/xml",
    "application/yaml",
    "application/x-yaml",
    "application/javascript",
    "application/typescript",
    "application/toml",
    "application/x-sh",
}
TEXTUAL_EXTENSIONS = {
    ".excalidraw",
    ".json",
    ".jsonl",
    ".md",
    ".markdown",
    ".txt",
    ".csv",
    ".tsv",
    ".yaml",
    ".yml",
    ".xml",
    ".html",
    ".svg",
    ".toml",
    ".ini",
    ".cfg",
    ".sh",
    ".py",
    ".js",
    ".mjs",
    ".ts",
    ".tsx",
    ".jsx",
    ".css",
    ".sql",
    ".rs",
    ".go",
    ".java",
    ".rb",
    ".php",
}
MAX_INLINE_CHARS = 200_000


def _source_value(item: DocumentInputContent) -> str | None:
    source = getattr(item, "source", None)
    if source is None:
        return None
    kind = getattr(source, "type", None)
    if kind == "data":
        try:
            return base64.b64decode(source.value).decode("utf-8", errors="replace")
        except Exception:
            return None
    if kind == "url":
        return source.value
    return None


def _filename(item: DocumentInputContent) -> str:
    metadata = item.metadata if isinstance(item.metadata, dict) else {}
    return str(metadata.get("filename") or "attached file")


def _is_textual(item: DocumentInputContent) -> bool:
    mime = str(getattr(getattr(item, "source", None), "mime_type", "") or "").lower()
    if mime in TEXTUAL_MIME_TYPES or mime.startswith("text/"):
        return True
    filename = _filename(item).lower()
    return os.path.splitext(filename)[1] in TEXTUAL_EXTENSIONS


def _text_block(item: DocumentInputContent) -> TextInputContent | None:
    value = _source_value(item)
    if value is None:
        return None
    filename = _filename(item)
    if len(value) > MAX_INLINE_CHARS:
        value = value[:MAX_INLINE_CHARS] + "\n... (truncated)"
    # Four-backtick fence tolerates triple backticks inside the file body.
    text = f'[Attached file: "{filename}"]\n\n````\n{value}\n````'
    return TextInputContent(text=text)


def inline_textual_documents(content):
    """Map textual document parts to text blocks; pass everything else through."""
    mapped = []
    for item in content:
        if isinstance(item, DocumentInputContent) and _is_textual(item):
            block = _text_block(item)
            if block is not None:
                mapped.append(block)
                continue
            logger.warning("Dropping textual document %r: source could not be decoded", _filename(item))
        mapped.append(item)
    return mapped


_original_convert = None


def apply() -> None:
    """Wrap ag_ui_langgraph's converter; idempotent."""
    global _original_convert
    from ag_ui_langgraph import utils as agui_utils

    if _original_convert is not None:
        return
    _original_convert = agui_utils.convert_agui_multimodal_to_langchain

    def convert(content):
        return _original_convert(inline_textual_documents(list(content)))

    agui_utils.convert_agui_multimodal_to_langchain = convert
