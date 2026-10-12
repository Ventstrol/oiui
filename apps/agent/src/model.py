"""Chat model factory for the agent."""

import os
from contextlib import contextmanager

from langchain.agents.middleware import AgentMiddleware
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult
from langchain_core.messages import AIMessageChunk
from pydantic import Field
from langchain_anthropic import ChatAnthropic
from langchain_core.language_models.chat_models import BaseChatModel

DEFAULT_MODEL = "chat-latest"

# Widget generation (generateSandboxedUi tool args) routinely needs tens of
# thousands of output tokens; too-small limits truncate args mid-stream and
# the widget is stuck in its preview sandbox. GLM thinking can consume a
# large share of the budget before the tool call starts. The local vLLM
# deployment serves glm53f with max_model_len=262144 and accepts this cap.
MAX_TOKENS = 98304


def build_model(*, allow_unconfigured: bool = False) -> BaseChatModel:
    model_name = os.environ.get("LLM_MODEL", DEFAULT_MODEL).strip()
    is_openai = not model_name.startswith("claude-")
    # GLM-5 style endpoints think unbounded by default, which can burn most of
    # the completion budget before a tool call starts. Cap the effort.
    reasoning_effort = os.environ.get("LLM_REASONING_EFFORT", "high").strip() or None
    key_name = "OPENAI_API_KEY" if is_openai else "ANTHROPIC_API_KEY"
    if not os.environ.get(key_name, "").strip():
        if allow_unconfigured:
            return UnconfiguredModel()
        raise ValueError(
            f"{key_name} is required for the selected LLM_MODEL provider. "
            "Set it in the agent environment and restart the agent."
        )
    if is_openai:
        # Any OpenAI-compatible endpoint works: set OPENAI_BASE_URL
        # (e.g. a local llama-swap/vLLM gateway) and LLM_MODEL to its model id.
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(
            model=model_name,
            base_url=os.environ.get("OPENAI_BASE_URL", "").strip() or None,
            max_tokens=MAX_TOKENS,
            reasoning_effort=reasoning_effort,
        )
    return ChatAnthropic(
        model=model_name,
        max_tokens=MAX_TOKENS,
    )


class UnconfiguredModel(BaseChatModel):
    """Compile a BYOK-only graph without constructing a provider with fake credentials."""

    @property
    def _llm_type(self):
        return "unconfigured"

    def _generate(self, *args, **kwargs):
        raise ValueError("Provider credentials are required. Add OpenAI and Jev keys.")

    def bind_tools(self, tools, **kwargs):
        return self


def request_model(fallback):
    from src.credentials import current_credentials
    credentials = current_credentials.get()
    if credentials is None:
        return fallback
    from langchain_openai import ChatOpenAI
    from openai import AsyncOpenAI, OpenAI, DefaultAsyncHttpxClient, DefaultHttpxClient

    # SDK None defaults inherit server organization/project settings. Explicit
    # clients with empty scopes and isolated transports prevent that inheritance,
    # including server HTTP(S)_PROXY and OPENAI_PROXY settings.
    options = {
        "api_key": credentials.openai,
        "base_url": "https://api.openai.com/v1",
        "organization": "",
        "project": "",
    }
    sync_client = OpenAI(**options, http_client=DefaultHttpxClient(trust_env=False))
    async_client = AsyncOpenAI(
        **options, http_client=DefaultAsyncHttpxClient(trust_env=False)
    )
    # After construction, None omits these headers without rereading env vars.
    for client in (sync_client, async_client):
        client.organization = None
        client.project = None
        client.admin_api_key = None
        client.webhook_secret = None
        # The SDK merges OPENAI_CUSTOM_HEADERS even with default_headers={}.
        # Clear that merge before any request so host Authorization cannot win.
        client._custom_headers = {}
    model = ChatOpenAI(
        model=DEFAULT_MODEL,
        api_key=credentials.openai,
        base_url=options["base_url"],
        openai_proxy="",
        root_client=sync_client,
        client=sync_client.chat.completions,
        root_async_client=async_client,
        async_client=async_client.chat.completions,
    )
    # LangChain's metadata field separately inherits organization environment
    # values even when prebuilt SDK clients are supplied. Clear the inert field.
    model.openai_organization = None
    return model


@contextmanager
def provider_error_boundary():
    from src.credentials import current_credentials
    try:
        yield
    except Exception:
        if current_credentials.get() is None:
            raise
        raise ValueError("OpenAI request failed. Check your key and model access, or retry.") from None


class RequestModelMiddleware(AgentMiddleware):
    def wrap_model_call(self, request, handler):
        with provider_error_boundary():
            return handler(request.override(model=request_model(request.model)))

    async def awrap_model_call(self, request, handler):
        with provider_error_boundary():
            return await handler(request.override(model=request_model(request.model)))


class CredentialScopedModel(BaseChatModel):
    """Route DeepAgents' internal summary/subagent model calls through BYOK too.

    A transparent delegate, not a call-time wrapper: the public API resolves
    the inner model via request_model() and calls it directly. Wrapping (the
    previous _astream/_stream approach) re-emits every streamed chunk through
    both the inner and outer runs, which duplicates AG-UI TOOL_CALL_START and
    TEXT_MESSAGE_CONTENT events on the wire and corrupts streamed tool args.
    """

    fallback: BaseChatModel = Field(exclude=True)

    @property
    def _llm_type(self):
        return "credential-scoped"

    def _resolved(self) -> BaseChatModel:
        return request_model(self.fallback)

    def bind(self, *args, **kwargs):
        return self._resolved().bind(*args, **kwargs)

    def bind_tools(self, tools, **kwargs):
        return self._resolved().bind_tools(tools, **kwargs)

    def invoke(self, *args, **kwargs):
        with provider_error_boundary():
            return self._resolved().invoke(*args, **kwargs)

    async def ainvoke(self, *args, **kwargs):
        with provider_error_boundary():
            return await self._resolved().ainvoke(*args, **kwargs)

    def stream(self, *args, **kwargs):
        return self._stream_inner(self._resolved().stream(*args, **kwargs))

    async def astream(self, *args, **kwargs):
        with provider_error_boundary():
            async for chunk in self._resolved().astream(*args, **kwargs):
                yield chunk

    def _stream_inner(self, inner):
        with provider_error_boundary():
            yield from inner

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        with provider_error_boundary():
            message = self._resolved().invoke(messages, stop=stop, **kwargs)
            return ChatResult(generations=[ChatGeneration(message=message)])
