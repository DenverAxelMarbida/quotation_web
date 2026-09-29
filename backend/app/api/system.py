"""System routes."""

from fastapi import APIRouter
from pydantic import BaseModel

from app.version import API_VERSION

router = APIRouter(tags=["system"])


class HealthResponse(BaseModel):
    status: str
    version: str


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Liveness probe used by the frontend and by hosting provider health checks."""
    return HealthResponse(status="ok", version=API_VERSION)
