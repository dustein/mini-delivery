/**
 * GameObjective.js
 *
 * Manages one delivery round: pickup → delivery → reset.
 *
 * States:
 *   PICKUP   — vehicle must reach pickupNodeId to collect the package
 *   DELIVERY — vehicle must reach deliveryNodeId to complete the delivery
 *   COMPLETE — delivery done; caller should wait briefly then call nextRound()
 *
 * Reads vehicle.lastArrivedNodeId every frame (set by Vehicle on node arrival).
 */

export const ObjectiveState = Object.freeze({
  PICKUP:   'PICKUP',
  DELIVERY: 'DELIVERY',
  COMPLETE: 'COMPLETE',
});

/** Minimum Manhattan distance (in grid hops) between pickup and delivery. */
const MIN_HOPS = 3;

export class GameObjective {
  /** @param {import('./GraphManager').GraphManager} graphManager */
  constructor(graphManager) {
    this._gm = graphManager;

    this.state          = ObjectiveState.PICKUP;
    this.pickupNodeId   = null;
    this.deliveryNodeId = null;

    /** Seconds elapsed during this round (stops when COMPLETE). */
    this.elapsedTime     = 0;
    /** Seconds of the most recent completed delivery. */
    this.lastDeliveryTime = null;
    /** Total deliveries completed across all rounds. */
    this.totalDeliveries  = 0;

    this._generatePair();
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Call every frame.
   * @param {number} dt
   * @param {{ lastArrivedNodeId: string|null }} vehicle
   */
  update(dt, vehicle) {
    if (this.state !== ObjectiveState.COMPLETE) {
      this.elapsedTime += dt;
    }

    const nodeId = vehicle.lastArrivedNodeId;
    if (!nodeId) return;

    if (this.state === ObjectiveState.PICKUP && nodeId === this.pickupNodeId) {
      // Package collected
      this.state = ObjectiveState.DELIVERY;

    } else if (this.state === ObjectiveState.DELIVERY && nodeId === this.deliveryNodeId) {
      // Delivery completed
      this.totalDeliveries++;
      this.lastDeliveryTime = this.elapsedTime;
      this.state = ObjectiveState.COMPLETE;
    }
  }

  /** Reset for the next round (called by MiniDeliveryGame after the flash). */
  nextRound() {
    this._generatePair();
    this.elapsedTime = 0;
    this.state       = ObjectiveState.PICKUP;
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  _generatePair() {
    const nodes = this._gm.getAllNodes();

    // Pick a random pickup node
    let pickup = nodes[Math.floor(Math.random() * nodes.length)];
    let delivery;
    let attempts = 0;

    // Pick delivery that is at least MIN_HOPS away (Manhattan on col/row)
    do {
      delivery = nodes[Math.floor(Math.random() * nodes.length)];
      attempts++;
    } while (
      attempts < 100 && (
        delivery.id === pickup.id ||
        this._manhattan(pickup, delivery) < MIN_HOPS
      )
    );

    this.pickupNodeId   = pickup.id;
    this.deliveryNodeId = delivery.id;
  }

  _manhattan(a, b) {
    return Math.abs((a.col ?? 0) - (b.col ?? 0)) +
           Math.abs((a.row ?? 0) - (b.row ?? 0));
  }
}

export default GameObjective;
