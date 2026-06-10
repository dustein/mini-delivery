/**
 * Renderer.js
 *
 * All Canvas 2D drawing lives here. The Renderer is purely presentational —
 * it reads state from the game objects but never mutates them.
 *
 * Draw order (painter's algorithm, back to front):
 *   1. Clear canvas
 *   2. Apply camera transform
 *      3. Static map blit (background, blocks, roads, dashes)
 *      4. Objective markers  ← pickup / delivery (drawn under vehicle)
 *      5. Vehicle
 *   6. Restore camera transform
 *
 * Static map layers (background, blocks, roads, dashes) are pre-rendered once
 * onto an offscreen canvas and blitted each frame — important for mobile perf.
 */

import { GRID_WIDTH, GRID_HEIGHT } from '../data/mockGraph.js';

// ─── Visual constants ─────────────────────────────────────────────────────────

const ROAD_WIDTH    = 36;  // px in world space (the dark asphalt strip)
const SIDEWALK_PAD  = 6;   // extra px each side beyond road edge (lighter strip)
const DASH_LEN      = 10;
const DASH_GAP      = 8;

const COLOR_BG          = '#E8E4DC';  // warm sidewalk / outer city
const COLOR_ROAD        = '#3A3A3A';  // asphalt
const COLOR_DASH        = '#FFFFFF';  // centre line
const COLOR_INTERSECTION = '#3A3A3A'; // same as road — fills intersection boxes

// Pastel block palette — one chosen per block, deterministically
const BLOCK_COLORS = [
  '#D4C5E2', // lavender
  '#B8DCCA', // mint
  '#F5CBA7', // peach
  '#FCE4A8', // pale yellow
  '#C9E4DE', // teal tint
  '#F0D5E0', // blush
  '#BDD5EA', // sky blue
  '#D5E8C4', // sage
];

export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('./GraphManager').GraphManager} graphManager
   */
  constructor(canvas, graphManager) {
    this._canvas  = canvas;
    this._ctx     = canvas.getContext('2d');
    this._gm      = graphManager;

    /** Offscreen canvas holding the static map (redrawn only on resize). */
    this._mapCanvas = null;
    this._mapDirty  = true;  // force initial bake

    this._bindResize();
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /** Mark the static map as needing a re-bake (e.g. after canvas resize). */
  invalidateMap() {
    this._mapDirty = true;
  }

  /**
   * Main render call — invoked every frame by the game loop.
   *
   * @param {import('./Camera').Camera} camera
   * @param {{ x: number, y: number, angle: number }} vehicle
   * @param {import('./GameObjective').GameObjective|null} [objective]
   * @param {Array<{x:number, y:number}>} [trail]  — ordered oldest→newest
   */
  render(camera, vehicle, objective = null, trail = []) {
    const ctx    = this._ctx;
    const canvas = this._canvas;
    const dpr    = window.devicePixelRatio || 1;

    // 1. Clear
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // DPR scale — all subsequent drawing uses CSS-pixel coordinates
    ctx.save();
    ctx.scale(dpr, dpr);

    // 2. Camera transform
    ctx.save();
    camera.applyTransform(ctx);

    // 3. Static map
    this._bakeMapIfDirty();
    ctx.drawImage(this._mapCanvas, 0, 0);

    // 4. Vehicle trail (under objectives and vehicle)
    if (trail.length > 1) {
      this._drawTrail(ctx, trail);
    }

    // 5. Objective markers (under vehicle)
    if (objective) {
      this._drawObjectives(ctx, objective);
    }

    // 6. Vehicle
    if (vehicle) {
      this._drawVehicle(ctx, vehicle.x, vehicle.y, vehicle.angle);
    }

    ctx.restore(); // camera
    ctx.restore(); // dpr scale
  }

  // ─── Vehicle trail ───────────────────────────────────────────────────────────

  /**
   * Draws a fading trail of the vehicle's recent path.
   * @param {CanvasRenderingContext2D} ctx
   * @param {Array<{x: number, y: number}>} trail  oldest → newest
   */
  _drawTrail(ctx, trail) {
    const n = trail.length;
    ctx.save();
    for (let i = 0; i < n; i++) {
      const t      = i / (n - 1);             // 0 (oldest) → 1 (newest)
      const alpha  = t * 0.45;               // fade from transparent to semi-opaque
      const radius = 1.5 + t * 3;            // grow from 1.5 to 4.5px
      ctx.globalAlpha = alpha;
      ctx.fillStyle   = '#E05C2A';            // vehicle orange
      ctx.beginPath();
      ctx.arc(trail[i].x, trail[i].y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ─── Static map baking ──────────────────────────────────────────────────────

  _bakeMapIfDirty() {
    if (!this._mapDirty) return;
    this._mapDirty = false;

    // Create / resize offscreen canvas to world dimensions
    if (!this._mapCanvas) this._mapCanvas = document.createElement('canvas');
    this._mapCanvas.width  = GRID_WIDTH;
    this._mapCanvas.height = GRID_HEIGHT;

    const ctx = this._mapCanvas.getContext('2d');

    // Layer 1: city background
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, GRID_WIDTH, GRID_HEIGHT);

    // Layer 2: city blocks (pastels)
    this._drawBlocks(ctx);

    // Layer 3: road strips (asphalt)
    this._drawRoads(ctx);

    // Layer 4: intersection fills (square patches)
    this._drawIntersections(ctx);

    // Layer 5: centre dashes
    this._drawDashes(ctx);
  }

  // ─── Map layers ──────────────────────────────────────────────────────────────

  _drawBlocks(ctx) {
    const nodes  = this._gm.getAllNodes();
    const nodeMap = {};
    for (const n of nodes) nodeMap[n.id] = n;

    // For a grid, blocks sit between 4 adjacent nodes:
    // (col,row), (col+1,row), (col,row+1), (col+1,row+1)
    // We detect adjacency by checking for nodes at (col+1,row) and (col,row+1).

    const halfRoad = ROAD_WIDTH / 2 + SIDEWALK_PAD;

    for (const node of nodes) {
      const right  = nodeMap[`c${node.col + 1}r${node.row}`];
      const below  = nodeMap[`c${node.col}r${node.row + 1}`];
      if (!right || !below) continue;

      const belowRight = nodeMap[`c${node.col + 1}r${node.row + 1}`];
      if (!belowRight) continue;

      // Block rectangle in world space (inset from road centres)
      const x1 = node.x  + halfRoad;
      const y1 = node.y  + halfRoad;
      const x2 = right.x - halfRoad;
      const y2 = below.y - halfRoad;
      const w  = x2 - x1;
      const h  = y2 - y1;

      if (w <= 0 || h <= 0) continue;

      // Deterministic colour from block position
      const colorIdx = (node.col + node.row * 3) % BLOCK_COLORS.length;
      ctx.fillStyle   = BLOCK_COLORS[colorIdx];
      ctx.fillRect(x1, y1, w, h);
    }
  }

  _drawRoads(ctx) {
    ctx.strokeStyle = COLOR_ROAD;
    ctx.lineWidth   = ROAD_WIDTH;
    ctx.lineCap     = 'butt';
    ctx.setLineDash([]);

    for (const edge of this._gm.getAllEdges()) {
      const a = this._gm.getNode(edge.from);
      const b = this._gm.getNode(edge.to);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  _drawIntersections(ctx) {
    // Fill a square centred on each node to plug the gaps between road strips
    const size = ROAD_WIDTH;
    ctx.fillStyle = COLOR_INTERSECTION;

    for (const node of this._gm.getAllNodes()) {
      ctx.fillRect(
        node.x - size / 2,
        node.y - size / 2,
        size,
        size,
      );
    }
  }

  _drawDashes(ctx) {
    ctx.strokeStyle = COLOR_DASH;
    ctx.lineWidth   = 2;
    ctx.setLineDash([DASH_LEN, DASH_GAP]);
    ctx.lineDashOffset = 0;

    for (const edge of this._gm.getAllEdges()) {
      const a = this._gm.getNode(edge.from);
      const b = this._gm.getNode(edge.to);

      // Offset start/end slightly so dash doesn't run into intersection box
      const dx   = b.x - a.x;
      const dy   = b.y - a.y;
      const len  = Math.hypot(dx, dy);
      const ux   = dx / len;
      const uy   = dy / len;
      const pad  = ROAD_WIDTH / 2 + 2; // clear the intersection box

      ctx.beginPath();
      ctx.moveTo(a.x + ux * pad, a.y + uy * pad);
      ctx.lineTo(b.x - ux * pad, b.y - uy * pad);
      ctx.stroke();
    }

    ctx.setLineDash([]); // reset
  }

  // ─── Vehicle ─────────────────────────────────────────────────────────────────

  /**
   * Draws a top-down minimalist delivery van.
   *   - Body: rounded rect, main colour
   *   - Cab: darker front section
   *   - Wheels: 4 small dark rounded rects
   *   - Windshield: thin light strip on cab
   *
   * The vehicle is always drawn facing RIGHT (+X) and rotated by `angle`.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x      world-space centre
   * @param {number} y      world-space centre
   * @param {number} angle  radians, 0 = facing right
   */
  _drawVehicle(ctx, x, y, angle) {
    const W  = 26;   // total vehicle width  (along X when angle=0)
    const H  = 14;   // total vehicle height (along Y when angle=0)
    const cW = 7;    // cab section width
    const r  = 3;    // body corner radius

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    // ── Wheels (drawn under body) ──────────────────────────────────────
    ctx.fillStyle = '#222222';
    const wxOff = W / 2 - 3;
    const wyOff = H / 2 + 1;
    const ww = 5, wh = 3;
    [
      [ wxOff, -wyOff],
      [ wxOff,  wyOff],
      [-wxOff, -wyOff],
      [-wxOff,  wyOff],
    ].forEach(([wx, wy]) => {
      ctx.beginPath();
      ctx.roundRect(wx - ww / 2, wy - wh / 2, ww, wh, 1);
      ctx.fill();
    });

    // ── Body ──────────────────────────────────────────────────────────
    ctx.fillStyle = '#E05C2A'; // delivery orange
    ctx.beginPath();
    ctx.roundRect(-W / 2, -H / 2, W, H, r);
    ctx.fill();

    // ── Cab (front-right portion when angle=0) ─────────────────────
    ctx.fillStyle = '#C04B20';
    ctx.beginPath();
    ctx.roundRect(W / 2 - cW, -H / 2, cW, H, [0, r, r, 0]);
    ctx.fill();

    // ── Windshield ─────────────────────────────────────────────────
    ctx.fillStyle = 'rgba(200, 230, 255, 0.7)';
    ctx.fillRect(W / 2 - cW + 1, -H / 2 + 2, cW - 3, H - 4);

    // ── Outline ────────────────────────────────────────────────────
    ctx.strokeStyle = '#111111';
    ctx.lineWidth   = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.roundRect(-W / 2, -H / 2, W, H, r);
    ctx.stroke();

    ctx.restore();
  }

  // ─── Objective markers ────────────────────────────────────────────────────────

  /**
   * Draws animated pickup (📦) and delivery (🏠) markers.
   * Uses performance.now() for independent pulsing animation.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {import('./GameObjective').GameObjective} objective
   */
  _drawObjectives(ctx, objective) {
    const { ObjectiveState } = objective.constructor
      ? { ObjectiveState: { PICKUP: 'PICKUP', DELIVERY: 'DELIVERY', COMPLETE: 'COMPLETE' } }
      : {};

    const t         = performance.now() / 1000; // seconds
    const isComplete = objective.state === 'COMPLETE';

    // Pickup marker — always shown until collected
    if (objective.state === 'PICKUP' || isComplete) {
      const node = this._gm.getNode(objective.pickupNodeId);
      if (node) {
        this._drawMarker(ctx, node.x, node.y, {
          color:    '#FF8C00',  // orange
          label:    '📦',
          pulse:    t,
          opacity:  isComplete ? 0.3 : 1,
        });
      }
    }

    // Delivery marker — shown from DELIVERY phase onward
    if (objective.state === 'DELIVERY' || isComplete) {
      const node = this._gm.getNode(objective.deliveryNodeId);
      if (node) {
        this._drawMarker(ctx, node.x, node.y, {
          color:    '#27AE60',  // green
          label:    '🏠',
          pulse:    t + Math.PI, // offset phase from pickup
          opacity:  isComplete ? 0.3 : 1,
        });
      }
    }

    // COMPLETE flash — bright ring on delivery node
    if (isComplete) {
      const node = this._gm.getNode(objective.deliveryNodeId);
      if (node) {
        const flashAlpha = 0.5 + 0.5 * Math.sin(t * 8); // fast blink
        ctx.save();
        ctx.globalAlpha = flashAlpha;
        ctx.strokeStyle = '#FFD700'; // gold
        ctx.lineWidth   = 4;
        ctx.beginPath();
        ctx.arc(node.x, node.y, 24, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  /**
   * Draws a single pulsing marker at (x, y).
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x
   * @param {number} y
   * @param {{ color: string, label: string, pulse: number, opacity: number }} opts
   */
  _drawMarker(ctx, x, y, { color, label, pulse, opacity }) {
    const BASE_R  = 16;
    const PULSE_R = BASE_R + 5 * (0.5 + 0.5 * Math.sin(pulse * 2.5));

    ctx.save();
    ctx.globalAlpha = opacity;

    // Outer pulsing ring
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2.5;
    ctx.globalAlpha = opacity * (0.4 + 0.3 * Math.sin(pulse * 2.5));
    ctx.beginPath();
    ctx.arc(x, y, PULSE_R, 0, Math.PI * 2);
    ctx.stroke();

    // Inner filled circle
    ctx.globalAlpha = opacity * 0.85;
    ctx.fillStyle   = color;
    ctx.beginPath();
    ctx.arc(x, y, BASE_R, 0, Math.PI * 2);
    ctx.fill();

    // Emoji label (canvas text)
    ctx.globalAlpha  = opacity;
    ctx.font         = '14px serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y);

    ctx.restore();
  }

  // ─── Resize handling ─────────────────────────────────────────────────────────

  _bindResize() {
    const observer = new ResizeObserver(() => this._onResize());
    observer.observe(this._canvas);
    this._onResize(); // initial sizing
  }

  _onResize() {
    const dpr = window.devicePixelRatio || 1;
    const w   = this._canvas.clientWidth;
    const h   = this._canvas.clientHeight;

    // Only resize if dimensions actually changed (avoids needless repaints)
    if (this._canvas.width !== Math.round(w * dpr) ||
        this._canvas.height !== Math.round(h * dpr)) {
      this._canvas.width  = Math.round(w * dpr);
      this._canvas.height = Math.round(h * dpr);
      this._mapDirty = true; // map proportions may have shifted
    }
  }
}

export default Renderer;
