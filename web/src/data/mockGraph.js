/**
 * mockGraph.js
 *
 * 4×4 symmetrical city grid — 16 nodes, 24 edges.
 *
 * Layout (col, row) → node id "c{col}r{row}":
 *
 *   c0r0 — c1r0 — c2r0 — c3r0
 *    |       |       |       |
 *   c0r1 — c1r1 — c2r1 — c3r1
 *    |       |       |       |
 *   c0r2 — c1r2 — c2r2 — c3r2
 *    |       |       |       |
 *   c0r3 — c1r3 — c2r3 — c3r3
 *
 * World-space coordinates:
 *   - Grid starts at offset (100, 100) in canvas pixels.
 *   - Cell spacing: 160px horizontally and vertically.
 *   - Total grid area: 480×480px within a ~680×680 world.
 *
 * Format is intentionally compatible with a future OSMnx-derived graph:
 *   nodes  → { [id]: { id, x, y, col, row } }
 *   edges  → Array of { id, from, to, length }  (undirected — each pair stored once)
 */

const OFFSET_X = 100; // world-space left margin
const OFFSET_Y = 100; // world-space top margin
const SPACING  = 160; // px between adjacent nodes

// ─── Nodes ────────────────────────────────────────────────────────────────────

export const nodes = {};

for (let row = 0; row < 4; row++) {
  for (let col = 0; col < 4; col++) {
    const id = `c${col}r${row}`;
    nodes[id] = {
      id,
      col,
      row,
      x: OFFSET_X + col * SPACING,
      y: OFFSET_Y + row * SPACING,
    };
  }
}

// ─── Edges ────────────────────────────────────────────────────────────────────
// Only horizontal and vertical connections; each undirected edge stored once.

export const edges = [];

for (let row = 0; row < 4; row++) {
  for (let col = 0; col < 4; col++) {
    // Horizontal edge: current node → right neighbour
    if (col < 3) {
      const from = `c${col}r${row}`;
      const to   = `c${col + 1}r${row}`;
      edges.push({
        id: `${from}__${to}`,
        from,
        to,
        length: SPACING, // px — same as world spacing for a perfect grid
      });
    }

    // Vertical edge: current node → bottom neighbour
    if (row < 3) {
      const from = `c${col}r${row}`;
      const to   = `c${col}r${row + 1}`;
      edges.push({
        id: `${from}__${to}`,
        from,
        to,
        length: SPACING,
      });
    }
  }
}

// ─── Derived helpers exported for convenience ──────────────────────────────

/** Total world width of the grid (px). */
export const GRID_WIDTH  = OFFSET_X * 2 + 3 * SPACING; // 580
/** Total world height of the grid (px). */
export const GRID_HEIGHT = OFFSET_Y * 2 + 3 * SPACING; // 580

/** Node closest to the absolute centre of the world — used as vehicle spawn. */
export const CENTER_NODE_ID = 'c1r1'; // top-left of the 2×2 centre cluster

export const mockGraph = { nodes, edges };
export default mockGraph;
