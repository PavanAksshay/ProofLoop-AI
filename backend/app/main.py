from fastapi import FastAPI, HTTPException

from .models import ApprovalDecisionRequest, IncidentResponse, IncidentRunRequest
from .orchestrator import decide_approval, get_incident, run_incident
from .simulator import SUPPORTED_SCENARIOS


app = FastAPI(
    title="ProofLoop AI",
    description="Policy-governed incident resolution with independent recovery verification.",
    version="0.2.0",
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


@app.get("/incidents/{incident_id}", response_model=IncidentResponse)
def read_incident(incident_id: str) -> IncidentResponse:
    response = get_incident(incident_id)
    if response is None:
        raise HTTPException(status_code=404, detail="Incident not found.")
    return response


@app.post("/incidents/{incident_id}/approval", response_model=IncidentResponse)
def submit_approval(incident_id: str, request: ApprovalDecisionRequest) -> IncidentResponse:
    try:
        return decide_approval(incident_id, request)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
