"""
main.py

FastAPI server for Mini Delivery — Phase 2.

Endpoint:
    POST /generate-map
    Body:  { "lat": float, "lng": float }
    Response: graph JSON consumed by the frontend GraphManager.js

Features:
    - In-memory cache keyed by (lat, lng) rounded to 3 decimal places
    - CORS enabled for all origins (dev convenience)
    - Structured error handling: MapBuildError → 422, unexpected → 500
"""

import logging

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from map_builder import MapBuildError, build_map

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)

# ── FastAPI app ───────────────────────────────────────────────────────────────

app = FastAPI(
    title="Mini Delivery — Map API",
    description=(
        "Generates real-world road-network maps from OpenStreetMap for the "
        "Mini Delivery game. Returns a pixel-normalised graph JSON compatible "
        "with the frontend GraphManager.js."
    ),
    version="2.0.0",
)

# CORS — allow all origins so the React dev server (any port) can call this
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,   # credentials not needed with wildcard origin
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── In-memory cache ───────────────────────────────────────────────────────────
# Key: "lat_3dp,lng_3dp"  (3 decimal places ≈ 111m resolution)
# Value: the full response dict
_cache: dict[str, dict] = {}


# ── Request / Response models ─────────────────────────────────────────────────

class MapRequest(BaseModel):
    lat: float = Field(..., ge=-90.0,  le=90.0,  description="Latitude of map centre")
    lng: float = Field(..., ge=-180.0, le=180.0, description="Longitude of map centre")


# ── Endpoint ──────────────────────────────────────────────────────────────────

@app.post(
    "/generate-map",
    summary="Generate a road-network map",
    response_description="Pixel-normalised graph JSON with nodes, edges, shops and meta",
)
async def generate_map(req: MapRequest) -> dict:
    """
    Download a ~1 km² road network centred on the given coordinates,
    simplify it, fetch nearby shops, and return a pixel-space graph JSON.

    - **First call** for a location: typically 5–15 s (OSM download).
    - **Subsequent calls** with the same location (±0.001°): < 1 s (cached).
    """
    # Normalise cache key
    cache_key = f"{req.lat:.3f},{req.lng:.3f}"

    if cache_key in _cache:
        logger.info("Cache hit for key %s", cache_key)
        return _cache[cache_key]

    logger.info("Cache miss for key %s — building map", cache_key)

    try:
        result = build_map(req.lat, req.lng)
    except MapBuildError as exc:
        logger.warning("MapBuildError for %s: %s", cache_key, exc)
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Unexpected error building map for %s", cache_key)
        raise HTTPException(
            status_code=500,
            detail=(
                f"An unexpected error occurred while building the map: {exc}. "
                "If the problem persists, check server logs."
            ),
        ) from exc

    _cache[cache_key] = result
    logger.info("Map cached for key %s", cache_key)
    return result


# ── Health check ──────────────────────────────────────────────────────────────

@app.get("/health", summary="Health check")
async def health() -> dict:
    """Returns server status and cache statistics."""
    return {
        "status": "ok",
        "cached_maps": len(_cache),
        "cached_keys": list(_cache.keys()),
    }
