/**
 * InputManager.js
 *
 * Unified input abstraction — Phase 1C handles keyboard only.
 * Phase 1D will extend this with touch inputs from TouchControls.jsx.
 *
 * Two modes of reading input:
 *   - Held state  : isAccelerating(), isBraking() — polled every frame
 *   - Just-pressed: consumeAction(key) — one-shot, cleared after read
 *                   Used for ← → in DECIDING state (avoid 60x/s cycling)
 */

export class InputManager {
  constructor() {
    this._held        = new Set();  // keys currently held down
    this._justPressed = new Set();  // keys pressed this frame (one-shot)

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp   = this._onKeyUp.bind(this);

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup',   this._onKeyUp);
  }

  // ─── Held-state queries (polled every frame) ─────────────────────────────

  isAccelerating() { return this._held.has('ArrowUp'); }
  isBraking()      { return this._held.has('ArrowDown'); }
  isTurningLeft()  { return this._held.has('ArrowLeft'); }
  isTurningRight() { return this._held.has('ArrowRight'); }

  // ─── One-shot queries (consumed on read) ────────────────────────────────

  /** Returns true once per physical key-press for the given logical action. */
  consumeLeft()        { return this._consume('ArrowLeft'); }
  consumeRight()       { return this._consume('ArrowRight'); }
  consumeAccelerate()  { return this._consume('ArrowUp'); }

  // ─── Touch injection (called by TouchControls.jsx in Phase 1D) ──────────

  pressKey(key)   { this._held.add(key);    this._justPressed.add(key); }
  releaseKey(key) { this._held.delete(key); }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  /** Call at the END of each game-loop frame to clear one-shot state. */
  flush() {
    this._justPressed.clear();
  }

  destroy() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup',   this._onKeyUp);
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  _onKeyDown(e) {
    const GAME_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    if (GAME_KEYS.includes(e.key)) {
      e.preventDefault(); // block page scroll
      if (!this._held.has(e.key)) {
        // Only register just-pressed on the FIRST keydown (not auto-repeat)
        this._justPressed.add(e.key);
      }
      this._held.add(e.key);
    }
  }

  _onKeyUp(e) {
    this._held.delete(e.key);
  }

  _consume(key) {
    if (this._justPressed.has(key)) {
      this._justPressed.delete(key);
      return true;
    }
    return false;
  }
}

export default InputManager;
