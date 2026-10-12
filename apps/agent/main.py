"""
This is the main entry point for the agent.
It defines the workflow graph, state, tools, nodes and edges.
"""

import os
import warnings

from dotenv import load_dotenv
from pydantic import BaseModel
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from copilotkit import CopilotKitMiddleware
from ag_ui_langgraph import add_langgraph_fastapi_endpoint
from deepagents import create_deep_agent

from src.anthropic_compat import ConsecutiveSystemMessagesMiddleware
from src.bounded_memory_saver import BoundedMemorySaver
from src.model import build_model, RequestModelMiddleware, CredentialScopedModel
from src.credentials import (
    CredentialsMiddleware,
    CredentialScopedAgent,
    current_credentials,
    validate_credentials,
    server_credentials_available,
)
from src.thread_store import get_thread_store
from src import multimodal_text_files

multimodal_text_files.apply()
from src.visualization_router import JevVisualizationMiddleware  # noqa: F401  (enabled via JEV_ENABLED=1)
from src.skill_backend import SKILL_SOURCES, build_agent_backend
from src.query import query_data
from src.todos import AgentState, todo_tools
from src.form import generate_form
from src.trip_images import get_trip_stop_images
from src.plan import plan_visualization
from src.prompt import SYSTEM_PROMPT

load_dotenv()

agent = create_deep_agent(
    model=CredentialScopedModel(fallback=build_model(allow_unconfigured=True)),
    tools=[query_data, get_trip_stop_images, plan_visualization, *todo_tools, generate_form],
    middleware=[
        *([JevVisualizationMiddleware()] if os.environ.get("JEV_ENABLED", "").strip().lower() in {"1", "true", "yes"} else []),
        RequestModelMiddleware(),
        CopilotKitMiddleware(),
        ConsecutiveSystemMessagesMiddleware(),
    ],
    context_schema=AgentState,
    skills=SKILL_SOURCES,
    backend=build_agent_backend,
    checkpointer=BoundedMemorySaver(max_threads=200),
    system_prompt=SYSTEM_PROMPT,
)

app = FastAPI()
app.add_middleware(CredentialsMiddleware)


@app.post("/credentials/validate")
async def validate_provider_credentials():
    credentials = current_credentials.get()
    if credentials is None:
        return JSONResponse({"ok": False, "code": "invalid_keys"}, status_code=400)
    return await validate_credentials(credentials)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/credentials/status")
def credentials_status():
    return {"ok": True, "server": server_credentials_available()}



@app.get("/threads")
def list_threads():
    return get_thread_store().list_threads()


@app.get("/threads/{thread_id}")
def get_thread(thread_id: str):
    thread = get_thread_store().get(thread_id)
    if thread is None:
        return JSONResponse({"detail": "not found"}, status_code=404)
    return thread


@app.delete("/threads/{thread_id}")
def delete_thread(thread_id: str):
    if not get_thread_store().delete(thread_id):
        return JSONResponse({"detail": "not found"}, status_code=404)
    return {"ok": True}


class RenameThreadRequest(BaseModel):
    title: str


@app.patch("/threads/{thread_id}")
def rename_thread(thread_id: str, request: RenameThreadRequest):
    title = request.title.strip()
    if not title:
        return JSONResponse({"detail": "title required"}, status_code=400)
    row = get_thread_store().rename(thread_id, title[:200])
    if row is None:
        return JSONResponse({"detail": "not found"}, status_code=404)
    return row


add_langgraph_fastapi_endpoint(
    app=app,
    agent=CredentialScopedAgent(
        name="sample_agent",
        description="Open Generative UI by CopilotKit — answers you can interact with",
        graph=agent,
    ),
    path="/",
)

warnings.filterwarnings("ignore", category=UserWarning, module="pydantic")

if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8123"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
