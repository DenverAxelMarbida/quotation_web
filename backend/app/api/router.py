"""Aggregated API router.

Route modules stay small and independent; this is the single place that decides
which routers the application exposes.
"""

from fastapi import APIRouter

from app.api import quotations, system

api_router = APIRouter()
api_router.include_router(system.router)
api_router.include_router(quotations.router)
