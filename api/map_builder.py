"""
map_builder.py

All OSMnx logic: graph download, simplification, coordinate normalization,
POI fetching, and JSON assembly.

The output dict is consumed directly by the frontend's GraphManager.js
without any transformation.
"""

import logging
import math
import random

import networkx as nx
import osmnx as ox

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

# Radius in metres — equivalent bounding diagonal of a ~1 km² square
GRAPH_RADIUS_M = 565

# OSM tags for points of interest (shops/amenities)
SHOP_TAGS = {
    "amenity": ["bakery", "convenience", "supermarket", "grocery", "marketplace"],
    "shop": ["convenience", "supermarket", "greengrocer", "bakery"],
}

MAX_SHOPS = 15
MIN_SYNTHETIC_SHOPS = 4
MAX_SYNTHETIC_SHOPS = 8

CANVAS_SIZE = 1000   # pixel coordinate space: 0..1000
CANVAS_CENTER = CANVAS_SIZE / 2   # 500
CANVAS_PADDING = 50  # keep nodes ≥50px from the canvas edge → usable 900×900

# Approximate metres per degree of latitude (constant)
M_PER_DEG_LAT = 111_320.0

NODE_LIMIT_WARN = 300


# ── Custom exception ──────────────────────────────────────────────────────────

class MapBuildError(Exception):
    """Raised when the map cannot be built for the given coordinates."""


# ── Public API ────────────────────────────────────────────────────────────────

def build_map(lat: float, lng: float) -> dict:
    """
    Full pipeline: download → simplify → fetch shops → normalise → assemble.

    Returns a dict ready to be serialised as JSON and consumed by
    the frontend GraphManager.js.

    Raises MapBuildError for expected failures (no data, empty graph, …).
    """
    logger.info("Building map for (%.4f, %.4f)", lat, lng)

    # 1. Download road network
    G = _download_graph(lat, lng)

    # 2. Simplify
    G = _simplify_graph(G)

    # 3. Extract node/edge geo data while we still have OSM coordinates
    nodes_geo, edges_geo = _extract_geo(G)

    # 4. Compute bounding box from raw node coordinates
    lats = [d["lat"] for d in nodes_geo.values()]
    lngs = [d["lng"] for d in nodes_geo.values()]
    bbox = {
        "min_lat": min(lats), "max_lat": max(lats),
        "min_lng": min(lngs), "max_lng": max(lngs),
    }

    # 5. Fetch shops (using OSM bbox)
    shops_raw = _fetch_shops(lat, lng, bbox)

    # 6. Normalise everything to pixel space
    scale_x, scale_y = _compute_scale(lat, bbox)
    nodes_px = _normalise_nodes(nodes_geo, lat, lng, scale_x, scale_y)
    edges_px  = _normalise_edges(edges_geo, nodes_px)
    shops_px  = _normalise_shops(shops_raw, lat, lng, scale_x, scale_y, nodes_px)

    # 7. Assemble and return
    return _build_response(nodes_px, edges_px, shops_px, lat, lng)


# ── Step 1: Download ──────────────────────────────────────────────────────────

def _download_graph(lat: float, lng: float) -> nx.MultiDiGraph:
    try:
        G = ox.graph_from_point(
            (lat, lng),
            dist=GRAPH_RADIUS_M,
            network_type="drive",
            simplify=False,   # we simplify ourselves in step 2
        )
    except Exception as exc:
        raise MapBuildError(
            f"No road network found at ({lat:.4f}, {lng:.4f}). "
            "Check that the coordinates are on land and have driveable roads."
        ) from exc

    if len(G.nodes) == 0:
        raise MapBuildError(
            f"The road network at ({lat:.4f}, {lng:.4f}) is empty."
        )

    # Keep only the largest weakly-connected component to avoid isolated fragments
    components = list(nx.weakly_connected_components(G))
    if len(components) > 1:
        largest = max(components, key=len)
        G = G.subgraph(largest).copy()
        logger.debug(
            "Kept largest component: %d/%d nodes",
            len(G.nodes), sum(len(c) for c in components),
        )

    logger.info("Downloaded graph: %d nodes, %d edges", len(G.nodes), len(G.edges))
    return G


# ── Step 2: Simplify ──────────────────────────────────────────────────────────

def _simplify_graph(G: nx.MultiDiGraph) -> nx.MultiDiGraph:
    before = len(G.nodes)
    G = ox.simplify_graph(G)
    after = len(G.nodes)
    logger.info("Simplified graph: %d → %d nodes", before, after)

    if after > NODE_LIMIT_WARN:
        logger.warning(
            "Graph has %d nodes (>%d). Performance may be affected.",
            after, NODE_LIMIT_WARN,
        )

    if after == 0:
        raise MapBuildError("Graph is empty after simplification.")

    return G


# ── Step 3: Extract geo data ──────────────────────────────────────────────────

def _extract_geo(G: nx.MultiDiGraph) -> tuple[dict, list]:
    """
    Pull lat/lng and geometry from the NetworkX graph.

    Returns:
        nodes_geo: {osmid: {"lat": float, "lng": float}}
        edges_geo: [{"from_osmid": int, "to_osmid": int, "geometry": [(lat,lng),…]}]
    """
    nodes_geo: dict[int, dict] = {}
    for osmid, data in G.nodes(data=True):
        nodes_geo[osmid] = {
            "lat": float(data["y"]),   # OSMnx stores lat as "y"
            "lng": float(data["x"]),   # OSMnx stores lng as "x"
        }

    # For MultiDiGraph each edge may appear in both directions (u→v and v→u).
    # We de-duplicate by only keeping (min_id, max_id) pairs so the frontend
    # _buildAdjacency receives each street exactly once and adds both directions.
    seen_pairs: set[tuple[int, int]] = set()
    edges_geo: list[dict] = []

    for u, v, data in G.edges(data=True):
        key = (min(u, v), max(u, v))
        if key in seen_pairs:
            continue
        seen_pairs.add(key)

        # Intermediate geometry points from OSMnx (if the road is not straight)
        geo_points: list[tuple[float, float]] = []  # (lat, lng) ordered u→v
        if "geometry" in data:
            # Shapely LineString: coords are (lng, lat)
            for lng_pt, lat_pt in data["geometry"].coords:
                geo_points.append((float(lat_pt), float(lng_pt)))
        else:
            # Straight segment — just the two endpoints
            geo_points = [
                (nodes_geo[u]["lat"], nodes_geo[u]["lng"]),
                (nodes_geo[v]["lat"], nodes_geo[v]["lng"]),
            ]

        # Ensure the geometry starts at u and ends at v
        if geo_points and geo_points[0] != (nodes_geo[u]["lat"], nodes_geo[u]["lng"]):
            geo_points = list(reversed(geo_points))

        edges_geo.append({
            "from_osmid": u,
            "to_osmid": v,
            "geometry": geo_points,
        })

    return nodes_geo, edges_geo


# ── Step 4: Fetch shops ───────────────────────────────────────────────────────

def _fetch_shops(lat: float, lng: float, bbox: dict) -> list[dict]:
    """
    Download POIs from OpenStreetMap using the graph's bounding box.
    Falls back to synthetic shops if none are found.

    Returns list of {"name": str, "lat": float, "lng": float}.
    """
    shops: list[dict] = []

    try:
        # OSMnx 2.0 bbox format: (west, south, east, north) = (min_lng, min_lat, max_lng, max_lat)
        gdf = ox.features_from_bbox(
            bbox=(bbox["min_lng"], bbox["min_lat"], bbox["max_lng"], bbox["max_lat"]),
            tags=SHOP_TAGS,
        )
        for _, row in gdf.iterrows():
            try:
                centroid = row.geometry.centroid
                name = (
                    row.get("name")
                    or row.get("amenity")
                    or row.get("shop")
                    or "Shop"
                )
                shops.append({
                    "name": str(name).title(),
                    "lat": float(centroid.y),
                    "lng": float(centroid.x),
                })
            except Exception:
                continue  # skip malformed entries silently

        logger.info("Fetched %d real shops from OSM", len(shops))
    except Exception as exc:
        logger.warning("Could not fetch shops from OSM: %s", exc)

    # Cap at MAX_SHOPS (prefer centrally-located ones)
    if len(shops) > MAX_SHOPS:
        shops.sort(
            key=lambda s: (s["lat"] - lat) ** 2 + (s["lng"] - lng) ** 2
        )
        shops = shops[:MAX_SHOPS]

    return shops   # may be empty → synthetic shops generated later in normalise step


# ── Step 5: Compute scale ─────────────────────────────────────────────────────

def _compute_scale(center_lat: float, bbox: dict) -> tuple[float, float]:
    """
    Compute pixel/metre scale for X and Y so the graph fits within the
    padded canvas (CANVAS_SIZE − 2×CANVAS_PADDING).

    Returns (scale_x, scale_y) — pixels per metre.
    """
    usable = CANVAS_SIZE - 2 * CANVAS_PADDING  # 900 px

    lat_range_m = (bbox["max_lat"] - bbox["min_lat"]) * M_PER_DEG_LAT
    lng_range_m = (
        (bbox["max_lng"] - bbox["min_lng"])
        * M_PER_DEG_LAT
        * math.cos(math.radians(center_lat))
    )

    if lat_range_m <= 0 or lng_range_m <= 0:
        raise MapBuildError("Graph bounding box is degenerate (zero width or height).")

    # Use the same scale on both axes (uniform scaling) so the map is not distorted.
    uniform_scale = usable / max(lat_range_m, lng_range_m)
    return uniform_scale, uniform_scale


# ── Step 6a: Normalise nodes ──────────────────────────────────────────────────

def _geo_to_pixel(
    pt_lat: float, pt_lng: float,
    center_lat: float, center_lng: float,
    scale_x: float, scale_y: float,
) -> tuple[float, float]:
    """Convert a single (lat, lng) to canvas (x, y) pixels."""
    m_per_deg_lng = M_PER_DEG_LAT * math.cos(math.radians(center_lat))
    x = (pt_lng - center_lng) * m_per_deg_lng * scale_x + CANVAS_CENTER
    y = -(pt_lat - center_lat) * M_PER_DEG_LAT * scale_y + CANVAS_CENTER
    return round(x, 2), round(y, 2)


def _normalise_nodes(
    nodes_geo: dict,
    center_lat: float,
    center_lng: float,
    scale_x: float,
    scale_y: float,
) -> dict[int, dict]:
    """
    Returns {osmid: {"x": float, "y": float}}.
    """
    nodes_px: dict[int, dict] = {}
    for osmid, geo in nodes_geo.items():
        x, y = _geo_to_pixel(geo["lat"], geo["lng"], center_lat, center_lng, scale_x, scale_y)
        nodes_px[osmid] = {"x": x, "y": y}
    return nodes_px


# ── Step 6b: Normalise edges ──────────────────────────────────────────────────

def _normalise_edges(
    edges_geo: list[dict],
    nodes_px: dict[int, dict],
) -> list[dict]:
    """
    Build pixel-space edge data from the already-normalised node positions.

    Geometry is represented as a straight two-point segment [from_node, to_node].
    Vehicle.js interpolates linearly between nodes anyway, so curved intermediate
    points would not affect gameplay — they are omitted to keep the pipeline simple.
    """
    edges_px: list[dict] = []

    for edge in edges_geo:
        u = edge["from_osmid"]
        v = edge["to_osmid"]

        start_px = nodes_px[u]
        end_px   = nodes_px[v]

        dx = end_px["x"] - start_px["x"]
        dy = end_px["y"] - start_px["y"]
        length = round(math.hypot(dx, dy), 2)

        if length < 1:
            # Degenerate edge — skip (coincident nodes after simplification)
            logger.debug("Skipping degenerate edge %s→%s (length %.2f)", u, v, length)
            continue

        edges_px.append({
            "from_osmid":  u,
            "to_osmid":    v,
            "px_geometry": [
                {"x": start_px["x"], "y": start_px["y"]},
                {"x": end_px["x"],   "y": end_px["y"]},
            ],
            "length": length,
        })

    return edges_px


# ── Step 6c: Normalise shops ──────────────────────────────────────────────────

def _normalise_shops(
    shops_raw: list[dict],
    center_lat: float,
    center_lng: float,
    scale_x: float,
    scale_y: float,
    nodes_px: dict[int, dict],
) -> list[dict]:
    """
    Convert shop lat/lng to pixels and compute snap_node.
    If no real shops, generate synthetic ones.
    """
    # Synthetic shops if none found
    if not shops_raw:
        node_ids = list(nodes_px.keys())
        count = random.randint(MIN_SYNTHETIC_SHOPS, MAX_SYNTHETIC_SHOPS)
        chosen = random.sample(node_ids, min(count, len(node_ids)))

        SYNTHETIC_NAMES = [
            "Padaria Central", "Mini Mercado", "Verdurão", "Quitanda",
            "Mercadinho", "Bazar do Bairro", "Supermercado", "Mercearia",
        ]
        shops_raw = []
        for i, osmid in enumerate(chosen):
            node = nodes_px[osmid]
            shops_raw.append({
                "name": SYNTHETIC_NAMES[i % len(SYNTHETIC_NAMES)],
                "lat": None,   # sentinel: already in pixel space
                "_px": (node["x"], node["y"]),
            })
        logger.info("Generated %d synthetic shops", len(shops_raw))

    shops_out: list[dict] = []
    for shop in shops_raw:
        if shop.get("_px"):
            sx, sy = shop["_px"]
        else:
            sx, sy = _geo_to_pixel(
                shop["lat"], shop["lng"],
                center_lat, center_lng,
                scale_x, scale_y,
            )

        # Snap to nearest node
        snap_osmid = _nearest_node(sx, sy, nodes_px)

        shops_out.append({
            "_osmid_snap": snap_osmid,
            "name": shop["name"],
            "x": round(sx, 2),
            "y": round(sy, 2),
        })

    return shops_out


def _nearest_node(x: float, y: float, nodes_px: dict[int, dict]) -> int:
    best_id   = None
    best_dist = float("inf")
    for osmid, node in nodes_px.items():
        d = (node["x"] - x) ** 2 + (node["y"] - y) ** 2
        if d < best_dist:
            best_dist = d
            best_id   = osmid
    return best_id


# ── Step 7: Assemble response ─────────────────────────────────────────────────

def _build_response(
    nodes_px: dict[int, dict],
    edges_px: list[dict],
    shops_px: list[dict],
    center_lat: float,
    center_lng: float,
) -> dict:
    """
    Map internal OSM ids to sequential string ids and build the final JSON dict.

    Frontend contract (GraphManager.js):
      nodes:  { [id: string]: { id, x, y, connections: string[] } }
      edges:  Array<{ id, from, to, length, geometry }>
      shops:  Array<{ id, name, x, y, snap_node }>
      meta:   { center_lat, center_lng, canvas_size }
    """
    # Assign sequential string ids to nodes
    osmid_list = list(nodes_px.keys())
    osmid_to_nodeid: dict[int, str] = {
        osmid: f"node_{i}" for i, osmid in enumerate(osmid_list)
    }

    # Build adjacency for connections field
    adjacency: dict[str, list[str]] = {nid: [] for nid in osmid_to_nodeid.values()}

    # Process edges first so we can populate connections
    edges_out: list[dict] = []
    for i, edge in enumerate(edges_px):
        u_id = osmid_to_nodeid.get(edge["from_osmid"])
        v_id = osmid_to_nodeid.get(edge["to_osmid"])
        if u_id is None or v_id is None:
            continue   # node was filtered out

        edge_id = f"{u_id}__{v_id}"

        edges_out.append({
            "id":       edge_id,
            "from":     u_id,
            "to":       v_id,
            "length":   edge["length"],
            "geometry": edge["px_geometry"],
        })

        # Bidirectional adjacency (frontend also does this, belt-and-suspenders)
        if v_id not in adjacency[u_id]:
            adjacency[u_id].append(v_id)
        if u_id not in adjacency[v_id]:
            adjacency[v_id].append(u_id)

    # Build nodes dict
    nodes_out: dict[str, dict] = {}
    for osmid, node_id in osmid_to_nodeid.items():
        px = nodes_px[osmid]
        nodes_out[node_id] = {
            "id":          node_id,
            "x":           px["x"],
            "y":           px["y"],
            "connections": adjacency[node_id],
        }

    # Build shops list
    shops_out: list[dict] = []
    for i, shop in enumerate(shops_px):
        snap_osmid = shop["_osmid_snap"]
        snap_id    = osmid_to_nodeid.get(snap_osmid, "node_0")
        shops_out.append({
            "id":        f"shop_{i}",
            "name":      shop["name"],
            "x":         shop["x"],
            "y":         shop["y"],
            "snap_node": snap_id,
        })

    logger.info(
        "Response assembled: %d nodes, %d edges, %d shops",
        len(nodes_out), len(edges_out), len(shops_out),
    )

    return {
        "nodes": nodes_out,
        "edges": edges_out,
        "shops": shops_out,
        "meta":  {
            "center_lat":  center_lat,
            "center_lng":  center_lng,
            "canvas_size": CANVAS_SIZE,
        },
    }
