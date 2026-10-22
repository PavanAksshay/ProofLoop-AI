from fastapi import FastAPI, HTTPException

from .models import IncidentResponse, IncidentRunRequest
from .orchestrator import run_incident
from .simulator import SUPPORTED_SCENARIOS


app = FastAPI(
    title="ProofLoop AI",
    description="Policy-governed incident resolution with independent recovery verification.",
    version="0.1.0",
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "active_mode": "fallback", "implementation": "synthetic-prototype"}


@app.get("/scenarios")
def scenarios() -> dict:
    return {"scenarios": sorted(SUPPORTED_SCENARIOS), "clients": ["client_a", "client_b"], "modes": ["proofloop"]}


@app.post("/incidents", response_model=IncidentResponse)
def create_incident(request: IncidentRunRequest) -> IncidentResponse:
    try:
        return run_incident(request)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
