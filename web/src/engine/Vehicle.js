/**
 * Vehicle.js
 *
 * Graph-constrained vehicle with REAL-TIME edge switching.
 *
 * Movement states:
 *   MOVING   — traveling along an edge (the only normal state)
 *   DEADEND  — stopped at a dead-end node (no exits); only reverse possible
 *
 * Intersection logic (evaluated instantly at every node arrival — no pause):
 *   - LEFT held  → take the exit with the most-left relative angle
 *   - RIGHT held → take the exit with the most-right relative angle
 *   - Neither    → continue straight (exit closest to relativeAngle = 0)
 *   - Fallback   → if requested direction has no exit, fall back to straight
 *
 * Public read properties (used by Renderer and MiniDeliveryGame):
 *   x, y    — world-space position (interpolated each frame)
 *   angle   — heading in radians (0 = East/right)
 *   speed   — current px/s (positive = forward, negative = reverse)
 *   state   — current VehicleState string
 */

// ─── Constants ────────────────────────────────────────────────────────────────

export const VehicleState = Object.freeze({
  MOVING:  'MOVING',
  DEADEND: 'DEADEND',
});

const MAX_SPEED         = 120;  // px/s forward
const MAX_REVERSE_SPEED =  60;  // px/s reverse (50% of max)
const ACCELERATION      = 220;  // px/s²
const FRICTION          = 180;  // px/s² coast deceleration

/** Minimum relativeAngle (rad) to classify an exit as left or right. */
const TURN_THRESHOLD = 0.2;  // ~11.5°

export class Vehicle {
  /**
   * @param {import('./GraphManager').GraphManager} graphManager
   * @param {string} startNodeId  — node id where the vehicle spawns
   */
  constructor(graphManager, startNodeId) {
    this._gm = graphManager;

    this.state = VehicleState.MOVING;

    // Current edge: travels from _fromNodeId toward _toNodeId
    // progress ∈ [0, 1]: 0 = at fromNode, 1 = at toNode
    this._fromNodeId = startNodeId;
    this._toNodeId   = this._pickEastNeighbor(startNodeId);
    this._progress   = 0;
    this._edgeLength = this._gm.getEdge(this._fromNodeId, this._toNodeId)?.length ?? 160;

    this.speed = 0;

    // Dead-end state
    this._deadEndNodeId   = null;
    this._deadEndCameFrom = null;

    /**
     * Set to the nodeId of the node the vehicle just arrived at during this frame.
     * Cleared at the START of each update(). Read by GameObjective.
     * @type {string|null}
     */
    this.lastArrivedNodeId = null;

    // World-space outputs
    this.x     = 0;
    this.y     = 0;
    this.angle = 0;
    this._updatePosition();
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * @param {number} dt
   * @param {import('./InputManager').InputManager} input
   */
  update(dt, input) {
    this.lastArrivedNodeId = null; // clear from previous frame
    switch (this.state) {
      case VehicleState.MOVING:  this._updateMoving(dt, input);  break;
      case VehicleState.DEADEND: this._updateDeadend(dt, input); break;
    }
    this._updatePosition();
  }

  // ─── State updates ────────────────────────────────────────────────────────

  _updateMoving(dt, input) {
    // ── Speed control ─────────────────────────────────────────────────────
    if (input.isAccelerating()) {
      this.speed = Math.min(this.speed + ACCELERATION * dt, MAX_SPEED);
    } else if (input.isBraking()) {
      this.speed = Math.max(this.speed - ACCELERATION * dt, -MAX_REVERSE_SPEED);
    } else {
      // Friction — coast toward zero
      if (this.speed > 0) {
        this.speed = Math.max(0, this.speed - FRICTION * dt);
      } else if (this.speed < 0) {
        this.speed = Math.min(0, this.speed + FRICTION * dt);
      }
    }

    // ── Advance progress ─────────────────────────────────────────────────
    this._progress += (this.speed / this._edgeLength) * dt;

    // ── Node arrival checks ───────────────────────────────────────────────
    if (this._progress >= 1.0) {
      this._progress = 1.0;
      this.speed     = Math.max(0, this.speed);
      this._handleArrival(this._toNodeId, this._fromNodeId, input);

    } else if (this._progress <= 0.0) {
      // Reversed back to fromNode — flip edge direction, keep speed magnitude
      this._progress = 1.0;
      this.speed     = Math.abs(this.speed);
      const wasFrom  = this._fromNodeId;
      const wasTo    = this._toNodeId;
      this._fromNodeId = wasTo;
      this._toNodeId   = wasFrom;
      this._handleArrival(this._toNodeId, this._fromNodeId, input);
    }
  }

  _updateDeadend(dt, input) {
    // Only DOWN (brake) escapes a dead-end by reversing back
    if (input.isBraking()) {
      const edge = this._gm.getEdge(this._deadEndNodeId, this._deadEndCameFrom);
      if (edge) {
        this._fromNodeId = this._deadEndNodeId;
        this._toNodeId   = this._deadEndCameFrom;
        this._edgeLength = edge.length;
        this._progress   = 0;
        this.speed       = -30;
        this.state       = VehicleState.MOVING;
      }
    }
  }

  // ─── Real-time intersection decision ─────────────────────────────────────

  /**
   * Called instantly when the vehicle physically reaches a node.
   * Reads the live input state and picks the next edge without any pause.
   *
   * @param {string} arrivedAt
   * @param {string} cameFrom
   * @param {import('./InputManager').InputManager} input
   */
  _handleArrival(arrivedAt, cameFrom, input) {
    const sorted = this._gm.getSortedExitEdges(cameFrom, arrivedAt);

    // Record arrival for GameObjective (cleared next frame)
    this.lastArrivedNodeId = arrivedAt;

    // ── Dead-end: no exits ───────────────────────────────────────────────
    if (sorted.length === 0) {
      this.state            = VehicleState.DEADEND;
      this.speed            = 0;
      this._deadEndNodeId   = arrivedAt;
      this._deadEndCameFrom = cameFrom;
      this._snapToNode(arrivedAt);
      return;
    }

    // ── Pick exit ────────────────────────────────────────────────────────
    let chosen;

    if (sorted.length === 1) {
      // Only one option — auto-continue regardless of input
      chosen = sorted[0];

    } else if (input.isTurningLeft() && !input.isTurningRight()) {
      // Prefer leftmost exit (most negative relativeAngle)
      const leftExits = sorted.filter(e => e.relativeAngle < -TURN_THRESHOLD);
      chosen = leftExits.length > 0
        ? leftExits[0]                   // leftmost available
        : this._straightest(sorted);     // fallback: go straight

    } else if (input.isTurningRight() && !input.isTurningLeft()) {
      // Prefer rightmost exit (most positive relativeAngle)
      const rightExits = sorted.filter(e => e.relativeAngle > TURN_THRESHOLD);
      chosen = rightExits.length > 0
        ? rightExits[rightExits.length - 1]  // rightmost available
        : this._straightest(sorted);          // fallback: go straight

    } else {
      // No directional input (or both pressed) — continue straight
      chosen = this._straightest(sorted);
    }

    // ── Commit to chosen edge ────────────────────────────────────────────
    this._fromNodeId = arrivedAt;
    this._toNodeId   = chosen.neighborId;
    this._edgeLength = chosen.length;
    this._progress   = 0;
    // speed carries over — vehicle flows through without stopping
  }

  // ─── Position interpolation ───────────────────────────────────────────────

  _updatePosition() {
    if (this.state === VehicleState.DEADEND) return;

    const fromNode = this._gm.getNode(this._fromNodeId);
    const toNode   = this._gm.getNode(this._toNodeId);
    if (!fromNode || !toNode) return;

    const p    = Math.max(0, Math.min(1, this._progress));
    this.x     = fromNode.x + (toNode.x - fromNode.x) * p;
    this.y     = fromNode.y + (toNode.y - fromNode.y) * p;
    this.angle = Math.atan2(toNode.y - fromNode.y, toNode.x - fromNode.x);
  }

  _snapToNode(nodeId) {
    const node = this._gm.getNode(nodeId);
    if (node) { this.x = node.x; this.y = node.y; }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  /** Returns the exit whose relative angle is closest to 0 (straight ahead). */
  _straightest(sortedExits) {
    return sortedExits.reduce((best, exit) =>
      Math.abs(exit.relativeAngle) < Math.abs(best.relativeAngle) ? exit : best
    );
  }

  /** Picks the East-facing neighbor from startNode (or any neighbor as fallback). */
  _pickEastNeighbor(startNodeId) {
    const neighbors = this._gm.getNeighbors(startNodeId);
    if (!neighbors.length) return startNodeId;

    const startNode = this._gm.getNode(startNodeId);
    return neighbors.reduce((best, n) => {
      const node    = this._gm.getNode(n.neighborId);
      const angle   = Math.abs(Math.atan2(node.y - startNode.y, node.x - startNode.x));
      const bNode   = this._gm.getNode(best.neighborId);
      const bAngle  = Math.abs(Math.atan2(bNode.y - startNode.y, bNode.x - startNode.x));
      return angle < bAngle ? n : best;
    }).neighborId;
  }
}

export default Vehicle;
