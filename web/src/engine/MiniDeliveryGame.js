/**
 * MiniDeliveryGame.js
 *
 * Main orchestrator — wires all engine sub-systems.
 *
 * Phase 1F additions:
 *   - Vehicle trail (circular buffer of last N positions)
 *   - AudioManager (pickup bip, delivery chord)
 *   - Haptic feedback on objective state transitions
 *   - Bearing + distance to current objective emitted to HUD
 */

import { GraphManager }   from './GraphManager.js';
import { GameLoop }       from './GameLoop.js';
import { Camera }         from './Camera.js';
import { Renderer }       from './Renderer.js';
import { InputManager }   from './InputManager.js';
import { Vehicle }        from './Vehicle.js';
import { GameObjective }  from './GameObjective.js';
import { AudioManager }   from './AudioManager.js';
import { CENTER_NODE_ID } from '../data/mockGraph.js';

const COMPLETE_FLASH_DURATION = 2.0;  // seconds

/** How many px of world-space gap between trail samples. */
const TRAIL_SAMPLE_DIST = 6;
/** Max number of trail points kept. */
const TRAIL_MAX_POINTS  = 30;

export class MiniDeliveryGame {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {(state: object) => void} onStateUpdate
   */
  constructor(canvas, onStateUpdate) {
    this._canvas        = canvas;
    this._onStateUpdate = onStateUpdate ?? (() => {});

    // ── Sub-systems ──────────────────────────────────────────────────────────
    this._gm        = new GraphManager();
    this._input     = new InputManager();
    this._camera    = new Camera(canvas);
    this._renderer  = new Renderer(canvas, this._gm);
    this._vehicle   = new Vehicle(this._gm, CENTER_NODE_ID);
    this._objective = new GameObjective(this._gm);
    this._audio     = new AudioManager();

    // ── Trail ────────────────────────────────────────────────────────────────
    /** @type {Array<{x: number, y: number}>} oldest → newest */
    this._trail         = [];
    this._trailLastX    = null;
    this._trailLastY    = null;

    // ── State tracking for event detection ───────────────────────────────────
    this._prevObjectiveState  = this._objective.state;
    this._completeFlashTimer  = 0;

    this._loop = new GameLoop(
      (dt) => this._update(dt),
      ()     => this._render(),
    );

    // Prime camera
    this._camera.update(this._vehicle.x, this._vehicle.y, 1);
  }

  // ─── React-facing API ────────────────────────────────────────────────────────

  start()   { this._loop.start(); }
  pause()   { this._loop.stop(); }
  resume()  { this._loop.start(); }

  destroy() {
    this._loop.stop();
    this._input.destroy();
    this._audio.destroy();
  }

  cycleZoom()       { this._camera.cycleZoom(); }
  pressKey(key)     { this._audio.resume(); this._input.pressKey(key); }
  releaseKey(key)   { this._input.releaseKey(key); }

  // ─── Game loop ───────────────────────────────────────────────────────────────

  _update(dt) {
    // 1. Vehicle
    this._vehicle.update(dt, this._input);

    // 2. Objective
    const prevState = this._prevObjectiveState;
    this._objective.update(dt, this._vehicle);
    const curState  = this._objective.state;

    // 3. Detect objective state transitions → audio + haptic
    if (curState !== prevState) {
      if (curState === 'DELIVERY') {
        this._audio.playPickup();
        this._vibrate(40);
      } else if (curState === 'COMPLETE') {
        this._audio.playDelivery();
        this._vibrate([50, 30, 80]);
      }
    }
    this._prevObjectiveState = curState;

    // 4. Auto-advance from COMPLETE
    if (curState === 'COMPLETE') {
      this._completeFlashTimer += dt;
      if (this._completeFlashTimer >= COMPLETE_FLASH_DURATION) {
        this._completeFlashTimer = 0;
        this._objective.nextRound();
        this._prevObjectiveState = this._objective.state;
        this._trail = [];          // clear trail on new round
      }
    } else {
      this._completeFlashTimer = 0;
    }

    // 5. Camera
    this._camera.update(this._vehicle.x, this._vehicle.y, dt);

    // 6. Trail — sample by distance to avoid oversampling at low speeds
    this._sampleTrail();

    // 7. Flush one-shot input
    this._input.flush();

    // 8. Emit HUD state
    this._emitState();
  }

  _render() {
    this._renderer.render(this._camera, this._vehicle, this._objective, this._trail);
  }

  // ─── Trail sampling ───────────────────────────────────────────────────────────

  _sampleTrail() {
    const { x, y } = this._vehicle;

    if (this._trailLastX === null) {
      this._trailLastX = x;
      this._trailLastY = y;
    }

    const dx   = x - this._trailLastX;
    const dy   = y - this._trailLastY;
    const dist = Math.hypot(dx, dy);

    if (dist >= TRAIL_SAMPLE_DIST) {
      this._trail.push({ x, y });
      if (this._trail.length > TRAIL_MAX_POINTS) this._trail.shift();
      this._trailLastX = x;
      this._trailLastY = y;
    }
  }

  // ─── State emission ───────────────────────────────────────────────────────────

  _emitState() {
    const obj = this._objective;

    // Bearing from vehicle to current objective node
    const targetNodeId = obj.state === 'PICKUP'
      ? obj.pickupNodeId
      : obj.deliveryNodeId;
    const targetNode = this._gm.getNode(targetNodeId);

    let bearingDeg  = 0;
    let distPx      = 0;

    if (targetNode) {
      const dx = targetNode.x - this._vehicle.x;
      const dy = targetNode.y - this._vehicle.y;
      distPx     = Math.round(Math.hypot(dx, dy));
      bearingDeg = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360;
    }

    this._onStateUpdate({
      // Camera
      zoomLevel:        this._camera.zoomLevel,
      // Vehicle
      speed:            Math.round(Math.abs(this._vehicle.speed)),
      vehicleState:     this._vehicle.state,
      // Objective
      objectiveState:   obj.state,
      totalDeliveries:  obj.totalDeliveries,
      elapsedTime:      obj.elapsedTime,
      lastDeliveryTime: obj.lastDeliveryTime,
      // Navigation
      bearingDeg,
      distPx,
    });
  }

  // ─── Haptic ───────────────────────────────────────────────────────────────────

  /**
   * @param {number | number[]} pattern - ms or array of on/off ms durations
   */
  _vibrate(pattern) {
    try { navigator.vibrate?.(pattern); } catch { /* not supported */ }
  }
}

export default MiniDeliveryGame;
