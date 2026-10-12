#!/usr/bin/env python3
"""Patch ag-ui-langgraph 0.0.41 to keep tool-args chunks that carry finish_reason.

OpenAI sends finish_reason on a separate empty delta, but llama.cpp-style
gateways (llama-swap, llama.cpp server, vLLM backends) attach it to the SAME
chunk as the final args fragment. ag-ui-langgraph drops that chunk wholesale
(`if response_metadata.get('finish_reason'): return`), truncating streamed
tool arguments — generateSandboxedUi widgets then never leave the preview
sandbox. Upstream still had this behavior in 0.0.47, so we patch locally.

Idempotent: re-running is a no-op. Run with the agent venv interpreter:
    uv run --directory apps/agent python ../../scripts/patch-ag-ui-finish-reason.py
"""

from pathlib import Path

import ag_ui_langgraph

TARGET = """            if response_metadata.get('finish_reason', None):
                return
"""

REPLACEMENT = """            # llama.cpp-style gateways attach finish_reason to the SAME
            # chunk as the final tool-args fragment; dropping the chunk
            # truncates streamed tool arguments. Only skip genuinely
            # terminal chunks that carry no further tool data.
            if response_metadata.get('finish_reason', None) and not tool_call_chunks_list:
                return
"""


def main() -> int:
    source = Path(ag_ui_langgraph.__file__).parent / "agent.py"
    text = source.read_text()
    if "not tool_call_chunks_list:\n                return" in text:
        print(f"already patched: {source}")
        return 0
    if TARGET not in text:
        print(f"pattern not found in {source} — check the installed version")
        return 1
    source.write_text(text.replace(TARGET, REPLACEMENT, 1))
    print(f"patched: {source}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
