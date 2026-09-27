"""API routes.

Only the health route exists at this stage. Business endpoints
(upload/parse, preview, Excel generation) are added in later phases.
"""

from fastapi import APIRouter
from pydantic import BaseModel

from app.version import API_VERSION

router = APIRouter(tags=["system"])


class HealthResponse(BaseModel):
    status: str
    version: str


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Liveness probe used by the frontend and by CI/deployment health checks."""
    return HealthResponse(status="ok", version=API_VERSION)
