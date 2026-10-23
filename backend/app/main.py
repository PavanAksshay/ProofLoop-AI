import asyncio
import json
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4

# Ensure repository root is on sys.path for benchmark runner
repo_root = Path(__file__).resolve().parent.parent.parent
if str(repo_root) not in sys.path:
    sys.path.insert(0, str(repo_root))

from fastapi import BackgroundTasks, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .models import (
    ApprovalDecisionRequest,
    BenchmarkRunRequest,
    IncidentResponse,
    IncidentRunRequest,
    Outcome,
    TERMINAL_OUTCOMES,
)
from .orchestrator import decide_approval, get_incident, run_incident
from .llm_investigator import configured_mode
from .simulator import SUPPORTED_SCENARIOS
from .store import (
    create_incident,
    events_after,
    get_benchmark,
    get_incident_response,
    incident_exists,
    initialize_store,
    list_incidents,
    save_benchmark,
    update_benchmark,
)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Initialize persistence and recover interrupted approval claims on startup."""
    initialize_store()
    from .store import recover_interrupted_approval_claims

    recover_interrupted_approval_claims()
    yield


app = FastAPI(
    title="ProofLoop AI",
    description="Policy-governed incident resolution with independent recovery verification.",
    version="0.3.0",
    lifespan=lifespan,
)

cors_origins_env = os.getenv(
    "PROOFLOOP_CORS_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173",
)
allowed_origins = [origin.strip() for origin in cors_origins_env.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "configured_mode": configured_mode(), "implementation": "synthetic-prototype"}


@app.get("/scenarios")
def scenarios() -> dict:
    return {"scenarios": sorted(SUPPORTED_SCENARIOS), "clients": ["client_a", "client_b"], "modes": ["proofloop"]}


@app.post("/incidents", response_model=IncidentResponse)
def create_incident_sync(request: IncidentRunRequest) -> IncidentResponse:
    """Synchronous endpoint retained for direct tests and simple debugging."""
    try:
        return run_incident(request)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _run_background(incident_id: str, request: IncidentRunRequest) -> None:
    try:
        run_incident(request, incident_id=incident_id)
    except Exception as exc:
        from .models import Actor, Event
        from .store import append_event, update_incident_status
        event = Event(
            incident_id=incident_id,
            type="worker_error",
            actor=Actor.SYSTEM,
            payload={"error_type": type(exc).__name__, "message": "Incident worker failed; inspect server logs for details."},
        )
        append_event(event)
        update_incident_status(incident_id, Outcome.ESCALATED, "Incident worker failed; incident escalated.")


@app.post("/incidents/start", status_code=202)
def start_incident(request: IncidentRunRequest, background_tasks: BackgroundTasks) -> dict:
    if request.scenario not in SUPPORTED_SCENARIOS:
        raise HTTPException(status_code=422, detail=f"Unsupported scenario: {request.scenario}")
    incident_id = str(uuid4())
    create_incident(incident_id, request.scenario, request.client, Outcome.RUNNING, "Incident queued.")
    background_tasks.add_task(_run_background, incident_id, request)
    return {
        "incident_id": incident_id,
        "outcome": Outcome.RUNNING.value,
        "events_url": f"/incidents/{incident_id}/events",
        "incident_url": f"/incidents/{incident_id}",
    }


@app.get("/incidents",)
def incidents(limit: int = Query(default=50, ge=1, le=200)) -> dict:
    return {"incidents": list_incidents(limit)}


@app.get("/incidents/{incident_id}", response_model=IncidentResponse)
def read_incident(incident_id: str) -> IncidentResponse:
    response = get_incident_response(incident_id)
    if response is None:
        response = get_incident(incident_id)
    if response is None:
        raise HTTPException(status_code=404, detail="Incident not found.")
    return response


@app.get("/incidents/{incident_id}/events")
async def stream_incident_events(
    request: Request,
    incident_id: str,
    after: int = Query(default=0, ge=0),
) -> StreamingResponse:
    if not incident_exists(incident_id):
        raise HTTPException(status_code=404, detail="Incident not found.")

    terminal_values = {outcome.value for outcome in TERMINAL_OUTCOMES}

    async def event_stream():
        cursor = after
        idle_polls = 0
        try:
            while True:
                if await request.is_disconnected():
                    break
                batch = events_after(incident_id, cursor)
                for item in batch:
                    cursor = item["sequence"]
                    yield f"id: {cursor}\nevent: {item['type']}\ndata: {json.dumps(item, separators=(',', ':'))}\n\n"
                incident = get_incident_response(incident_id)
                if incident and incident.outcome.value in terminal_values and not events_after(incident_id, cursor):
                    break
                idle_polls += 1
                if idle_polls % 10 == 0:
                    yield ": keep-alive\n\n"
                await asyncio.sleep(0.25)
        except asyncio.CancelledError:
            return

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/incidents/{incident_id}/approval", response_model=IncidentResponse)
def submit_approval(incident_id: str, request: ApprovalDecisionRequest) -> IncidentResponse:
    try:
        response = decide_approval(incident_id, request)
        # The approval handler and event store share the same event IDs, so
        # the event log remains append-only and duplicate inserts are ignored.
        from .store import append_event, update_incident_status
        for event in response.events:
            append_event(event)
        update_incident_status(incident_id, response.outcome, response.summary)
        return response
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


def _run_benchmark_background(run_id: str, request: BenchmarkRunRequest) -> None:
    try:
        from benchmark.runner import run_benchmark

        result = run_benchmark(
            scenarios=request.scenarios,
            client=request.client,
            trials=request.trials,
            seed=request.seed,
            run_id=run_id,
        )
        update_benchmark(run_id, status="completed", result=result)
    except Exception as exc:
        update_benchmark(run_id, status="failed", error="Benchmark worker encountered an unexpected error.")


@app.post("/benchmark", status_code=202)
def start_benchmark_endpoint(
    request: BenchmarkRunRequest,
    background_tasks: BackgroundTasks,
    sync: bool = Query(default=False, description="Run synchronously for tests or immediate response"),
) -> dict:
    run_id = f"bench-{uuid4().hex[:12]}"
    params = request.model_dump()
    save_benchmark(run_id, status="running", params=params)

    if sync:
        from benchmark.runner import run_benchmark

        try:
            result = run_benchmark(
                scenarios=request.scenarios,
                client=request.client,
                trials=request.trials,
                seed=request.seed,
                run_id=run_id,
            )
            update_benchmark(run_id, status="completed", result=result)
            return {
                "run_id": run_id,
                "status": "completed",
                "benchmark_url": f"/benchmark/{run_id}",
                "result": result,
            }
        except Exception as exc:
            update_benchmark(run_id, status="failed", error="Benchmark execution failed.")
            raise HTTPException(status_code=500, detail="Benchmark execution failed.") from exc

    background_tasks.add_task(_run_benchmark_background, run_id, request)
    return {
        "run_id": run_id,
        "status": "running",
        "benchmark_url": f"/benchmark/{run_id}",
    }


@app.get("/benchmark/{run_id}")
def get_benchmark_endpoint(run_id: str) -> dict:
    record = get_benchmark(run_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Benchmark run not found.")
    return record

