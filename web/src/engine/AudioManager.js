/**
 * AudioManager.js
 *
 * Minimal Web Audio API sound effects using oscillators.
 * No external assets — all sounds generated procedurally.
 *
 * Mobile note: Web Audio requires a user-gesture to resume.
 * The touch controls already provide this, so audio works
 * after the first tap on any button.
 *
 * Sounds:
 *   playPickup()   — short high bip (package collected)
 *   playDelivery() — ascending two-tone chord (delivery complete)
 *   playRevEngine()— subtle periodic rumble at low volume (driving feel, optional)
 */

export class AudioManager {
  constructor() {
    this._ctx = null;
    this._initContext();
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /** Short bright bip — package collected. */
  playPickup() {
    this._beep({ freq: 880, duration: 0.12, type: 'sine', gain: 0.25 });
  }

  /** Ascending two-tone chord — delivery complete. */
  playDelivery() {
    this._beep({ freq: 523, duration: 0.12, type: 'sine', gain: 0.25, delay: 0    });
    this._beep({ freq: 784, duration: 0.18, type: 'sine', gain: 0.30, delay: 0.10 });
    this._beep({ freq: 1047, duration: 0.22, type: 'sine', gain: 0.20, delay: 0.20 });
  }

  /** Resume audio context after a user gesture (call on first touch/key). */
  resume() {
    if (this._ctx?.state === 'suspended') {
      this._ctx.resume().catch(() => {});
    }
  }

  destroy() {
    this._ctx?.close().catch(() => {});
    this._ctx = null;
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  _initContext() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this._ctx = new AC();
    } catch {
      // Audio not available — silent degradation
    }
  }

  /**
   * @param {{ freq: number, duration: number, type: OscillatorType, gain: number, delay?: number }} opts
   */
  _beep({ freq, duration, type, gain, delay = 0 }) {
    if (!this._ctx) return;
    try {
      const t   = this._ctx.currentTime + delay;
      const osc = this._ctx.createOscillator();
      const env = this._ctx.createGain();

      osc.type            = type;
      osc.frequency.value = freq;

      env.gain.setValueAtTime(gain, t);
      env.gain.exponentialRampToValueAtTime(0.001, t + duration);

      osc.connect(env);
      env.connect(this._ctx.destination);

      osc.start(t);
      osc.stop(t + duration + 0.01);
    } catch {
      // Silently ignore — audio is a progressive enhancement
    }
  }
}

export default AudioManager;
