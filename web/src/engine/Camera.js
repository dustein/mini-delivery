/**
 * Camera.js
 *
 * Manages the viewport transform applied to the Canvas 2D context before
 * every render call.
 *
 * Three discrete zoom levels (Decision 3.1):
 *   Level 1 — Street View   : follows the vehicle at ~1:1 scale
 *   Level 2 — Neighborhood  : follows the vehicle, ~20% of world visible
 *   Level 3 — City Map      : static, shows 100% of the world
 *
 * Transitions between levels use linear interpolation (lerp) on both the
 * target scale and the target position for a smooth animated feel.
 */

import { GRID_WIDTH, GRID_HEIGHT } from '../data/mockGraph.js';

// ─── Constants ────────────────────────────────────────────────────────────────

export const ZOOM_LEVELS = {
  STREET:       1,
  NEIGHBORHOOD: 2,
  CITY:         3,
};

/** Fraction of the world that each zoom level shows. */
const VISIBLE_FRACTION = {
  [ZOOM_LEVELS.STREET]:       0.40,  // ~40% — close follow
  [ZOOM_LEVELS.NEIGHBORHOOD]: 0.65,  // ~65% — mid follow
  [ZOOM_LEVELS.CITY]:         1.00,  // 100% — full map, camera fixed
};

/** Speed of the lerp animation (higher = snappier). */
const LERP_SPEED = 6; // units per second

export class Camera {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    this._canvas      = canvas;
    this._zoomLevel   = ZOOM_LEVELS.STREET;

    // Current interpolated values (what is actually rendered)
    this._scale       = 1;
    this._x           = 0; // world-space camera centre X
    this._y           = 0; // world-space camera centre Y

    // Target values (what we're lerping towards)
    this._targetScale = 1;
    this._targetX     = 0;
    this._targetY     = 0;
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /** Current zoom level (1 | 2 | 3). */
  get zoomLevel() { return this._zoomLevel; }

  /** Cycle through zoom levels: 1 → 2 → 3 → 1. */
  cycleZoom() {
    this._zoomLevel =
      this._zoomLevel === ZOOM_LEVELS.CITY
        ? ZOOM_LEVELS.STREET
        : this._zoomLevel + 1;
  }

  /**
   * Call every frame BEFORE rendering.
   * Updates camera targets based on the vehicle position, then lerps towards them.
   *
   * @param {number} vehicleX   - Vehicle world-space X
   * @param {number} vehicleY   - Vehicle world-space Y
   * @param {number} dt         - Delta time in seconds
   */
  update(vehicleX, vehicleY, dt) {
    const cw = this._canvas.width  / (window.devicePixelRatio || 1);
    const ch = this._canvas.height / (window.devicePixelRatio || 1);

    // ── Compute target scale ─────────────────────────────────────────────────
    const fraction    = VISIBLE_FRACTION[this._zoomLevel];
    const scaleX      = cw / (GRID_WIDTH  * fraction);
    const scaleY      = ch / (GRID_HEIGHT * fraction);
    this._targetScale = Math.min(scaleX, scaleY); // uniform scale, fit both axes

    // ── Compute target camera centre ─────────────────────────────────────────
    if (this._zoomLevel === ZOOM_LEVELS.CITY) {
      // Fixed: centre on the entire world
      this._targetX = GRID_WIDTH  / 2;
      this._targetY = GRID_HEIGHT / 2;
    } else {
      // Follow vehicle, clamped so we don't show area outside the world
      const halfW = (cw / this._targetScale) / 2;
      const halfH = (ch / this._targetScale) / 2;

      this._targetX = Math.max(halfW, Math.min(GRID_WIDTH  - halfW, vehicleX));
      this._targetY = Math.max(halfH, Math.min(GRID_HEIGHT - halfH, vehicleY));
    }

    // ── Lerp current values towards targets ──────────────────────────────────
    const t       = Math.min(1, LERP_SPEED * dt);
    this._scale   = this._lerp(this._scale, this._targetScale, t);
    this._x       = this._lerp(this._x,     this._targetX,     t);
    this._y       = this._lerp(this._y,     this._targetY,     t);
  }

  /**
   * Apply the camera transform to the canvas context.
   * Call ctx.save() before and ctx.restore() after rendering.
   *
   * @param {CanvasRenderingContext2D} ctx
   */
  applyTransform(ctx) {
    const cw = this._canvas.width  / (window.devicePixelRatio || 1);
    const ch = this._canvas.height / (window.devicePixelRatio || 1);

    // Translate so that world point (this._x, this._y) maps to canvas centre
    ctx.translate(cw / 2 - this._x * this._scale, ch / 2 - this._y * this._scale);
    ctx.scale(this._scale, this._scale);
  }

  /**
   * Convert a canvas (screen) coordinate to world space.
   * Useful for touch hit-testing in future phases.
   * @param {number} sx  screen X
   * @param {number} sy  screen Y
   * @returns {{ x: number, y: number }}
   */
  screenToWorld(sx, sy) {
    const cw = this._canvas.width  / (window.devicePixelRatio || 1);
    const ch = this._canvas.height / (window.devicePixelRatio || 1);
    return {
      x: (sx - cw / 2) / this._scale + this._x,
      y: (sy - ch / 2) / this._scale + this._y,
    };
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  _lerp(a, b, t) {
    return a + (b - a) * t;
  }
}

export default Camera;
