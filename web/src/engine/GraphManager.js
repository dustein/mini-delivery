/**
 * GraphManager.js
 *
 * Loads and manages the graph data (nodes + edges).
 * Provides query methods used by the Vehicle, Renderer, and GameObjective.
 *
 * Designed to be graph-source-agnostic: swap `mockGraph` for an OSMnx-derived
 * JSON payload in Phase 2 without changing any callers.
 */

import { nodes as defaultNodes, edges as defaultEdges } from '../data/mockGraph.js';

export class GraphManager {
  /**
   * @param {object} [graphData] - Optional graph override (for testing or future phases).
   *   Defaults to the 4×4 mock grid.
   */
  constructor(graphData = null) {
    const source = graphData ?? { nodes: defaultNodes, edges: defaultEdges };

    /** @type {Object.<string, {id: string, x: number, y: number, col?: number, row?: number}>} */
    this.nodes = source.nodes;

    /**
     * Adjacency map:  nodeId → Array of { edgeId, neighborId, length }
     * Built once at construction; O(1) lookup at runtime.
     * @type {Object.<string, Array<{edgeId: string, neighborId: string, length: number}>>}
     */
    this.adjacency = {};

    /**
     * Edge lookup by id.
     * @type {Object.<string, {id: string, from: string, to: string, length: number}>}
     */
    this.edgeMap = {};

    this._buildAdjacency(source.edges);
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  _buildAdjacency(edges) {
    // Initialise empty arrays for every node
    for (const id of Object.keys(this.nodes)) {
      this.adjacency[id] = [];
    }

    for (const edge of edges) {
      this.edgeMap[edge.id] = edge;

      // Undirected: add both directions to the adjacency list
      this.adjacency[edge.from].push({
        edgeId:     edge.id,
        neighborId: edge.to,
        length:     edge.length,
      });
      this.adjacency[edge.to].push({
        edgeId:     edge.id,
        neighborId: edge.from,
        length:     edge.length,
      });
    }
  }

  // ─── Node queries ───────────────────────────────────────────────────────────

  /**
   * Returns the node object for a given id.
   * @param {string} id
   * @returns {{ id: string, x: number, y: number } | undefined}
   */
  getNode(id) {
    return this.nodes[id];
  }

  /**
   * Returns all node objects as an array.
   * @returns {Array}
   */
  getAllNodes() {
    return Object.values(this.nodes);
  }

  // ─── Neighbour queries ──────────────────────────────────────────────────────

  /**
   * Returns the adjacency entries for a node.
   * Each entry: { edgeId, neighborId, length }
   * @param {string} nodeId
   * @returns {Array<{edgeId: string, neighborId: string, length: number}>}
   */
  getNeighbors(nodeId) {
    return this.adjacency[nodeId] ?? [];
  }

  /**
   * Returns the degree (number of connections) of a node.
   * @param {string} nodeId
   * @returns {number}
   */
  getDegree(nodeId) {
    return this.getNeighbors(nodeId).length;
  }

  /**
   * Returns neighbour entries EXCLUDING a specific neighbour.
   * Used at intersections to remove the "came from" edge from the choice list.
   * @param {string} nodeId
   * @param {string} excludeNeighborId
   * @returns {Array<{edgeId: string, neighborId: string, length: number}>}
   */
  getNeighborsExcluding(nodeId, excludeNeighborId) {
    return this.getNeighbors(nodeId).filter(
      (entry) => entry.neighborId !== excludeNeighborId
    );
  }

  // ─── Edge queries ───────────────────────────────────────────────────────────

  /**
   * Returns the edge object between two nodes (order-independent).
   * @param {string} fromId
   * @param {string} toId
   * @returns {{ id: string, from: string, to: string, length: number } | null}
   */
  getEdge(fromId, toId) {
    // Try both directions since edges are stored with a canonical id
    const id1 = `${fromId}__${toId}`;
    const id2 = `${toId}__${fromId}`;
    return this.edgeMap[id1] ?? this.edgeMap[id2] ?? null;
  }

  /**
   * Returns all edge objects as an array.
   * @returns {Array}
   */
  getAllEdges() {
    return Object.values(this.edgeMap);
  }

  // ─── Geometry helpers ───────────────────────────────────────────────────────

  /**
   * Returns the angle (radians) of the edge FROM → TO, measured from the
   * positive X-axis clockwise (canvas convention).
   * @param {string} fromId
   * @param {string} toId
   * @returns {number} angle in radians [-π, π]
   */
  getEdgeAngle(fromId, toId) {
    const a = this.nodes[fromId];
    const b = this.nodes[toId];
    if (!a || !b) return 0;
    return Math.atan2(b.y - a.y, b.x - a.x);
  }

  /**
   * Given an arrival direction and a target node, returns the available
   * exit edges sorted by their RELATIVE angle to the arrival direction.
   *
   * Relative angle is snapped to the nearest 45° multiple for consistent
   * left/right classification (Decision 3.5).
   *
   * @param {string} arrivedFromId  - The node the vehicle is coming FROM.
   * @param {string} atNodeId       - The intersection node the vehicle just reached.
   * @returns {Array<{edgeId, neighborId, length, rawAngle, snappedAngle, relativeAngle}>}
   *          Sorted by relativeAngle ascending (most-left first).
   */
  getSortedExitEdges(arrivedFromId, atNodeId) {
    // Use the FORWARD direction of travel as the reference angle.
    // "arrivedFrom → atNode" is the direction the vehicle was heading.
    // This makes relativeAngle = 0 mean "straight ahead",
    // negative = left turn, positive = right turn.
    const forwardAngle = this.getEdgeAngle(arrivedFromId, atNodeId);

    const exits = this.getNeighborsExcluding(atNodeId, arrivedFromId);

    return exits
      .map((entry) => {
        const rawAngle     = this.getEdgeAngle(atNodeId, entry.neighborId);
        const snappedAngle = this._snapTo45(rawAngle);
        let relativeAngle  = snappedAngle - this._snapTo45(forwardAngle);

        // Normalise to (-π, π]
        while (relativeAngle >  Math.PI) relativeAngle -= 2 * Math.PI;
        while (relativeAngle <= -Math.PI) relativeAngle += 2 * Math.PI;

        return { ...entry, rawAngle, snappedAngle, relativeAngle };
      })
      .sort((a, b) => a.relativeAngle - b.relativeAngle);
  }

  /**
   * Snaps a radian angle to the nearest 45° (π/4) multiple.
   * @param {number} angle - radians
   * @returns {number} snapped angle in radians
   */
  _snapTo45(angle) {
    const step = Math.PI / 4; // 45°
    return Math.round(angle / step) * step;
  }

  // ─── Spatial queries ─────────────────────────────────────────────────────────

  /**
   * Returns the node whose world position is closest to (x, y).
   * Useful for placing pickups/deliveries or snapping the camera.
   * @param {number} x
   * @param {number} y
   * @returns {{ id: string, x: number, y: number }}
   */
  getNearestNode(x, y) {
    let nearest  = null;
    let minDist  = Infinity;

    for (const node of Object.values(this.nodes)) {
      const dx   = node.x - x;
      const dy   = node.y - y;
      const dist = dx * dx + dy * dy; // no sqrt needed for comparison
      if (dist < minDist) {
        minDist = dist;
        nearest = node;
      }
    }

    return nearest;
  }

  /**
   * Returns a random node id, optionally excluding specific ids.
   * @param {string[]} [exclude=[]]
   * @returns {string}
   */
  getRandomNodeId(exclude = []) {
    const ids = Object.keys(this.nodes).filter((id) => !exclude.includes(id));
    return ids[Math.floor(Math.random() * ids.length)];
  }
}

export default GraphManager;
