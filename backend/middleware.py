"""Middleware for CADE backend."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.config import get_config


def setup_cors(app: FastAPI) -> None:
    """Configure CORS middleware for the FastAPI app.

    Allows browser-based remote access when CORS origins are configured.
    If no origins are configured, allows all origins for backward compatibility.
    """
    config = get_config()

    # Default to allowing all origins if none specified
    # This maintains backward compatibility with local development
    allowed_origins = config.cors_origins if config.cors_origins else ["*"]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
