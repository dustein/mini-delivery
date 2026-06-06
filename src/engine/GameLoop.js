/**
 * GameLoop.js
 *
 * Manages the requestAnimationFrame loop.
 * Provides a stable delta time (capped at 100ms to avoid spiral-of-death on
 * tab focus restore) and fires separate update() and render() callbacks.
 *
 * Usage:
 *   const loop = new GameLoop(update, render);
 *   loop.start();
 *   loop.stop();
 */

export class GameLoop {
  /**
   * @param {(dt: number) => void} onUpdate  - Logic tick. dt = elapsed seconds.
   * @param {() => void}           onRender  - Draw tick. Called after every update.
   */
  constructor(onUpdate, onRender) {
    this._onUpdate  = onUpdate;
    this._onRender  = onRender;
    this._rafId     = null;
    this._lastTime  = null;
    this._running   = false;

    // Bind so it can be passed directly to rAF without losing `this`
    this._tick = this._tick.bind(this);
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  start() {
    if (this._running) return;
    this._running  = true;
    this._lastTime = null;          // reset so first dt = 0
    this._rafId    = requestAnimationFrame(this._tick);
  }

  stop() {
    this._running = false;
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  get isRunning() {
    return this._running;
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  _tick(timestamp) {
    if (!this._running) return;

    if (this._lastTime === null) {
      this._lastTime = timestamp;
    }

    // dt in seconds, capped at 100 ms to prevent large jumps after tab-switch
    const dt = Math.min((timestamp - this._lastTime) / 1000, 0.1);
    this._lastTime = timestamp;

    this._onUpdate(dt);
    this._onRender();

    this._rafId = requestAnimationFrame(this._tick);
  }
}

export default GameLoop;
